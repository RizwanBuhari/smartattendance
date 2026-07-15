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
  await app.listen(3000, '0.0.0.0');
}
bootstrap().catch((err) => {
  console.error('Failed to start the backend:', err);
  process.exit(1);
});
