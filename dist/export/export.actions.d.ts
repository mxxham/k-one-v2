import { ExcelExportService } from './excel-export.service';
import { PrintService } from './print.service';
import { PicklistService } from '../picklist/picklist.service';
export interface BinaryResult {
    _binary: true;
    buffer: Buffer;
    filename: string;
    contentType: string;
}
export interface HtmlResult {
    _html: true;
    html: string;
}
export declare class ExportActions {
    private readonly excel;
    private readonly print;
    private readonly picklist;
    constructor(excel: ExcelExportService, print: PrintService, picklist: PicklistService);
    private idFrom;
    private inbound;
    private outbound;
    private customers;
    private products;
    private ledger;
    private stock;
    private stocktake;
    private asn;
    private report;
    private inboundReceipt;
    private putaway;
    private outboundDo;
    private suratJalan;
    private picklistPrint;
    private reportPrint;
}
