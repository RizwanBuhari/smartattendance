// Shared geofence logic — used by both attendance (check-in/out) and
// location-pings (periodic background tracking) so the two features can
// never disagree about what counts as "on-site".
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { LocationsService } from '../locations/locations.service';
import type { EmployeeRole } from '../employees/employees.service';

@Injectable()
export class GeofenceService {
  constructor(private readonly locations: LocationsService) {}

  private readonly db = getFirestore();

  // Native Geofence Resolution: Resolves the employee's assigned workplace location
  // relying on Native Geofencing reported by the mobile device.
  async check(
    lat: number,
    lng: number,
    assignedLocationIds: string[] = [],
    isInsideGeofence?: boolean,
  ) {
    const all = await this.locations.findAll();
    const candidates =
      assignedLocationIds.length > 0
        ? all.filter((l) => assignedLocationIds.includes(l.id))
        : all;

    const target = candidates.length > 0 ? candidates[0] : (all.length > 0 ? all[0] : null);

    if (isInsideGeofence === false) {
      return {
        inside: false,
        name: target?.name || null,
        id: target?.id || null,
        distance: null,
      };
    }

    if (target) {
      return {
        inside: true,
        name: target.name,
        id: target.id,
        distance: 0,
      };
    }

    return { inside: true, name: null, id: null, distance: 0 };
  }

  // Looks up the employee to get their display name and their approved
  // locations. The mobile app sends the Firebase Auth UID as the id. That's
  // not necessarily the employee doc's Firestore ID: a standalone
  // registration creates the doc keyed by the UID, but a code issued for an
  // employee the admin already created keeps that doc's original (random)
  // ID and only gets an `authUid` field pointing at the UID. So we look up
  // by the `authUid` field rather than assuming it's the doc ID — this
  // covers both cases. If nothing matches (not yet registered), we return
  // null and fall back to allowing any approved location.
  async getEmployee(authUid: string) {
    const snapshot = await this.db
      .collection('employees_ids')
      .where('authUid', '==', authUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    // The Firestore doc id is returned alongside the data because the rest of
    // the system keys on it (one-time codes, the site admin's team list) while
    // the mobile app only knows the Firebase authUid. Resolving the two here,
    // once, keeps every caller consistent.
    return {
      ...(snapshot.docs[0].data() as {
        name: string;
        assignedLocationIds?: string[];
        role?: EmployeeRole;
      }),
      id: snapshot.docs[0].id,
    };
  }
}
