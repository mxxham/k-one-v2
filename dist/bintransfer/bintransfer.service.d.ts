import { DbService } from '../database/db.service';
type Q = Record<string, any>;
export declare class BinTransferService {
    private readonly db;
    constructor(db: DbService);
    private generateNumber;
    getAll(status: string | null, limit?: number, offset?: number): Promise<any[]>;
    countAll(status: string | null): Promise<number>;
    getById(id: number): Promise<any>;
    getStockAtLocation(productId: number, location?: string): Promise<any[]>;
    getLocationsWithStock(productId: number): Promise<any[]>;
    create(data: Q, userId: number): Promise<number>;
    execute(transferId: number, userId: number): Promise<void>;
    cancel(transferId: number): Promise<void>;
    private addLedger;
}
export {};
