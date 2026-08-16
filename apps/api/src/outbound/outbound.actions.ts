import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { OutboundService } from './outbound.service';
import { ActivityLogger } from '../common/activity-logger';
import { MasterDataService } from '../master/master-data.service';
import { RedisLockService } from '../common/redis-lock.service';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';
import { LOCK_KEYS } from '@k-one/shared';

type Q = Record<string, any>;

@Injectable()
export class OutboundActions {
  constructor(
    private readonly db: DbService,
    private readonly outbound: OutboundService,
    private readonly activity: ActivityLogger,
    private readonly master: MasterDataService,
    private readonly lock: RedisLockService,
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
    setModuleDepartments('outbound', ['outbound']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const odNo = String(ctx.query.od_no ?? '').trim() || null;
    const total = await this.outbound.countAll(status, odNo);
    const rows = await this.outbound.getAll(status, perPage, offset, odNo);
    for (const r of rows) {
      r.id = Number(r.id);
      r.display_order_no = this.outbound.displayOrderNo(r);
    }
    return { rows, total, page, per_page: perPage, statuses: ['Open', 'Picking', 'Picked', 'Shipped', 'Delivered', 'Completed', 'Cancelled'] };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const order = await this.outbound.getById(id);
    if (!order) throw ApiException.notFound('Outbound tidak ditemukan');
    order.display_order_no = this.outbound.displayOrderNo(order);
    const items = await this.outbound.getItems(id);
    for (const it of items) {
      it.id = Number(it.id);
      it.picked_locations = await this.outbound.getItemPickedLocations(Number(it.id));
    }
    return {
      order,
      items,
      destinations: await this.outbound.getDestinations(id),
      customers: await this.master.customerOptions(),
      products: await this.master.productOptions(),
    };
  }

  private async stats(_ctx: RequestContext): Promise<Q> {
    return { stats: await this.outbound.getStats() };
  }

  private async searchProducts(ctx: RequestContext): Promise<Q> {
    return { results: await this.master.searchProducts(String(ctx.query.q ?? '')) };
  }

  private async checkStock(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const quantity = Number(ctx.query.quantity ?? 0);
    const location = ctx.query.location ? String(ctx.query.location) : null;
    return await this.outbound.checkStock(productId, quantity, location);
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const validItems: any[] = [];
    const skippedItems: any[] = [];
    for (const item of rawItems) {
      const pid = Number(item.product_id ?? 0);
      if (!pid) continue;
      const avail = await this.outbound.getTotalAvailableQty(pid);
      if (avail <= 0) {
        const pRow = await this.db.query(
          'SELECT product_code, product_name FROM products WHERE id = $1',
          [pid],
        );
        const p = pRow.rows[0];
        skippedItems.push((p?.product_code ?? 'ID:' + pid) + ' – ' + (p?.product_name ?? 'Unknown'));
      } else {
        validItems.push(item);
      }
    }
    if (rawItems.length > 0 && validItems.length === 0) {
      throw ApiException.conflict(
        'Semua produk tidak ada di stok. Order tidak dibuat. Dilewati: ' + skippedItems.join(', '),
      );
    }
    data.items = validItems;
    data.created_by = ctx.user.id;
    const id = await this.outbound.create(data);
    if (Array.isArray(data.destinations) && data.destinations.length > 0) {
      const d = data.destinations;
      await this.outbound.saveDestinations(
        id,
        d.map((x: any) => x.ship_to_name),
        d.map((x: any) => x.ship_to_location),
        d.map((x: any) => x.ship_to_street),
        d.map((x: any) => x.kota),
        d.map((x: any) => x.notes),
      );
    }
    await this.activity.log(
      'CREATE_OUTBOUND', 'outbound', 'Outbound', id,
      null,
      'Buat outbound, customer ID ' + (data.customer_id ?? '—') + ', SO: ' + (data.so_number ?? '—'),
      null, null, this.actCtx(ctx),
    );
    return { id, warnings: skippedItems };
  }

  private async update(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('ID wajib diisi');
    const obCheck = await this.outbound.getById(id);
    if ((obCheck?.status ?? '') === 'Completed') {
      throw ApiException.conflict('Order sudah Completed dan tidak dapat diedit.');
    }
    await this.outbound.update(id, data, ctx.user.id);
    if (Array.isArray(data.destinations) && data.destinations.length > 0) {
      const d = data.destinations;
      await this.outbound.saveDestinations(
        id,
        d.map((x: any) => x.ship_to_name),
        d.map((x: any) => x.ship_to_location),
        d.map((x: any) => x.ship_to_street),
        d.map((x: any) => x.kota),
        d.map((x: any) => x.notes),
      );
    }
    await this.activity.log('UPDATE_OUTBOUND', 'outbound', 'Outbound', id, null, 'Edit outbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async delete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const ob = await this.outbound.getById(id);
    if (!ob) throw ApiException.notFound('Outbound tidak ditemukan.');
    if (['Completed', 'Cancelled', 'Shipped', 'Delivered'].includes(ob.status ?? '')) {
      throw ApiException.conflict('Order sudah ' + ob.status + ' dan tidak dapat dihapus.');
    }
    await this.outbound.delete(id);
    await this.activity.log(
      'DELETE_OUTBOUND', 'outbound', 'Outbound', id, ob.order_number ?? null,
      'Hapus outbound ' + (ob.order_number ?? id), null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async addItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const outboundId = Number.parseInt(data.outbound_id ?? '0', 10) || 0;
    const obCheck = await this.outbound.getById(outboundId);
    if ((obCheck?.status ?? '') === 'Completed') {
      throw ApiException.conflict('Order sudah Completed dan tidak dapat diedit.');
    }
    const item = data.item ?? data;
    item.manual_location = data.manual_location ?? null;
    item.manual_locs = data.manual_locs ?? null;
    let newItemId: number;
    try {
      newItemId = await this.outbound.addItemWithFEFO(outboundId, item);
    } catch (e) {
      if (e instanceof ApiException && (e as any).getStatus?.() === 409) throw e;
      // PHP: catches Exception and re-emits 409.
      throw ApiException.conflict((e as Error).message);
    }
    await this.outbound.attachDestination(outboundId, newItemId, item);
    await this.activity.log(
      'ADD_OUTBOUND_ITEM', 'outbound', 'Outbound', outboundId,
      null,
      'Tambah item produk ID ' + (item.product_id ?? '?') + ' qty ' + (item.quantity ?? 0),
      null, null, this.actCtx(ctx),
    );
    return { item_id: newItemId, outbound_id: outboundId };
  }

  private async pickItems(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const ob = await this.outbound.getById(id);
    if (!ob) throw ApiException.notFound('Outbound tidak ditemukan');
    if (String(ob.expected_date ?? '').trim() === '') {
      throw ApiException.conflict('Expected Date wajib diisi sebelum Pick Items.');
    }
    await this.lock.runLocked(LOCK_KEYS.fefo(id), () => this.outbound.pickItems(id), { ttlMs: 60_000 });
    await this.activity.log(
      'PICK_OUTBOUND', 'outbound', 'Outbound', id, ob.order_number ?? null,
      'Pick outbound ' + (ob.order_number ?? id), null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async ship(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const ob = await this.outbound.getById(id);
    await this.lock.runLocked(LOCK_KEYS.fefo(id), () => this.outbound.ship(id, ctx.user.id), { ttlMs: 60_000 });
    await this.activity.log(
      'SHIP_OUTBOUND', 'outbound', 'Outbound', id, ob?.order_number ?? null,
      'Kirim outbound ' + (ob?.order_number ?? id), null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async complete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const ob = await this.outbound.getById(id);
    await this.outbound.complete(id);
    await this.activity.log(
      'COMPLETE_OUTBOUND', 'outbound', 'Outbound', id, ob?.order_number ?? null,
      'Selesai outbound ' + (ob?.order_number ?? id), null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const outboundId = Number.parseInt(data.outbound_id ?? '0', 10) || 0;
    const itemId = Number.parseInt(data.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
    const obCheck = await this.outbound.getById(outboundId);
    if ((obCheck?.status ?? '') === 'Completed') {
      throw ApiException.conflict('Order sudah Completed dan tidak dapat diedit.');
    }
    await this.outbound.deleteItem(itemId);
    await this.activity.log(
      'DELETE_OUTBOUND_ITEM', 'outbound', 'Outbound', outboundId, null,
      `Hapus item ID ${itemId} dari outbound ID ${outboundId}`, null, null, this.actCtx(ctx),
    );
    return { item_id: itemId };
  }

  private async updateItemStatus(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    const outboundId = Number.parseInt(data.outbound_id ?? '0', 10) || 0;
    const status = String(data.status ?? '').trim();
    await this.outbound.changeItemStatus(itemId, status);
    await this.activity.log(
      'UPDATE_OB_ITEM_STATUS', 'outbound', 'Outbound', outboundId, null,
      `Status outbound item ID ${itemId} → ${status}`, null, null, this.actCtx(ctx),
    );
    return { item_id: itemId, status };
  }
}