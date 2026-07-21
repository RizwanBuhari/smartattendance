// Talks to the "attendance_ids" collection in Firestore and enforces the geofence.
//
// The mobile app POSTs a check-in/out with the phone's live GPS. We verify the
// point is inside one of the APPROVED LOCATIONS (managed by the admin in the
// dashboard — the "locations_ids" collection), then save a record the dashboard
// can display. This is what keeps the app and dashboard in sync: the admin
// edits locations on the web, and the mobile geofence respects them instantly.
import { Injectable } from '@nestjs/common';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';
import { LocationsService, isSite } from '../locations/locations.service';
import { OtpService } from '../otp/otp.service';

// What the mobile app sends with each check-in / check-out.
export interface AttendanceEvent {
  employeeId: string;
  deviceId?: string;
  latitude: number;
  longitude: number;
  gpsAccuracy?: number;
  timestamp?: string; // UTC ISO string from the phone
  // The 6 digits scanned from the site admin's QR. Only required at locations
  // with requiresCheckInCode enabled.
  code?: string;
}

// When someone tries to check out from OUTSIDE their approved radius we don't
// close the session outright — we attach one of these so an admin can accept
// (complete the check-out) or reject it on the dashboard's Review page.
export interface CheckoutReview {
  status: 'pending' | 'accepted' | 'rejected';
  requestedAt: string; // when the employee attempted the check-out (UTC ISO)
  coords: { lat: number; lng: number } | null;
  distanceMeters: number | null;
  locationName: string | null;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
}

// Dubai is UTC+4. Stored times are UTC; the dashboard uses this offset only to
// DISPLAY them in local time. (Later this could be sent by the phone instead.)
const TZ_OFFSET_MINUTES = 240;

