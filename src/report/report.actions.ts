import { Injectable } from '@nestjs/common';
import { ReportService } from './report.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class ReportActions {
  constructor(
    private readonly report: ReportService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('dashboard', {
      stats: (c) => this.dashboardStats(c),
      aisle_detail: (c) => this.aisleDetail(c),
      check_expiry_alerts: (c) => this.checkExpiryAlerts(c),
    });
    registerActions('report', {
      daily: (c) => this.daily(c),
      products: (c) => this.products(c),
      inbound: (c) => this.inbound(c),
      outbound: (c) => this.outbound(c),
      stock: (c) => this.stock(c),
      ledger: (c) => this.ledger(c),
    });
    registerActions('activitylog', {
      list: (c) => this.activityList(c),
      modules: (c) => this.activityModules(c),
    });
    registerActions('system', {
      reset_operational_data: (c) => this.resetOperationalData(c),
    });
    setPermission('system', 'reset_operational_data', 'admin');
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  // ---------------------------------------------------------------------------
  // dashboard
  // ---------------------------------------------------------------------------
  private async dashboardStats(_ctx: RequestContext): Promise<Q> {
    return this.report.dashboardStats();
  }

  private async aisleDetail(ctx: RequestContext): Promise<Q> {
    const aisle = String(ctx.query.aisle ?? '').trim();
    if (!aisle) throw ApiException.badRequest('aisle required');
    return this.report.aisleDetail(aisle);
  }

  private async checkExpiryAlerts(_ctx: RequestContext): Promise<Q> {
    return this.report.checkExpiryAlerts();
  }

  // ---------------------------------------------------------------------------
  // report
  // ---------------------------------------------------------------------------
  private async daily(ctx: RequestContext): Promise<Q> {
    const date = ctx.query.date ? String(ctx.query.date) : null;
    const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
    return { report: await this.report.dailyReport(date, dateTo) };
  }

  private async products(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.report.reportProducts() };
  }

  private async inbound(ctx: RequestContext): Promise<Q> {
    const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
    const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    return { rows: await this.report.reportInbound(status, start, end) };
  }

  private async outbound(ctx: RequestContext): Promise<Q> {
    const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
    const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    return { rows: await this.report.reportOutbound(status, start, end) };
  }

  private async stock(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.report.reportStock() };
  }

  private async ledger(ctx: RequestContext): Promise<Q> {
    const start = ctx.query.start_date ? String(ctx.query.start_date) : null;
    const end = ctx.query.end_date ? String(ctx.query.end_date) : null;
    return { rows: await this.report.reportLedger(start, end) };
  }

  // ---------------------------------------------------------------------------
  // activitylog
  // ---------------------------------------------------------------------------
  private async activityList(ctx: RequestContext): Promise<Q> {
    const module = ctx.query.module ? String(ctx.query.module) : null;
    const limit = Number.parseInt(ctx.query.limit ?? '200', 10) || 200;
    return { rows: await this.report.activityLogList(module, limit) };
  }

  private async activityModules(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.report.activityModules() };
  }

  // ---------------------------------------------------------------------------
  // system
  // ---------------------------------------------------------------------------
  private async resetOperationalData(ctx: RequestContext): Promise<Q> {
    await this.report.resetOperationalData();
    await this.activity.log(
      'RESET_OPERATIONAL_DATA', 'system', 'System', 0, null,
      'Reset semua data operasional', null, null, this.actCtx(ctx),
    );
    return { message: 'Reset berhasil. Semua data transaksi/log telah dibersihkan. Master data tetap aman.' };
  }
}
