import { DbService } from '../database/db.service';
import { ActivityLogger } from '../common/activity-logger';
export declare class AuthService {
    private readonly db;
    private readonly activity;
    constructor(db: DbService, activity: ActivityLogger);
    issueToken(userId: number): Promise<string>;
    revokeToken(req: any): Promise<void>;
}
