import { DbService } from '../database/db.service';
import { InboundService } from '../inbound/inbound.service';
import { OutboundService } from '../outbound/outbound.service';
import { PicklistService } from '../picklist/picklist.service';
import { ReportService } from '../report/report.service';
export declare class PrintService {
    private readonly db;
    private readonly inbound;
    private readonly outbound;
    private readonly picklistService;
    private readonly report;
    constructor(db: DbService, inbound: InboundService, outbound: OutboundService, picklistService: PicklistService, report: ReportService);
    inboundReceipt(id: number): Promise<string>;
    putawaySheet(id: number): Promise<string>;
    outboundDo(id: number): Promise<string>;
    suratJalan(id: number): Promise<string>;
    picklist(id: number): Promise<string>;
    reportPrint(type: string, date: string | null, dateTo: string | null): Promise<string>;
    private stockAllInternal;
    private expiringInternal;
}
