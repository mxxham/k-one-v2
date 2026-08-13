import { BinTransferService } from './bintransfer.service';
import { ActivityLogger } from '../common/activity-logger';
export declare class BinTransferActions {
    private readonly binTransfer;
    private readonly activity;
    constructor(binTransfer: BinTransferService, activity: ActivityLogger);
    private actCtx;
    private list;
    private detail;
    private locationsWithStock;
    private stockAtLocation;
    private create;
    private execute;
    private cancel;
}
