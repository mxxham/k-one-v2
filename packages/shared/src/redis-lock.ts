/**
 * Redis distributed lock (SET NX PX + Lua release). Used by the worker for
 * FEFO/stock-take critical sections and by the API async import dispatch.
 * Lock keys are namespaced: kone:lock:<name>.
 */
import Redis from 'ioredis';

export class RedisLock {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  static key(name: string): string {
    return `kone:lock:${name}`;
  }

  /**
   * Try to acquire a lock. Returns a release function (idempotent) or null.
   * token: random UUID-ish used to guard the release (only the owner releases).
   */
  async acquire(name: string, ttlMs = 30_000, token: string = Math.random().toString(36).slice(2) + Date.now().toString(36)): Promise<(() => Promise<void>) | null> {
    const key = RedisLock.key(name);
    const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      // Lua: only delete when token matches.
      await this.redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        token,
      );
    };
    return release;
  }

  /** Block until acquired (with timeout). Returns release or null on timeout. */
  async acquireBlocking(name: string, ttlMs = 30_000, waitMs = 5_000): Promise<(() => Promise<void>) | null> {
    const deadline = Date.now() + waitMs;
    let release = await this.acquire(name, ttlMs);
    while (!release && Date.now() < deadline) {
      await sleep(50);
      release = await this.acquire(name, ttlMs);
    }
    return release;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convenience: run fn under a lock, else throw a busy error message. */
export async function withLock<T>(redis: Redis, name: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const lock = new RedisLock(redis);
  const release = await lock.acquireBlocking(name, opts.ttlMs, opts.waitMs);
  if (!release) {
    throw new Error(`Operasi sedang berjalan (lock: ${name}). Coba lagi.`);
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}