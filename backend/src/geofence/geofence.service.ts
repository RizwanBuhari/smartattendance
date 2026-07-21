// Shared geofence logic — used by both attendance (check-in/out) and
// location-pings (periodic background tracking) so the two features can
// never disagree about what counts as "on-site".
import { Injectable } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { LocationsService } from '../locations/locations.service';

@Injectable()
export class GeofenceService {
  constructor(private readonly locations: LocationsService) {}

  private readonly db = getFirestore();

  // --- Haversine: distance in metres between two lat/lng points. ---
  distanceMeters(
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
  // (so a point outside their assigned sites is rejected). If they have none
  // configured, we fall back to allowing any approved location.
  async check(lat: number, lng: number, assignedLocationIds: string[] = []) {
    // Cached in Redis by LocationsService — this runs on every check-in,
    // check-out and background ping, so it must not hit Firestore each time.
    const all = await this.locations.findAll();
    const candidates =
      assignedLocationIds.length > 0
        ? all.filter((l) => assignedLocationIds.includes(l.id))
        : all;
    let nearest: { name: string; id: string; distance: number } | null = null;

    for (const loc of candidates) {
      const distance = this.distanceMeters(
        lat,
        lng,
        loc.latitude,
        loc.longitude,
      );
      if (!nearest || distance < nearest.distance) {
        nearest = { name: loc.name, id: loc.id, distance };
      }
      if (distance <= loc.radiusMeters) {
        return {
          inside: true,
          name: loc.name,
          id: loc.id,
          distance: Math.round(distance),
        };
      }
    }

    return nearest
      ? {
          inside: false,
          name: nearest.name,
          id: nearest.id,
          distance: Math.round(nearest.distance),
        }
      : { inside: false, name: null, id: null, distance: null };
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
      }),
      id: snapshot.docs[0].id,
    };
  }
}
