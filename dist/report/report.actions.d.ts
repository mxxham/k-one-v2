import { ReportService } from './report.service';
import { ActivityLogger } from '../common/activity-logger';
export declare class ReportActions {
    private readonly report;
    private readonly activity;
    constructor(report: ReportService, activity: ActivityLogger);
    private actCtx;
    private dashboardStats;
    private aisleDetail;
    private checkExpiryAlerts;
    private daily;
    private products;
    private inbound;
    private outbound;
    private stock;
    private ledger;
    private activityList;
    private activityModules;
    private resetOperationalData;
}
