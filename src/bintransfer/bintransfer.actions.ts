import { Injectable } from '@nestjs/common';
import { BinTransferService } from './bintransfer.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class BinTransferActions {
  constructor(
    private readonly binTransfer: BinTransferService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('bintransfer', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      locations_with_stock: (c) => this.locationsWithStock(c),
      stock_at_location: (c) => this.stockAtLocation(c),
      create: (c) => this.create(c),
      execute: (c) => this.execute(c),
      cancel: (c) => this.cancel(c),
    });
    setPermission('bintransfer', 'create', 'write');
    setPermission('bintransfer', 'execute', 'write');
    setPermission('bintransfer', 'cancel', 'write');
    setModuleDepartments('bintransfer', ['inventory']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '200', 10) || 200);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const total = await this.binTransfer.countAll(status);
    const rows = await this.binTransfer.getAll(status, perPage, offset);
    for (const r of rows) r.id = Number(r.id);
    return { rows, total, page, per_page: perPage, statuses: ['Pending', 'Completed', 'Cancelled'] };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const transfer = await this.binTransfer.getById(id);
    if (!transfer) throw ApiException.notFound('Transfer tidak ditemukan');
    return { transfer };
  }

  private async locationsWithStock(ctx: RequestContext): Promise<Q> {
    const pid = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    return { rows: await this.binTransfer.getLocationsWithStock(pid) };
  }

  private async stockAtLocation(ctx: RequestContext): Promise<Q> {
    const pid = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const loc = ctx.query.location ? String(ctx.query.location) : '';
    return { rows: await this.binTransfer.getStockAtLocation(pid, loc) };
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = await this.binTransfer.create(data, ctx.user.id);
    await this.activity.log(
      'CREATE_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null,
      `Buat transfer ${data.from_location ?? ''} → ${data.to_location ?? ''} qty ${data.quantity ?? 0}`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async execute(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.binTransfer.execute(id, ctx.user.id);
    await this.activity.log('EXECUTE_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null, 'Eksekusi transfer ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async cancel(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.binTransfer.cancel(id);
    await this.activity.log('CANCEL_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null, 'Batalkan transfer ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }
}
