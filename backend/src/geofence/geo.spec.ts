// Unit tests for the pure geospatial helpers.
//
// These matter more than most tests in the project: every check-in decision now
// runs through haversineMetres, so an error here is an error in the one thing the
// system exists to get right. The reference distances below are independently
// verifiable — real coordinates, known separations.
import {
  haversineMetres,
  isValidLatitude,
  isValidLongitude,
  isNullIsland,
  impliedSpeedKmh,
} from './geo';

describe('haversineMetres', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMetres(25.1193, 55.3773, 25.1193, 55.3773)).toBe(0);
  });

  it('matches a known short distance in Dubai (Silicon Oasis area)', () => {
    // Two points ~1.5km apart. Tolerance is 1% — well inside the precision this
    // system needs, where the smallest radius in play is tens of metres.
    const metres = haversineMetres(25.1193, 55.3773, 25.1273, 55.3893);
    expect(metres).toBeGreaterThan(1400);
    expect(metres).toBeLessThan(1600);
  });

  it('measures one degree of latitude as ~111km anywhere', () => {
    // A degree of latitude is constant; this catches a lat/lng argument swap,
    // which is the single most likely bug in a function with four numeric args.
    expect(haversineMetres(0, 0, 1, 0)).toBeCloseTo(111195, -2);
    expect(haversineMetres(50, 30, 51, 30)).toBeCloseTo(111195, -2);
  });

  it('shrinks a degree of longitude as latitude increases', () => {
    // The reason this uses haversine rather than a flat approximation: at 25°N a
    // degree of longitude is ~10% shorter than at the equator.
    const atEquator = haversineMetres(0, 0, 0, 1);
    const atDubai = haversineMetres(25, 0, 25, 1);
    expect(atDubai).toBeLessThan(atEquator);
    expect(atDubai / atEquator).toBeCloseTo(Math.cos((25 * Math.PI) / 180), 3);
  });

  it('is symmetric', () => {
    const a = haversineMetres(25.1, 55.3, 25.2, 55.4);
    const b = haversineMetres(25.2, 55.4, 25.1, 55.3);
    expect(a).toBeCloseTo(b, 9);
  });

  it('handles antipodal points without NaN', () => {
    // The reason atan2 is used instead of asin — asin overflows its domain here.
    const metres = haversineMetres(0, 0, 0, 180);
    expect(Number.isFinite(metres)).toBe(true);
    expect(metres).toBeCloseTo(20015086, -3);
  });

  it('resolves metre-scale differences, not just kilometres', () => {
    // ~0.0001 degrees of latitude is ~11m. A geofence with a 50m radius depends
    // on this resolution being real.
    const metres = haversineMetres(25.1193, 55.3773, 25.1194, 55.3773);
    expect(metres).toBeGreaterThan(10);
    expect(metres).toBeLessThan(12);
  });
});

describe('coordinate validation', () => {
  it('accepts in-range numbers including the extremes', () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
  });

  it('rejects out-of-range numbers', () => {
    expect(isValidLatitude(90.1)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
    expect(isValidLongitude(181)).toBe(false);
  });

  it('rejects non-numbers, NaN and Infinity', () => {
    // The cases an unvalidated JSON body actually produces.
    expect(isValidLatitude('25.1')).toBe(false);
    expect(isValidLatitude(null)).toBe(false);
    expect(isValidLatitude(undefined)).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
    expect(isValidLatitude({})).toBe(false);
    expect(isValidLongitude([])).toBe(false);
  });

  it('identifies Null Island', () => {
    expect(isNullIsland(0, 0)).toBe(true);
    expect(isNullIsland(0.0001, 0)).toBe(false);
    expect(isNullIsland(25.1, 55.3)).toBe(false);
  });
});

describe('impliedSpeedKmh', () => {
  const base = { lat: 25.1193, lng: 55.3773, atMs: 1_700_000_000_000 };

  it('reports a plausible walking speed as plausible', () => {
    // ~11m in 10 seconds ≈ 4 km/h.
    const speed = impliedSpeedKmh(base, {
      lat: 25.1194,
      lng: 55.3773,
      atMs: base.atMs + 10_000,
    });
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(2);
    expect(speed!).toBeLessThan(6);
  });

  it('exposes a teleport as an impossible speed', () => {
    // Dubai to Abu Dhabi (~130km) in 60 seconds — the mock-location signature.
    const speed = impliedSpeedKmh(base, {
      lat: 24.4539,
      lng: 54.3773,
      atMs: base.atMs + 60_000,
    });
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(1000);
  });

  it('returns null when the fixes are too close in time to divide safely', () => {
    expect(
      impliedSpeedKmh(base, { ...base, atMs: base.atMs + 500 }),
    ).toBeNull();
    expect(impliedSpeedKmh(base, { ...base, atMs: base.atMs })).toBeNull();
  });

  it('returns null when the second fix is timestamped before the first', () => {
    // A clock-skewed phone. Must not come back as a negative speed that then
    // silently passes a "< threshold" check.
    expect(
      impliedSpeedKmh(base, { lat: 24.4, lng: 54.3, atMs: base.atMs - 60_000 }),
    ).toBeNull();
  });
});
