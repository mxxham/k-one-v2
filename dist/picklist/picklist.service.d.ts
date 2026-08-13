import { DbService } from '../database/db.service';
export declare class PicklistService {
    private readonly db;
    constructor(db: DbService);
    generateNumber(): Promise<string>;
    createFromOutbound(outboundId: number, createdBy: number): Promise<number>;
    calculatePalletDistribution(quantity: number, uomPerPallet: number): Array<{
        quantity: number;
        is_full: boolean;
    }>;
    getById(id: number): Promise<any>;
    getItems(picklistId: number): Promise<any[]>;
    getAll(status: string | null, limit: number | null, offset: number): Promise<any[]>;
    countAll(status: string | null): Promise<number>;
    getStats(): Promise<any>;
    updateItem(itemId: number, data: Record<string, any>): Promise<boolean>;
    confirm(picklistId: number): Promise<void>;
    complete(picklistId: number): Promise<void>;
    delete(picklistId: number): Promise<void>;
    exportForPrint(picklistId: number): Promise<{
        picklist: any;
        items: any[];
    }>;
}
