// Talks to the "attendance_ids" collection in Firestore and enforces the geofence.
//
// The mobile app POSTs a check-in/out with the phone's live GPS. We verify the
// point is inside one of the APPROVED LOCATIONS (managed by the admin in the
// dashboard — the "locations_ids" collection), then save a record the dashboard
// can display. This is what keeps the app and dashboard in sync: the admin
// edits locations on the web, and the mobile geofence respects them instantly.
import { Injectable } from '@nestjs/common';
import { getFirestore, QueryDocumentSnapshot, FieldValue } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';
import { CodeRequestsService } from '../code-requests/code-requests.service';
import { PushService } from '../push/push.service';
import { BiometricsService } from '../biometrics/biometrics.service';
import { normalizeRole } from '../employees/employees.service';
import {
  checkAttendanceWindow,
  localMinutesOfDay,
  formatHHMM,
} from './attendance-window.util';

// What the mobile app sends with each check-in / check-out.
//
// Fields removed in the geofence-hardening pass: `code`, `locationId`,
// `attendanceMethod`, `biometricVerified` and `biometricDeviceId` were declared
// here but read nowhere — leftovers from a supervised-check-in feature that was
// half-removed. Declaring inputs the service ignores is worse than not
// declaring them: it made this file read as though a site QR code gated
// check-in when nothing of the sort happened. The offsite-checkin module owns
// the QR flow; biometrics live in their own module.
export interface AttendanceEvent {
  employeeId: string;
  deviceId?: string;
  latitude: number;
  longitude: number;
  gpsAccuracy?: number;
  timestamp?: string; // UTC ISO string from the phone
  /**
   * The phone's own geofence opinion. NOT the decision — the server computes
   * that from latitude/longitude. Kept because a disagreement between the two
   * is a fraud signal worth persisting (see `clientDisagreed`).
   */
  isInsideGeofence?: boolean;
  /** Native-geofence dwell confirmation, recorded for the audit trail. */
  isDwellConfirmed?: boolean;
  locationId?: string;
  code?: string;
  nonce?: string;
  attendanceMethod?: string;
  assignedAuthPolicy?: string;
  preferredAuthMethod?: string;
  authMethodUsed?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  biometricVerified?: boolean;
  biometricDeviceId?: string;
  /** The device's real UTC offset in minutes, as reported by the phone. */
  tzOffsetMinutes?: number;
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
  // Set when this review was opened (also/instead) because the checkout
  // happened outside the location's configured hours for this employee's
  // role — distinct from an out-of-radius checkout, since the fix for one
  // says nothing about the other.
  outsideWindow?: boolean;
  windowText?: string | null;
}

// Fallback offset (Dubai, UTC+4) for clients that don't report their own.
// Stored times are always UTC; this offset exists only so the dashboard can
// render them in the employee's local time. The device's real offset is
// preferred when it sends one — a hardcoded constant is wrong for anyone
// travelling, and wrong twice a year anywhere observing DST.
const TZ_OFFSET_MINUTES = 240;

