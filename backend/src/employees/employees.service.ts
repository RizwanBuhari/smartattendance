// Talks to the "employees_ids" collection in Firestore.
//
// This is the ONLY place employee data is read/written. The controller calls
// these methods; nothing here knows about HTTP. getFirestore() reuses the
// admin app we initialized in main.ts, so no extra setup is needed.
import { BadRequestException, Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';

// The shape of one employee document (mirrors the dashboard's mockData.js).
export interface Employee {
  name: string;
  email: string;
  status: 'active' | 'disabled';
  assignedLocationIds: string[];
  // A siteAdmin (or site_supervisor) can issue one-time check-in codes for the
  // sites in their assignedLocationIds, and a supervisor also approves offsite
  // requests. Set by a dashboard admin through update() — deliberately absent
  // from SelfProfileChanges so nobody can promote themselves. Missing/undefined
  // is treated as a plain 'employee'.
  role?: EmployeeRole;
  authUid?: string;
  nationality?: string;
  photoBase64?: string;
  supervisorId?: string;
  supervisorName?: string;
}

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

// The complete set of roles that may be written to an employee document.
// update() checks against this list, so a malformed or invented role can never
// reach the field that the guards, OtpService and firestore.rules read.
export const EMPLOYEE_ROLES = [
  'employee',
  'siteAdmin',
  'site_employee',
  'site_supervisor',
  'onsite_employee',
  'offsite_employee',
] as const;

// The roles allowed to approve a check-in: issue a one-time code, appear in the
// gate screen, and be notified when someone is waiting at their site.
//
// Declared ONCE and imported everywhere, because the two roles were introduced
// by different pieces of work: 'siteAdmin' predates 'site_supervisor'. When the
// approver test was written out by hand in each service they drifted, and
// CodeRequestsService kept alerting only 'siteAdmin' — so a site whose only
// approver was a supervisor logged "no active site admin" and silently notified
// nobody. Add a new approving role here and every call site follows.
export const APPROVER_ROLES: readonly EmployeeRole[] = [
  'siteAdmin',
  'site_supervisor',
];


// What the mobile app sends to link/create its own employee record right
// after Firebase Auth account creation during registration.
export interface RegisterSelfRequest {
  authUid: string;
  name: string;
  email: string;
  nationality: string;
  // Set when the company code was issued for a specific employee the admin
  // already created — links to that doc instead of creating a new one.
  employeeId?: string;
}

// What the mobile app's own profile screen may change about itself — a
// narrower set than the admin-facing `update()`, which also controls
// `status` and `assignedLocationIds` (those stay admin-only).
export interface SelfProfileChanges {
  name?: string;
  nationality?: string;
  photoBase64?: string;
}

@Injectable()
export class EmployeesService {
  private readonly db = getFirestore();
  // A handle to the "employees_ids" collection.
  private readonly collection = this.db.collection('employees_ids');

  constructor(private readonly redis: RedisService) {}

  // Returns every employee. Each doc's Firestore ID becomes the `id` field, so
  // the dashboard gets { id, name, email, ... } just like the old mock data.
  async findAll() {
    const snapshot = await this.collection.get();
    // Spread data first, then id — the Firestore doc id must win over any
    // stored `id` field, so delete/update target the right record.
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  // Adds one employee. Firestore generates the ID; we return it with the data.
  async create(employee: Employee) {
    const ref = await this.collection.add(employee);
    return { id: ref.id, ...employee };
  }

  // Applies a partial update to an employee — used to flip status, set locations,
  // role, and supervisor. Logs role change audits to 'role_audits'.
  async update(id: string, changes: Partial<Employee>, adminEmail?: string) {
    const docRef = this.collection.doc(id);
    const prevSnap = await docRef.get();
    const prevData = prevSnap.data() as Employee | undefined;
    const prevRole = prevData?.role || 'employee';

    const allowed: Partial<Employee> = {};
    if (changes.status !== undefined) allowed.status = changes.status;
    if (changes.assignedLocationIds !== undefined) {
      allowed.assignedLocationIds = changes.assignedLocationIds;
    }
    // Granting an elevated role lets someone approve check-ins and offsite
    // requests, so role is only settable here — on the AdminGuard-protected
    // admin route — and never through updateSelf(), which employees call for
    // their own profile. The value is checked against EMPLOYEE_ROLES so an
    // arbitrary string can never land in the field the guards and rules read.
    if (changes.role !== undefined) {
      allowed.role = EMPLOYEE_ROLES.includes(changes.role)
        ? changes.role
        : 'employee';
    }
    if (changes.supervisorId !== undefined) {
      allowed.supervisorId = changes.supervisorId || undefined;
    }
    if (changes.supervisorName !== undefined) {
      allowed.supervisorName = changes.supervisorName || undefined;
    }

    await docRef.update(allowed);

    if (prevData?.authUid) {
      await this.redis.del(`auth:employee:${prevData.authUid}`);
    }

    // If the role changed, write an entry to 'role_audits'.
    // NOTE: the custom claims stamped at sign-in (siteAdmin/employeeId) are NOT
    // refreshed here, so a role change only reaches firestore.rules after the
    // employee signs in again. Stamping them at this point is tracked separately.
    if (allowed.role !== undefined && allowed.role !== prevRole) {
      await this.db.collection('role_audits').add({
        employeeId: id,
        employeeName: prevData?.name || id,
        changedBy: adminEmail || 'system',
        changedAt: new Date().toISOString(),
        previousRole: prevRole,
        newRole: allowed.role,
      });
    }

    const doc = await docRef.get();
    return { ...doc.data(), id };
  }

  // Finds an employee by their Firebase Auth UID — used by the mobile app's
  // own profile screen, so it never has to query Firestore directly (which
  // depends on Firestore Security Rules being configured to allow it; the
  // Admin SDK here bypasses rules entirely, same as everything else in this
  // backend).
  async findByAuthUid(authUid: string) {
    const snapshot = await this.collection
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id };
  }

  // Applies the employee's own edits to their own record — a narrower set of
  // fields than the admin-facing `update()` above.
  async updateSelf(authUid: string, changes: SelfProfileChanges) {
    const snapshot = await this.collection
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];

    const allowed: SelfProfileChanges = {};
    if (changes.name !== undefined) allowed.name = changes.name;
    if (changes.nationality !== undefined)
      allowed.nationality = changes.nationality;
    if (changes.photoBase64 !== undefined)
      allowed.photoBase64 = changes.photoBase64;

    await doc.ref.update(allowed);
    await this.redis.del(`auth:employee:${authUid}`);
    const updated = await doc.ref.get();
    return { ...updated.data(), id: updated.id };
  }

  // Called by AuthService during registration — either links the new Firebase
  // account to an employee record the admin already created (company code
  // issued for a specific person), or creates a brand-new standalone record
  // (a code with no employee tied to it yet).
  //
  // `employeeId` MUST come from the consumed invite code, never from the
  // request body. Pointing an existing record at a new authUid is equivalent to
  // becoming that person — inheriting their role, their site access, their
  // history — so the guards below refuse to do it unless the record is
  // genuinely unclaimed and the email matches what the admin registered.
  // AuthService already derives the id from the code; these checks are the
  // second line, and hold even if a future caller gets that wrong.
  async registerSelf(request: RegisterSelfRequest) {
    const { authUid, name, email, nationality, employeeId } = request;

    if (employeeId) {
      const ref = this.collection.doc(employeeId);
      const existing = await ref.get();

      if (!existing.exists) {
        throw new BadRequestException(
          'That code points at an employee record that no longer exists.',
        );
      }
      const current = existing.data() as Employee;
      if (current.authUid && current.authUid !== authUid) {
        throw new BadRequestException(
          'That employee already has a login. Sign in instead, or ask your admin for help.',
        );
      }
      if (
        current.email &&
        current.email.trim().toLowerCase() !== email.trim().toLowerCase()
      ) {
        throw new BadRequestException(
          'Email must match the one your admin registered for you.',
        );
      }

      await ref.update({ authUid, name, nationality });
      await this.redis.del(`auth:employee:${authUid}`);
      const doc = await ref.get();
      return { ...doc.data(), id: doc.id };
    }

    const employee: Employee = {
      name,
      email,
      status: 'active',
      assignedLocationIds: [],
      nationality,
      authUid,
    };
    // Keyed by the auth UID itself (not a random Firestore ID) — mirrors
    // what the mobile app used to do when it wrote this directly.
    await this.collection.doc(authUid).set(employee);
    return { ...employee, id: authUid };
  }

  // Deletes an employee and cleans up everything tied to them: their attendance
  // records and invite codes. The Firebase Auth login, if any, is separate and
  // can be removed from the Firebase console.
  //
  // Attendance is keyed by `employeeId`, which is the Firebase UID for a
  // registered user (stored on the employee doc as `authUid`) but may also be
  // the employee doc's id for admin-created records — so we delete records
  // matching either key.
  async remove(id: string) {
    const doc = await this.collection.doc(id).get();
    const authUid = (doc.data() as { authUid?: string } | undefined)?.authUid;
    const keys = [id, authUid].filter((k): k is string => !!k);

    const attendance = this.db.collection('attendance_ids');
    for (const key of keys) {
      const snap = await attendance.where('employeeId', '==', key).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }

    const codes = await this.db
      .collection('company_Codes')
      .where('employeeId', '==', id)
      .get();
    await Promise.all(codes.docs.map((d) => d.ref.delete()));

    await this.collection.doc(id).delete();
    return { id };
  }

  // One-time helper: fills the collection with sample data so the dashboard has
  // something to show. Safe to remove once you add real employees via the UI.
  async seed() {
    const samples: Employee[] = [
      {
        name: 'Amash Aal',
        email: 'amash@example.com',
        status: 'active',
        assignedLocationIds: [],
      },
      {
        name: 'Rizwan Buhari',
        email: 'rizwan@example.com',
        status: 'active',
        assignedLocationIds: [],
      },
      {
        name: 'Sara Khan',
        email: 'sara@example.com',
        status: 'disabled',
        assignedLocationIds: [],
      },
    ];
    for (const employee of samples) {
      await this.collection.add(employee);
    }
    return { seeded: samples.length };
  }
}
