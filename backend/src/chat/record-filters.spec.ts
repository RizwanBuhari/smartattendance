// Tests for the dashboard assistant's record handling.
//
// The model is not exercised here on purpose: a test that calls Gemini would be
// slow, cost money, and fail for reasons unrelated to this code. What matters
// and what is testable is the layer underneath — if the date range is off by a
// day, or onlyFlagged lets a clean record through, or a truncated result does
// not announce itself, the assistant states something false with complete
// confidence. Same reasoning, and same shape, as geo.spec.ts.
import {
  filterRecords,
  isFlagged,
  summarise,
  toExplanation,
  toLocationSummary,
  toSummary,
} from './record-filters';

// Shaped like AttendanceService.findAll() actually returns: the raw Firestore
// document spread, plus `id`, plus the computed `flaggedOutside`.
function record(over: Record<string, any> = {}) {
  return {
    id: 'a1',
    employeeName: 'Ahmed Mashaal',
    employeeId: 'emp-1',
    checkInUtc: '2026-08-03T06:00:00.000Z',
    checkOutUtc: '2026-08-03T14:00:00.000Z',
    locationName: 'Dubai Office',
    status: 'checked_out',
    gpsAccuracy: 8,
    deviceId: 'device-1',
    checkoutFlagged: false,
    flaggedOutside: false,
    verification: {
      distanceMeters: 12,
      radiusMeters: 100,
      reason: 'inside',
      clientDisagreed: false,
    },
    ...over,
  };
}

describe('filterRecords — dates', () => {
  it('includes the whole of the "to" day', () => {
    // The bug this guards: comparing yyyy-mm-dd against a full ISO timestamp
    // drops everything after midnight on the last day, and the assistant
    // reports the smaller number with no sign anything went missing.
    const rows = [
      record({ id: 'morning', checkInUtc: '2026-08-03T06:00:00.000Z' }),
      record({ id: 'evening', checkInUtc: '2026-08-03T21:30:00.000Z' }),
    ];

    const out = filterRecords(rows, { from: '2026-08-03', to: '2026-08-03' });

    expect(out.map((r) => r.id)).toEqual(['morning', 'evening']);
  });

  it('excludes records outside the range on both ends', () => {
    const rows = [
      record({ id: 'before', checkInUtc: '2026-08-01T09:00:00.000Z' }),
      record({ id: 'inside', checkInUtc: '2026-08-03T09:00:00.000Z' }),
      record({ id: 'after', checkInUtc: '2026-08-06T09:00:00.000Z' }),
    ];

    const out = filterRecords(rows, { from: '2026-08-02', to: '2026-08-04' });

    expect(out.map((r) => r.id)).toEqual(['inside']);
  });

  it('treats a one-sided range as open-ended', () => {
    const rows = [
      record({ id: 'old', checkInUtc: '2026-07-01T09:00:00.000Z' }),
      record({ id: 'new', checkInUtc: '2026-08-30T09:00:00.000Z' }),
    ];

    expect(filterRecords(rows, { from: '2026-08-01' }).map((r) => r.id)).toEqual(['new']);
    expect(filterRecords(rows, { to: '2026-07-31' }).map((r) => r.id)).toEqual(['old']);
  });

  it('returns everything when no filters are given', () => {
    const rows = [record({ id: 'a' }), record({ id: 'b' })];
    expect(filterRecords(rows, {})).toHaveLength(2);
  });
});

describe('filterRecords — names', () => {
  it('matches partially and case-insensitively', () => {
    const rows = [
      record({ id: 'a', employeeName: 'Ahmed Mashaal', locationName: 'Dubai Office' }),
      record({ id: 'b', employeeName: 'Sara Hany', locationName: 'Jebel Ali Site' }),
    ];

    expect(filterRecords(rows, { employeeName: 'ahmed' }).map((r) => r.id)).toEqual(['a']);
    expect(filterRecords(rows, { locationName: 'JEBEL' }).map((r) => r.id)).toEqual(['b']);
  });

  it('survives records with missing names instead of throwing', () => {
    // Older records predate some fields. A crash here would take out the whole
    // answer, not just one row.
    const rows = [record({ id: 'x', employeeName: undefined, locationName: null })];

    expect(filterRecords(rows, { employeeName: 'ahmed' })).toEqual([]);
    expect(() => filterRecords(rows, { locationName: 'dubai' })).not.toThrow();
  });

  it('combines filters as AND, not OR', () => {
    const rows = [
      record({ id: 'both', employeeName: 'Ahmed', locationName: 'Dubai Office' }),
      record({ id: 'name-only', employeeName: 'Ahmed', locationName: 'Jebel Ali' }),
    ];

    const out = filterRecords(rows, { employeeName: 'ahmed', locationName: 'dubai' });

    expect(out.map((r) => r.id)).toEqual(['both']);
  });
});

