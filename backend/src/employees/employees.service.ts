// Talks to the "employees_ids" collection in Firestore.
//
// This is the ONLY place employee data is read/written. The controller calls
// these methods; nothing here knows about HTTP. getFirestore() reuses the
// admin app we initialized in main.ts, so no extra setup is needed.
import { BadRequestException, Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

// The shape of one employee document (mirrors the dashboard's mockData.js).
export interface Employee {
  name: string;
  email: string;
  status: 'active' | 'disabled';
  assignedLocationIds: string[];
  // A siteAdmin can issue one-time check-in codes for the sites in their
  // assignedLocationIds. Set by a dashboard admin through update() — it is
  // deliberately absent from SelfProfileChanges so nobody can promote
  // themselves. Missing/undefined is treated as a plain 'employee'.
  role?: 'employee' | 'siteAdmin';
  authUid?: string;
  nationality?: string;
  photoBase64?: string;
}

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

  // Applies a partial update to an employee — used to flip status and to set
  // the list of approved locations. Only known fields are written.
  async update(id: string, changes: Partial<Employee>) {
    const allowed: Partial<Employee> = {};
    if (changes.status !== undefined) allowed.status = changes.status;
    if (changes.assignedLocationIds !== undefined) {
      allowed.assignedLocationIds = changes.assignedLocationIds;
    }
    // Granting site-admin lets someone approve check-ins, so it is only
    // settable here — on the AdminGuard-protected admin route — and never
    // through updateSelf(), which employees can call for their own profile.
    if (changes.role !== undefined) {
      allowed.role = changes.role === 'siteAdmin' ? 'siteAdmin' : 'employee';
    }
    await this.collection.doc(id).update(allowed);
    const doc = await this.collection.doc(id).get();
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
