// Pure helpers for the dashboard assistant's tools. No Nest, no Firestore, no
// I/O — so they can be unit tested directly, the same reasoning as geo.ts.
//
// Why this file exists separately from chat.service.ts: everything here decides
// WHICH records the model is shown and WHAT it is told about them. If the date
// range is off by a day, or a truncated result doesn't announce itself, the
// assistant states something false with complete confidence. That is worth
// testing on its own, away from the model and the framework.

/** An attendance record as AttendanceService.findAll() returns it. */
export type AttendanceRow = Record<string, any>;

export interface FindAttendanceFilters {
  from?: string;
  to?: string;
  employeeName?: string;
  locationName?: string;
  onlyFlagged?: boolean;
}

/** Case-insensitive "contains", safe against null/undefined fields. */
function includesFold(haystack: unknown, needle: string): boolean {
  return String(haystack ?? '')
    .toLowerCase()
    .includes(needle.toLowerCase());
}

/**
 * True when a record carries any of the three signals an admin cares about.
 *
 * Three distinct things, deliberately OR'd: a background ping caught them
 * outside during the session, the check-out itself was out of radius, or the
 * device's claim contradicted the server's measurement.
 */
export function isFlagged(row: AttendanceRow): boolean {
  return (
    row?.flaggedOutside === true ||
    row?.checkoutFlagged === true ||
    row?.verification?.clientDisagreed === true
  );
}

/**
 * Applies the tool's filters to a list of records.
 *
 * `to` is inclusive of the whole end day. Comparing a yyyy-mm-dd string
 * directly against a full ISO timestamp would silently drop everything after
 * midnight on the last day — and the assistant would report the smaller number
 * without any sign that records were missing.
 */
export function filterRecords(
  rows: AttendanceRow[],
  { from, to, employeeName, locationName, onlyFlagged }: FindAttendanceFilters,
): AttendanceRow[] {
  let out = rows ?? [];

  if (from) out = out.filter((r) => String(r?.checkInUtc ?? '') >= from);
  if (to) out = out.filter((r) => String(r?.checkInUtc ?? '') <= `${to}T23:59:59Z`);
  if (employeeName) {
    out = out.filter((r) => includesFold(r?.employeeName, employeeName));
  }
  if (locationName) {
    out = out.filter((r) => includesFold(r?.locationName, locationName));
  }
  if (onlyFlagged) out = out.filter(isFlagged);

  return out;
}

/**
 * Trims a record to the fields that can change an answer.
 *
 * A full record is large and mostly irrelevant to the question. Sending a
 * couple of hundred of them would blow the context window and pay for tokens
 * that change nothing.
 *
 * Missing measurements come back as null rather than 0 on purpose: a record
 * written before server-side confirmation existed has no distance, and zero
 * would read as "standing on the exact centre of the site".
 */
export function toSummary(row: AttendanceRow) {
  return {
    id: row?.id ?? null,
    employeeName: row?.employeeName ?? null,
    checkInUtc: row?.checkInUtc ?? null,
    checkOutUtc: row?.checkOutUtc ?? null,
    locationName: row?.locationName ?? null,
    status: row?.status ?? null,
    distanceMeters: row?.verification?.distanceMeters ?? null,
    radiusMeters: row?.verification?.radiusMeters ?? null,
    reason: row?.verification?.reason ?? null,
    clientDisagreed: row?.verification?.clientDisagreed ?? false,
    checkoutFlagged: row?.checkoutFlagged ?? false,
    flaggedOutside: row?.flaggedOutside ?? false,
  };
}

/**
 * Builds the tool's response, including the untruncated total.
 *
 * Reporting `total` alongside `returned` is what stops the assistant saying
 * "3 people checked in" after being handed the first 3 of 40.
 */
export function summarise(rows: AttendanceRow[], limit: number) {
  const capped = Math.max(1, Math.min(limit || 25, 50));
  return {
    total: rows.length,
    returned: Math.min(rows.length, capped),
    records: rows.slice(0, capped).map(toSummary),
  };
}

/** The stored verdict for one record — read, never recomputed. */
export function toExplanation(row: AttendanceRow | undefined) {
  if (!row) return { found: false as const };

  return {
    found: true as const,
    employeeName: row.employeeName ?? null,
    locationName: row.locationName ?? null,
    checkInUtc: row.checkInUtc ?? null,
    checkOutUtc: row.checkOutUtc ?? null,
    gpsAccuracy: row.gpsAccuracy ?? null,
    deviceId: row.deviceId ?? null,
    verification: row.verification ?? null,
    checkoutFlagged: row.checkoutFlagged ?? false,
    checkoutDistanceMeters: row.checkoutDistanceMeters ?? null,
    flaggedOutside: row.flaggedOutside ?? false,
  };
}

/** Trims a location to what the model needs to reason about a geofence. */
export function toLocationSummary(l: AttendanceRow) {
  return {
    id: l?.id ?? null,
    name: l?.name ?? null,
    radiusMeters: l?.radiusMeters ?? null,
    type: l?.type ?? 'office',
  };
}
