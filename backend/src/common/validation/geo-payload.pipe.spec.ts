// Tests for the request-body validation on every GPS endpoint.
//
// Two jobs being verified: malformed payloads are rejected with a useful
// message, and — the security-relevant half — fields the route never declared
// are stripped before they can reach `collection.add(record)`.
import { BadRequestException } from '@nestjs/common';
import { GeoPayloadPipe } from './geo-payload.pipe';

const attendancePipe = new GeoPayloadPipe({
  requireCoordinates: true,
  allow: ['isInsideGeofence', 'isDwellConfirmed'],
});

const validBody = {
  latitude: 25.1193,
  longitude: 55.3773,
  gpsAccuracy: 8.5,
  timestamp: new Date().toISOString(),
  deviceId: 'device-abc',
  isInsideGeofence: true,
};

describe('GeoPayloadPipe — structure', () => {
  it('passes a well-formed attendance body through', () => {
    const result = attendancePipe.transform(validBody);
    expect(result.latitude).toBe(25.1193);
    expect(result.longitude).toBe(55.3773);
    expect(result.gpsAccuracy).toBe(8.5);
    expect(result.isInsideGeofence).toBe(true);
  });

  it('rejects a non-object body', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      expect(() => attendancePipe.transform(bad)).toThrow(BadRequestException);
    }
  });
});

describe('GeoPayloadPipe — coordinates', () => {
  it('rejects a body with no coordinates at all', () => {
    // "Trust the button press" arrives at the API as an empty body.
    expect(() => attendancePipe.transform({ deviceId: 'x' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects one coordinate without the other', () => {
    expect(() => attendancePipe.transform({ latitude: 25.1 })).toThrow(
      BadRequestException,
    );
    expect(() => attendancePipe.transform({ longitude: 55.3 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects out-of-range coordinates', () => {
    expect(() =>
      attendancePipe.transform({ ...validBody, latitude: 91 }),
    ).toThrow(BadRequestException);
    expect(() =>
      attendancePipe.transform({ ...validBody, longitude: -181 }),
    ).toThrow(BadRequestException);
  });

  it('rejects coordinates sent as strings rather than coercing them', () => {
    // Silently parsing would hide a real client bug.
    expect(() =>
      attendancePipe.transform({ ...validBody, latitude: '25.1193' }),
    ).toThrow(BadRequestException);
  });

  it('rejects null, NaN and Infinity coordinates', () => {
    expect(() =>
      attendancePipe.transform({ ...validBody, latitude: null }),
    ).toThrow(BadRequestException);
    expect(() =>
      attendancePipe.transform({ ...validBody, longitude: Infinity }),
    ).toThrow(BadRequestException);
  });

  it('rejects exactly (0, 0)', () => {
    expect(() =>
      attendancePipe.transform({ ...validBody, latitude: 0, longitude: 0 }),
    ).toThrow(BadRequestException);
  });

  it('allows a missing position when the route permits it', () => {
    // Native geofence events: the background isolate's fix can legitimately fail.
    const eventPipe = new GeoPayloadPipe({
      requireCoordinates: false,
      allow: ['eventType', 'locationId'],
    });
    const result = eventPipe.transform({
      eventType: 'EXIT',
      locationId: 'loc-1',
      timestamp: new Date().toISOString(),
    });
    expect(result.eventType).toBe('EXIT');
    expect(result.latitude).toBeUndefined();
  });

  it('still validates a position that IS supplied on an optional route', () => {
    const eventPipe = new GeoPayloadPipe({ requireCoordinates: false });
    expect(() =>
      eventPipe.transform({ latitude: 999, longitude: 55.3 }),
    ).toThrow(BadRequestException);
  });
});

describe('GeoPayloadPipe — accuracy', () => {
  it('accepts a non-negative number and omission', () => {
    expect(
      attendancePipe.transform({ ...validBody, gpsAccuracy: 0 }).gpsAccuracy,
    ).toBe(0);
    const { gpsAccuracy: _omitted, ...withoutAccuracy } = validBody;
    expect(() => attendancePipe.transform(withoutAccuracy)).not.toThrow();
  });

  it('rejects a negative or non-numeric accuracy', () => {
    expect(() =>
      attendancePipe.transform({ ...validBody, gpsAccuracy: -5 }),
    ).toThrow(BadRequestException);
    expect(() =>
      attendancePipe.transform({ ...validBody, gpsAccuracy: 'high' }),
    ).toThrow(BadRequestException);
  });

  it('does NOT reject a merely poor accuracy', () => {
    // A ±400m fix is a valid measurement and a bad one. The geofence turns it
    // into an actionable `poor_accuracy` verdict; the transport layer should not
    // pre-empt that with a 400 the employee can't interpret.
    expect(() =>
      attendancePipe.transform({ ...validBody, gpsAccuracy: 400 }),
    ).not.toThrow();
  });
});

describe('GeoPayloadPipe — timestamp', () => {
  it('accepts a current UTC ISO string', () => {
    const ts = new Date().toISOString();
    expect(attendancePipe.transform({ ...validBody, timestamp: ts }).timestamp)
      .toBe(ts);
  });

  it('rejects an unparseable timestamp', () => {
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: 'yesterday' }),
    ).toThrow(BadRequestException);
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: 1700000000000 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a timestamp far in the future', () => {
    // Otherwise a phone can book a shift that has not happened yet.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: future }),
    ).toThrow(BadRequestException);
  });

  it('rejects a timestamp far in the past', () => {
    const ancient = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: ancient }),
    ).toThrow(BadRequestException);
  });

  it('tolerates ordinary clock drift and a short offline queue', () => {
    // The offline queue in native_geofence_service.dart can hold an event for a
    // while before the network comes back; that must still sync.
    const slightlyAhead = new Date(Date.now() + 60 * 1000).toISOString();
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: slightlyAhead }),
    ).not.toThrow();
    expect(() =>
      attendancePipe.transform({ ...validBody, timestamp: twoDaysAgo }),
    ).not.toThrow();
  });
});

