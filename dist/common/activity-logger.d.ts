import { DbService } from '../database/db.service';
export interface ActivityContext {
    user_id?: number | null;
    username?: string | null;
    full_name?: string | null;
    ip_address?: string | null;
}
export declare class ActivityLogger {
    private readonly db;
    private readonly logger;
    constructor(db: DbService);
    log(action: string, module: string, refType?: string | null, refId?: number | null, refNo?: string | null, description?: string | null, oldValue?: unknown, newValue?: unknown, ctx?: ActivityContext): Promise<void>;
    getRecent(opts: {
        limit?: number;
        offset?: number;
        module?: string;
        userId?: number;
        refType?: string;
        refId?: number;
    }): Promise<any[]>;
    countRecent(opts: {
        module?: string;
        userId?: number;
        refType?: string;
        refId?: number;
    }): Promise<number>;
    getModules(): string[];
}
