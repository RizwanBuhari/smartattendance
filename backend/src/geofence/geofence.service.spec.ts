// Tests for the server-side geofence decision.
//
// The regression these lock down: check() used to return `{ inside: true,
// distance: 0 }` for anyone, anywhere, unless the phone volunteered
// `isInsideGeofence: false`. The decision belonged to the client. Every test
// below is a statement that it now belongs to us.
//
// GeofenceService only touches Firestore in getEmployee(), which these tests
// don't exercise — but `db = getFirestore()` runs as a field initialiser, so the
// module still has to be stubbed for the constructor to work at all. Reuses the
// in-memory fake already in the repo rather than adding a second one.
import { firestoreMock } from '../offsite-checkin/__fakes__/fake-firestore';

jest.mock('firebase-admin/firestore', () => firestoreMock);

import { GeofenceService } from './geofence.service';
import type { StoredLocation } from '../locations/locations.service';

// Dubai Silicon Oasis, roughly the office in the project brief.
const OFFICE: StoredLocation = {
  id: 'office-1',
  name: 'Dubai Office',
  latitude: 25.1193,
  longitude: 55.3773,
  radiusMeters: 100,
};

// ~1.5km from OFFICE.
const SITE: StoredLocation = {
  id: 'site-1',
  name: 'Customer Site',
  latitude: 25.1273,
  longitude: 55.3893,
  radiusMeters: 150,
};

function makeService(locations: StoredLocation[] = [OFFICE, SITE]) {
  const locationsService = {
    findAll: jest.fn().mockResolvedValue(locations),
  };
  // getFirestore() is called in the field initialiser, so it must not blow up.
  // Casting keeps the stub minimal rather than mocking firebase-admin wholesale.
  const service = new GeofenceService(locationsService as never);
  return { service, locationsService };
}

// A point a known distance north of a location, for boundary tests.
// 1 degree of latitude ≈ 111195m, so metres/111195 degrees.
function metresNorthOf(location: StoredLocation, metres: number) {
  return {
    lat: location.latitude + metres / 111195,
    lng: location.longitude,
  };
}

describe('GeofenceService.check — the server decides', () => {
  it('accepts a position at the centre of an approved location', async () => {
    const { service } = makeService();
    const result = await service.check(
      OFFICE.latitude,
      OFFICE.longitude,
      ['office-1'],
    );
    expect(result.inside).toBe(true);
    expect(result.id).toBe('office-1');
    expect(result.distance).toBe(0);
    expect(result.reason).toBe('inside');
  });

  it('REJECTS a far-away position even when the client insists it is inside', async () => {
    // The core regression. Previously this returned inside:true, distance:0.
    const { service } = makeService();
    const result = await service.check(
      24.4539, // Abu Dhabi, ~130km away
      54.3773,
      ['office-1'],
      true, // client claims to be on-site
    );
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('outside_radius');
    expect(result.distance).toBeGreaterThan(100_000);
    expect(result.clientDisagreed).toBe(true);
    expect(result.clientClaimedInside).toBe(true);
  });

  it('rejects the forged-payload shape: (0,0) with a true claim', async () => {
    // What `curl -d '{"isInsideGeofence":true,"latitude":0,"longitude":0}'` sends.
    const { service } = makeService();
    const result = await service.check(0, 0, ['office-1'], true);
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('invalid_coordinates');
    expect(result.clientDisagreed).toBe(true);
  });

  it('rejects NaN and out-of-range coordinates', async () => {
    const { service } = makeService();
    for (const [lat, lng] of [
      [NaN, 55.3773],
      [25.1193, NaN],
      [91, 55.3773],
      [25.1193, 181],
    ]) {
      const result = await service.check(lat, lng, ['office-1'], true);
      expect(result.inside).toBe(false);
      expect(result.reason).toBe('invalid_coordinates');
    }
  });

  it('reports a real distance, never a hardcoded zero', async () => {
    const { service } = makeService();
    const point = metresNorthOf(OFFICE, 60); // inside the 100m radius
    const result = await service.check(point.lat, point.lng, ['office-1']);
    expect(result.inside).toBe(true);
    expect(result.distance).toBeGreaterThan(55);
    expect(result.distance).toBeLessThan(65);
  });

  it('records agreement when the client was right', async () => {
    const { service } = makeService();
    const result = await service.check(
      OFFICE.latitude,
      OFFICE.longitude,
      ['office-1'],
      true,
    );
    expect(result.inside).toBe(true);
    expect(result.clientDisagreed).toBe(false);
  });

  it('overrides a client that wrongly claims to be OUTSIDE', async () => {
    // The mirror case. A stale client cache should not be able to manufacture a
    // rejection either — the server's measurement wins in both directions.
    const { service } = makeService();
    const result = await service.check(
      OFFICE.latitude,
      OFFICE.longitude,
      ['office-1'],
      false,
    );
    expect(result.inside).toBe(true);
    expect(result.clientDisagreed).toBe(true);
  });
});

