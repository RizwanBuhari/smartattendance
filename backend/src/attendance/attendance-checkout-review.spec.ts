// Requirement #2 — checkout outside the approved radius.
//
// Proves that an out-of-radius checkout is RECORDED (not rejected), flagged for
// admin review, surfaced in the review queue, and can be accepted or rejected
// exactly once with the reviewer + timestamp captured. Inside-radius checkout
// stays a plain success. Uses the in-memory Firestore fake; the geofence and
// notification collaborators are stubbed so the test drives the inside/outside
// decision directly.
import { db, firestoreMock } from '../offsite-checkin/__fakes__/fake-firestore';

jest.mock('firebase-admin/firestore', () => firestoreMock);

import { AttendanceService } from './attendance.service';

const EMP = {
  id: 'EMP1',
  authUid: 'emp-uid',
  name: 'Eddie Employee',
  assignedLocationIds: ['W1'],
};

// A geofence stub whose verdict the test sets per-case.
function makeGeofence(verdict: {
  inside: boolean;
  distance: number | null;
  name: string | null;
}) {
  return {
    getEmployee: async () => ({ ...EMP }),
    check: async () => ({
      inside: verdict.inside,
      name: verdict.name,
      id: 'W1',
      distance: verdict.distance,
    }),
  };
}

function makeService(verdict: {
  inside: boolean;
  distance: number | null;
  name: string | null;
}) {
  const noopPush = { sendToEmployees: async () => {} };
  const codeRequests = { close: async () => {} };
  return new AttendanceService(
    makeGeofence(verdict) as any,
    {} as any, // locations — only used via the (stubbed) geofence
    {} as any, // otp — unused on checkout
    codeRequests as any,
    noopPush as any,
  );
}

function seedOpenShift(id = 'A1') {
  db.seed('attendance_ids', id, {
    employeeId: EMP.authUid,
    employeeName: EMP.name,
    checkInUtc: '2026-01-02T04:00:00.000Z',
    checkOutUtc: null,
    status: 'checked_in',
  });
}

const checkoutEvent = {
  employeeId: EMP.authUid,
  latitude: 25.2,
  longitude: 55.3,
  gpsAccuracy: 12,
  timestamp: '2026-01-02T09:00:00.000Z',
};

describe('Checkout outside the approved radius', () => {
  beforeEach(() => {
    db.reset();
  });

  it('records an out-of-radius checkout and opens a pending review (does NOT reject)', async () => {
    seedOpenShift();
    const svc = makeService({
      inside: false,
      distance: 250,
      name: 'North Site',
    });

    const res = await svc.checkOut({ ...checkoutEvent });

    // The employee is checked out (never stuck) and told it is under review.
    expect(res.accepted).toBe(true);
    expect(res.checkoutFlagged).toBe(true);
    expect(res.message).toMatch(/under review/i);

    // Audit trail persisted on the record.
    const rec = db.read('attendance_ids', 'A1');
    expect(rec.status).toBe('checked_out');
    expect(rec.checkoutFlagged).toBe(true);
    expect(rec.checkoutDistanceMeters).toBe(250);
    expect(rec.checkoutReview).toMatchObject({
      status: 'pending',
      distanceMeters: 250,
      locationName: 'North Site',
      coords: { lat: 25.2, lng: 55.3 },
      requestedAt: checkoutEvent.timestamp,
    });
  });

  it('lists pending out-of-radius checkouts in the review queue', async () => {
    seedOpenShift();
    const svc = makeService({
      inside: false,
      distance: 300,
      name: 'North Site',
    });
    await svc.checkOut({ ...checkoutEvent });

    const reviews = await svc.getReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe('A1');
  });

  it('admin ACCEPT clears the flag and records reviewer + timestamp', async () => {
    seedOpenShift();
    const svc = makeService({
      inside: false,
      distance: 250,
      name: 'North Site',
    });
    await svc.checkOut({ ...checkoutEvent });

    const out = await svc.acceptReview('A1', 'admin@example.com');
    expect(out.accepted).toBe(true);
    expect(out.status).toBe('accepted');

    const rec = db.read('attendance_ids', 'A1');
    expect(rec.checkoutFlagged).toBe(false);
    expect(rec.status).toBe('checked_out'); // stays closed
    expect(rec.checkoutReview).toMatchObject({
      status: 'accepted',
      resolvedBy: 'admin@example.com',
    });
    expect(rec.checkoutReview.resolvedAt).toBeTruthy();
  });

  it('admin REJECT re-opens the shift and stores the reason + reviewer', async () => {
    seedOpenShift();
    const svc = makeService({
      inside: false,
      distance: 250,
      name: 'North Site',
    });
    await svc.checkOut({ ...checkoutEvent });

    const out = await svc.rejectReview(
      'A1',
      'Left site early',
      'boss@example.com',
    );
    expect(out.accepted).toBe(true);
    expect(out.status).toBe('rejected');

    const rec = db.read('attendance_ids', 'A1');
    expect(rec.status).toBe('checked_in'); // re-opened for correction
    expect(rec.checkoutReview).toMatchObject({
      status: 'rejected',
      resolvedBy: 'boss@example.com',
      rejectionReason: 'Left site early',
    });
    // Original attempted-checkout audit data preserved.
    expect(rec.attemptedCheckoutDistance).toBe(250);
  });

  it('prevents a duplicate / conflicting review of the same checkout', async () => {
    seedOpenShift();
    const svc = makeService({
      inside: false,
      distance: 250,
      name: 'North Site',
    });
    await svc.checkOut({ ...checkoutEvent });

    const first = await svc.acceptReview('A1', 'admin@example.com');
    expect(first.accepted).toBe(true);

    // Second admin tries to reject the already-accepted checkout.
    const second = await svc.rejectReview(
      'A1',
      'changed my mind',
      'other@example.com',
    );
    expect(second.accepted).toBe(false);
    expect(second.message).toMatch(/already been accepted/i);

    // The first decision is untouched.
    const rec = db.read('attendance_ids', 'A1');
    expect(rec.checkoutReview.status).toBe('accepted');
    expect(rec.checkoutReview.resolvedBy).toBe('admin@example.com');
  });

  it('an inside-radius checkout is a plain success with no review', async () => {
    seedOpenShift();
    const svc = makeService({ inside: true, distance: 10, name: 'North Site' });

    const res = await svc.checkOut({ ...checkoutEvent });
    expect(res.accepted).toBe(true);
    expect(res.checkoutFlagged).toBe(false);
    expect(res.message).toMatch(/successfully/i);

    const rec = db.read('attendance_ids', 'A1');
    expect(rec.status).toBe('checked_out');
    expect(rec.checkoutReview).toBeNull();

    const reviews = await svc.getReviews();
    expect(reviews).toHaveLength(0);
  });
});
