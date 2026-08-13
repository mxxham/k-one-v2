import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';
import { QUEUE } from '@k-one/shared';

/**
 * BullMQ producer + Redis client for the async import path (spec-3 §3.6).
 * The sync parity path (import::auto) remains unchanged; import::auto_async
 * enqueues the job and returns {task_id}, and import::task_status polls it.
 */
@Injectable()
export class ImportQueueProvider implements OnModuleDestroy {
  readonly redis: Redis;
  readonly queue: Queue;
  readonly events: QueueEvents;
  readonly queueName = QUEUE.IMPORT;

  constructor(config: ConfigService) {
    const host = config.env.REDIS_HOST;
    const port = config.env.REDIS_PORT;
    const url = `redis://${host}:${port}`;
    const connection = { host, port };
    this.redis = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(this.queueName, { connection });
    this.events = new QueueEvents(this.queueName, { connection });
  }

  async enqueue(taskId: string, data: Record<string, any>): Promise<void> {
    await this.queue.add(taskId, data, { jobId: taskId, removeOnComplete: 100, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.events.close();
      await this.queue.close();
      await this.redis.quit();
    } catch {
      /* ignore */
    }
  }
}
