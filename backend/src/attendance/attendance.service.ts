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

  // Checks a point against every approved location. Returns the nearest one and
  // whether the point is inside its allowed radius.
  private async checkGeofence(lat: number, lng: number) {
    const snapshot = await this.db.collection('locations').get();
    let nearest: { name: string; id: string; distance: number } | null = null;

    for (const doc of snapshot.docs) {
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

  // Best-effort friendly name for the dashboard. The mobile currently sends a
  // placeholder id (e.g. "EMP_001"); if it matches an employee doc we use the
  // real name, otherwise we just show the id.
  private async getEmployeeName(employeeId: string) {
    const doc = await this.db.collection('employees').doc(employeeId).get();
    return doc.exists ? (doc.data() as { name: string }).name : employeeId;
  }

  // POST /attendance/check-in
  async checkIn(event: AttendanceEvent) {
    const geo = await this.checkGeofence(event.latitude, event.longitude);
    if (!geo.inside) {
      const where = geo.name ? ` from ${geo.name}` : '';
      return {
        accepted: false,
        message: `Rejected! You are ${geo.distance ?? '?'}m away${where}, outside all approved locations.`,
        distanceMeters: geo.distance,
      };
    }

    const record = {
      employeeId: event.employeeId,
      employeeName: await this.getEmployeeName(event.employeeId),
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

  // POST /attendance/check-out — closes this employee's open check-in.
  async checkOut(event: AttendanceEvent) {
    const snapshot = await this.collection
      .where('employeeId', '==', event.employeeId)
      .get();

    // Pick the most recent record that is still open (status = checked_in).
    const open = snapshot.docs
      .filter((d) => (d.data() as { status: string }).status === 'checked_in')
      .sort((a, b) =>
        (a.data() as { checkInUtc: string }).checkInUtc <
        (b.data() as { checkInUtc: string }).checkInUtc
          ? 1
          : -1,
      )[0];

    if (!open) {
      return { accepted: false, message: 'No open check-in found for this employee.' };
    }

    await open.ref.update({
      checkOutUtc: event.timestamp ?? new Date().toISOString(),
      checkOutCoords: { lat: event.latitude, lng: event.longitude },
      status: 'checked_out',
    });

    return { accepted: true, id: open.id, message: 'Checked out successfully.' };
  }

  // GET /attendance — every record, newest first (for the dashboard).
  async findAll() {
    const snapshot = await this.collection.get();
    const sorted = snapshot.docs.sort((a, b) =>
      (a.data().checkInUtc as string) < (b.data().checkInUtc as string) ? 1 : -1,
    );
    return sorted.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}
