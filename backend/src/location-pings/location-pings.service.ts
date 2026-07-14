// Talks to the "locationPings" collection — periodic background location
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
  private readonly collection = this.db.collection('locationPings');

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
    return { accepted: true, id: ref.id, insideGeofence: geo.inside };
  }

  // GET /location-pings/anomalies — pings outside the geofence, newest
  // first, for the dashboard's live "who's out of place" panel. Capped to a
  // recent window so a stale anomaly from weeks ago doesn't linger forever.
  async findAnomalies() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const snapshot = await this.collection.where('insideGeofence', '==', false).get();
    const recent = snapshot.docs.filter(
      (d) => (d.data() as { timestamp: string }).timestamp >= since,
    );
    const sorted = recent.sort((a, b) =>
      (a.data().timestamp as string) < (b.data().timestamp as string) ? 1 : -1,
    );
    return sorted.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}
