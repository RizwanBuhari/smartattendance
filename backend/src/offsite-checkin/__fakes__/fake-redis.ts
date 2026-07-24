// @ts-nocheck
// In-memory RedisService replacement with real TTL / atomic-incr semantics,
// so OtpService's one-time-code and lockout logic behaves as it would against
// a live Redis. `available` is always true here.
export class FakeRedis {
  constructor() {
    this.store = new Map(); // key -> { val, exp(ms|null) }
  }
  _live(key) {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp != null && e.exp <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key) {
    const e = this._live(key);
    return e ? e.val : null;
  }
  async set(key, value, ttlSeconds) {
    this.store.set(key, { val: value, exp: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async del(...keys) {
    keys.forEach((k) => this.store.delete(k));
  }
  async incr(key, ttlSeconds) {
    const e = this._live(key);
    const next = e ? parseInt(e.val, 10) + 1 : 1;
    // Only the first increment sets the expiry (mirrors RedisService.incr).
    const exp = e ? e.exp : Date.now() + ttlSeconds * 1000;
    this.store.set(key, { val: String(next), exp });
    return next;
  }
  async ttl(key) {
    const e = this._live(key);
    if (!e) return -2;
    if (e.exp == null) return -1;
    return Math.max(0, Math.round((e.exp - Date.now()) / 1000));
  }
}
