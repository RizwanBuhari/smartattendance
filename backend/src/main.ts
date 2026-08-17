// Load environment variables from backend/.env before anything else (SMTP
// credentials, app-download link, etc.).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { initializeApp, cert } from 'firebase-admin/app';

// Connect the backend to Firestore using the service-account key.
// This is the trusted (admin) connection — the ONLY thing that touches the
// database. Both the dashboard and the mobile app go through this backend.
initializeApp({
  credential: cert('./serviceAccountKey.json'),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the dashboard (browser) and mobile app to call this API from a
  // different origin. Without this, the browser blocks the requests.
  //
  // By default CORS is open (the previous behaviour) because the API is
  // protected by Firebase bearer tokens, not cookies, so a permissive origin
  // does not by itself grant access. To lock it down in production, set
  // ALLOWED_ORIGINS to a comma-separated allow-list (e.g. the dashboard URL);
  // when set, only those origins are accepted.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors(
    allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined,
  );

  // --- API documentation ---------------------------------------------------
  // Served at /api/docs (interactive) and /api/docs-json (raw OpenAPI 3.0).
  //
  // Generated from the code rather than written alongside it, because a
  // hand-maintained document describing ~70 endpoints is a document that goes
  // stale on the first refactor. The decorators are the source of truth.
  //
  // Set SWAGGER_ENABLED=false to switch it off in a deployment where the API
  // surface should not be public. It stays on by default: the endpoints are all
  // guarded by Firebase bearer tokens, so describing them is not itself a
  // disclosure, and an undiscoverable API is a support burden.
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Smart Attendance & Geofencing API')
      .setDescription(
        [
          'Backend for the Smart Attendance & Geofencing platform: a Flutter',
          'mobile app and a React admin dashboard sharing this NestJS API over',
          'Firebase Firestore.',
          '',
          '### Authentication',
          'Every route except `/auth/*` and `/health*` requires a Firebase ID',
          'token as `Authorization: Bearer <token>`. Two guards apply:',
          '',
          '- **EmployeeGuard** — a signed-in employee. The employee identity is',
          '  taken from the token, never from the request body, so a device can',
          '  only ever act as itself.',
          '- **AdminGuard** — a dashboard administrator. Attaches the verified',
          '  admin email to the request for audit trails.',
          '',
          'Mobile clients additionally send `X-Session-Id`, the session the',
          'backend minted at login. A request carrying a superseded id is',
          'rejected — this is what makes one-account-one-device enforcement real',
          'rather than something the app agrees to do to itself.',
          '',
          '### Geofence verification',
          'Check-in is decided **server-side**. The device reports coordinates',
          'and its own opinion (`isInsideGeofence`), but the server computes the',
          'haversine distance to the employee\'s approved locations and judges it',
          'against the configured radius. A disagreement between the two is',
          'recorded on the attendance record as `verification.clientDisagreed` —',
          'a phone insisting it is on-site while its own coordinates say',
          'otherwise is the most useful fraud signal the system produces.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Firebase ID token from the mobile app or dashboard.',
        },
        'firebase',
      )
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-Session-Id',
          description:
            'Server-minted session id. Mobile clients only; a stale id is rejected.',
        },
        'session',
      )
      .addTag('Auth', 'Sign-in, registration and password reset (unguarded)')
      .addTag('Attendance', 'Check-in, check-out, history and checkout reviews')
      .addTag('Geofence Events', 'Native ENTER/DWELL/EXIT/RETURN reports')
      .addTag('Location Pings', 'Periodic background location samples')
      .addTag('Locations', 'Approved work sites and their geofence radii')
      .addTag('Employees', 'Employee records, roles and location assignments')
      .addTag('Admins', 'Dashboard administrator accounts and sessions')
      .addTag('Company Codes', 'Single-use registration codes')
      .addTag('Offsite Check-in', 'Supervisor-approved off-site attendance via QR')
      .addTag('Biometrics', 'Device biometric enrolment and challenges')
      .addTag('OTP', 'Site-admin one-time check-in codes')
      .addTag('Devices', 'Push notification token registration')
      .addTag('Health', 'Liveness and cache diagnostics')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: {
        // Keeps a pasted bearer token across page reloads while testing.
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'Smart Attendance API',
    });
  }

  // Listen on 3000 INSIDE the container. This is not the port you type in a
  // browser: Kubernetes publishes NodePort 30300 on the host and forwards it to
  // targetPort 3000 here (see k8s/02-backend.yaml). Changing this to 30300
  // would leave nothing on 3000, so the health probes fail and the Service
  // routes to a dead port.
  //
  // 0.0.0.0 (not localhost) so connections from outside the container are
  // accepted at all.
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap().catch((err) => {
  console.error('Failed to start the backend:', err);
  process.exit(1);
});
