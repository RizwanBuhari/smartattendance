// Talks to the "locations_ids" collection in Firestore — the approved work sites
// (with a GPS centre + allowed radius) that attendance is checked against.
import { Injectable } from '@nestjs/common';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { RedisService } from '../redis/redis.service';

// "HH:MM", 24-hour, zero-padded (e.g. "08:00", "22:30"). Both ends of a pair
// are required for the pair to count as configured — see isWithinWindow.
export interface TimeWindow {
  from?: string;
  to?: string;
}

export interface RoleAttendanceWindows {
  checkIn?: TimeWindow;
  checkOut?: TimeWindow;
}

// Keyed by the same three canonical roles employees.service.ts normalizes
// to. A role with no entry (or an entry missing either from/to) is
// unrestricted — this is opt-in per location, per role, so a location saved
// before this feature existed keeps behaving exactly as before.
export type AttendanceWindows = Partial<
  Record<'office_employee' | 'site_employee' | 'site_supervisor', RoleAttendanceWindows>
>;

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
  // Per-role check-in/check-out hours at this location. Enforced by
  // AttendanceService (reject check-in) and OffsiteCheckinService (reject
  // check-in, flag checkout for review) via isWithinWindow — see
  // attendance/attendance-window.util.ts.
  attendanceWindows?: AttendanceWindows;
}

// One place decides whether a location demands a scanned code, so the rule can
// never drift between check-in, the mobile app and the dashboard.
export function isSite(location: Pick<Location, 'type'> | undefined | null) {
  return location?.type === 'site';
}

export type StoredLocation = Location & { id: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLE_KEYS = ['office_employee', 'site_employee', 'site_supervisor'] as const;

// Drops anything that isn't a clean "HH:MM" pair rather than rejecting the
// whole location save — a malformed single field falling back to
// "unconfigured" (open) is far safer than a save that fails outright and
// takes the admin's other edits down with it.
function sanitizeAttendanceWindows(
  raw: unknown,
): AttendanceWindows | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const cleanWindow = (w: unknown): TimeWindow | undefined => {
    if (!w || typeof w !== 'object') return undefined;
    const { from, to } = w as Record<string, unknown>;
    const cleanFrom = typeof from === 'string' && HHMM.test(from) ? from : undefined;
    const cleanTo = typeof to === 'string' && HHMM.test(to) ? to : undefined;
    // Both ends or neither — a pair with only one valid end is exactly the
    // "unconfigured" case (isWithinWindow already treats a missing end as
    // open), so drop it here rather than persisting a half-set pair that
    // would show a lone "To" value with no "From" on the dashboard.
    if (!cleanFrom || !cleanTo) return undefined;
    return { from: cleanFrom, to: cleanTo };
  };

  const result: AttendanceWindows = {};
  for (const role of ROLE_KEYS) {
    const roleRaw = input[role] as Record<string, unknown> | undefined;
    if (!roleRaw || typeof roleRaw !== 'object') continue;
    const checkIn = cleanWindow(roleRaw.checkIn);
    const checkOut = cleanWindow(roleRaw.checkOut);
    // Only set a key when it actually has a value — Firestore's update()
    // rejects `undefined` anywhere in the payload, so `{ checkIn, checkOut }`
    // here (when only one is configured) would crash every save that
    // configures just check-in OR just check-out for a role, which is the
    // normal case, not an edge case.
    if (checkIn || checkOut) {
      const roleWindows: RoleAttendanceWindows = {};
      if (checkIn) roleWindows.checkIn = checkIn;
      if (checkOut) roleWindows.checkOut = checkOut;
      result[role] = roleWindows;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

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
    const clean: Location = { ...location };
    const windows = sanitizeAttendanceWindows(location.attendanceWindows);
    if (windows) {
      clean.attendanceWindows = windows;
    } else {
      delete clean.attendanceWindows;
    }
    const ref = await this.collection.add(clean);
    await this.invalidateCache();
    return { id: ref.id, ...clean };
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
    if (changes.attendanceWindows !== undefined) {
      // An explicit {} clears every role's hours back to unrestricted —
      // Firestore's `update` needs the field named to overwrite it, not
      // merge into it, so this always replaces the whole map.
      allowed.attendanceWindows =
        sanitizeAttendanceWindows(changes.attendanceWindows) ?? {};
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
