// Shared geofence logic — used by attendance (check-in/out), location-pings
// (periodic background tracking) and geofence-events (native ENTER/EXIT
// reports), so none of them can disagree about what counts as "on-site".
//
// THE SERVER DECIDES. Earlier this class returned `{ inside: true, distance: 0 }`
// and only said otherwise when the phone POSTed `isInsideGeofence: false` — the
// decision belonged to the client, which made it worth exactly as much as the
// button press this project exists to replace. The distance is now computed here
// from the reported coordinates against the admin-configured radius. The
// client's own claim is still accepted, but only as a signal to cross-check:
// when it disagrees with our arithmetic we record the disagreement, because a
// phone insisting it is on-site while its own coordinates say otherwise is the
// single most useful fraud indicator this system can produce.
import { Injectable, Logger } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import {
  LocationsService,
  StoredLocation,
} from '../locations/locations.service';
import type { EmployeeRole } from '../employees/employees.service';
import {
  haversineMetres,
  isValidLatitude,
  isValidLongitude,
  isNullIsland,
} from './geo';

// A fix worse than this is not trusted to place someone inside a radius at all.
// 50m is a deliberate compromise: a modern phone with a clear sky reports 3-10m,
// indoors or in an urban canyon it degrades to 20-40m, and beyond ~50m the fix
// is usually a wifi/cell-tower estimate rather than a satellite one — precise
// enough to say "in this neighbourhood", not "at this building".
//
// Overridable per deployment: a site surrounded by tall structures may need a
// looser ceiling, and that is a configuration decision, not a code change.
export const MAX_ACCEPTABLE_ACCURACY_METRES = Number(
  process.env.MAX_GPS_ACCURACY_METRES ?? 50,
);

// How much of the reported accuracy is allowed to count in the employee's
// favour at the boundary.
//
// A fix is a probability cloud, not a point: someone standing exactly on the
// perimeter with a ±30m fix is genuinely ambiguous, and rejecting them produces
// the "I'm standing right here and it won't let me check in" complaint that
// makes people stop using the app. So the radius is allowed to stretch by the
// accuracy figure — but only up to this cap, otherwise a conveniently poor fix
// becomes a way to inflate the geofence. Capped at 25m, a 100m site can never
// behave like more than a 125m one.
export const MAX_ACCURACY_BUFFER_METRES = Number(
  process.env.MAX_GPS_ACCURACY_BUFFER_METRES ?? 25,
);

export interface GeofenceCheckResult {
  /** Server's verdict. This is the only field callers should gate on. */
  inside: boolean;
  /** Nearest relevant approved location (the one they're inside, if any). */
  name: string | null;
  id: string | null;
  /** Metres to that location's centre, rounded. Null only if unresolvable. */
  distance: number | null;
  /** The configured radius that `distance` was judged against. */
  radiusMeters: number | null;
  /** Accuracy allowance actually applied at the boundary, in metres. */
  accuracyBufferApplied: number;
  /** What the phone claimed, when it said anything at all. */
  clientClaimedInside: boolean | null;
  /** True when the phone's claim contradicts the server's arithmetic. */
  clientDisagreed: boolean;
  /** Machine-readable cause when `inside` is false. */
  reason:
    | 'inside'
    | 'invalid_coordinates'
    | 'poor_accuracy'
    | 'no_approved_locations'
    | 'outside_radius';
  /** Human-readable explanation, safe to surface to the employee. */
  message: string;
}

@Injectable()
export class GeofenceService {
  constructor(private readonly locations: LocationsService) {}

  private readonly db = getFirestore();
  private readonly logger = new Logger(GeofenceService.name);

