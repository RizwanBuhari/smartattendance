import { db, firestoreMock } from './__fakes__/fake-firestore';
import { FakeRedis } from './__fakes__/fake-redis';

jest.mock('firebase-admin/firestore', () => firestoreMock);

import { OtpService } from '../otp/otp.service';
import { OffsiteQrTokenService } from './offsite-qr-token.service';
import { OffsiteCheckinService } from './offsite-checkin.service';

const SUP = {
  id: 'SUP1',
  name: 'Sam Supervisor',
  role: 'site_supervisor',
  status: 'active',
  authUid: 'sup-uid',
  companyId: 'company_1',
  assignedLocationIds: ['W1', 'W2'],
};
const EMP = {
  id: 'EMP1',
  name: 'Eddie Employee',
  role: 'offsite_employee',
  status: 'active',
  authUid: 'emp-uid',
  companyId: 'company_1',
  supervisorId: 'SUP1',
  supervisorName: 'Sam Supervisor',
  assignedLocationIds: ['W1', 'W2'],
};

function seedWorld(worksiteId = 'W1') {
  db.reset();
  db.seed('employees_ids', SUP.id, { ...SUP });
  db.seed('employees_ids', EMP.id, { ...EMP });
  db.seed('locations_ids', 'W1', { name: 'North Tower Site', latitude: 25, longitude: 55, radiusMeters: 150 });
  db.seed('locations_ids', 'W2', { name: 'South Tower Site', latitude: 25.1, longitude: 55.1, radiusMeters: 150 });
  db.seed('offsite_requests', 'REQ1', {
    companyId: 'company_1',
    employeeId: EMP.id,
    employeeName: EMP.name,
    employeeUid: EMP.authUid,
    supervisorId: SUP.id,
    supervisorName: SUP.name,
    worksiteId,
    worksiteName: 'North Tower Site',
    requestType: 'check_in',
    status: 'pending_approval',
    reason: 'Delivering equipment',
  });
}

function makeServices() {
  const redis = new FakeRedis();
  const otp = new OtpService(redis as any);
  const qr = new OffsiteQrTokenService(otp);
  const svc = new OffsiteCheckinService(qr);
  return { svc, redis, qr };
}

