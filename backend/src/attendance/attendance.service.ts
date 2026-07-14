// Talks to the "attendance" collection in Firestore and enforces the geofence.
//
// The mobile app POSTs a check-in/out with the phone's live GPS. We verify the
// point is inside one of the APPROVED LOCATIONS (managed by the admin in the
// dashboard — the "locations" collection), then save a record the dashboard
// can display. This is what keeps the app and dashboard in sync: the admin
// edits locations on the web, and the mobile geofence respects them instantly.
import { Injectable } from '@nestjs/common';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';

// What the mobile app sends with each check-in / check-out.
export interface AttendanceEvent {
  employeeId: string;
  deviceId?: string;
  latitude: number;
  longitude: number;
  gpsAccuracy?: number;
  timestamp?: string; // UTC ISO string from the phone
}

// Dubai is UTC+4. Stored times are UTC; the dashboard uses this offset only to
// DISPLAY them in local time. (Later this could be sent by the phone instead.)
const TZ_OFFSET_MINUTES = 240;

@Injectable()
export class AttendanceService {
  constructor(private readonly geofence: GeofenceService) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('attendance');

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
      return {
        accepted: false,
        message: `Rejected! You are ${geo.distance ?? '?'}m away${where}, outside your approved locations.`,
        distanceMeters: geo.distance,
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
    };

    const ref = await this.collection.add(record);
    return {
      accepted: true,
      id: ref.id,
      message: `Accepted! ${geo.distance}m from ${geo.name}.`,
      ...record,
    };
  }

  // POST /attendance/check-out — closes this employee's open check-in(s).
  async checkOut(event: AttendanceEvent) {
    // Same geofence rule as check-in: you must be on-site to check out too.
    const employee = await this.geofence.getEmployee(event.employeeId);
    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
    );
    if (!geo.inside) {
      const where = geo.name ? ` from ${geo.name}` : '';
      return {
        accepted: false,
        message: `Rejected! You are ${geo.distance ?? '?'}m away${where}, outside your approved locations.`,
        distanceMeters: geo.distance,
      };
    }

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
      return { accepted: false, message: 'No open check-in found for this employee.' };
    }

    const checkOutUtc = event.timestamp ?? new Date().toISOString();
    const checkOutCoords = { lat: event.latitude, lng: event.longitude };
    await Promise.all(
      open.map((doc) => doc.ref.update({ checkOutUtc, checkOutCoords, status: 'checked_out' })),
    );

    const latest = open.sort((a, b) =>
      (a.data() as { checkInUtc: string }).checkInUtc <
      (b.data() as { checkInUtc: string }).checkInUtc
        ? 1
        : -1,
    )[0];

    return { accepted: true, id: latest.id, message: 'Checked out successfully.' };
  }

  // DELETE /attendance/:id — admin removes a record (e.g. clean up duplicates).
  async remove(id: string) {
    await this.collection.doc(id).delete();
    return { id };
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
      this.db.collection('employees').get(),
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
      await Promise.all(orphans.map((d) => d.ref.delete()));
    }

    return this.sortMap(kept);
  }

  // Sorts records newest-first, maps each doc to { ...data, id }, and flags
  // any record where a background location ping (see LocationPingsService —
  // the separate 9AM-6PM periodic check, distinct from the geofence
  // enforced at the moment of check-in/out itself) caught the employee
  // outside their approved area at some point during that session.
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
        };
        const windowEnd = data.checkOutUtc ?? new Date().toISOString();
        const flaggedOutside = (anomalies.get(data.employeeId) ?? []).some(
          (ts) => ts >= data.checkInUtc && ts <= windowEnd,
        );
        // Spread data first, then id — so the real Firestore doc id always wins
        // over any `id` field stored inside the document (which would otherwise
        // make delete/update target the wrong record).
        return { ...doc.data(), id: doc.id, flaggedOutside };
      });
  }

  // Every out-of-geofence ping, grouped by employee — used to cross-reference
  // against each attendance session's [checkIn, checkOut] window.
  private async getAnomalyTimestampsByEmployee(): Promise<Map<string, string[]>> {
    const snapshot = await this.db
      .collection('locationPings')
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
