import { PicklistService } from './picklist.service';
import { ActivityLogger } from '../common/activity-logger';
export declare class PicklistActions {
    private readonly picklist;
    private readonly activity;
    constructor(picklist: PicklistService, activity: ActivityLogger);
    private actCtx;
    private list;
    private detail;
    private stats;
    private createFromOutbound;
    private confirm;
    private complete;
    private delete;
    private updateItem;
    private exportData;
}
