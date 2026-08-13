import { ImportService } from './import.service';
import { ImportQueueProvider } from './import-queue.provider';
export interface BinaryResult {
    _binary: true;
    buffer: Buffer;
    filename: string;
    contentType: string;
}
export declare class ImportActions {
    private readonly importService;
    private readonly importQueue;
    constructor(importService: ImportService, importQueue: ImportQueueProvider);
    private tplInbound;
    private tplOutbound;
    private tplStock;
    private inbound;
    private outbound;
    private stockPreview;
    private stockCommit;
    private auto;
    private autoAsync;
    private taskStatus;
}
