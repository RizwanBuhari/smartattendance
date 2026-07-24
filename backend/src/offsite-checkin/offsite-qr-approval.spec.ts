// End-to-end-ish test of the OFFSITE "supervisor approves, employee scans QR"
// flow, driving the real service code with in-memory Firestore + Redis fakes.
//
// It exercises exactly the path the mobile app triggers:
//   supervisor accept  -> OffsiteCheckinService.acceptRequest
//                       -> OffsiteQrTokenService.requestQrGeneration
//                       -> OtpService.issueCode            (code stored in Redis)
//   employee scan      -> OffsiteCheckinService.verifyScannedQr
//                       -> OffsiteQrTokenService.verifyScannedQr
//                       -> OtpService.verifyCode           (code consumed)
//                       -> attendance record created, request marked completed
//
// Firestore/Redis are faked; every line of the services above is the real thing.

import { db, firestoreMock } from './__fakes__/fake-firestore';
import { FakeRedis } from './__fakes__/fake-redis';

// getFirestore() is called in the service field initializers, so it must be
// mocked before the services are imported.
jest.mock('firebase-admin/firestore', () => firestoreMock);

import { OtpService } from '../otp/otp.service';
import { OffsiteQrTokenService } from './offsite-qr-token.service';
import { OffsiteCheckinService } from './offsite-checkin.service';

const SUP = {
  id: 'SUP1',
  name: 'Sam Supervisor',
  role: 'siteAdmin',
  status: 'active',
  authUid: 'sup-uid',
  assignedLocationIds: ['W1'],
};
const EMP = {
  id: 'EMP1',
  name: 'Eddie Employee',
  role: 'site_employee',
  status: 'active',
  authUid: 'emp-uid',
  supervisorId: 'SUP1',
  supervisorName: 'Sam Supervisor',
  assignedLocationIds: ['W1'],
};

function seedWorld(worksiteId = 'W1') {
  db.reset();
  // employees_ids: OtpService.issueCode reads issuer + target from here.
  db.seed('employees_ids', SUP.id, { ...SUP });
  db.seed('employees_ids', EMP.id, { ...EMP });
  db.seed('locations_ids', 'W1', { name: 'North Tower Site', latitude: 25, longitude: 55, radiusMeters: 150 });
  // A request the employee already submitted, waiting on the supervisor.
  db.seed('offsite_requests', 'REQ1', {
    employeeId: EMP.id,
    employeeName: EMP.name,
    employeeUid: EMP.authUid,
    supervisorId: SUP.id,
    supervisorName: SUP.name,
    worksiteId,
    worksiteName: 'North Tower Site',
    status: 'pending_approval',
    reason: 'Delivering equipment',
  });
}

function makeServices() {
  const redis = new FakeRedis();
  const otp = new OtpService(redis as any);
  const qr = new OffsiteQrTokenService(otp);
  const svc = new OffsiteCheckinService(qr);
  return { svc, redis };
}

describe('Offsite approval via QR code', () => {
  const realEnv = { ...process.env };
  beforeEach(() => {
    // Force the real generator path (not the "integration pending" stub).
    process.env.NODE_ENV = 'test';
    process.env.DEBUG_QR_GENERATOR = 'true';
  });
  afterEach(() => {
    process.env = { ...realEnv };
  });

  it('happy path: supervisor approves → QR issued → employee scans → checked in', async () => {
    seedWorld();
    const { svc } = makeServices();

    // 1) Supervisor approves the pending request.
    const approved = await svc.acceptRequest(SUP as any, 'REQ1');
    console.log('[approve] status =', approved.status, '| generator =', approved.generatorVersion);
    expect(approved.status).toBe('qr_ready');
    expect(approved.generatorVersion).toBe('redis-otp-1.0');

    // 2) A scannable 6-digit code was written to the request as the QR payload.
    const req = db.read('offsite_requests', 'REQ1');
    const code = req.qrPayload as string;
    console.log('[approve] QR payload (code) =', code);
    expect(code).toMatch(/^\d{6}$/);
    expect(req.tokenHash).toBe(code); // (flagged in review: raw code stored on the doc)

    // 3) Employee scans the code shown on the supervisor's phone.
    const result = await svc.verifyScannedQr(EMP as any, {
      requestId: 'REQ1',
      scannedPayload: code,
      latitude: 25.0001,
      longitude: 55.0001,
      gpsAccuracy: 8,
      deviceId: 'pixel-test',
    });
    console.log('[scan] accepted =', result.accepted, '| attendanceId =', result.attendanceId);
    expect(result.accepted).toBe(true);
    expect(result.attendanceId).toBeTruthy();

    // 4) Request is completed and an attendance record exists.
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
    console.log('[done] attendance =', JSON.stringify({ employeeId: attendance[0].employeeId, method: attendance[0].checkInMethod, status: attendance[0].status }));
  });

  it('one-time: the same QR cannot be scanned twice', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;

    await svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 });

    // Second scan of the now-completed request must be rejected.
    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/status: completed/i);
    console.log('[replay] second scan correctly rejected');
  });

  it('wrong code is rejected', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;
    const wrong = code === '111111' ? '222222' : '111111';

    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: wrong, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/incorrect code/i);
    console.log('[wrong] wrong code correctly rejected; real code still unused');
  });

  it('expired QR is rejected', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;
    // Force the request's QR window into the past.
    await db.read('offsite_requests', 'REQ1'); // no-op read for clarity
    (db as any).seed('offsite_requests', 'REQ1', {
      ...db.read('offsite_requests', 'REQ1'),
      qrExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(
      svc.verifyScannedQr(EMP as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/expired/i);
    console.log('[expiry] expired QR correctly rejected');
  });

  it('a non-owner employee cannot scan someone else’s QR', async () => {
    seedWorld();
    const { svc } = makeServices();
    await svc.acceptRequest(SUP as any, 'REQ1');
    const code = db.read('offsite_requests', 'REQ1').qrPayload as string;
    const intruder = { ...EMP, id: 'EMP2', authUid: 'emp2-uid' };

    await expect(
      svc.verifyScannedQr(intruder as any, { requestId: 'REQ1', scannedPayload: code, latitude: 25, longitude: 55 }),
    ).rejects.toThrow(/not issued for your account/i);
    console.log('[ownership] non-owner scan correctly rejected');
  });

  it('REVIEW BUG: supervisor not assigned to the worksite silently downgrades to the untrusted random code', async () => {
    // Offsite worksite W2 is somewhere the supervisor is NOT assigned — the real
    // offsite scenario. issueCode throws ForbiddenException, which
    // requestQrGeneration swallows and replaces with a random fallback code.
    seedWorld('W2');
    const { svc } = makeServices();
    const approved = await svc.acceptRequest(SUP as any, 'REQ1');
    console.log('[fallback] generator =', approved.generatorVersion);

    // If this reads 'random-fallback-1.0', the Redis-backed one-time/lockout
    // protections were bypassed for a permission failure — the bug from the review.
    expect(approved.generatorVersion).toBe('random-fallback-1.0');
  });

  it('production without the debug flag leaves the QR as "integration pending"', async () => {
    seedWorld();
    process.env.NODE_ENV = 'production';
    delete process.env.DEBUG_QR_GENERATOR;
    const { svc } = makeServices();

    const approved = await svc.acceptRequest(SUP as any, 'REQ1');
    console.log('[prod] status =', approved.status, '| qrGenerationStatus =', approved.qrGenerationStatus);
    expect(approved.status).toBe('approved_waiting_qr');
    expect(approved.qrGenerationStatus).toBe('integration_pending');
    expect(approved.qrPayload).toBeNull();
  });
});