  /**
   * Decides whether a reported position is inside one of the employee's
   * approved locations, server-side.
   *
   * @param lat                   latitude as reported by the device
   * @param lng                   longitude as reported by the device
   * @param assignedLocationIds   the employee's approved locations; empty means
   *                              "any approved location" (an employee the admin
   *                              has not scoped yet)
   * @param clientClaimedInside   what the phone said, for cross-checking only
   * @param gpsAccuracy           the fix's reported accuracy radius in metres
   */
  async check(
    lat: number,
    lng: number,
    assignedLocationIds: string[] = [],
    clientClaimedInside?: boolean,
    gpsAccuracy?: number,
  ): Promise<GeofenceCheckResult> {
    const claimed =
      typeof clientClaimedInside === 'boolean' ? clientClaimedInside : null;

    // Shapes a result and works out, in one place, whether the phone's claim
    // contradicted us — so no early return can forget to set it.
    const build = (
      partial: Omit<
        GeofenceCheckResult,
        'clientClaimedInside' | 'clientDisagreed'
      >,
    ): GeofenceCheckResult => {
      const disagreed = claimed !== null && claimed !== partial.inside;
      if (disagreed) {
        // Worth a log line on its own: the interesting direction (phone says
        // inside, server says outside) is an attempted spoof or a badly stale
        // client cache, and either way someone should be able to find it later.
        this.logger.warn(
          `Client/server geofence disagreement: client claimed ${
            claimed ? 'INSIDE' : 'OUTSIDE'
          }, server computed ${partial.inside ? 'INSIDE' : 'OUTSIDE'} ` +
            `(${partial.reason}, ${partial.distance ?? '?'}m from ${
              partial.name ?? 'unknown'
            })`,
        );
      }
      return {
        ...partial,
        clientClaimedInside: claimed,
        clientDisagreed: disagreed,
      };
    };

    // --- Step 1: is this even a coordinate? ---------------------------------
    // The transport layer validates the request body, but this class is called
    // from three different modules and is the thing that guarantees the geofence
    // rule — so it re-checks rather than trusting that every caller validated.
    if (
      !isValidLatitude(lat) ||
      !isValidLongitude(lng) ||
      isNullIsland(lat, lng)
    ) {
      return build({
        inside: false,
        name: null,
        id: null,
        distance: null,
        radiusMeters: null,
        accuracyBufferApplied: 0,
        reason: 'invalid_coordinates',
        message: 'No usable location was reported by the device.',
      });
    }

    // --- Step 2: is the fix good enough to place them? ----------------------
    // Ordered before the distance maths on purpose: with a ±500m fix the
    // distance is not meaningful, so computing it would only lend false
    // precision to a number nobody should act on.
    if (
      typeof gpsAccuracy === 'number' &&
      Number.isFinite(gpsAccuracy) &&
      gpsAccuracy > MAX_ACCEPTABLE_ACCURACY_METRES
    ) {
      return build({
        inside: false,
        name: null,
        id: null,
        distance: null,
        radiusMeters: null,
        accuracyBufferApplied: 0,
        reason: 'poor_accuracy',
        message:
          `GPS accuracy is too low (±${Math.round(gpsAccuracy)}m, ` +
          `limit ±${MAX_ACCEPTABLE_ACCURACY_METRES}m). ` +
          'Move to an open area and try again.',
      });
    }

    // --- Step 3: distance to each candidate --------------------------------
    const all = await this.locations.findAll();
    const candidates =
      assignedLocationIds.length > 0
        ? all.filter((l) => assignedLocationIds.includes(l.id))
        : all;

    // Drop locations the admin saved with unusable coordinates rather than
    // letting NaN propagate into a distance and quietly become "not inside".
    const usable = candidates.filter(
      (l) =>
        isValidLatitude(l.latitude) &&
        isValidLongitude(l.longitude) &&
        typeof l.radiusMeters === 'number' &&
        Number.isFinite(l.radiusMeters) &&
        l.radiusMeters > 0,
    );

    if (usable.length === 0) {
      return build({
        inside: false,
        name: null,
        id: null,
        distance: null,
        radiusMeters: null,
        accuracyBufferApplied: 0,
        reason: 'no_approved_locations',
        message:
          candidates.length > 0
            ? 'Your approved location is misconfigured. Contact your administrator.'
            : 'You have no approved work location assigned. Contact your administrator.',
      });
    }

    // The accuracy allowance, bounded so a poor fix cannot inflate the geofence
    // without limit. Absent accuracy gets no allowance — we do not invent one.
    const buffer =
      typeof gpsAccuracy === 'number' && Number.isFinite(gpsAccuracy)
        ? Math.min(Math.max(gpsAccuracy, 0), MAX_ACCURACY_BUFFER_METRES)
        : 0;

    const measured = usable
      .map((location: StoredLocation) => {
        const distance = haversineMetres(
          lat,
          lng,
          location.latitude,
          location.longitude,
        );
        return {
          location,
          distance,
          inside: distance <= location.radiusMeters + buffer,
        };
      })
      // NEAREST FIRST. The previous implementation took `candidates[0]` — the
      // first assigned location, in whatever order Firestore returned it — so an
      // employee with Office + Home + Customer Site had every record attributed
      // to whichever happened to sort first.
      .sort((a, b) => a.distance - b.distance);

    // --- Step 4: inside any approved radius? -------------------------------
    // An employee may be approved for several locations, so being inside ANY of
    // them counts. Prefer the nearest one they are actually inside; if none,
    // report the nearest overall so the record and the error message name the
    // place they were closest to.
    const hit = measured.find((m) => m.inside) ?? measured[0];
    const distance = Math.round(hit.distance);

    if (!hit.inside) {
      return build({
        inside: false,
        name: hit.location.name,
        id: hit.location.id,
        distance,
        radiusMeters: hit.location.radiusMeters,
        accuracyBufferApplied: buffer,
        reason: 'outside_radius',
        message:
          `You are ${distance}m from ${hit.location.name}, ` +
          `outside its ${hit.location.radiusMeters}m approved radius.`,
      });
    }

    return build({
      inside: true,
      name: hit.location.name,
      id: hit.location.id,
      distance,
      radiusMeters: hit.location.radiusMeters,
      accuracyBufferApplied: buffer,
      reason: 'inside',
      message: `Inside ${hit.location.name} (${distance}m from centre).`,
    });
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
