// Talks to the "locations_ids" collection in Firestore — the approved work sites
// (with a GPS centre + allowed radius) that attendance is checked against.
import { Injectable } from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  // What kind of place this is, and the single source of truth for how strict
  // check-in is there:
  //   'site'   -> supervised: inside the geofence AND a code scanned from a
  //               site admin. Used for work sites.
  //   'office' -> geofence only (the original behaviour).
  // Missing/undefined is treated as 'office', so existing locations keep
  // working exactly as before.
  type?: 'site' | 'office';
}

// One place decides whether a location demands a scanned code, so the rule can
// never drift between check-in, the mobile app and the dashboard.
export function isSite(location: Pick<Location, 'type'> | undefined | null) {
  return location?.type === 'site';
}

export type StoredLocation = Location & { id: string };

// Single cache entry holding the whole (small) locations list.
const LOCATIONS_CACHE_KEY = 'locations:all';
// Deliberately short. Writes through this service invalidate the cache
// immediately, but an edit made DIRECTLY in the Firebase console cannot be
// detected — this TTL bounds how long such a change can go unnoticed.
const LOCATIONS_CACHE_TTL_SECONDS = 60;

@Injectable()
export class LocationsService {
  constructor(private readonly redis: RedisService) {}

  private readonly db = getFirestore();
  private readonly collection = this.db.collection('locations_ids');
  private readonly employees = this.db.collection('employees_ids');

  // Read on every geofence check (check-in, check-out and every background
  // location ping), so it is cached: the list is tiny and rarely changes.
  async findAll(): Promise<StoredLocation[]> {
    const cached = await this.redis.get(LOCATIONS_CACHE_KEY);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as StoredLocation[];
      } catch {
        // Corrupt entry — ignore it and fall through to Firestore.
      }
    }

    const snapshot = await this.collection.get();
    // Spread data first, then id — the Firestore doc id must win over any
    // stored `id` field so delete targets the right record.
    const locations = snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    })) as StoredLocation[];

    await this.redis.set(
      LOCATIONS_CACHE_KEY,
      JSON.stringify(locations),
      LOCATIONS_CACHE_TTL_SECONDS,
    );
    return locations;
  }

  // Every write path calls this so the next read rebuilds from Firestore.
  private async invalidateCache() {
    await this.redis.del(LOCATIONS_CACHE_KEY);
  }

  async create(location: Location) {
    const ref = await this.collection.add(location);
    await this.invalidateCache();
    return { id: ref.id, ...location };
  }

  // Updates a location's editable fields (name / coordinates / radius). Writes
  // straight to Firestore — which is exactly what the mobile geofence reads, so
  // a change here takes effect immediately for check-ins.
  async update(id: string, changes: Partial<Location>) {
    const allowed: Partial<Location> = {};
    if (changes.name !== undefined) allowed.name = changes.name;
    if (changes.latitude !== undefined) allowed.latitude = changes.latitude;
    if (changes.longitude !== undefined) allowed.longitude = changes.longitude;
    if (changes.radiusMeters !== undefined) {
      allowed.radiusMeters = changes.radiusMeters;
    }
    if (changes.type !== undefined) {
      allowed.type = changes.type === 'site' ? 'site' : 'office';
    }
    await this.collection.doc(id).update(allowed);
    // Must happen before returning: geofence checks read this cache, so a
    // changed radius/centre has to take effect on the very next check-in.
    await this.invalidateCache();
    const doc = await this.collection.doc(id).get();
    return { ...doc.data(), id };
  }

  async remove(id: string) {
    // Deleting the location doc alone leaves its id behind in every employee's
    // assignedLocationIds. With no location left to resolve that id to a name,
    // the dashboard falls back to printing the raw id — so pull it out of every
    // employee that referenced it, in the same batch as the delete.
    const affected = await this.employees
      .where('assignedLocationIds', 'array-contains', id)
      .get();

    const batch = this.db.batch();
    for (const doc of affected.docs) {
      batch.update(doc.ref, {
        assignedLocationIds: FieldValue.arrayRemove(id),
      });
    }
    batch.delete(this.collection.doc(id));
    await batch.commit();

    // The EmployeeGuard caches each employee record (assignedLocationIds and
    // all) under `auth:employee:<authUid>`; drop the entries we just changed so
    // the next request — and the mobile geofence sync behind it — sees the
    // location gone rather than a stale cached copy. Key format mirrors
    // EmployeesService/EmployeeGuard.
    await Promise.all(
      affected.docs
        .map((doc) => (doc.data() as { authUid?: string }).authUid)
        .filter((uid): uid is string => !!uid)
        .map((uid) => this.redis.del(`auth:employee:${uid}`)),
    );

    await this.invalidateCache();
    return { id, unassignedFrom: affected.size };
  }
}
