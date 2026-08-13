import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisLock, withLock } from '@k-one/shared';
import { ConfigService } from '../config/config.service';

/**
 * Fail-open distributed lock wrapper. If Redis is unreachable the operation
 * proceeds without a lock (the parity sync path must never break), but when
 * Redis is up it serializes FEFO/stock-take critical sections across API +
 * worker processes.
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger('RedisLock');
  private readonly redis: Redis;
  private ready = false;

  constructor(config: ConfigService) {
    this.redis = new Redis({ host: config.env.REDIS_HOST, port: config.env.REDIS_PORT, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, retryStrategy: () => null });
    this.redis.on('connect', () => {
      this.ready = true;
    });
    this.redis.on('error', () => {
      this.ready = false;
    });
  }

  async runLocked<T>(name: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
    if (!this.ready) {
      return fn();
    }
    try {
      const lock = new RedisLock(this.redis);
      const release = await lock.acquireBlocking(name, opts.ttlMs, opts.waitMs);
      if (!release) {
        return fn(); // busy but proceed (parity) — DB transaction still guards integrity
      }
      try {
        return await fn();
      } finally {
        await release();
      }
    } catch (e) {
      this.logger.warn(`lock ${name} unavailable (${(e as Error)?.message ?? e}) — proceeding unlocked`);
      return fn();
    }
  }
}

export { withLock };
