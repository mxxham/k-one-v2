import { DbService } from '../database/db.service';
import { InboundService } from '../inbound/inbound.service';
import { OutboundService } from '../outbound/outbound.service';
import { ReportService } from '../report/report.service';
import { StockTakeService } from '../stocktake/stocktake.service';
import { AsnService } from '../asn/asn.service';
export interface ExportFile {
    buffer: Buffer;
    filename: string;
    contentType: string;
}
declare function nf(v: unknown): string;
declare function fmtDate(d: unknown): string;
declare function fmtDateLong(d: unknown): string;
declare function daysLeft(expDate: unknown): number | '';
export declare class ExcelExportService {
    private readonly db;
    private readonly inbound;
    private readonly outbound;
    private readonly report;
    private readonly stocktake;
    private readonly asn;
    constructor(db: DbService, inbound: InboundService, outbound: OutboundService, report: ReportService, stocktake: StockTakeService, asn: AsnService);
    inboundReport(status: string | null): Promise<ExportFile>;
    outboundReport(status: string | null): Promise<ExportFile>;
    customersReport(): Promise<ExportFile>;
    productsReport(): Promise<ExportFile>;
    ledgerReport(): Promise<ExportFile>;
    reportsExcel(type: string, date: string | null, dateTo: string | null): Promise<ExportFile>;
    expiring365(): Promise<any[]>;
    stockAll(): Promise<any[]>;
    stockReport(): Promise<ExportFile>;
    stocktakeReport(id: number): Promise<ExportFile>;
    asnReport(status: string | null): Promise<ExportFile>;
}
export { nf, fmtDate, fmtDateLong, daysLeft };
