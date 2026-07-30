// Pure geospatial helpers. No Nest, no Firestore, no I/O — so they can be unit
// tested directly and reused by anything that needs to reason about distance.
//
// Why this file exists: the geofence decision used to be made on the phone and
// POSTed to the server as a boolean. That is not a verification — a modified
// client, a mock-location app, or a plain `curl` could claim to be anywhere.
// Everything here runs server-side so the decision is ours, not the caller's.

// Mean Earth radius in metres (WGS-84 mean radius). The haversine formula
// assumes a sphere; over the sub-kilometre distances a geofence deals with the
// error against a true ellipsoid is centimetres, which is far below GPS noise.
const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two WGS-84 points, in metres.
 *
 * Uses haversine rather than the simpler equirectangular approximation because
 * the latter's error grows with latitude, and this system runs in the UAE
 * (~25°N) where that error is already a few percent — enough to matter against
 * a 50m radius.
 */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;

  // atan2 (rather than asin) keeps this numerically stable for antipodal points.
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A finite number inside [min, max]. Rejects NaN, Infinity, null and strings. */
export function isFiniteInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value >= min && value <= max
    : false;
}

export const isValidLatitude = (v: unknown) => isFiniteInRange(v, -90, 90);
export const isValidLongitude = (v: unknown) => isFiniteInRange(v, -180, 180);

/**
 * Rejects a coordinate pair at exactly (0, 0) — "Null Island", in the Gulf of
 * Guinea. A real GPS fix effectively never lands there, but it is what an
 * uninitialised `double`, a stripped payload, or a lazily forged request
 * produces, so treating it as invalid is worth the negligible false-negative
 * risk.
 */
export const isNullIsland = (lat: number, lng: number) =>
  lat === 0 && lng === 0;

/**
 * Implied ground speed between two timestamped fixes, in km/h.
 *
 * Used to catch the "location suddenly jumps" failure mode: a mock-location app
 * teleports the device, which shows up here as an impossible velocity. Returns
 * null when the two fixes are too close together in time to divide by safely.
 */
export function impliedSpeedKmh(
  from: { lat: number; lng: number; atMs: number },
  to: { lat: number; lng: number; atMs: number },
): number | null {
  const seconds = (to.atMs - from.atMs) / 1000;
  // Non-positive or sub-second gaps make the division meaningless (and a
  // clock-skewed phone can report the second fix as earlier than the first).
  if (!Number.isFinite(seconds) || seconds < 1) return null;
  const metres = haversineMetres(from.lat, from.lng, to.lat, to.lng);
  return metres / seconds * 3.6;
}