// Accepts the device's reported offset when it is a plausible real-world one
// (UTC-12:00 to UTC+14:00), otherwise falls back to the constant above.
function resolveTzOffset(reported?: number): number {
  return typeof reported === 'number' &&
    Number.isInteger(reported) &&
    reported >= -720 &&
    reported <= 840
    ? reported
    : TZ_OFFSET_MINUTES;
}

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
    private readonly codeRequests: CodeRequestsService,
    private readonly push: PushService,
    private readonly biometrics: BiometricsService,
  ) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('attendance_ids');
  // Backend-only mirror of each record's check-in/out time in epoch ms, kept in
  // a SEPARATE collection the dashboard never reads (not returned by the API and
  // not subscribed to by the realtime listeners). Keyed by the attendance doc
  // id. Written only here via the Admin SDK.
  private readonly meta = this.db.collection('attendance_meta');

  private async notifyAdmins(title: string, body: string) {
    try {
      const snap = await this.db
        .collection('employees_ids')
        .where('role', 'in', ['site_supervisor', 'siteAdmin'])
        .get();
      const supIds = snap.docs
        .map((d) => d.data().authUid || d.id)
        .filter(Boolean);
      if (supIds.length > 0) {
        await this.push.sendToEmployees(supIds, { title, body });
      }
    } catch (_) {}
  }

  private async hasOpenCheckIn(employeeId: string): Promise<boolean> {
    const existing = await this.collection
      .where('employeeId', '==', employeeId)
      .get();
    return existing.docs.some(
      (d) => (d.data() as { status: string }).status === 'checked_in',
    );
  }

  // POST /attendance/check-in
  async checkIn(event: AttendanceEvent) {
    const alreadyOpen = await this.hasOpenCheckIn(event.employeeId);
    if (alreadyOpen) {
      return {
        accepted: false,
        message: 'You are already checked in. Please check out first.',
      };
    }

    const employee = await this.geofence.getEmployee(event.employeeId) as any;
    const assignedAuthPolicy = event.assignedAuthPolicy || employee?.assignedAuthPolicy || employee?.attendanceMethod || 'geofence';
    const preferredAuthMethod = event.preferredAuthMethod || employee?.preferredAuthMethod || 'device_authentication';
    const authMethodUsed = event.authMethodUsed || 'device_authentication';
    const fallbackUsed = Boolean(event.fallbackUsed);
    const fallbackReason = event.fallbackReason || null;

    // Strict Policy Cross-Check
    if ((assignedAuthPolicy === 'strict_face' || assignedAuthPolicy === 'strict_fingerprint') && fallbackUsed) {
      return {
        accepted: false,
        message: 'Strict authentication policy violated. Fallback is disallowed for your account by HR.',
      };
    }

    if (fallbackUsed && employee?.blockAttendanceWhenFallbackUsed === true) {
      return {
        accepted: false,
        message: 'Attendance blocked: HR policy prohibits fallback authentication for your profile.',
      };
    }

    if (fallbackUsed && authMethodUsed === 'fingerprint' && employee?.allowFingerprintFallback === false) {
      return {
        accepted: false,
        message: 'Fingerprint fallback is disallowed by HR policy for your account.',
      };
    }

    if (fallbackUsed && (authMethodUsed === 'device_credential' || authMethodUsed === 'device_authentication') && employee?.allowDeviceCredentialFallback === false) {
      return {
        accepted: false,
        message: 'Device PIN/Pattern fallback is disallowed by HR policy for your account.',
      };
    }

    if (assignedAuthPolicy.includes('face') && !fallbackUsed) {
      if (!employee?.faceSetupCompleted) {
        return {
          accepted: false,
          message: 'Face setup incomplete. Please complete setup in profile.',
        };
      }
      if (employee.faceDeviceId && event.deviceId && employee.faceDeviceId !== event.deviceId) {
        return {
          accepted: false,
          message: 'Registered device mismatch. Please contact HR.',
        };
      }
      if (event.nonce && !this.biometrics.verifyChallenge(employee.authUid || event.employeeId, event.nonce, 'check_in', event.deviceId)) {
        return {
          accepted: false,
          message: 'Invalid or expired security challenge.',
        };
      }
    }

    const employeeName = employee?.name ?? event.employeeId;

    // Geofencing is used ONLY when one of these 3 specific options is assigned:
    // 1. Geofence Only ('geofence')
    // 2. Fingerprint + Geofence ('fingerprint_geofence')
    // 3. Face Recognition + Geofence ('face_geofence')
    const requiresGeofence =
      assignedAuthPolicy === 'geofence' ||
      assignedAuthPolicy === 'fingerprint_geofence' ||
      assignedAuthPolicy === 'face_geofence';

    // THE decision. Computed server-side from the reported coordinates against
    // the admin-configured radius — the phone's `isInsideGeofence` is passed in
    // only so a contradiction can be recorded, never to decide the outcome.
    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
      event.isInsideGeofence,
      event.gpsAccuracy,
    );

    if (!requiresGeofence) {
      geo.inside = true;
    }

    // Everything the geofence concluded, stored on the record so the dashboard
    // can show WHY a decision was made rather than just what it was.
    const verification = {
      distanceMeters: geo.distance,
      radiusMeters: geo.radiusMeters,
      accuracyBufferApplied: geo.accuracyBufferApplied,
      reason: geo.reason,
      // The fraud signal: the phone claimed one thing, our arithmetic said
      // another. `clientClaimedInside: true` against `inside: false` is either a
      // spoofing attempt or a badly stale client cache.
      clientClaimedInside: geo.clientClaimedInside,
      clientDisagreed: geo.clientDisagreed,
      isDwellConfirmed: event.isDwellConfirmed ?? null,
      verifiedBy: 'server' as const,
    };

    // Two independent gates decide "accepted" here: the geofence (checked
    // above) and, separately, the location's configured hours for this
    // employee's role. Either can reject — the location's own hours only get
    // evaluated once the geofence has already passed, so a rejection always
    // names ONE clear reason rather than both firing at once.
    let checkInRejection: { reason: string; message: string; notifyBody: string } | null = null;

    if (requiresGeofence && !geo.inside) {
      checkInRejection = {
        reason: geo.reason,
        message: geo.message,
        notifyBody: geo.clientDisagreed
          ? `${employeeName}'s check-in was rejected — the app reported being on-site but ` +
              `the server measured ${geo.distance ?? '?'}m from ${geo.name ?? 'the approved area'}.`
          : `${employeeName}'s check-in attempt was rejected (${geo.message})`,
      };
    } else {
      const role = normalizeRole(employee?.role);
      const nowMinutesLocal = localMinutesOfDay(
        Date.parse(event.timestamp ?? new Date().toISOString()),
        resolveTzOffset(event.tzOffsetMinutes),
      );
      const windowCheck = checkAttendanceWindow(
        geo.attendanceWindows ?? undefined,
        role,
        'checkIn',
        nowMinutesLocal,
      );
      if (!windowCheck.allowed) {
        const windowText = `${formatHHMM(windowCheck.window!.from)}–${formatHHMM(windowCheck.window!.to)}`;
        checkInRejection = {
          reason: 'outside_attendance_window',
          message: `Check-in at ${geo.name ?? 'this location'} is only allowed between ${windowText}.`,
          notifyBody:
            `${employeeName}'s check-in was rejected — outside the allowed check-in hours ` +
            `at ${geo.name ?? 'their location'} (${windowText}).`,
        };
      }
    }

    if (checkInRejection) {
      const record = {
        employeeId: event.employeeId,
        employeeName: employeeName,
        deviceId: event.deviceId ?? null,
        checkInUtc: event.timestamp ?? new Date().toISOString(),
        checkOutUtc: null,
        tzOffsetMinutes: resolveTzOffset(event.tzOffsetMinutes),
        gpsAccuracy: event.gpsAccuracy ?? null,
        checkInCoords: { lat: event.latitude, lng: event.longitude },
        checkOutCoords: null,
        locationId: geo.id ?? null,
        locationName: geo.name ?? null,
        status: 'rejected' as const,
        rejectionReason: checkInRejection.reason,
        assignedAuthPolicy,
        preferredAuthMethod,
        authMethodUsed,
        fallbackUsed,
        fallbackReason,
        fallbackApprovedByPolicy: !fallbackUsed || Boolean(employee?.allowFingerprintFallback || employee?.allowDeviceCredentialFallback),
        authenticationVerifiedAt: FieldValue.serverTimestamp(),
        fallbackUsedAt: fallbackUsed ? FieldValue.serverTimestamp() : null,
        verification,
      };
      await this.collection.add(record);
      await this.notifyAdmins('Check-in Rejected', checkInRejection.notifyBody);
      return {
        accepted: false,
        // The specific reason, not a generic refusal: "your GPS is ±80m" and
        // "you are 400m away" need completely different responses from the
        // employee, and the old message covered both as "outside work area".
        message: `Rejected! ${checkInRejection.message}`,
        reason: checkInRejection.reason,
        distanceMeters: geo.distance,
        radiusMeters: geo.radiusMeters,
      };
    }

    const record = {
      employeeId: event.employeeId,
      employeeName: employeeName,
      deviceId: event.deviceId ?? null,
      checkInUtc: event.timestamp ?? new Date().toISOString(),
      checkOutUtc: null,
      tzOffsetMinutes: resolveTzOffset(event.tzOffsetMinutes),
      gpsAccuracy: event.gpsAccuracy ?? null,
      checkInCoords: { lat: event.latitude, lng: event.longitude },
      checkOutCoords: null,
      locationId: geo.id,
      locationName: geo.name,
      status: 'checked_in' as const,
      approvedBy: null,
      approvedAt: null,
      assignedAuthPolicy,
      preferredAuthMethod,
      authMethodUsed,
      fallbackUsed,
      fallbackReason,
      fallbackApprovedByPolicy: !fallbackUsed || Boolean(employee?.allowFingerprintFallback || employee?.allowDeviceCredentialFallback),
      authenticationVerifiedAt: FieldValue.serverTimestamp(),
      fallbackUsedAt: fallbackUsed ? FieldValue.serverTimestamp() : null,
      verification,
    };

    const ref = await this.collection.add(record);
    // Private epoch-ms mirror (backend-only; not exposed to the dashboard).
    await this.meta.doc(ref.id).set({
      employeeId: record.employeeId,
      checkInUtc: record.checkInUtc,
      checkInUtcMs: toMillis(record.checkInUtc),
      authenticationVerifiedAt: FieldValue.serverTimestamp(),
      fallbackUsedAt: fallbackUsed ? FieldValue.serverTimestamp() : null,
      fallbackAuditCreatedAt: FieldValue.serverTimestamp(),
    });
    // They are in — drop them off the site admin's waiting list. Safe to call
    // for an ordinary office check-in, where no request was ever opened.
    if (employee?.id) {
      await this.codeRequests.close(employee.id);
    }

    const emp = employee as any;
    if (fallbackUsed && emp?.notifyHrOnFallback !== false && authMethodUsed !== (preferredAuthMethod || assignedAuthPolicy)) {
      const humanAssigned = formatAuthMethod(preferredAuthMethod || assignedAuthPolicy);
      const humanActual = formatAuthMethod(authMethodUsed);
      const humanReason = formatFallbackReason(fallbackReason ?? undefined);

      const title = 'Attendance Fallback Used';
      const bodyText = `${employeeName} checked in using ${humanActual} instead of the assigned ${humanAssigned} method.`;
      const reasonText = `Reason: ${humanReason}.`;

      const notifDocId = `${ref.id}_check_in_fallback_notification`;

      await this.db.collection('admin_notifications').doc(notifDocId).set({
        id: notifDocId,
        type: 'attendance_fallback',
        employeeId: event.employeeId,
        employeeName,
        attendanceId: ref.id,
        action: 'check_in',
        assignedMethod: preferredAuthMethod || assignedAuthPolicy,
        actualMethod: authMethodUsed,
        fallbackReason: fallbackReason || 'unavailable',
        worksiteId: geo.id ?? null,
        worksiteName: geo.name ?? null,
        title,
        body: bodyText,
        reasonText,
        message: `${bodyText} ${reasonText}`,
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      await this.notifyAdmins(title, `${bodyText}\n${reasonText}`);
    } else {
      await this.notifyAdmins(
        'Check-in Successful',
        `${employeeName} successfully checked in at ${geo.name ?? 'approved site'}.`,
      );
    }
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
    const employee = (await this.geofence.getEmployee(event.employeeId)) as any;
    const employeeName = employee?.name ?? event.employeeId;
    const assignedAuthPolicy =
      event.assignedAuthPolicy ||
      employee?.assignedAuthPolicy ||
      employee?.attendanceMethod ||
      'geofence';

    const requiresGeofence =
      assignedAuthPolicy === 'geofence' ||
      assignedAuthPolicy === 'fingerprint_geofence' ||
      assignedAuthPolicy === 'face_geofence';

    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
      event.isInsideGeofence,
      event.gpsAccuracy,
    );

    if (!requiresGeofence) {
      geo.inside = true;
    }

    // NOTE: unlike check-in, checkout is deliberately NOT blocked when the
    // employee is outside their approved radius (see the method doc above). The
    // early `return` that used to reject an out-of-radius checkout here has been
    // removed: it made the entire pending-review flow below unreachable dead
    // code, so an employee who genuinely needed to end their shift from outside
    // the geofence got stuck permanently "checked in". The session now always
    // closes; an out-of-radius checkout is instead flagged for admin review.

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

    // Same "never block a checkout" philosophy as the geofence above: outside
    // the configured hours still closes the session, it just opens a review
    // instead of silently succeeding — an employee who genuinely has to
    // leave early must never get stuck permanently checked in.
    const windowCheck = checkAttendanceWindow(
      geo.attendanceWindows ?? undefined,
      normalizeRole(employee?.role),
      'checkOut',
      localMinutesOfDay(
        Date.parse(checkOutUtc),
        resolveTzOffset(event.tzOffsetMinutes),
      ),
    );
    const outsideWindow = !windowCheck.allowed;
    const windowText = outsideWindow
      ? `${formatHHMM(windowCheck.window!.from)}–${formatHHMM(windowCheck.window!.to)}`
      : null;

    const checkoutFlagged = !geo.inside || outsideWindow;
    const checkoutDistanceMeters = !geo.inside ? geo.distance : null;
    // An out-of-radius and/or outside-hours checkout still closes the session
    // (so the employee is never stuck), but it opens a pending review the
    // admin resolves on the dashboard's Review page.
    const checkoutReview: CheckoutReview | null = checkoutFlagged
      ? {
          status: 'pending',
          requestedAt: checkOutUtc,
          coords: checkOutCoords,
          distanceMeters: !geo.inside ? geo.distance : null,
          locationName: geo.name,
          outsideWindow,
          windowText,
        }
      : null;
    const checkOutUtcMs = toMillis(checkOutUtc);
    // The checkout's own geofence evidence, kept separate from the check-in's
    // `verification` so the dashboard's detail view can show both ends of the
    // shift independently.
    const checkOutVerification = {
      distanceMeters: geo.distance,
      radiusMeters: geo.radiusMeters,
      accuracyBufferApplied: geo.accuracyBufferApplied,
      reason: geo.reason,
      clientClaimedInside: geo.clientClaimedInside,
      clientDisagreed: geo.clientDisagreed,
      gpsAccuracy: event.gpsAccuracy ?? null,
      verifiedBy: 'server' as const,
    };
    await Promise.all(
      open.flatMap((doc) => [
        doc.ref.update({
          checkOutUtc,
          checkOutCoords,
          status: 'checked_out',
          checkoutFlagged,
          checkoutDistanceMeters,
          checkoutReview,
          checkOutVerification,
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

    const flagReasons: string[] = [];
    if (!geo.inside) flagReasons.push(geo.message);
    if (outsideWindow) {
      flagReasons.push(
        `Checked out outside the allowed hours at ${geo.name ?? 'this location'} (${windowText}).`,
      );
    }
    const message = checkoutFlagged
      ? `Checked out — ${flagReasons.join(' ')} This checkout is under review.`
      : 'Checked out successfully.';

    const emp = employee as any;
    const fallbackUsed = Boolean(event.fallbackUsed);
    const preferredAuthMethod = event.preferredAuthMethod || emp?.preferredAuthMethod || 'device_authentication';
    const authMethodUsed = event.authMethodUsed || 'device_authentication';
    const fallbackReason = event.fallbackReason || null;

    if (fallbackUsed) {
      await Promise.all(
        open.map((doc) =>
          doc.ref.update({
            checkoutFallbackUsed: true,
            checkoutAuthMethodUsed: authMethodUsed,
            checkoutFallbackReason: fallbackReason,
          }),
        ),
      );
    }

    if (fallbackUsed && emp?.notifyHrOnFallback !== false && authMethodUsed !== (preferredAuthMethod || assignedAuthPolicy)) {
      const humanAssigned = formatAuthMethod(preferredAuthMethod || assignedAuthPolicy);
      const humanActual = formatAuthMethod(authMethodUsed);
      const humanReason = formatFallbackReason(fallbackReason ?? undefined);

      const title = 'Attendance Fallback Used';
      const bodyText = `${employeeName} checked out using ${humanActual} instead of the assigned ${humanAssigned} method.`;
      const reasonText = `Reason: ${humanReason}.`;

      const notifDocId = `${latest.id}_check_out_fallback_notification`;

      await this.db.collection('admin_notifications').doc(notifDocId).set({
        id: notifDocId,
        type: 'attendance_fallback',
        employeeId: event.employeeId,
        employeeName,
        attendanceId: latest.id,
        action: 'check_out',
        assignedMethod: preferredAuthMethod || assignedAuthPolicy,
        actualMethod: authMethodUsed,
        fallbackReason: fallbackReason || 'unavailable',
        worksiteId: geo.id ?? null,
        worksiteName: geo.name ?? null,
        title,
        body: bodyText,
        reasonText,
        message: `${bodyText} ${reasonText}`,
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      await this.notifyAdmins(title, `${bodyText}\n${reasonText}`);
    } else {
      await this.notifyAdmins(
        'Checkout Successful',
        `${employeeName} successfully checked out.`,
      );
    }

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
  // record reads as a normal checkout. `reviewedBy` is the verified admin email
  // supplied by AdminGuard, so the audit trail records WHO decided.
  async acceptReview(id: string, reviewedBy?: string) {
    return this.resolveReview(id, 'accepted', undefined, reviewedBy);
  }

  // POST /attendance/:id/review/reject — admin rejects an out-of-radius
  // checkout. The session stays closed but the record is marked rejected for
  // the record (e.g. left the site without permission).
  async rejectReview(id: string, reason?: string, reviewedBy?: string) {
    return this.resolveReview(id, 'rejected', reason, reviewedBy);
  }

  // Applies an admin decision to a pending checkout review, exactly once.
  //
  // Concurrency / duplicate-review guard: the decision is only applied when the
  // stored review is still 'pending'. A second accept/reject (two admins, or a
  // double click) finds the review already resolved and is rejected with a
  // clear message rather than overwriting the first decision or its reviewer.
  private async resolveReview(
    id: string,
    decision: 'accepted' | 'rejected',
    reason?: string,
    reviewedBy?: string,
  ) {
    const ref = this.collection.doc(id);
    const doc = await ref.get();
    const data = doc.data() as { checkoutReview?: CheckoutReview } | undefined;
    const review = data?.checkoutReview;
    if (!review) {
      return {
        accepted: false,
        message: 'No checkout review found for this record.',
      };
    }
    if (review.status !== 'pending') {
      // Already decided — do not clobber the first reviewer's decision.
      return {
        accepted: false,
        message: `This checkout has already been ${review.status}.`,
        status: review.status,
      };
    }
    const resolvedAt = new Date().toISOString();
    const resolvedBy = reviewedBy || 'Admin';
    if (decision === 'accepted') {
      await ref.update({
        checkoutReview: {
          ...review,
          status: 'accepted',
          resolvedAt,
          resolvedBy,
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
          resolvedAt,
          resolvedBy,
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
    return { accepted: true, id, status: decision, resolvedBy, resolvedAt };
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
  async findAll(employeeId?: string, authUid?: string) {
    if (employeeId || authUid) {
      const keys = Array.from(
        new Set([employeeId, authUid].filter(Boolean) as string[]),
      );
      const snapshot = await this.collection
        .where('employeeId', 'in', keys)
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
  //
  // IMPORTANT: "we could not tell" is not "they were absent". Now that the
  // server judges pings itself, a fix too poor to place someone (or a ping with
  // no usable coordinates at all) comes back as `inside: false` — and counting
  // those as anomalies would flag an employee sitting at their desk in a
  // basement with a weak signal. Those pings are marked `inconclusive` when
  // written and skipped here, which is the "how should false positives be
  // avoided?" question from the brief answered at the read side.
  //
  // The `inconclusive` flag is filtered in memory rather than in the Firestore
  // query because records written before this field existed simply don't have
  // it, and an equality filter would silently exclude all of them.
  private async getAnomalyTimestampsByEmployee(): Promise<
    Map<string, string[]>
  > {
    const snapshot = await this.db
      .collection('location_Pings')
      .where('insideGeofence', '==', false)
      .get();
    const byEmployee = new Map<string, string[]>();
    for (const doc of snapshot.docs) {
      const data = doc.data() as {
        employeeId: string;
        timestamp: string;
        inconclusive?: boolean;
      };
      if (data.inconclusive === true) continue;
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

export function formatAuthMethod(raw?: string): string {
  if (!raw) return 'Device Authentication';
  const val = String(raw).toLowerCase().trim();
  if (val.includes('strict_face') || val.includes('system_face') || val.includes('face')) {
    return 'Face Authentication';
  }
  if (val.includes('strict_fingerprint') || val.includes('fingerprint')) {
    return 'Fingerprint';
  }
  if (val === 'device_credential' || val.includes('pin') || val.includes('pattern') || val.includes('password') || val.includes('pass')) {
    return 'Device PIN, Pattern or Password';
  }
  if (val === 'device_authentication' || val.includes('device_auth')) {
    return 'Device Authentication';
  }
  return 'Device Authentication';
}

export function formatFallbackReason(raw?: string): string {
  if (!raw) return 'assigned method was unavailable';
  const val = String(raw).toLowerCase().trim();
  if (val.includes('face_not_supported') || val.includes('face_unavailable')) {
    return 'Face Authentication was unavailable';
  }
  if (val.includes('face_not_enrolled')) {
    return 'Face Authentication is not configured';
  }
  if (val.includes('fingerprint_not_supported') || val.includes('fingerprint_unavailable')) {
    return 'Fingerprint is not supported';
  }
  if (val.includes('fingerprint_not_enrolled')) {
    return 'Fingerprint is not configured';
  }
  if (val.includes('fingerprint_locked_out')) {
    return 'Fingerprint was temporarily locked';
  }
  if (val.includes('device_lock_not_configured')) {
    return 'Device lock is not configured';
  }
  return 'assigned method was unavailable';
}
