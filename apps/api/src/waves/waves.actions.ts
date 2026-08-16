import { Injectable } from '@nestjs/common';
import { WavesService } from './waves.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class WavesActions {
  constructor(
    private readonly waves: WavesService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('waves', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      create: (c) => this.create(c),
      cancel: (c) => this.cancel(c),
      candidate_orders: (c) => this.candidateOrders(c),
    });
    setPermission('waves', 'create', 'write');
    setPermission('waves', 'cancel', 'write');
    setModuleDepartments('waves', ['outbound']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const total = await this.waves.countAll(status);
    const rows = await this.waves.getAll(status, perPage, offset);
    for (const r of rows) {
      r.id = Number(r.id);
      r.order_count = Number(r.order_count ?? 0);
      r.item_count = Number(r.item_count ?? 0);
    }
    return {
      rows,
      total,
      page,
      per_page: perPage,
      statuses: ['Planning', 'Active', 'Completed', 'Cancelled'],
    };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const wave = await this.waves.getById(id);
    if (!wave) throw ApiException.notFound('Wave tidak ditemukan');
    for (const o of wave.orders) {
      o.id = Number(o.id);
      o.total_items = Number(o.total_items ?? 0);
    }
    return { wave };
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const orderIds = Array.isArray(data?.order_ids) ? data.order_ids : [];
    if (orderIds.length === 0) throw ApiException.badRequest('order_ids wajib diisi.');
    const res = await this.waves.create(data, ctx.user.id);
    await this.activity.log(
      'CREATE_WAVE', 'waves', 'Wave', res.wave_id, null,
      `Buat wave ${orderIds.length} order → picklist ID ${res.picklist_id}` +
        (res.skipped.length ? ` (dilewati: ${res.skipped.join(', ')})` : ''),
      null, null, this.actCtx(ctx),
    );
    return res;
  }

  private async cancel(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const wave = await this.waves.getById(id);
    if (!wave) throw ApiException.notFound('Wave tidak ditemukan');
    if (wave.status === 'Completed') throw ApiException.badRequest('Wave yang sudah Completed tidak dapat dibatalkan.');
    await this.waves.cancel(id);
    await this.activity.log('CANCEL_WAVE', 'waves', 'Wave', id, null, 'Batalkan wave ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async candidateOrders(_ctx: RequestContext): Promise<Q> {
    return { orders: await this.waves.candidateOrders() };
  }
}