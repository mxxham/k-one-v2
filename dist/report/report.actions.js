"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportActions = void 0;
const common_1 = require("@nestjs/common");
const report_service_1 = require("./report.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
let ReportActions = class ReportActions {
    report;
    activity;
    constructor(report, activity) {
        this.report = report;
        this.activity = activity;
        (0, registry_1.registerActions)('dashboard', {
            stats: (c) => this.dashboardStats(c),
            aisle_detail: (c) => this.aisleDetail(c),
            check_expiry_alerts: (c) => this.checkExpiryAlerts(c),
            fefo_queue: (c) => this.fefoQueue(c),
            alerts: (c) => this.dashboardAlerts(c),
            insights: (c) => this.dashboardInsights(c),
        });
        (0, registry_1.registerActions)('report', {
            daily: (c) => this.daily(c),
            products: (c) => this.products(c),
            inbound: (c) => this.inbound(c),
            outbound: (c) => this.outbound(c),
            stock: (c) => this.stock(c),
            ledger: (c) => this.ledger(c),
        });
        (0, registry_1.registerActions)('activitylog', {
            list: (c) => this.activityList(c),
            modules: (c) => this.activityModules(c),
        });
        (0, registry_1.registerActions)('system', {
            reset_operational_data: (c) => this.resetOperationalData(c),
        });
        (0, registry_1.setPermission)('system', 'reset_operational_data', 'admin');
        (0, registry_1.setModuleDepartments)('dashboard', ['all']);
        (0, registry_1.setModuleDepartments)('report', ['all']);
        (0, registry_1.setModuleDepartments)('activitylog', ['all']);
        (0, registry_1.setModuleDepartments)('system', ['all']);
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
    async dashboardStats(_ctx) {
        return this.report.dashboardStats();
    }
    async aisleDetail(ctx) {
        const aisle = String(ctx.query.aisle ?? '').trim();
        if (!aisle)
            throw api_exception_1.ApiException.badRequest('aisle required');
        return this.report.aisleDetail(aisle);
    }
    async checkExpiryAlerts(_ctx) {
        return this.report.checkExpiryAlerts();
    }
    async fefoQueue(ctx) {
        const limit = Number.parseInt(ctx.query.limit ?? '50', 10) || 50;
        return this.report.fefoQueue(limit);
    }
    async dashboardAlerts(_ctx) {
        return this.report.dashboardAlerts();
    }
    async dashboardInsights(_ctx) {
        return this.report.dashboardInsights();
    }
    async daily(ctx) {
        const date = ctx.query.date ? String(ctx.query.date) : null;
        const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
        return { report: await this.report.dailyReport(date, dateTo) };
    }
    async products(_ctx) {
        return { rows: await this.report.reportProducts() };
    }
    async inbound(ctx) {
        const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
        const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
        const status = ctx.query.status ? String(ctx.query.status) : null;
        return { rows: await this.report.reportInbound(status, start, end) };
    }
    async outbound(ctx) {
        const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
        const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
        const status = ctx.query.status ? String(ctx.query.status) : null;
        return { rows: await this.report.reportOutbound(status, start, end) };
    }
    async stock(_ctx) {
        return { rows: await this.report.reportStock() };
    }
    async ledger(ctx) {
        const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
        const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
        return { rows: await this.report.reportLedger(start, end) };
    }
    async activityList(ctx) {
        const module = ctx.query.module ? String(ctx.query.module) : null;
        const limit = Number.parseInt(ctx.query.limit ?? '200', 10) || 200;
        return { rows: await this.report.activityLogList(module, limit) };
    }
    async activityModules(_ctx) {
        return { rows: await this.report.activityModules() };
    }
    async resetOperationalData(ctx) {
        await this.report.resetOperationalData();
        await this.activity.log('RESET_OPERATIONAL_DATA', 'system', 'System', 0, null, 'Reset semua data operasional', null, null, this.actCtx(ctx));
        return { message: 'Reset berhasil. Semua data transaksi/log telah dibersihkan. Master data tetap aman.' };
    }
};
exports.ReportActions = ReportActions;
exports.ReportActions = ReportActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [report_service_1.ReportService,
        activity_logger_1.ActivityLogger])
], ReportActions);
//# sourceMappingURL=report.actions.js.map