describe('Offsite approval via QR code & checkout audit suite', () => {
  const realEnv = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DEBUG_QR_GENERATOR = 'true';
  });
  afterEach(() => {
    process.env = { ...realEnv };
  });

  it('happy path: supervisor approves → generate QR → employee scans → checked in', async () => {
    seedWorld();
    const { svc } = makeServices();

    const approved = await svc.acceptRequest(SUP as any, 'REQ1');
    expect(approved.status).toBe('approved_waiting_qr');

    const generated = await svc.generateQr(SUP as any, 'REQ1');
    expect(generated.status).toBe('qr_ready');

    const req = db.read('offsite_requests', 'REQ1');
    const code = req.qrPayload as string;
    expect(code).toMatch(/^\d{6}$/);

    const result = await svc.verifyScannedQr(EMP as any, {
      requestId: 'REQ1',
      scannedPayload: code,
      latitude: 25.0001,
      longitude: 55.0001,
      gpsAccuracy: 8,
      deviceId: 'pixel-test',
    });
    expect(result.accepted).toBe(true);
    expect(result.attendanceId).toBeTruthy();

    const done = db.read('offsite_requests', 'REQ1');
    expect(done.status).toBe('completed');
    const attendance = db.all('attendance_ids');
    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toMatchObject({
      employeeId: 'EMP1',
      attendanceType: 'offsite',
      checkInMethod: 'supervisor_qr',
      status: 'checked_in',
    });
  });

  it('offsite checkout flow: creates checkout request → approves → generates QR → scans → updates existing attendance doc', async () => {
    seedWorld();
    const { svc } = makeServices();

    // 1. Check in employee
    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const checkinCode = db.read('offsite_requests', 'REQ1').qrPayload as string;
    const checkinRes = await svc.verifyScannedQr(EMP as any, {
      requestId: 'REQ1',
      scannedPayload: checkinCode,
      latitude: 25.0,
      longitude: 55.0,
    });
    const attId = checkinRes.attendanceId;

    // 2. Submit offsite checkout request
    const checkoutReq = await svc.createCheckoutRequest(EMP as any, { worksiteId: 'W1', reason: 'Shift finished' });
    expect(checkoutReq.requestType).toBe('check_out');
    expect(checkoutReq.attendanceId).toBe(attId);

    // 3. Supervisor accepts & generates checkout QR
    await svc.acceptRequest(SUP as any, checkoutReq.id);
    await svc.generateQr(SUP as any, checkoutReq.id);
    const checkoutCode = db.read('offsite_requests', checkoutReq.id).qrPayload as string;

    // 4. Employee scans checkout QR
    const checkoutRes = await svc.verifyScannedQr(EMP as any, {
      requestId: checkoutReq.id,
      scannedPayload: checkoutCode,
      latitude: 25.0002,
      longitude: 55.0002,
    });
    expect(checkoutRes.accepted).toBe(true);
    expect(checkoutRes.status).toBe('checked_out');

    // 5. Verify NO SECOND attendance document was created
    const attendance = db.all('attendance_ids');
    expect(attendance).toHaveLength(1);
    expect(attendance[0].id).toBe(attId);
    expect(attendance[0].status).toBe('checked_out');
    expect(attendance[0].checkOutMethod).toBe('supervisor_qr');
    expect(attendance[0].offsiteCheckoutRequestId).toBe(checkoutReq.id);
  });

  it('checkout rejection leaves employee checked in', async () => {
    seedWorld();
    const { svc } = makeServices();

    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;
    await svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 });

    const checkoutReq = await svc.createCheckoutRequest(EMP as any, { worksiteId: 'W1', reason: 'Leaving early' });
    await svc.rejectRequest(SUP as any, checkoutReq.id, 'Work not finished');

    const rejectedDoc = db.read('offsite_requests', checkoutReq.id);
    expect(rejectedDoc.status).toBe('rejected');

    // Attendance record remains checked_in
    const attendance = db.all('attendance_ids');
    expect(attendance[0].status).toBe('checked_in');
  });

  it('regeneration revokes old token generation', async () => {
    seedWorld();
    const { svc } = makeServices();

    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const oldCode = db.read('offsite_requests', 'REQ1').qrPayload as string;

    await svc.regenerateQr(SUP as any, 'REQ1');
    const newCode = db.read('offsite_requests', 'REQ1').qrPayload as string;
    expect(newCode).not.toBe(oldCode);

    // Old code fails scan
    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: oldCode, latitude: 25, longitude: 55 }),
    ).rejects.toThrow();

    // New code passes scan
    const res = await svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: newCode, latitude: 25, longitude: 55 });
    expect(res.accepted).toBe(true);
  });

  it('unauthorized supervisor cannot handle request', async () => {
    seedWorld();
    const { svc } = makeServices();
    const rogueSup = { ...SUP, id: 'SUP_ROGUE', authUid: 'rogue-uid' };

    await expect(svc.acceptRequest(rogueSup as any, 'REQ1')).rejects.toThrow(/not assigned to you/i);
  });

  it('duplicate check-in request is blocked when request is active', async () => {
    seedWorld();
    const { svc } = makeServices();

    await expect(
      svc.createRequest(EMP as any, { worksiteId: 'W1', reason: 'Second request' }),
    ).rejects.toThrow(/already have an active check-in request/i);
  });

  it('one-time: the same QR cannot be scanned twice', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;

    await svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 });

    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/status: completed/i);
  });

  it('expired QR is rejected', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;

    db.seed('offsite_requests', 'REQ1', {
      ...db.read('offsite_requests', 'REQ1'),
      qrExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/expired/i);
  });

  it('a non-owner employee cannot scan someone else’s QR', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    await svc.generateQr(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;
    const intruder = { ...EMP, id: 'EMP2', authUid: 'emp2-uid' };

    await expect(
      svc.verifyScannedQr(intruder as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/not issued for your account/i);
  });
});
