import { DbService } from '../database/db.service';
import { AuthService } from './auth.service';
import { ActivityLogger } from '../common/activity-logger';
export declare class AuthActions {
    private readonly db;
    private readonly authService;
    private readonly activity;
    constructor(db: DbService, authService: AuthService, activity: ActivityLogger);
    private login;
    private logout;
    private me;
    private ip;
}
