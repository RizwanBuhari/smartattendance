// Talks to the "location_Pings" collection — periodic background location
// samples the mobile app sends during work hours, so the dashboard can flag
// an employee who has wandered outside their approved site during the day
// (as opposed to attendance, which only checks the moment of check-in/out).
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';

export interface LocationPingEvent {
  employeeId: string;
  latitude: number;
  longitude: number;
  gpsAccuracy?: number;
  timestamp?: string; // UTC ISO string from the phone
}

// Dubai is UTC+4 — same offset used by AttendanceService. Tracking pings
// outside this local-time window are rejected; the phone shouldn't be
// scheduling them then anyway, but the server is the authority.
const TZ_OFFSET_MINUTES = 240;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

@Injectable()
export class LocationPingsService {
  constructor(private readonly geofence: GeofenceService) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('location_Pings');

  private isWithinWorkHours(): boolean {
    const localMs = Date.now() + TZ_OFFSET_MINUTES * 60_000;
    const localHour = new Date(localMs).getUTCHours();
    return localHour >= WORK_START_HOUR && localHour < WORK_END_HOUR;
  }

  // POST /location-pings
  async record(event: LocationPingEvent) {
    if (!this.isWithinWorkHours()) {
      return { accepted: false, message: 'Outside tracking hours (9AM-6PM).' };
    }

    const employee = await this.geofence.getEmployee(event.employeeId);
    const geo = await this.geofence.check(
      event.latitude,
      event.longitude,
      employee?.assignedLocationIds ?? [],
    );

    const ping = {
      employeeId: event.employeeId,
      employeeName: employee?.name ?? event.employeeId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      tzOffsetMinutes: TZ_OFFSET_MINUTES,
      lat: event.latitude,
      lng: event.longitude,
      gpsAccuracy: event.gpsAccuracy ?? null,
      insideGeofence: geo.inside,
      locationName: geo.name,
      distanceMeters: geo.distance,
    };

    const ref = await this.collection.add(ping);
    return {
      accepted: true,
      id: ref.id,
      insideGeofence: geo.inside,
      distanceMeters: geo.distance != null ? Math.round(geo.distance) : null,
    };
  }

  // GET /location-pings/anomalies — one entry PER EMPLOYEE (their most
  // recent out-of-geofence ping), for the dashboard's live "who's out of
  // place" panel. Every repeat ping while someone stays outside would
  // otherwise pile up as a separate row for the same person — this keeps
  // only the latest, so the row just updates in place as new pings come in.
  // Capped to a recent window so a stale anomaly from weeks ago doesn't
  // linger forever.
  async findAnomalies() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const snapshot = await this.db.collection('geofence_Events').get();
    const recent = snapshot.docs.filter(
      (d) => (d.data() as { timestamp: string }).timestamp >= since,
    );
    const sorted = recent.sort((a, b) =>
      (a.data().timestamp as string) < (b.data().timestamp as string) ? 1 : -1,
    );

    const seen = new Set<string>();
    const latestEvents = sorted.filter((doc) => {
      const employeeId = (doc.data() as { employeeId: string }).employeeId;
      if (seen.has(employeeId)) return false;
      seen.add(employeeId);
      return true;
    });

    const outsideEmployees = latestEvents.filter(doc => {
      const data = doc.data() as { eventType: string };
      return data.eventType === 'EXIT';
    });

    // Only surface anomalies for employees who are CURRENTLY on an open shift.
    // The moment someone checks out — whether they were back inside the radius,
    // or their out-of-radius checkout was accepted/rejected by an admin — their
    // session closes, so their anomaly drops off here instead of lingering.
    // Query only OPEN sessions (usually a handful) rather than the whole
    // attendance history, to keep Firestore reads down.
    const attSnap = await this.db
      .collection('attendance_ids')
      .where('status', '==', 'checked_in')
      .get();
    const onShift = new Set<string>();
    for (const doc of attSnap.docs) {
      onShift.add((doc.data() as { employeeId: string }).employeeId);
    }

    return outsideEmployees
      .filter((doc) =>
        onShift.has((doc.data() as { employeeId: string }).employeeId),
      )
      .map((doc) => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          employeeId: data.employeeId,
          employeeName: data.employeeName,
          timestamp: data.timestamp,
          lat: data.latitude,
          lng: data.longitude,
          gpsAccuracy: data.gpsAccuracy,
          insideGeofence: false,
          locationName: data.locationName,
          distanceMeters: null,
        };
      });
  }

  // GET /location-pings?employeeId=xxx — every ping (inside or outside the
  // geofence) for one employee, newest first. Used both as a debugging aid to
  // confirm the mobile app's background schedule is firing, and by the
  // dashboard's per-employee report to build that employee's location heat-map.
  async findAll(employeeId: string) {
    const pingsSnap = await this.collection
      .where('employeeId', '==', employeeId)
      .get();
    const oldPings = pingsSnap.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        timestamp: data.timestamp,
        lat: data.lat,
        lng: data.lng,
        gpsAccuracy: data.gpsAccuracy,
        insideGeofence: data.insideGeofence,
        locationName: data.locationName,
        distanceMeters: data.distanceMeters,
      };
    });

    const eventsSnap = await this.db.collection('geofence_Events')
      .where('employeeId', '==', employeeId)
      .get();
    const newEvents = eventsSnap.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        timestamp: data.timestamp,
        lat: data.latitude,
        lng: data.longitude,
        gpsAccuracy: data.gpsAccuracy,
        insideGeofence: data.eventType !== 'EXIT',
        locationName: data.locationName,
        distanceMeters: null,
      };
    });

    const combined = [...oldPings, ...newEvents];
    return combined.sort((a, b) =>
      (a.timestamp as string) < (b.timestamp as string) ? 1 : -1
    );
  }
}
