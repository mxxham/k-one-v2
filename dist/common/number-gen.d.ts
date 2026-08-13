import { DbService } from '../database/db.service';
export interface NumberSpec {
    table: string;
    column: string;
    prefix: string;
    searchPrefix: string;
    pad?: number;
}
export declare function generateNumber(db: DbService, spec: NumberSpec): Promise<string>;
export declare function stockTakeNumber(): string;
export declare function adjustmentReference(): string;
export declare function stockImportReference(seq: number): string;
