// Requirement #5 — role rename + backend authorization by role.
//
// Verifies:
//   • normalizeRole() collapses every legacy AND canonical value correctly, so
//     an un-migrated record keeps working (backward compatibility).
//   • The backend — not just the mobile UI — enforces which role may call the
//     offsite check-in endpoints, so a user can't bypass the UI by calling the
//     API directly.
import { db, firestoreMock } from '../offsite-checkin/__fakes__/fake-firestore';
import { FakeRedis } from '../offsite-checkin/__fakes__/fake-redis';

jest.mock('firebase-admin/firestore', () => firestoreMock);

import { normalizeRole, EmployeesService } from './employees.service';
import { OtpService } from '../otp/otp.service';
import { OffsiteQrTokenService } from '../offsite-checkin/offsite-qr-token.service';
import { OffsiteCheckinService } from '../offsite-checkin/offsite-checkin.service';

describe('normalizeRole (canonical + legacy)', () => {
  it('maps office roles', () => {
    expect(normalizeRole('office_employee')).toBe('office_employee');
    expect(normalizeRole('onsite_employee')).toBe('office_employee'); // legacy
    expect(normalizeRole('employee')).toBe('office_employee'); // legacy
    expect(normalizeRole(undefined)).toBe('office_employee'); // safe default
  });
  it('maps site roles', () => {
    expect(normalizeRole('site_employee')).toBe('site_employee');
    expect(normalizeRole('offsite_employee')).toBe('site_employee'); // legacy
  });
  it('maps supervisor roles', () => {
    expect(normalizeRole('site_supervisor')).toBe('site_supervisor');
    expect(normalizeRole('siteAdmin')).toBe('site_supervisor'); // legacy
  });
});

const fakePush = { sendToEmployees: async () => {} };

function makeService() {
  const redis = new FakeRedis();
  const otp = new OtpService(redis as any);
  const qr = new OffsiteQrTokenService(otp);
  return new OffsiteCheckinService(qr, fakePush as any);
}

const SUP = {
  id: 'SUP1',
  name: 'Sam Supervisor',
  role: 'site_supervisor',
  status: 'active',
  authUid: 'sup-uid',
  companyId: 'c1',
  assignedLocationIds: ['W1'],
};

function seedWorld() {
  db.reset();
  db.seed('employees_ids', SUP.id, { ...SUP });
  db.seed('locations_ids', 'W1', {
    name: 'North Site',
    latitude: 25,
    longitude: 55,
    radiusMeters: 150,
  });
}

function employee(role: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'EMP1',
    authUid: 'emp-uid',
    name: 'Eddie',
    role,
    status: 'active',
    companyId: 'c1',
    supervisorId: 'SUP1',
    supervisorName: 'Sam Supervisor',
    assignedLocationIds: ['W1'],
    ...overrides,
  } as any;
}

describe('Offsite check-in is gated by role on the BACKEND', () => {
  beforeEach(seedWorld);

  it('rejects an office employee (wrong role) calling the API directly', async () => {
    const svc = makeService();
    await expect(
      svc.createRequest(employee('office_employee'), { worksiteId: 'W1' }),
    ).rejects.toThrow(/Only site employees/i);
  });

  it('rejects a supervisor from requesting an offsite check-in', async () => {
    const svc = makeService();
    await expect(
      svc.createRequest(employee('site_supervisor'), { worksiteId: 'W1' }),
    ).rejects.toThrow(/Only site employees/i);
  });

  it('allows a canonical site_employee', async () => {
    const svc = makeService();
    const res = await svc.createRequest(employee('site_employee'), {
      worksiteId: 'W1',
    });
    expect((res as any).status).toBe('pending_approval');
    expect((res as any).requestType).toBe('check_in');
  });

  it('allows a legacy offsite_employee (backward compatibility)', async () => {
    const svc = makeService();
    const res = await svc.createRequest(employee('offsite_employee'), {
      worksiteId: 'W1',
    });
    expect((res as any).status).toBe('pending_approval');
  });

  it('rejects a non-supervisor from viewing the approvals queue', async () => {
    const svc = makeService();
    await expect(
      svc.getSupervisorRequests(employee('site_employee')),
    ).rejects.toThrow(/Only site supervisors/i);
  });
});

describe('Employees.findAll scope filtering (requirement #3, backend-enforced)', () => {
  function seedPeople() {
    db.reset();
    db.seed('employees_ids', 'E_OFFICE', {
      name: 'Olivia',
      role: 'office_employee',
      status: 'active',
    });
    db.seed('employees_ids', 'E_SITE', {
      name: 'Sina',
      role: 'site_employee',
      status: 'active',
    });
    db.seed('employees_ids', 'E_SUP', {
      name: 'Sam',
      role: 'site_supervisor',
      status: 'active',
    });
    db.seed('employees_ids', 'E_LEGACY_ADMIN', {
      name: 'Legacy',
      role: 'siteAdmin',
      status: 'active',
    });
    db.seed('employees_ids', 'E_LEGACY_ONSITE', {
      name: 'Old',
      role: 'onsite_employee',
      status: 'active',
    });
  }
  const svc = () => new EmployeesService(new FakeRedis() as any);

  beforeEach(seedPeople);

  it('scope=staff excludes supervisors and legacy admins', async () => {
    const rows = await svc().findAll('staff');
    const ids = rows.map((r: any) => r.id).sort();
    expect(ids).toEqual(['E_LEGACY_ONSITE', 'E_OFFICE', 'E_SITE']);
  });

  it('scope=supervisors returns only supervisors (canonical + legacy siteAdmin)', async () => {
    const rows = await svc().findAll('supervisors');
    const ids = rows.map((r: any) => r.id).sort();
    expect(ids).toEqual(['E_LEGACY_ADMIN', 'E_SUP']);
  });

  it('no scope returns everyone', async () => {
    const rows = await svc().findAll();
    expect(rows).toHaveLength(5);
  });
});

describe('Self-profile update cannot escalate role or re-enable (requirement #4)', () => {
  it('ignores role/status in updateSelf; only profile fields change', async () => {
    db.reset();
    db.seed('employees_ids', 'ME', {
      name: 'Original',
      role: 'office_employee',
      status: 'active',
      authUid: 'me-uid',
      assignedLocationIds: [],
    });
    const svc = new EmployeesService(new FakeRedis() as any);

    // A malicious client tries to promote themselves and change locations.
    const updated: any = await svc.updateSelf('me-uid', {
      name: 'New Name',
      // These are NOT part of SelfProfileChanges and must be dropped.
      role: 'site_supervisor',
      status: 'disabled',
      assignedLocationIds: ['SECRET'],
    } as any);

    expect(updated.name).toBe('New Name'); // allowed field applied
    expect(updated.role).toBe('office_employee'); // unchanged
    expect(updated.status).toBe('active'); // unchanged
    expect(updated.assignedLocationIds).toEqual([]); // unchanged
  });
});
