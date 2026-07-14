// Talks to the "attendance" collection in Firestore and enforces the geofence.
//
// The mobile app POSTs a check-in/out with the phone's live GPS. We verify the
// point is inside one of the APPROVED LOCATIONS (managed by the admin in the
// dashboard — the "locations" collection), then save a record the dashboard
// can display. This is what keeps the app and dashboard in sync: the admin
// edits locations on the web, and the mobile geofence respects them instantly.
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

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
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('attendance');

  // --- Haversine: distance in metres between two lat/lng points. ---
  // (Same formula your teammate wrote — verified correct.)
  private distanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371e3; // Earth's radius in metres
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Checks a point against the employee's approved locations. Returns the
  // nearest one and whether the point is inside its allowed radius.
  //
  // If the employee has approved locations configured, ONLY those are checked
  // (so a check-in outside their assigned sites is rejected). If they have none
  // configured, we fall back to allowing any approved location.
  private async checkGeofence(
    lat: number,
    lng: number,
    assignedLocationIds: string[] = [],
  ) {
    const snapshot = await this.db.collection('locations').get();
    const docs =
      assignedLocationIds.length > 0
        ? snapshot.docs.filter((d) => assignedLocationIds.includes(d.id))
        : snapshot.docs;
    let nearest: { name: string; id: string; distance: number } | null = null;

    for (const doc of docs) {
      const loc = doc.data() as {
        name: string;
        latitude: number;
        longitude: number;
        radiusMeters: number;
      };
      const distance = this.distanceMeters(lat, lng, loc.latitude, loc.longitude);
      if (!nearest || distance < nearest.distance) {
        nearest = { name: loc.name, id: doc.id, distance };
      }
      if (distance <= loc.radiusMeters) {
        return { inside: true, name: loc.name, id: doc.id, distance: Math.round(distance) };
      }
    }

    return nearest
      ? { inside: false, name: nearest.name, id: nearest.id, distance: Math.round(nearest.distance) }
      : { inside: false, name: null, id: null, distance: null };
  }

  // Looks up the employee to get their display name and their approved
  // locations. The mobile app sends the Firebase Auth UID as employeeId.
  // That's not necessarily the employee doc's Firestore ID: a standalone
  // registration creates the doc keyed by the UID, but a code issued for an
  // employee the admin already created keeps that doc's original (random)
  // ID and only gets an `authUid` field pointing at the UID. So we look up
  // by the `authUid` field rather than assuming it's the doc ID — this
  // covers both cases. If nothing matches (not yet registered), we return
  // null and fall back to allowing any approved location.
  private async getEmployee(authUid: string) {
    const snapshot = await this.db
      .collection('employees')
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as { name: string; assignedLocationIds?: string[] };
  }

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

    const employee = await this.getEmployee(event.employeeId);
    const geo = await this.checkGeofence(
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
    const employee = await this.getEmployee(event.employeeId);
    const geo = await this.checkGeofence(
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

  // GET /attendance — every record, newest first (for the dashboard).
  // GET /attendance?employeeId=xxx — just that employee's records (for the
  // mobile app's own history list).
  async findAll(employeeId?: string) {
    const query = employeeId
      ? this.collection.where('employeeId', '==', employeeId)
      : this.collection;
    const snapshot = await query.get();
    const sorted = snapshot.docs.sort((a, b) =>
      (a.data().checkInUtc as string) < (b.data().checkInUtc as string) ? 1 : -1,
    );
    return sorted.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}