describe('isFlagged / onlyFlagged', () => {
  it('catches all three kinds of flag, and nothing clean', () => {
    const rows = [
      record({ id: 'clean' }),
      record({ id: 'ping-flagged', flaggedOutside: true }),
      record({ id: 'checkout-flagged', checkoutFlagged: true }),
      record({
        id: 'disagreed',
        verification: { ...record().verification, clientDisagreed: true },
      }),
    ];

    const out = filterRecords(rows, { onlyFlagged: true });

    expect(out.map((r) => r.id).sort()).toEqual([
      'checkout-flagged',
      'disagreed',
      'ping-flagged',
    ]);
  });

  it('does not flag a record that simply has no verification block', () => {
    expect(isFlagged(record({ verification: undefined }))).toBe(false);
  });
});

describe('summarise', () => {
  it('reports the true total when the result is truncated', () => {
    // Without this the assistant says "3 people checked in" after being handed
    // the first 3 of 40 — confidently, and wrongly.
    const rows = Array.from({ length: 40 }, (_, i) => record({ id: `r${i}` }));

    const out = summarise(rows, 5);

    expect(out.total).toBe(40);
    expect(out.returned).toBe(5);
    expect(out.records).toHaveLength(5);
  });

  it('caps the limit at 50 however large a number the model asks for', () => {
    const rows = Array.from({ length: 200 }, (_, i) => record({ id: `r${i}` }));

    const out = summarise(rows, 9999);

    expect(out.returned).toBe(50);
    expect(out.total).toBe(200);
  });

  it('does not claim to return more than it has', () => {
    const out = summarise([record()], 25);
    expect(out.total).toBe(1);
    expect(out.returned).toBe(1);
  });
});

describe('toSummary', () => {
  it('flattens verification so the model sees the measurement', () => {
    const row = toSummary(record());

    expect(row.distanceMeters).toBe(12);
    expect(row.radiusMeters).toBe(100);
    expect(row.reason).toBe('inside');
    expect(row.clientDisagreed).toBe(false);
  });

  it('nulls the measurement when a record has no verification at all', () => {
    // Records written before server-side confirmation existed. Null is honest;
    // 0 would read as "standing on the exact centre of the site".
    const row = toSummary(record({ verification: undefined }));

    expect(row.distanceMeters).toBeNull();
    expect(row.radiusMeters).toBeNull();
    expect(row.reason).toBeNull();
    expect(row.clientDisagreed).toBe(false);
  });

  it('does not leak fields the model was not given', () => {
    const row = toSummary(record({ internalNote: 'do not surface' }));
    expect(JSON.stringify(row)).not.toContain('internalNote');
  });
});

describe('toExplanation', () => {
  it('returns the stored verdict for a known record', () => {
    const out = toExplanation(record());

    expect(out.found).toBe(true);
    expect(out).toMatchObject({
      gpsAccuracy: 8,
      deviceId: 'device-1',
      verification: { reason: 'inside' },
    });
  });

  it('says so plainly when the record does not exist', () => {
    expect(toExplanation(undefined)).toEqual({ found: false });
  });
});

describe('toLocationSummary', () => {
  it('returns only what is needed to reason about a geofence', () => {
    const out = toLocationSummary({
      id: 'loc-1',
      name: 'Dubai Office',
      latitude: 25.1,
      longitude: 55.3,
      radiusMeters: 100,
      type: 'office',
      secretInternalNote: 'do not surface',
    });

    expect(out).toEqual({
      id: 'loc-1',
      name: 'Dubai Office',
      radiusMeters: 100,
      type: 'office',
    });
  });

  it('defaults a missing type to office rather than emitting undefined', () => {
    expect(toLocationSummary({ id: 'l', name: 'Site', radiusMeters: 250 }).type).toBe(
      'office',
    );
  });
});
