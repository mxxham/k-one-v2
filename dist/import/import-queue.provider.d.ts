import { OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';
export declare class ImportQueueProvider implements OnModuleDestroy {
    readonly redis: Redis;
    readonly queue: Queue;
    readonly events: QueueEvents;
    readonly queueName: "kone-import";
    constructor(config: ConfigService);
    enqueue(taskId: string, data: Record<string, any>): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
