import { Controller, Get } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Lightweight warm-up ping. The dashboard's login page calls this on load so
  // the server process AND its Firestore gRPC connection are already warm by the
  // time the admin signs in — otherwise the first request pays the cold-start
  // cost (key fetch + connection setup) and sign-in feels slow.
  @Get('health')
  async health() {
    try {
      await getFirestore().collection('admin_Users').limit(1).get();
    } catch {
      // Ignore — this is only a warm-up; the real request will surface errors.
    }
    return { ok: true };
  }
}