// Epoch milliseconds for a UTC ISO string (null if missing/unparseable).
function toMillis(utcIso: string | null | undefined): number | null {
  if (!utcIso) return null;
  const ms = Date.parse(utcIso);
  return Number.isNaN(ms) ? null : ms;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly geofence: GeofenceService,
    private readonly locations: LocationsService,
    private readonly otp: OtpService,
  ) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('attendance_ids');
  // Backend-only mirror of each record's check-in/out time in epoch ms, kept in
  // a SEPARATE collection the dashboard never reads (not returned by the API and
  // not subscribed to by the realtime listeners). Keyed by the attendance doc
  // id. Written only here via the Admin SDK.
  private readonly meta = this.db.collection('attendance_UTCM');

  // POST /attendance/check-in
  async checkIn(event: AttendanceEvent) {
    // One open check-in at a time: if this employee already has a record that
    // hasn't been checked out, reject instead of creating a duplicate.
    const existing = await this.collection
      .where('employeeId', '==', event.employeeId)
      .get();
    const alreadyOpen = existing.docs.some(
      (d) => (d.data() as { status: string }).status === 'checked_in',
    );
    if (alreadyOpen) {
      return {
        accepted: false,
        message: 'You are already checked in. Please check out first.',
      };
    }

    const employee = await this.geofence.getEmployee(event.employeeId);
    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
    );
    if (!geo.inside) {
      const where = geo.name ? ` from ${geo.name}` : '';
      const record = {
        employeeId: event.employeeId,
        employeeName: employee?.name ?? event.employeeId,
        deviceId: event.deviceId ?? null,
        checkInUtc: event.timestamp ?? new Date().toISOString(),
        checkOutUtc: null,
        tzOffsetMinutes: TZ_OFFSET_MINUTES,
        gpsAccuracy: event.gpsAccuracy ?? null,
        checkInCoords: { lat: event.latitude, lng: event.longitude },
        checkOutCoords: null,
        locationId: geo.id ?? null,
        locationName: geo.name ?? null,
        status: 'rejected' as const,
      };
      await this.collection.add(record);
      return {
        accepted: false,
        message: `Rejected! You are ${geo.distance ?? '?'}m away${where}, outside your approved locations.`,
        distanceMeters: geo.distance,
      };
    }

    // --- Supervised check-in (second factor) ---------------------------------
    // Order matters: the employee must be INSIDE the geofence before a code is
    // even considered. GPS alone is spoofable, and a code alone proves nothing
    // about where they are — the site admin's code is only meaningful on top of
    // a passing location check.
    //
    // Only locations of type 'site' demand this; an 'office' keeps the original
    // geofence-only behaviour.
    let approval: { approvedBy: string; approvedAt: string } | null = null;
    const location = (await this.locations.findAll()).find(
      (l) => l.id === geo.id,
    );

    if (isSite(location)) {
      if (!event.code) {
        return {
          accepted: false,
          // The app keys off this flag to open the scanner instead of just
          // showing an error.
          codeRequired: true,
          message:
            'This site needs a site admin to approve your check-in. Scan their QR code.',
        };
      }
      // The code was issued against the employee's Firestore DOC id (that is
      // what the site admin's team list hands back), but the phone identifies
      // itself with its Firebase authUid. Verify against the doc id or the
      // lookup silently misses and every valid scan looks "expired".
      if (!employee?.id) {
        return {
          accepted: false,
          message:
            'Your employee record could not be found. Ask an admin to check your registration.',
        };
      }

      // Throws (401/403/429) on a wrong, expired, reused or brute-forced code.
      const verified = await this.otp.verifyCode(employee.id, event.code);

      // A code issued for a different site must not work here.
      if (verified.locationId !== geo.id) {
        return {
          accepted: false,
          message: 'That code was issued for a different site.',
        };
      }
      approval = {
        approvedBy: verified.issuedBy,
        approvedAt: new Date().toISOString(),
      };
    }

    const record = {
      employeeId: event.employeeId,
      employeeName: employee?.name ?? event.employeeId,
      deviceId: event.deviceId ?? null,
      checkInUtc: event.timestamp ?? new Date().toISOString(),
      checkOutUtc: null,
      tzOffsetMinutes: TZ_OFFSET_MINUTES,
      gpsAccuracy: event.gpsAccuracy ?? null,
      checkInCoords: { lat: event.latitude, lng: event.longitude },
      checkOutCoords: null,
      locationId: geo.id,
      locationName: geo.name,
      status: 'checked_in' as const,
      // Audit trail: which site admin vouched for this check-in, and when.
      // Null at sites that do not require a code.
      approvedBy: approval?.approvedBy ?? null,
      approvedAt: approval?.approvedAt ?? null,
    };

    const ref = await this.collection.add(record);
    // Private epoch-ms mirror (backend-only; not exposed to the dashboard).
    await this.meta.doc(ref.id).set({
      employeeId: record.employeeId,
      checkInUtc: record.checkInUtc,
      checkInUtcMs: toMillis(record.checkInUtc),
    });
    return {
      accepted: true,
      id: ref.id,
      message: `Accepted! ${geo.distance}m from ${geo.name}.`,
      ...record,
    };
  }

  // POST /attendance/check-out — closes this employee's open check-in(s).
  //
  // Unlike check-in, this is NEVER blocked by the geofence — someone who
  // genuinely needs to end their shift shouldn't get stuck permanently
  // "checked in" just because their GPS drifted on the way out, or because
  // they're legitimately checking out from somewhere else (e.g. left sick).
  // Instead, an out-of-radius checkout still succeeds but is flagged for
  // admin review (see `checkoutFlagged` — surfaced on the dashboard's
  // Attendance table via the same red-badge treatment as background-ping
  // anomalies), and the mobile app separately notifies the employee that
  // their checkout is under review.
  async checkOut(event: AttendanceEvent) {
    const employee = await this.geofence.getEmployee(event.employeeId);
    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
    );

    const snapshot = await this.collection
      .where('employeeId', '==', event.employeeId)
      .get();

    // Close EVERY open record, not just the most recent one — a stray older
    // check-in left open (e.g. from before duplicate check-ins were guarded
    // against) must not linger and flip the employee's status back to
    // "checked in" right after they've just checked out.
    const open = snapshot.docs.filter(
      (d) => (d.data() as { status: string }).status === 'checked_in',
    );

    if (open.length === 0) {
      return {
        accepted: false,
        message: 'No open check-in found for this employee.',
      };
    }

    const checkOutUtc = event.timestamp ?? new Date().toISOString();
    const checkOutCoords = { lat: event.latitude, lng: event.longitude };
    const checkoutFlagged = !geo.inside;
    const checkoutDistanceMeters = checkoutFlagged ? geo.distance : null;
    // An out-of-radius checkout still closes the session (so the employee is
    // never stuck), but it opens a pending review the admin resolves on the
    // dashboard's Review page.
    const checkoutReview: CheckoutReview | null = checkoutFlagged
      ? {
          status: 'pending',
          requestedAt: checkOutUtc,
          coords: checkOutCoords,
          distanceMeters: geo.distance,
          locationName: geo.name,
        }
      : null;
    const checkOutUtcMs = toMillis(checkOutUtc);
    await Promise.all(
      open.flatMap((doc) => [
        doc.ref.update({
          checkOutUtc,
          checkOutCoords,
          status: 'checked_out',
          checkoutFlagged,
          checkoutDistanceMeters,
          checkoutReview,
        }),
        // Private epoch-ms mirror (backend-only; merged onto the check-in meta).
        this.meta
          .doc(doc.id)
          .set({ checkOutUtc, checkOutUtcMs }, { merge: true }),
      ]),
    );

    const latest = open.sort((a, b) =>
      (a.data() as { checkInUtc: string }).checkInUtc <
      (b.data() as { checkInUtc: string }).checkInUtc
        ? 1
        : -1,
    )[0];

    const message = checkoutFlagged
      ? `Checked out — you're ${geo.distance ?? '?'}m from ${geo.name ?? 'your approved area'}. This checkout is under review.`
      : 'Checked out successfully.';

    return {
      accepted: true,
      id: latest.id,
      message,
      checkoutFlagged,
      distanceMeters: checkoutDistanceMeters,
    };
  }

  // DELETE /attendance/:id — admin removes a record (e.g. clean up duplicates).
  async remove(id: string) {
    await Promise.all([
      this.collection.doc(id).delete(),
      this.meta.doc(id).delete(), // drop its private epoch-ms mirror too
    ]);
    return { id };
  }

  // GET /attendance/reviews — every checkout still awaiting an admin decision
  // (someone who checked out from outside their approved radius), newest first.
  // Powers the dashboard's Review page.
  async getReviews() {
    // Query only the pending ones (a nested-field equality) rather than reading
    // the whole attendance history — keeps Firestore reads down.
    const snapshot = await this.collection
      .where('checkoutReview.status', '==', 'pending')
      .get();
    return snapshot.docs
      .sort((a, b) =>
        (a.data() as { checkInUtc: string }).checkInUtc <
        (b.data() as { checkInUtc: string }).checkInUtc
          ? 1
          : -1,
      )
      .map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  // POST /attendance/:id/review/accept — admin approves an out-of-radius
  // checkout. The session is already closed; this just clears the flag so the
  // record reads as a normal checkout.
  async acceptReview(id: string) {
    return this.resolveReview(id, 'accepted');
  }

  // POST /attendance/:id/review/reject — admin rejects an out-of-radius
  // checkout. The session stays closed but the record is marked rejected for
  // the record (e.g. left the site without permission).
  async rejectReview(id: string, reason?: string) {
    return this.resolveReview(id, 'rejected', reason);
  }

  private async resolveReview(
    id: string,
    decision: 'accepted' | 'rejected',
    reason?: string,
  ) {
    const ref = this.collection.doc(id);
    const doc = await ref.get();
    const data = doc.data() as { checkoutReview?: CheckoutReview } | undefined;
    const review = data?.checkoutReview;
    if (!review || review.status !== 'pending') {
      return { accepted: false, message: 'No pending checkout to review.' };
    }
    if (decision === 'accepted') {
      await ref.update({
        checkoutReview: {
          ...review,
          status: 'accepted',
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'Admin',
        },
        checkoutFlagged: false,
      });
    } else {
      await ref.update({
        status: 'checked_in',
        checkOutUtc: null,
        checkOutCoords: null,
        checkoutDistanceMeters: null,
        attemptedCheckoutAt: review.requestedAt || null,
        attemptedCheckoutLatitude: review.coords?.lat || null,
        attemptedCheckoutLongitude: review.coords?.lng || null,
        attemptedCheckoutAccuracy: null,
        attemptedCheckoutDistance: review.distanceMeters || null,
        checkoutReview: {
          ...review,
          status: 'rejected',
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'Admin',
          rejectionReason: reason || 'Outside approved area',
        },
        checkoutFlagged: true,
      });
      await this.meta.doc(id).set(
        {
          checkOutUtc: null,
          checkOutUtcMs: null,
        },
        { merge: true },
      );
    }
    return { accepted: true, id, status: decision };
  }

  // GET /attendance?employeeId=xxx — just that employee's records (for the
  // mobile app's own history list), returned as-is.
  //
  // GET /attendance (dashboard) — every record for employees that STILL EXIST,
  // newest first. Records whose employee has been deleted (from the dashboard
  // OR directly in Firestore) are filtered out, so the dashboard never shows a
  // deleted employee's attendance. Attendance is keyed by `employeeId`, which
  // is the Firebase UID for registered users (stored as `authUid` on the
  // employee doc) or the employee doc id for admin-created records — both count
  // as valid keys.
  async findAll(employeeId?: string) {
    if (employeeId) {
      const snapshot = await this.collection
        .where('employeeId', '==', employeeId)
        .get();
      return this.sortMap(snapshot.docs);
    }

    const [empSnap, attSnap] = await Promise.all([
      this.db.collection('employees_ids').get(),
      this.collection.get(),
    ]);

    // Safety: without any employees to compare against, we can't tell orphaned
    // records apart — so don't hide or delete anything.
    if (empSnap.empty) {
      return this.sortMap(attSnap.docs);
    }

    // Valid keys an attendance record may use: an employee's doc id, or their
    // Firebase UID (stored as authUid on the employee doc).
    const valid = new Set<string>();
    for (const doc of empSnap.docs) {
      valid.add(doc.id);
      const uid = (doc.data() as { authUid?: string }).authUid;
      if (uid) valid.add(uid);
    }

    const kept: QueryDocumentSnapshot[] = [];
    const orphans: QueryDocumentSnapshot[] = [];
    for (const doc of attSnap.docs) {
      const key = (doc.data() as { employeeId: string }).employeeId;
      (valid.has(key) ? kept : orphans).push(doc);
    }

    // A deleted employee (removed from the dashboard OR directly in Firestore)
    // leaves orphaned attendance behind — physically purge it so it's gone from
    // both the backend and the dashboard.
    if (orphans.length) {
      await Promise.all(
        orphans.flatMap((d) => [d.ref.delete(), this.meta.doc(d.id).delete()]),
      );
    }

    return this.sortMap(kept);
  }

  // Sorts records newest-first, maps each doc to { ...data, id }, and flags
  // any record where EITHER a background location ping (see
  // LocationPingsService — the separate 9AM-6PM periodic check, distinct
  // from the geofence enforced at the moment of check-in itself) caught the
  // employee outside their approved area during the session, OR the
  // checkout itself happened outside the radius (checkoutFlagged).
  private async sortMap(docs: QueryDocumentSnapshot[]) {
    const anomalies = await this.getAnomalyTimestampsByEmployee();
    return docs
      .sort((a, b) =>
        (a.data().checkInUtc as string) < (b.data().checkInUtc as string)
          ? 1
          : -1,
      )
      .map((doc) => {
        const data = doc.data() as {
          employeeId: string;
          checkInUtc: string;
          checkOutUtc: string | null;
          checkoutFlagged?: boolean;
        };
        const windowEnd = data.checkOutUtc ?? new Date().toISOString();
        const pingFlagged = (anomalies.get(data.employeeId) ?? []).some(
          (ts) => ts >= data.checkInUtc && ts <= windowEnd,
        );
        const flaggedOutside = pingFlagged || data.checkoutFlagged === true;
        // Spread data first, then id — so the real Firestore doc id always wins
        // over any `id` field stored inside the document (which would otherwise
        // make delete/update target the wrong record).
        return { ...doc.data(), id: doc.id, flaggedOutside };
      });
  }

  // Every out-of-geofence ping, grouped by employee — used to cross-reference
  // against each attendance session's [checkIn, checkOut] window.
  private async getAnomalyTimestampsByEmployee(): Promise<
    Map<string, string[]>
  > {
    const snapshot = await this.db
      .collection('location_Pings')
      .where('insideGeofence', '==', false)
      .get();
    const byEmployee = new Map<string, string[]>();
    for (const doc of snapshot.docs) {
      const data = doc.data() as { employeeId: string; timestamp: string };
      const list = byEmployee.get(data.employeeId);
      if (list) {
        list.push(data.timestamp);
      } else {
        byEmployee.set(data.employeeId, [data.timestamp]);
      }
    }
    return byEmployee;
  }
}
