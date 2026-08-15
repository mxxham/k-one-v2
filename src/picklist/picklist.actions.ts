import { Injectable } from '@nestjs/common';
import { PicklistService } from './picklist.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class PicklistActions {
  constructor(
    private readonly picklist: PicklistService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('picklist', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      stats: (c) => this.stats(c),
      create_from_outbound: (c) => this.createFromOutbound(c),
      confirm: (c) => this.confirm(c),
      complete: (c) => this.complete(c),
      delete: (c) => this.delete(c),
      update_item: (c) => this.updateItem(c),
      export_data: (c) => this.exportData(c),
    });
    setPermission('picklist', 'create_from_outbound', 'write');
    setPermission('picklist', 'confirm', 'write');
    setPermission('picklist', 'complete', 'write');
    setPermission('picklist', 'delete', 'write');
    setPermission('picklist', 'update_item', 'write');
    setModuleDepartments('picklist', ['outbound']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const total = await this.picklist.countAll(status);
    const rows = await this.picklist.getAll(status, perPage, offset);
    for (const r of rows) r.id = Number(r.id);
    return {
      rows,
      total,
      page,
      per_page: perPage,
      statuses: ['Draft', 'Confirmed', 'Picking', 'Picked', 'Completed', 'Cancelled'],
    };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const picklist = await this.picklist.getById(id);
    if (!picklist) throw ApiException.notFound('Picklist tidak ditemukan');
    const items = await this.picklist.getItems(id);
    for (const it of items) it.id = Number(it.id);
    return { picklist, items };
  }

  private async stats(_ctx: RequestContext): Promise<Q> {
    return { stats: await this.picklist.getStats() };
  }

  private async createFromOutbound(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const outboundId = Number.parseInt(data.outbound_id ?? ctx.query.outbound_id ?? '0', 10) || 0;
    if (!outboundId) throw ApiException.badRequest('outbound_id wajib diisi.');
    const id = await this.picklist.createFromOutbound(outboundId, ctx.user.id);
    await this.activity.log(
      'CREATE_PICKLIST', 'picklist', 'Picklist', id, null,
      'Buat picklist dari outbound ID ' + outboundId, null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async confirm(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.picklist.confirm(id);
    await this.activity.log('CONFIRM_PICKLIST', 'picklist', 'Picklist', id, null, 'Konfirmasi picklist ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async complete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.picklist.complete(id);
    await this.activity.log('COMPLETE_PICKLIST', 'picklist', 'Picklist', id, null, 'Selesaikan picklist ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async delete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.picklist.delete(id);
    await this.activity.log('DELETE_PICKLIST', 'picklist', 'Picklist', id, null, 'Hapus picklist ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async updateItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    await this.picklist.updateItem(itemId, data);
    return { item_id: itemId };
  }

  private async exportData(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    return { data: await this.picklist.exportForPrint(id) };
  }
}