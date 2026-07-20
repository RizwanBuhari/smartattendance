import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';

export interface GeofenceEventPayload {
  employeeId: string;
  deviceId: string;
  locationId: string;
  eventType: 'ENTER' | 'DWELL' | 'EXIT' | 'RETURN';
  timestamp: string;
  enteredAt?: string;
  dwellConfirmedAt?: string;
  exitedAt?: string;
  totalInsideDurationSeconds?: number;
  attendanceId?: string;
  source: 'NATIVE_GEOFENCE';
  isBrief?: boolean;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
}

@Injectable()
export class GeofenceEventsService {
  constructor(private readonly geofence: GeofenceService) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('geofenceEvents');

  async record(payload: GeofenceEventPayload) {
    const employee = await this.geofence.getEmployee(payload.employeeId);
    
    // Look up location name
    let locationName = null;
    try {
      const locDoc = await this.db.collection('locations').doc(payload.locationId).get();
      if (locDoc.exists) {
        locationName = locDoc.data()?.name || null;
      }
    } catch (_) {}

    // Look up active attendance shift session
    let attendanceId = payload.attendanceId || null;
    if (!attendanceId) {
      try {
        const attSnap = await this.db.collection('attendance')
          .where('employeeId', '==', payload.employeeId)
          .where('status', '==', 'checked_in')
          .limit(1)
          .get();
        if (!attSnap.empty) {
          attendanceId = attSnap.docs[0].id;
        }
      } catch (_) {}
    }

    const eventRecord = {
      employeeId: payload.employeeId,
      employeeName: employee?.name || payload.employeeId,
      deviceId: payload.deviceId,
      locationId: payload.locationId,
      locationName: locationName,
      eventType: payload.eventType,
      timestamp: payload.timestamp,
      enteredAt: payload.enteredAt || null,
      dwellConfirmedAt: payload.dwellConfirmedAt || null,
      exitedAt: payload.exitedAt || null,
      totalInsideDurationSeconds: payload.totalInsideDurationSeconds != null 
        ? Math.round(payload.totalInsideDurationSeconds) 
        : null,
      attendanceId: attendanceId,
      source: payload.source,
      isBrief: payload.isBrief || null,
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      gpsAccuracy: payload.gpsAccuracy || null,
    };

    const ref = await this.collection.add(eventRecord);
    return {
      accepted: true,
      id: ref.id,
      message: `Geofence event ${payload.eventType} recorded successfully.`,
    };
  }
}
