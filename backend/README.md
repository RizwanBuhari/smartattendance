# Smart Attendance & Geofencing — Backend

NestJS API over Firebase Firestore, serving both the Flutter mobile app and the
React admin dashboard. Redis fronts the hot reads; Firestore is the system of
record.

## API documentation

Start the server and open:

| | |
|---|---|
| **Interactive docs** | http://localhost:3000/api/docs |
| **OpenAPI 3.0 JSON** | http://localhost:3000/api/docs-json |

61 operations across 13 tags, generated from decorators in the controllers so it
cannot drift from the code. Set `SWAGGER_ENABLED=false` to switch it off.

To try a guarded endpoint from the docs page: sign in on the mobile app or
dashboard, copy the Firebase ID token, and paste it into **Authorize** →
`firebase`. Mobile routes also want the `X-Session-Id` the backend minted at
login (**Authorize** → `session`); a superseded id is rejected, which is how
one-account-one-device is enforced.

## Setup

```bash
npm install
```

Two files are required and are **not** in version control:

- `serviceAccountKey.json` — Firebase service-account credentials. This is the
  only trusted connection to Firestore; both clients go through this API.
- `.env` — SMTP credentials, `FIREBASE_API_KEY`, and optional geofence tuning.

## Run

```bash
npm run start:dev     # watch mode
npm run start:prod    # from dist/
npm test              # unit tests
npm run test:cov      # with coverage
```

Listens on `3000` inside the container. Kubernetes publishes NodePort `30300`
and forwards to `targetPort: 3000` — see `k8s/02-backend.yaml`.

## How presence is verified

The core of the project. Check-in is decided **server-side**; the device reports
coordinates but does not get a vote.

1. Reject a payload without usable coordinates (`GeoPayloadPipe`, which also
   strips any field the route did not declare).
2. Reject a GPS fix worse than `MAX_GPS_ACCURACY_METRES` — with a ±500m fix the
   distance is not meaningful, so computing it would only lend false precision.
3. Measure the haversine distance to each of the employee's approved locations
   and take the nearest.
4. Accept only if inside that location's configured radius, plus up to
   `MAX_GPS_ACCURACY_BUFFER_METRES` of the reported accuracy at the boundary.

The device's own `isInsideGeofence` is cross-checked rather than trusted. A
contradiction is persisted as `verification.clientDisagreed` — a phone insisting
it is on-site while its own coordinates say otherwise is the most useful fraud
signal the system produces.

After check-in, native OS geofences on the device report ENTER / DWELL / EXIT /
RETURN to `POST /geofence-events`, which measures the reported position against
the radius the same way. Events that fail to send are queued on the device and
retried, so an offline crossing is not lost.

A ping whose fix was too poor to judge is stored `inconclusive` and is **not**
counted as evidence of absence — otherwise anyone with a weak indoor signal
would be flagged for leaving.

### Geofence configuration

| Variable | Default | Effect |
|---|---|---|
| `MAX_GPS_ACCURACY_METRES` | `50` | Fixes worse than this are refused outright. Raise it for sites hemmed in by tall structures. |
| `MAX_GPS_ACCURACY_BUFFER_METRES` | `25` | Accuracy allowance at the boundary. Capped so a conveniently poor fix cannot inflate the geofence. |

Note that a phone reports ±3-10m outdoors and ±20-40m indoors, so a location
radius below roughly 50m will refuse people who are genuinely on site.

## Layout

```
src/
  attendance/       check-in, check-out, checkout reviews
  geofence/         geo.ts (haversine, validation) + the decision service
  geofence-events/  native ENTER/DWELL/EXIT/RETURN reports
  location-pings/   periodic background samples
  locations/        approved sites and their radii
  employees/        records, roles, location assignments
  auth/             login, registration, guards
  admins/           dashboard administrators
  offsite-checkin/  supervisor-approved off-site attendance via QR
  otp/              site-admin one-time codes
  biometrics/       device enrolment
  push/             FCM token registration
  common/           the GPS payload validation pipe
```

`geofence/geo.ts` holds pure functions with no I/O, so the maths every check-in
depends on is directly unit-testable.

## Authentication

Every route except `/auth/*` and `/health*` needs a Firebase ID token as
`Authorization: Bearer <token>`.

- **EmployeeGuard** — a signed-in employee. The identity comes from the token,
  never the request body, so a device can only ever act as itself.
- **AdminGuard** — a dashboard administrator. Attaches the verified admin email
  so decisions carry an audit trail of who made them.
