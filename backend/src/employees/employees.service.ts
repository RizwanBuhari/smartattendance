// Talks to the "employees_ids" collection in Firestore.
import { BadRequestException, Injectable } from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';

export interface Employee {
  name: string;
  email: string;
  status: 'active' | 'disabled';
  assignedLocationIds: string[];
  role?: EmployeeRole;
  authUid?: string;
  companyId?: string;
  nationality?: string;
  photoBase64?: string;
  supervisorId?: string;
  supervisorName?: string;
  attendanceMethod?: 'geofence' | 'biometric_geofence' | 'biometric';
  biometricRequired?: boolean;
  biometricSetupCompleted?: boolean;
  biometricDeviceId?: string | null;
  biometricDeviceName?: string | null;
  biometricActivatedAt?: string | null;
  biometricResetAt?: string | null;
}

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

// Canonical roles (user-facing names in parentheses):
//   office_employee  ("Office employee") — works in the office; geofence-only
//                    check-in. Formerly `onsite_employee` / "Onsite Employee".
//   site_employee    ("Site employee")   — works on a site, offsite from the
//                    office; supervisor-QR check-in. Formerly
//                    `offsite_employee` / "Offsite employee".
//   site_supervisor  ("Site Supervisor") — approves site employees' check-ins.
//
// Legacy values are still accepted on read and mapped by normalizeRole(); the
// one-off migration (scripts/migrate-roles.ts) rewrites stored docs to the
// canonical values. Keeping the legacy names here means an un-migrated record
// never fails validation.
export const CANONICAL_ROLES = [
  'office_employee',
  'site_employee',
  'site_supervisor',
] as const;

export const EMPLOYEE_ROLES = [
  ...CANONICAL_ROLES,
  // legacy compatibility roles
  'onsite_employee',
  'offsite_employee',
  'employee',
  'siteAdmin',
] as const;

export const ACTIVE_ROLES = CANONICAL_ROLES;

export const APPROVER_ROLES: readonly EmployeeRole[] = [
  'site_supervisor',
  'siteAdmin',
];

export type NormalizedRole = (typeof CANONICAL_ROLES)[number];

// Collapses any stored/legacy role string to one canonical role. This is the
// single source of truth for role meaning, so callers compare against the
// canonical values only.
export function normalizeRole(role?: string): NormalizedRole {
  if (role === 'siteAdmin' || role === 'site_supervisor')
    return 'site_supervisor';
  // Site employee = works on a site (offsite from the office).
  if (role === 'offsite_employee' || role === 'site_employee')
    return 'site_employee';
  // Office employee = works in the office (onsite). Also the safe default.
  return 'office_employee';
}

export interface RegisterSelfRequest {
  authUid: string;
  name: string;
  email: string;
  nationality: string;
  employeeId?: string;
}

export interface SelfProfileChanges {
  name?: string;
  nationality?: string;
  photoBase64?: string;
}

@Injectable()
export class EmployeesService {
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('employees_ids');

  constructor(private readonly redis: RedisService) {}

  // Lists employees, optionally scoped by role so supervisors/admins can be kept
  // OUT of the normal staff list (requirement #3). Enforced here on the backend,
  // not just in the dashboard: `scope='staff'` returns office + site employees
  // only; `scope='supervisors'` returns site supervisors (incl. legacy
  // siteAdmin); omitted returns everyone (used by internal callers that need the
  // full set). Filtering goes through normalizeRole so legacy role values are
  // classified correctly even before the migration runs.
  async findAll(scope?: 'staff' | 'supervisors') {
    const snapshot = await this.collection.get();
    const all = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    if (scope !== 'staff' && scope !== 'supervisors') return all;
    return all.filter((emp) => {
      const isSupervisor =
        normalizeRole((emp as { role?: string }).role) === 'site_supervisor';
      return scope === 'supervisors' ? isSupervisor : !isSupervisor;
    });
  }

