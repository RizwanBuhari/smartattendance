// Thin wrapper around the Redis client used for caching.
//
// Design rule: Redis is an OPTIONAL speed-up, never a hard dependency. If Redis
// is unreachable (e.g. you run `npm run start:dev` without docker compose), every
// method below quietly no-ops and the app falls back to querying Firestore
// directly. A cache outage must never take the API down.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  // Flipped by the connection events below; guards every operation.
  private available = false;
  // Ensures we log "cache unavailable" once per outage instead of on every retry.
  private warned = false;

  constructor() {
    // In docker compose this is redis://redis:6379 (see docker-compose.yml).
    // Outside compose it falls back to a local Redis, and if none is running the
    // service simply stays unavailable.
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

    this.client = new Redis(url, {
      // Fail a command fast rather than queueing it while Redis is down.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Keep trying to reconnect, backing off up to 5s, so the cache heals
      // itself once Redis comes back without needing an app restart.
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('ready', () => {
      this.available = true;
      this.warned = false;
      this.logger.log(`Redis cache connected (${url})`);
    });

    this.client.on('end', () => {
      this.available = false;
    });

    this.client.on('error', (err: Error) => {
      this.available = false;
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `Redis unavailable (${err.message}) — continuing without cache.`,
        );
      }
    });
  }

  // Reads a cached value. Returns null on a miss OR any failure, which callers
  // treat identically: "not cached, go ask Firestore".
  async get(key: string): Promise<string | null> {
    if (!this.available) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  // Stores a value with a time-to-live in seconds, after which Redis drops it
  // automatically. The TTL is what bounds how stale cached data can ever be.
  //
  // Returns true only if the value was really stored. Callers that merely cache
  // can ignore this; callers that depend on the write (one-time codes, for
  // example) must check it, because a silent no-op would hand out a code that
  // can never be verified.
  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.available) return false;
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return true;
    } catch {
      // Ignore — failing to cache is not an error worth failing the request for.
      return false;
    }
  }

  // Atomically increments a counter and returns its NEW value, setting the TTL
  // on first use so the counter expires with whatever it is counting.
  //
  // Returning the incremented value (rather than reading the counter first and
  // adding one) is what makes this safe under concurrency: two simultaneous
  // requests get 1 and 2, never 1 and 1.
  //
  // Returns null when Redis is unavailable so callers can decide how to react —
  // for security counters the safe reaction is to reject, not to continue.
  async incr(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.available) return null;
    try {
      const value = await this.client.incr(key);
      // Only the first increment needs an expiry; re-setting it each time would
      // let an attacker keep the window open indefinitely.
      if (value === 1) await this.client.expire(key, ttlSeconds);
      return value;
    } catch {
      return null;
    }
  }

  // Seconds remaining before a key expires (-2 = no such key, -1 = no expiry).
  // Used to tell a locked-out user how long they must wait.
  async ttl(key: string): Promise<number> {
    if (!this.available) return -2;
    try {
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }

  // Invalidates keys. Call this whenever the underlying Firestore data changes,
  // otherwise callers keep seeing the old cached answer until the TTL expires.
  async del(...keys: string[]): Promise<void> {
    if (!this.available || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      // Ignore — see above.
    }
  }

  async onModuleDestroy() {
    // Close the connection cleanly so the process can exit.
    this.client.disconnect();
  }
}
