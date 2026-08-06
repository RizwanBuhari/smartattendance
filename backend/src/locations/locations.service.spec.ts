// Proves the "Save" path the dashboard's LocationsPage detail view drives:
// PATCH /locations/:id -> LocationsService.update() -> sanitized, persisted,
// and readable back exactly as GeofenceService (and the mobile app's direct
// Firestore read) would see it.
import { db, firestoreMock } from '../offsite-checkin/__fakes__/fake-firestore';

jest.mock('firebase-admin/firestore', () => firestoreMock);

import { FakeRedis } from '../offsite-checkin/__fakes__/fake-redis';
import { LocationsService } from './locations.service';

function makeService() {
  return new LocationsService(new FakeRedis() as any);
}

describe('LocationsService — attendanceWindows persistence', () => {
  beforeEach(() => {
    db.reset();
  });

  it('create() persists a valid per-role windows map exactly as given', async () => {
    const svc = makeService();
    const saved = await svc.create({
      name: 'Dubai Office',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        office_employee: {
          checkIn: { from: '08:00', to: '10:00' },
          checkOut: { from: '16:00', to: '19:00' },
        },
      },
    });

    expect(saved.attendanceWindows).toEqual({
      office_employee: {
        checkIn: { from: '08:00', to: '10:00' },
        checkOut: { from: '16:00', to: '19:00' },
      },
    });

    const stored = db.read('locations_ids', saved.id);
    expect(stored.attendanceWindows).toEqual(saved.attendanceWindows);
  });

  it('create() drops a malformed time and the pair it belongs to', async () => {
    const svc = makeService();
    const saved = await svc.create({
      name: 'Bad Times Site',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        site_employee: {
          checkIn: { from: '25:00', to: '10:00' }, // "25:00" is invalid
          checkOut: { from: '16:00', to: '19:00' }, // valid, kept
        },
      },
    } as any);

    expect(saved.attendanceWindows).toEqual({
      site_employee: {
        checkOut: { from: '16:00', to: '19:00' },
      },
    });
  });

  it('create() with only checkIn configured for a role does not throw, and never leaves an explicit checkOut: undefined', async () => {
    // The normal case — most locations only restrict one direction — is
    // exactly what broke in production: `{ checkIn, checkOut }` where
    // checkOut was undefined still SET the key, and Firestore's real
    // update()/add() reject undefined anywhere in the payload outright.
    const svc = makeService();
    const saved = await svc.create({
      name: 'Morning Only Site',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        office_employee: {
          checkIn: { from: '08:00', to: '10:00' },
          // checkOut deliberately omitted — the common case.
        },
      },
    } as any);

    expect(saved.attendanceWindows).toEqual({
      office_employee: { checkIn: { from: '08:00', to: '10:00' } },
    });
    // toEqual alone would pass even with a stray `checkOut: undefined` — Jest
    // treats an undefined-valued key as equivalent to an absent one. This is
    // the check that would have actually caught the regression.
    expect(
      Object.prototype.hasOwnProperty.call(
        saved.attendanceWindows!.office_employee,
        'checkOut',
      ),
    ).toBe(false);

    const stored = db.read('locations_ids', saved.id);
    expect(stored.attendanceWindows).toEqual(saved.attendanceWindows);
  });

  it('update() replaces the whole windows map, not a deep merge', async () => {
    const svc = makeService();
    const created = await svc.create({
      name: 'Site A',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        office_employee: { checkIn: { from: '08:00', to: '10:00' } },
        site_employee: { checkIn: { from: '06:00', to: '08:00' } },
      },
    });

    // Admin edits ONLY office_employee's hours and saves — the dashboard
    // always sends the complete map it has in state, not a partial patch.
    const updated = await svc.update(created.id, {
      attendanceWindows: {
        office_employee: { checkIn: { from: '09:00', to: '11:00' } },
        site_employee: { checkIn: { from: '06:00', to: '08:00' } },
      },
    });

    expect(updated.attendanceWindows).toEqual({
      office_employee: { checkIn: { from: '09:00', to: '11:00' } },
      site_employee: { checkIn: { from: '06:00', to: '08:00' } },
    });

    const stored = db.read('locations_ids', created.id);
    expect(stored.attendanceWindows).toEqual(updated.attendanceWindows);
  });

  it('update() with an explicit {} clears every role back to unrestricted', async () => {
    const svc = makeService();
    const created = await svc.create({
      name: 'Site B',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        office_employee: { checkIn: { from: '08:00', to: '10:00' } },
      },
    });

    await svc.update(created.id, { attendanceWindows: {} });

    const stored = db.read('locations_ids', created.id);
    expect(stored.attendanceWindows).toEqual({});
  });

  it('update() leaves attendanceWindows untouched when the field is omitted entirely', async () => {
    const svc = makeService();
    const created = await svc.create({
      name: 'Site C',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        office_employee: { checkIn: { from: '08:00', to: '10:00' } },
      },
    });

    // Saving just the name shouldn't wipe the hours.
    await svc.update(created.id, { name: 'Site C Renamed' });

    const stored = db.read('locations_ids', created.id);
    expect(stored.name).toBe('Site C Renamed');
    expect(stored.attendanceWindows).toEqual({
      office_employee: { checkIn: { from: '08:00', to: '10:00' } },
    });
  });

  it('findAll() returns the persisted windows map for GeofenceService/mobile to read', async () => {
    const svc = makeService();
    await svc.create({
      name: 'Site D',
      latitude: 25.1,
      longitude: 55.2,
      radiusMeters: 100,
      attendanceWindows: {
        site_supervisor: { checkOut: { from: '17:00', to: '20:00' } },
      },
    });

    const all = await svc.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].attendanceWindows).toEqual({
      site_supervisor: { checkOut: { from: '17:00', to: '20:00' } },
    });
  });
});
