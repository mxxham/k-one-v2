import { DbService } from '../database/db.service';
import { OutboundService } from './outbound.service';
import { ActivityLogger } from '../common/activity-logger';
import { MasterDataService } from '../master/master-data.service';
import { RedisLockService } from '../common/redis-lock.service';
export declare class OutboundActions {
    private readonly db;
    private readonly outbound;
    private readonly activity;
    private readonly master;
    private readonly lock;
    constructor(db: DbService, outbound: OutboundService, activity: ActivityLogger, master: MasterDataService, lock: RedisLockService);
    private actCtx;
    private list;
    private detail;
    private stats;
    private searchProducts;
    private checkStock;
    private create;
    private update;
    private delete;
    private addItem;
    private pickItems;
    private ship;
    private complete;
    private deleteItem;
    private updateItemStatus;
}