  private async validateSupervisorAssignment(
    employeeId: string | null,
    role: string,
    supervisorId?: string,
    locationIds?: string[],
    companyId?: string,
  ) {
    const normRole = normalizeRole(role);
    if (normRole !== 'site_employee') return;

    if (!supervisorId) {
      throw new BadRequestException(
        'A Site employee must have an assigned site supervisor.',
      );
    }
    if (employeeId && supervisorId === employeeId) {
      throw new BadRequestException(
        'An employee cannot be assigned as their own supervisor.',
      );
    }

    const supSnap = await this.collection.doc(supervisorId).get();
    if (!supSnap.exists || !supSnap.data()) {
      throw new BadRequestException('Assigned supervisor record not found.');
    }
    const supData = supSnap.data()!;
    if (supData.status !== 'active') {
      throw new BadRequestException(
        'Cannot assign a disabled employee as supervisor.',
      );
    }
    const supRole = normalizeRole(supData.role);
    if (supRole !== 'site_supervisor') {
      throw new BadRequestException(
        'Assigned supervisor must hold the site_supervisor role.',
      );
    }

    if (companyId && supData.companyId && companyId !== supData.companyId) {
      throw new BadRequestException(
        'Employee and supervisor must belong to the same company.',
      );
    }

    if (
      locationIds &&
      locationIds.length > 0 &&
      supData.assignedLocationIds &&
      supData.assignedLocationIds.length > 0
    ) {
      const sharesSite = locationIds.some((id) =>
        supData.assignedLocationIds.includes(id),
      );
      if (!sharesSite) {
        // Auto-assign the worksite to the supervisor so they can manage this employee
        const updatedSupLocs = Array.from(
          new Set([...supData.assignedLocationIds, ...locationIds]),
        );
        await this.collection.doc(supervisorId).update({
          assignedLocationIds: updatedSupLocs,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  async create(employee: Employee) {
    const normRole = normalizeRole(employee.role);
    await this.validateSupervisorAssignment(
      null,
      normRole,
      employee.supervisorId,
      employee.assignedLocationIds,
      employee.companyId,
    );

    const dataToSave = {
      ...employee,
      role: normRole,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await this.collection.add(dataToSave);
    return { id: ref.id, ...dataToSave };
  }

  async update(id: string, changes: Partial<Employee>, adminEmail?: string) {
    const docRef = this.collection.doc(id);
    const prevSnap = await docRef.get();
    const prevData = prevSnap.data() as Employee | undefined;
    const prevRole = normalizeRole(prevData?.role);

    const newRole =
      changes.role !== undefined ? normalizeRole(changes.role) : prevRole;
    const newSupId =
      changes.supervisorId !== undefined
        ? changes.supervisorId
        : prevData?.supervisorId;
    const newLocations =
      changes.assignedLocationIds !== undefined
        ? changes.assignedLocationIds
        : prevData?.assignedLocationIds;
    const companyId = prevData?.companyId || employeeCompany(prevData);

    await this.validateSupervisorAssignment(
      id,
      newRole,
      newSupId,
      newLocations,
      companyId,
    );

    const allowed: Partial<Employee> = {};
    if (changes.status !== undefined) allowed.status = changes.status;
    if (changes.assignedLocationIds !== undefined) {
      allowed.assignedLocationIds = changes.assignedLocationIds;
    }
    if (changes.role !== undefined) {
      allowed.role = newRole;
    }
    if (changes.attendanceMethod !== undefined) {
      allowed.attendanceMethod = changes.attendanceMethod;
    }

    const update: Record<string, unknown> = {
      ...allowed,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (changes.supervisorId !== undefined) {
      update.supervisorId = changes.supervisorId || FieldValue.delete();
    }
    if (changes.supervisorName !== undefined) {
      update.supervisorName = changes.supervisorName || FieldValue.delete();
    }

    await docRef.update(update);

    if (prevData?.authUid) {
      await this.redis.del(`auth:employee:${prevData.authUid}`);
    }

    // Role audit trail saved with server timestamp
    if (allowed.role !== undefined && allowed.role !== prevRole) {
      await this.db.collection('role_audit_logs').add({
        employeeId: id,
        employeeName: prevData?.name || id,
        changedBy: adminEmail || 'admin',
        changedAt: FieldValue.serverTimestamp(),
        previousRole: prevRole,
        newRole: allowed.role,
      });
      // also write to role_audits for backwards compatibility
      await this.db.collection('role_audits').add({
        employeeId: id,
        employeeName: prevData?.name || id,
        changedBy: adminEmail || 'admin',
        changedAt: FieldValue.serverTimestamp(),
        previousRole: prevRole,
        newRole: allowed.role,
      });
    }

    const doc = await docRef.get();
    return { ...doc.data(), id };
  }

  async findByAuthUid(authUid: string) {
    const snapshot = await this.collection
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id };
  }

  async updateSelf(authUid: string, changes: SelfProfileChanges) {
    const snapshot = await this.collection
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];

    const allowed: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
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
          'That record is already linked to another user account.',
        );
      }
      if (
        current.email &&
        current.email.toLowerCase() !== email.toLowerCase()
      ) {
        throw new BadRequestException(
          'That code was issued for a different email address.',
        );
      }

      await ref.update({
        authUid,
        name: current.name || name,
        nationality: current.nationality || nationality,
        status: 'active',
        role: normalizeRole(current.role),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await this.redis.del(`auth:employee:${authUid}`);
      const updated = await ref.get();
      return { ...updated.data(), id: ref.id };
    }

    const newEmp: Record<string, unknown> = {
      name,
      email,
      nationality,
      authUid,
      status: 'active',
      role: 'office_employee',
      assignedLocationIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await this.collection.add(newEmp);
    return { id: ref.id, ...newEmp };
  }

  async remove(id: string) {
    const docRef = this.collection.doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new BadRequestException('Employee not found.');
    await docRef.delete();
    return { id, deleted: true };
  }

  async seed() {
    return { message: 'Employees collection initialized.' };
  }
}

function employeeCompany(data?: Employee): string {
  return data?.companyId || 'default_company';
}