describe('GeofenceService.check — GPS accuracy gate', () => {
  it('refuses to judge a fix worse than the ceiling, even at the centre', async () => {
    const { service } = makeService();
    const result = await service.check(
      OFFICE.latitude,
      OFFICE.longitude,
      ['office-1'],
      true,
      500, // ±500m — a cell-tower estimate, not a GPS fix
    );
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('poor_accuracy');
    expect(result.message).toContain('500');
  });

  it('accepts a good fix', async () => {
    const { service } = makeService();
    const result = await service.check(
      OFFICE.latitude,
      OFFICE.longitude,
      ['office-1'],
      true,
      8,
    );
    expect(result.inside).toBe(true);
    expect(result.reason).toBe('inside');
  });

  it('gives the employee the benefit of the doubt at the boundary', async () => {
    // 110m from a 100m radius, but with a ±20m fix — genuinely ambiguous, so the
    // buffer lets it through rather than producing the "I'm standing right here"
    // complaint.
    const { service } = makeService();
    const point = metresNorthOf(OFFICE, 110);
    const withoutBuffer = await service.check(point.lat, point.lng, ['office-1']);
    const withBuffer = await service.check(
      point.lat,
      point.lng,
      ['office-1'],
      undefined,
      20,
    );
    expect(withoutBuffer.inside).toBe(false);
    expect(withBuffer.inside).toBe(true);
    expect(withBuffer.accuracyBufferApplied).toBe(20);
  });

  it('caps the buffer so a poor fix cannot inflate the geofence', async () => {
    // ±45m is under the 50m ceiling, but only 25m of it counts. 140m from a 100m
    // radius stays outside: 100 + 25 = 125 < 140.
    const { service } = makeService();
    const point = metresNorthOf(OFFICE, 140);
    const result = await service.check(
      point.lat,
      point.lng,
      ['office-1'],
      true,
      45,
    );
    expect(result.inside).toBe(false);
    expect(result.accuracyBufferApplied).toBe(25);
    expect(result.clientDisagreed).toBe(true);
  });

  it('applies no buffer when the device reports no accuracy', async () => {
    const { service } = makeService();
    const point = metresNorthOf(OFFICE, 110);
    const result = await service.check(point.lat, point.lng, ['office-1']);
    expect(result.accuracyBufferApplied).toBe(0);
    expect(result.inside).toBe(false);
  });
});

describe('GeofenceService.check — location resolution', () => {
  it('attributes the record to the NEAREST location, not the first assigned', async () => {
    // The old implementation took candidates[0]. Here the employee is standing at
    // the Customer Site but 'office-1' is listed first.
    const { service } = makeService();
    const result = await service.check(
      SITE.latitude,
      SITE.longitude,
      ['office-1', 'site-1'],
    );
    expect(result.inside).toBe(true);
    expect(result.id).toBe('site-1');
    expect(result.name).toBe('Customer Site');
  });

  it('counts being inside ANY approved location', async () => {
    const { service } = makeService();
    const atOffice = await service.check(OFFICE.latitude, OFFICE.longitude, [
      'office-1',
      'site-1',
    ]);
    const atSite = await service.check(SITE.latitude, SITE.longitude, [
      'office-1',
      'site-1',
    ]);
    expect(atOffice.id).toBe('office-1');
    expect(atSite.id).toBe('site-1');
  });

  it('names the nearest location when outside all of them', async () => {
    // So the rejection message and the stored record point at the place they were
    // closest to, which is the useful one for an investigator.
    const { service } = makeService();
    const point = metresNorthOf(OFFICE, 400);
    const result = await service.check(point.lat, point.lng, [
      'office-1',
      'site-1',
    ]);
    expect(result.inside).toBe(false);
    expect(result.id).toBe('office-1');
    expect(result.radiusMeters).toBe(100);
  });

  it('ignores locations the employee is not assigned to', async () => {
    // Standing at the Customer Site, but only approved for the office.
    const { service } = makeService();
    const result = await service.check(SITE.latitude, SITE.longitude, [
      'office-1',
    ]);
    expect(result.inside).toBe(false);
    expect(result.id).toBe('office-1');
  });

  it('falls back to any approved location when the employee has none assigned', async () => {
    // An employee the admin has created but not yet scoped.
    const { service } = makeService();
    const result = await service.check(SITE.latitude, SITE.longitude, []);
    expect(result.inside).toBe(true);
    expect(result.id).toBe('site-1');
  });

  it('reports no_approved_locations when nothing is configured', async () => {
    const { service } = makeService([]);
    const result = await service.check(25.1193, 55.3773, [], true);
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('no_approved_locations');
    expect(result.clientDisagreed).toBe(true);
  });

  it('skips locations an admin saved with unusable coordinates', async () => {
    // A malformed location must not become a silent "not inside" via NaN.
    const broken = {
      id: 'broken',
      name: 'Broken',
      latitude: NaN,
      longitude: 55.3,
      radiusMeters: 100,
    } as StoredLocation;
    const { service } = makeService([broken]);
    const result = await service.check(25.1193, 55.3773, ['broken']);
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('no_approved_locations');
  });

  it('skips locations with a zero or negative radius', async () => {
    const zero = { ...OFFICE, id: 'zero', radiusMeters: 0 };
    const { service } = makeService([zero]);
    const result = await service.check(OFFICE.latitude, OFFICE.longitude, [
      'zero',
    ]);
    expect(result.inside).toBe(false);
    expect(result.reason).toBe('no_approved_locations');
  });

  it('respects a radius the admin edited', async () => {
    // The dashboard writes radiusMeters; the geofence must honour it immediately.
    const point = metresNorthOf(OFFICE, 200);
    const tight = makeService([{ ...OFFICE, radiusMeters: 100 }]);
    const loose = makeService([{ ...OFFICE, radiusMeters: 300 }]);
    expect((await tight.service.check(point.lat, point.lng, ['office-1'])).inside).toBe(false);
    expect((await loose.service.check(point.lat, point.lng, ['office-1'])).inside).toBe(true);
  });
});
