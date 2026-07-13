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
<<<<<<< HEAD
  await app.listen(3000,'0.0.0.0');
=======
  await app.listen(process.env.PORT ?? 3000,'0.0.0.0');
>>>>>>> b8222dc9e23dce847ce60b869cce5671a9dc5cb4
}
bootstrap();
