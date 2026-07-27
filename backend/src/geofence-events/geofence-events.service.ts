import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { GeofenceService } from '../geofence/geofence.service';
import { PushService } from '../push/push.service';

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
  constructor(
    private readonly geofence: GeofenceService,
    private readonly push: PushService,
  ) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('geofence_Events');

  async record(payload: GeofenceEventPayload) {
    const employee = await this.geofence.getEmployee(payload.employeeId);

    // Look up location name
    let locationName = null;
    try {
      const locDoc = await this.db
        .collection('locations_ids')
        .doc(payload.locationId)
        .get();
      if (locDoc.exists) {
        locationName = locDoc.data()?.name || null;
      }
    } catch (_) {}

    // Look up active attendance shift session
    let attendanceId = payload.attendanceId || null;
    if (!attendanceId) {
      try {
        const attSnap = await this.db
          .collection('attendance_ids')
          .where('employeeId', '==', payload.employeeId)
          .where('status', '==', 'checked_in')
          .limit(1)
          .get();
        if (!attSnap.empty) {
          attendanceId = attSnap.docs[0].id;
        }
      } catch (_) {}
    }

    const employeeName = employee?.name || payload.employeeId;

    const eventRecord = {
      employeeId: payload.employeeId,
      employeeDocId: employee?.id || payload.employeeId,
      employeeName: employeeName,
      deviceId: payload.deviceId,
      locationId: payload.locationId,
      locationName: locationName,
      eventType: payload.eventType,
      timestamp: payload.timestamp,
      enteredAt: payload.enteredAt || null,
      dwellConfirmedAt: payload.dwellConfirmedAt || null,
      exitedAt: payload.exitedAt || null,
      totalInsideDurationSeconds:
        payload.totalInsideDurationSeconds != null
          ? Math.round(payload.totalInsideDurationSeconds)
          : null,
      attendanceId: attendanceId,
      source: payload.source,
      isBrief: payload.isBrief || null,
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      gpsAccuracy: payload.gpsAccuracy || null,
      reason: null,
    };

    const ref = await this.collection.add(eventRecord);

    // Realtime notification to Admins & Supervisors when employee exits or returns to working radius
    if (payload.eventType === 'EXIT' || payload.eventType === 'RETURN') {
      try {
        const supSnap = await this.db
          .collection('employees_ids')
          .where('role', 'in', ['site_supervisor', 'siteAdmin'])
          .get();
        const supIds = supSnap.docs
          .map((d) => d.data().authUid || d.id)
          .filter(Boolean);

        if (supIds.length > 0) {
          const isReturn = payload.eventType === 'RETURN';
          await this.push.sendToEmployees(supIds, {
            title: isReturn ? 'Geofence Return Alert' : 'Geofence Exit Alert',
            body: isReturn
              ? `${employeeName} has returned to ${locationName ?? 'the office radius'}.`
              : `${employeeName} is out of working radius for ${locationName ?? 'assigned site'}.`,
            data: {
              type: isReturn ? 'geofence_return' : 'geofence_exit',
              employeeId: payload.employeeId,
              eventId: ref.id,
            },
          });
        }
      } catch (_) {}
    }

    return {
      accepted: true,
      id: ref.id,
      message: `Geofence event ${payload.eventType} recorded successfully.`,
    };
  }

  async submitReason(
    authUid: string,
    eventId?: string,
    locationId?: string,
    reason?: string,
  ) {
    if (!reason || reason.trim().length === 0) {
      return { accepted: false, message: 'Reason cannot be empty.' };
    }
    const cleanReason = reason.trim();
    const employee = await this.geofence.getEmployee(authUid);
    const employeeName = employee?.name || authUid;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const snap1 = await this.collection
      .where('employeeId', '==', authUid)
      .where('eventType', '==', 'EXIT')
      .get();

    let docs = [...snap1.docs];
    if (employee?.id && employee.id !== authUid) {
      const snap2 = await this.collection
        .where('employeeDocId', '==', employee.id)
        .where('eventType', '==', 'EXIT')
        .get();
      for (const d of snap2.docs) {
        if (!docs.some((existing) => existing.id === d.id)) {
          docs.push(d);
        }
      }
    }

    let updatedAny = false;
    for (const doc of docs) {
      if ((doc.data().timestamp || '') >= since || doc.id === eventId) {
        await doc.ref.update({
          reason: cleanReason,
          reasonSubmittedAt: new Date().toISOString(),
        });
        updatedAny = true;
      }
    }

    if (!updatedAny) {
      await this.collection.add({
        employeeId: authUid,
        employeeDocId: employee?.id || authUid,
        employeeName: employeeName,
        eventType: 'EXIT',
        timestamp: new Date().toISOString(),
        locationId: locationId || null,
        reason: cleanReason,
        reasonSubmittedAt: new Date().toISOString(),
      });
    }

    // Push notification to Supervisors / Admins about the exit reason
    try {
      const supSnap = await this.db
        .collection('employees_ids')
        .where('role', 'in', ['site_supervisor', 'siteAdmin'])
        .get();
      const supIds = supSnap.docs
        .map((d) => d.data().authUid || d.id)
        .filter(Boolean);
      if (supIds.length > 0) {
        await this.push.sendToEmployees(supIds, {
          title: 'Geofence Exit Reason',
          body: `${employeeName} submitted exit reason: "${cleanReason}"`,
          data: { type: 'geofence_reason', employeeId: authUid },
        });
      }
    } catch (_) {}

    return {
      accepted: true,
      message: 'Reason submitted successfully to HR.',
    };
  }
}
