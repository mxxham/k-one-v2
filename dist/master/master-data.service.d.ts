import { DbService } from '../database/db.service';
export declare class MasterDataService {
    private readonly db;
    constructor(db: DbService);
    searchProducts(q: string): Promise<any[]>;
    activeUsers(): Promise<any[]>;
    productOptions(): Promise<any[]>;
    customerOptions(): Promise<any[]>;
    locationOptions(): Promise<any[]>;
}