describe('GeoPayloadPipe — tzOffsetMinutes', () => {
  it('accepts real-world offsets', () => {
    for (const tz of [240, 0, -720, 840, 330]) {
      expect(
        attendancePipe.transform({ ...validBody, tzOffsetMinutes: tz })
          .tzOffsetMinutes,
      ).toBe(tz);
    }
  });

  it('rejects impossible offsets and non-integers', () => {
    for (const tz of [1000, -800, 12.5, 'UTC+4']) {
      expect(() =>
        attendancePipe.transform({ ...validBody, tzOffsetMinutes: tz }),
      ).toThrow(BadRequestException);
    }
  });
});

describe('GeoPayloadPipe — whitelist', () => {
  it('strips fields the route never declared', () => {
    // The security case: these previously flowed straight into the Firestore
    // document, so the phone could write server-owned state.
    const result = attendancePipe.transform({
      ...validBody,
      status: 'checked_in',
      checkoutFlagged: false,
      employeeName: 'Someone Else',
      employeeId: 'another-uid',
      verification: { clientDisagreed: false },
    });
    expect(result.status).toBeUndefined();
    expect(result.checkoutFlagged).toBeUndefined();
    expect(result.employeeName).toBeUndefined();
    expect(result.employeeId).toBeUndefined();
    expect(result.verification).toBeUndefined();
    // ...while the legitimate fields survive.
    expect(result.latitude).toBe(25.1193);
    expect(result.deviceId).toBe('device-abc');
  });

  it('keeps only the extras a route opted into', () => {
    const result = attendancePipe.transform({
      ...validBody,
      isDwellConfirmed: true,
      eventType: 'ENTER', // not allowed on attendance routes
    });
    expect(result.isDwellConfirmed).toBe(true);
    expect(result.eventType).toBeUndefined();
  });
});
