import { DbService } from '../database/db.service';
type Q = Record<string, any>;
export declare class ImportService {
    private readonly db;
    constructor(db: DbService);
    fileFromReq(req: any): {
        buffer: Buffer;
        name: string;
    };
    private stockParse;
    private stockValidate;
    stockPreview(req: any): Promise<Q>;
    stockCommit(body: Q): Promise<Q>;
    private stockCommitTx;
    private addImportLedger;
    runInbound(req: any): Promise<Q>;
    private lookupProduct;
    private inboundNumber;
    private userId;
    runOutbound(req: any): Promise<Q>;
    private outboundProcessSheet;
    private createOutbound;
    private outboundNumber;
    private fefoAllocation;
    private reduceStockForOutboundItem;
    private addOutboundLedger;
    runAuto(req: any): Promise<Q>;
    private autoProcessMaster;
    private autoEnsureProducts;
    private autoCreateInbound;
    private inboundNumberFromQ;
}
export {};
