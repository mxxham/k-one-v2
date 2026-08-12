import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { OutboundService } from './outbound.service';
import { ActivityLogger } from '../common/activity-logger';
import { MasterDataService } from '../master/master-data.service';
import { registerActions, RequestContext, setPermission } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

@Injectable()
export class OutboundActions {
  constructor(
    private readonly db: DbService,
    private readonly outbound: OutboundService,
    private readonly activity: ActivityLogger,
    private readonly master: MasterDataService,
  ) {
    registerActions('outbound', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      stats: (c) => this.stats(c),
      search_products: (c) => this.searchProducts(c),
      check_stock: (c) => this.checkStock(c),
      create: (c) => this.create(c),
      update: (c) => this.update(c),
      delete: (c) => this.delete(c),
      add_item: (c) => this.addItem(c),
      delete_item: (c) => this.deleteItem(c),
      update_item_status: (c) => this.updateItemStatus(c),
      pick_items: (c) => this.pickItems(c),
      ship: (c) => this.ship(c),
      complete: (c) => this.complete(c),
    });
    setPermission('outbound', 'delete', 'write');
    setPermission('outbound', 'pick_items', 'write');
    setPermission('outbound', 'ship', 'write');
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext) {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = String(ctx.query.status ?? '').trim() || null;
    const q = String(ctx.query.q ?? '').trim() || null;
    const total = await this.outbound.countAll(status, q);
    const rows = await this.outbound.getAll(status, perPage, offset, q);
    const statuses = ['Open', 'Picking', 'Picked', 'Shipped', 'Delivered', 'Completed', 'Cancelled'];
    return { rows, total, page, per_page: perPage, statuses };
  }

  private async detail(ctx: RequestContext) {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const order = await this.outbound.getById(id);
    if (!order) throw ApiException.notFound('Outbound tidak ditemukan');
    const items = await this.outbound.getItems(id);
    return { order, items, users: await this.master.activeUsers(), products: await this.master.productOptions() };
  }

  private async stats(_ctx: RequestContext) {
    return { stats: await this.outbound.getStats() };
  }

  private async searchProducts(ctx: RequestContext) {
    return { results: await this.master.searchProducts(String(ctx.query.q ?? '')) };
  }

  private async checkStock(ctx: RequestContext) {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const quantity = Number(ctx.query.quantity ?? 0);
    const location = String(ctx.query.location ?? '').trim() || undefined;
    if (!productId || quantity <= 0) throw ApiException.badRequest('Product dan quantity wajib diisi.');
    return await this.outbound.checkStock(productId, quantity, location);
  }

  private async create(ctx: RequestContext) {
    const data = ctx.body;
    data.created_by = ctx.user.id;
    const id = await this.outbound.create(data);
    await this.activity.log('CREATE_OUTBOUND', 'outbound', 'Outbound', id, null, 'Buat outbound baru', null, null, this.actCtx(ctx));
    const order = await this.outbound.getById(id);
    return { id, order_number: order?.order_number ?? null };
  }

  private async update(ctx: RequestContext) {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('ID wajib diisi');
    await this.outbound.update(id, data);
    await this.activity.log('UPDATE_OUTBOUND', 'outbound', 'Outbound', id, null, 'Edit outbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async delete(ctx: RequestContext) {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    await this.outbound.delete(id);
    await this.activity.log('DELETE_OUTBOUND', 'outbound', 'Outbound', id, null, 'Hapus outbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async addItem(ctx: RequestContext) {
    const data = ctx.body;
    const outboundId = Number.parseInt(data.outbound_id ?? '0', 10) || 0;
    if (!outboundId) throw ApiException.badRequest('outbound_id wajib diisi');
    const itemId = await this.outbound.addItem(outboundId, data);
    await this.activity.log('ADD_OUTBOUND_ITEM', 'outbound', 'Outbound', outboundId, null, 'Tambah item outbound ID ' + outboundId, null, null, this.actCtx(ctx));
    return { item_id: itemId, outbound_id: outboundId };
  }

  private async deleteItem(ctx: RequestContext) {
    const itemId = Number.parseInt(ctx.body.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
    await this.outbound.deleteItem(itemId);
    await this.activity.log('DELETE_OUTBOUND_ITEM', 'outbound', 'Outbound', itemId, null, 'Hapus item outbound ID ' + itemId, null, null, this.actCtx(ctx));
    return { item_id: itemId };
  }

  private async updateItemStatus(ctx: RequestContext) {
    const itemId = Number.parseInt(ctx.body.item_id ?? '0', 10) || 0;
    const status = String(ctx.body.status ?? '').trim();
    await this.outbound.changeItemStatus(itemId, status);
    await this.activity.log('UPDATE_OB_ITEM_STATUS', 'outbound', 'Outbound', itemId, null, `Status item outbound ID ${itemId} → ${status}`, null, null, this.actCtx(ctx));
    return { item_id: itemId, status };
  }

  private async pickItems(ctx: RequestContext) {
    const data = ctx.body;
    const outboundId = Number.parseInt(data.outbound_id ?? '0', 10) || 0;
    if (!outboundId) throw ApiException.badRequest('outbound_id wajib diisi');
    const itemIds = Array.isArray(data.item_ids) ? data.item_ids.map((v) => Number(v)).filter((v) => v > 0) : [];
    await this.outbound.pickItems(outboundId, itemIds, ctx.user.id);
    await this.activity.log('PICK_OUTBOUND', 'outbound', 'Outbound', outboundId, null, 'Pick outbound ID ' + outboundId, null, null, this.actCtx(ctx));
    return { outbound_id: outboundId };
  }

  private async ship(ctx: RequestContext) {
    const id = Number.parseInt(ctx.body.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.outbound.ship(id, ctx.user.id);
    await this.activity.log('SHIP_OUTBOUND', 'outbound', 'Outbound', id, null, 'Kirim outbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async complete(ctx: RequestContext) {
    const id = Number.parseInt(ctx.body.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.outbound.complete(id);
    await this.activity.log('COMPLETE_OUTBOUND', 'outbound', 'Outbound', id, null, 'Selesaikan outbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }
}
