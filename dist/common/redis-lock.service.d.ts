import { withLock } from "@k-one/shared";
import { ConfigService } from '../config/config.service';
export declare class RedisLockService {
    private readonly logger;
    private readonly redis;
    private ready;
    constructor(config: ConfigService);
    runLocked<T>(name: string, fn: () => Promise<T>, opts?: {
        ttlMs?: number;
        waitMs?: number;
    }): Promise<T>;
}
export { withLock };
