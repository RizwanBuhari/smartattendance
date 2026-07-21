// Load environment variables from backend/.env before anything else (SMTP
// credentials, app-download link, etc.).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
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
  app.enableCors();

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
