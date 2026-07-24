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
}

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_ROLES = [
  'onsite_employee',
  'offsite_employee',
  'site_supervisor',
  // legacy compatibility roles
  'employee',
  'siteAdmin',
  'site_employee',
] as const;

export const ACTIVE_ROLES = [
  'onsite_employee',
  'offsite_employee',
  'site_supervisor',
] as const;

export const APPROVER_ROLES: readonly EmployeeRole[] = [
  'site_supervisor',
  'siteAdmin',
];

export function normalizeRole(role?: string): 'onsite_employee' | 'offsite_employee' | 'site_supervisor' {
  if (role === 'siteAdmin' || role === 'site_supervisor') return 'site_supervisor';
  if (role === 'site_employee' || role === 'offsite_employee') return 'offsite_employee';
  return 'onsite_employee';
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

  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  private async validateSupervisorAssignment(
    employeeId: string | null,
    role: string,
    supervisorId?: string,
    locationIds?: string[],
    companyId?: string,
  ) {
    const normRole = normalizeRole(role);
    if (normRole !== 'offsite_employee') return;

    if (!supervisorId) {
      throw new BadRequestException('An Offsite Employee must have an assigned site supervisor.');
    }
    if (employeeId && supervisorId === employeeId) {
      throw new BadRequestException('An employee cannot be assigned as their own supervisor.');
    }

    const supSnap = await this.collection.doc(supervisorId).get();
    if (!supSnap.exists || !supSnap.data()) {
      throw new BadRequestException('Assigned supervisor record not found.');
    }
    const supData = supSnap.data()!;
    if (supData.status !== 'active') {
      throw new BadRequestException('Cannot assign a disabled employee as supervisor.');
    }
    const supRole = normalizeRole(supData.role);
    if (supRole !== 'site_supervisor') {
      throw new BadRequestException('Assigned supervisor must hold the site_supervisor role.');
    }

    if (companyId && supData.companyId && companyId !== supData.companyId) {
      throw new BadRequestException('Employee and supervisor must belong to the same company.');
    }

    if (locationIds && locationIds.length > 0 && supData.assignedLocationIds?.length) {
      const sharesSite = locationIds.some((id) => supData.assignedLocationIds.includes(id));
      if (!sharesSite) {
        throw new BadRequestException('Supervisor must be assigned to at least one of the employee worksites.');
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

    const newRole = changes.role !== undefined ? normalizeRole(changes.role) : prevRole;
    const newSupId = changes.supervisorId !== undefined ? changes.supervisorId : prevData?.supervisorId;
    const newLocations = changes.assignedLocationIds !== undefined ? changes.assignedLocationIds : prevData?.assignedLocationIds;
    const companyId = prevData?.companyId || employeeCompany(prevData);

    await this.validateSupervisorAssignment(id, newRole, newSupId, newLocations, companyId);

    const allowed: Partial<Employee> = {};
    if (changes.status !== undefined) allowed.status = changes.status;
    if (changes.assignedLocationIds !== undefined) {
      allowed.assignedLocationIds = changes.assignedLocationIds;
    }
    if (changes.role !== undefined) {
      allowed.role = newRole;
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
    if (changes.nationality !== undefined) allowed.nationality = changes.nationality;
    if (changes.photoBase64 !== undefined) allowed.photoBase64 = changes.photoBase64;

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
        throw new BadRequestException('That code points at an employee record that no longer exists.');
      }
      const current = existing.data() as Employee;
      if (current.authUid && current.authUid !== authUid) {
        throw new BadRequestException('That record is already linked to another user account.');
      }
      if (current.email && current.email.toLowerCase() !== email.toLowerCase()) {
        throw new BadRequestException('That code was issued for a different email address.');
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
      role: 'onsite_employee',
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
