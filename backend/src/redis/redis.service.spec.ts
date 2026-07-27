// Requirement #1 — Redis metrics + safe fallback.
//
// Mocks ioredis so no real server is needed. Covers BOTH scenarios the task
// asks for: Redis-unavailable (every op no-ops safely) and Redis-connected
// (hit/miss counters and hitRatio are tracked).
jest.mock('ioredis', () => {
  // The real client fires a 'ready' event on connect; this fake never does, so
  // the service stays in its "unavailable" state — exactly the outage case.
  class FakeIORedis {
    on() {
      return this;
    }
    get() {
      return Promise.resolve(null);
    }
    set() {
      return Promise.resolve('OK');
    }
    ping() {
      return Promise.resolve('PONG');
    }
    disconnect() {}
  }
  return { __esModule: true, default: FakeIORedis };
});

import { RedisService } from './redis.service';

describe('RedisService', () => {
  it('fails safe when Redis is unavailable (never throws, never blocks)', async () => {
    const svc = new RedisService();

    expect(await svc.get('k')).toBeNull();
    expect(await svc.set('k', 'v', 10)).toBe(false);
    expect(await svc.incr('k', 10)).toBeNull();
    expect(await svc.ttl('k')).toBe(-2);
    expect(await svc.ping()).toBe(false);

    const stats = svc.stats();
    expect(stats.connected).toBe(false);
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.hitRatio).toBeNull(); // no real lookups happened

    await svc.onModuleDestroy();
  });

  it('counts hits and misses when connected', async () => {
    const svc = new RedisService();
    // Simulate a live connection with a controllable client.
    (svc as unknown as { available: boolean }).available = true;
    (svc as unknown as { client: unknown }).client = {
      get: jest
        .fn()
        .mockResolvedValueOnce('cached-value') // hit
        .mockResolvedValueOnce(null), // miss
      ping: () => Promise.resolve('PONG'),
      disconnect: () => {},
    };

    expect(await svc.get('present')).toBe('cached-value');
    expect(await svc.get('absent')).toBeNull();
    expect(await svc.ping()).toBe(true);

    const stats = svc.stats();
    expect(stats.connected).toBe(true);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRatio).toBe(0.5);
  });
});
