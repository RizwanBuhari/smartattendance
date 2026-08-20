// Request-body validation for every endpoint that accepts a GPS reading:
// check-in, check-out, background location pings and native geofence events.
//
// Why this is hand-rolled rather than class-validator + a global ValidationPipe:
// the rules here are domain rules, not generic type assertions. "A latitude is a
// finite number in [-90, 90], not at Null Island, and its timestamp is not three
// days in the future" is a statement about GPS, and expressing it directly is
// clearer than assembling it out of decorators. It also keeps the backend
// dependency-free, which matters for something on the check-in path.
//
// What it guarantees to the services behind it:
//   * latitude / longitude are present, are real numbers, and are in range
//   * gpsAccuracy, when present, is a non-negative finite number
//   * timestamp, when present, parses and is not absurdly skewed
//   * NOTHING ELSE from the request body survives — see the whitelist note below
//
// The whitelist is the security-relevant half. Previously a client could POST
// arbitrary extra fields and they would flow into `this.collection.add(record)`
// untouched, so the phone could write keys the server never intended to expose —
// including ones the dashboard reads, like `status` or `checkoutFlagged`.
import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import {
  isValidLatitude,
  isValidLongitude,
  isNullIsland,
} from '../../geofence/geo';

// A phone with a badly wrong clock (or a forged timestamp) should not be able to
// backdate a shift or book one in the future. Generous enough to absorb ordinary
// clock drift and a device that queued an event offline for a while.
const MAX_CLOCK_SKEW_FUTURE_MS = 5 * 60 * 1000; // 5 minutes ahead
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days behind (offline queue)

export interface GeoPayloadOptions {
  /** Extra keys, beyond the GPS fields, that this route legitimately accepts. */
  allow?: readonly string[];
  /** When false, latitude/longitude may be omitted entirely. */
  requireCoordinates?: boolean;
}

// Fields every geo endpoint understands. Anything outside this set plus the
// route's own `allow` list is dropped.
const BASE_FIELDS = [
  'latitude',
  'longitude',
  'gpsAccuracy',
  'timestamp',
  'deviceId',
  'tzOffsetMinutes',
] as const;

@Injectable()
export class GeoPayloadPipe implements PipeTransform {
  constructor(private readonly options: GeoPayloadOptions = {}) {}

  transform(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    const body = value as Record<string, unknown>;
    const errors: string[] = [];
    const requireCoordinates = this.options.requireCoordinates ?? true;

    // --- Coordinates ------------------------------------------------------
    const hasLat = body.latitude !== undefined && body.latitude !== null;
    const hasLng = body.longitude !== undefined && body.longitude !== null;

    if (requireCoordinates || hasLat || hasLng) {
      if (!hasLat || !hasLng) {
        errors.push('latitude and longitude are both required.');
      } else {
        // Strings are rejected rather than coerced. The Flutter client sends
        // real doubles; a string here means something has gone wrong upstream,
        // and silently parsing it would hide that.
        if (!isValidLatitude(body.latitude)) {
          errors.push('latitude must be a number between -90 and 90.');
        }
        if (!isValidLongitude(body.longitude)) {
          errors.push('longitude must be a number between -180 and 180.');
        }
        if (
          isValidLatitude(body.latitude) &&
          isValidLongitude(body.longitude) &&
          isNullIsland(body.latitude, body.longitude)
        ) {
          errors.push(
            'latitude/longitude of exactly (0, 0) is not a valid GPS fix.',
          );
        }
      }
    }

    // --- Accuracy ---------------------------------------------------------
    // Not range-checked against the ceiling here: that is a geofence decision
    // (it produces a `poor_accuracy` verdict the employee can act on), not a
    // malformed request. This only rejects values that aren't measurements.
    if (body.gpsAccuracy !== undefined && body.gpsAccuracy !== null) {
      const acc = body.gpsAccuracy;
      if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0) {
        errors.push('gpsAccuracy must be a non-negative number.');
      }
    }

    // --- Timestamp --------------------------------------------------------
    if (body.timestamp !== undefined && body.timestamp !== null) {
      if (typeof body.timestamp !== 'string') {
        errors.push('timestamp must be a UTC ISO-8601 string.');
      } else {
        const ms = Date.parse(body.timestamp);
        if (Number.isNaN(ms)) {
          errors.push('timestamp must be a parseable UTC ISO-8601 string.');
        } else {
          const skew = ms - Date.now();
          if (skew > MAX_CLOCK_SKEW_FUTURE_MS) {
            errors.push('timestamp is too far in the future.');
          } else if (-skew > MAX_BACKDATE_MS) {
            errors.push('timestamp is too far in the past.');
          }
        }
      }
    }

    // --- tzOffsetMinutes --------------------------------------------------
    // Real-world offsets span UTC-12:00 to UTC+14:00.
    if (body.tzOffsetMinutes !== undefined && body.tzOffsetMinutes !== null) {
      const tz = body.tzOffsetMinutes;
      if (typeof tz !== 'number' || !Number.isInteger(tz) || tz < -720 || tz > 840) {
        errors.push(
          'tzOffsetMinutes must be a whole number of minutes between -720 and 840.',
        );
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid location payload.',
        errors,
      });
    }

    // --- Whitelist --------------------------------------------------------
    const allowed = new Set<string>([
      ...BASE_FIELDS,
      ...(this.options.allow ?? []),
    ]);
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (allowed.has(key)) clean[key] = body[key];
    }
    return clean;
  }
}
