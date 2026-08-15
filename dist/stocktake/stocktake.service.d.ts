import { DbService } from '../database/db.service';
type Q = Record<string, any>;
export declare class StockTakeService {
    private readonly db;
    constructor(db: DbService);
    getAll(limit: number): Promise<any[]>;
    getById(id: number): Promise<any>;
    getItems(stockTakeId: number): Promise<any[]>;
    getStats(): Promise<Q>;
    calculateAccuracy(stockTakeId: number): Promise<Q>;
    create(data: Q, userId: number): Promise<number>;
    autoLoadByLocations(stockTakeId: number, locations: string[] | null, velocityClass?: string | null): Promise<void>;
    addItemFull(stockTakeId: number, data: Q): Promise<number>;
    update(id: number, data: Q): Promise<void>;
    delete(id: number): Promise<void>;
    getSystemStock(productId: number, location?: string | null, batchNumber?: string | null): Promise<number>;
    getActiveLockedLocations(): Promise<string[]>;
    getScopeLocations(): Promise<{
        locations: string[];
        locked: string[];
    }>;
    getStock(productId: number, location?: string | null, batch?: string | null): Promise<Q>;
    startCounting(id: number): Promise<void>;
    private saveC1;
    advanceToC2(id: number, c1Values: Record<string, any>): Promise<void>;
    saveCounters(id: number, counters: Record<string, {
        c1?: any;
        c2?: any;
        c3?: any;
    }>): Promise<void>;
    finishCounting(id: number, c2Values: Record<string, any>): Promise<void>;
    private saveC2WithClient;
    saveReview(id: number, physicals: Record<string, number | string>): Promise<void>;
    applyAdjustment(id: number): Promise<void>;
}
export {};
