import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisService } from './redis/redis.service';

describe('AppController', () => {
  let appController: AppController;

  // A stand-in for RedisService so the test never opens a real connection.
  const fakeRedis = {
    ping: async () => false,
    stats: () => ({
      connected: false,
      hits: 0,
      misses: 0,
      errors: 0,
      skipped: 0,
      hitRatio: null,
    }),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: RedisService, useValue: fakeRedis }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('cache health', () => {
    it('reports cache status without exposing any secret', async () => {
      const health = await appController.cacheHealth();
      expect(health).toMatchObject({ pingOk: false, connected: false });
      // Guard against a future change leaking the connection string.
      expect(JSON.stringify(health)).not.toMatch(/redis:\/\//i);
    });
  });
});
