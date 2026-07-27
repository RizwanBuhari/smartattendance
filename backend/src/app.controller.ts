import { Controller, Get } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { AppService } from './app.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Cache health + effectiveness. Deliberately returns ONLY counters and a
  // boolean connection flag — never REDIS_URL or any key/value — so it is safe
  // to expose. Use it as the before/after evidence that Redis is actually being
  // hit (rising `hits`, a healthy `hitRatio`) and that it fails safe (a down
  // Redis shows connected:false with rising `skipped`, and the app keeps
  // serving from Firestore).
  @Get('health/cache')
  async cacheHealth() {
    return {
      pingOk: await this.redis.ping(),
      ...this.redis.stats(),
    };
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
