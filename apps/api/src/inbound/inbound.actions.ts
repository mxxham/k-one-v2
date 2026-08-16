import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { InboundService } from './inbound.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments, setActionDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';
import { MasterDataService } from '../master/master-data.service';
import { PutawayService } from '../putaway/putaway.service';

type Q = Record<string, any>;

@Injectable()
export class InboundActions {
  constructor(
    private readonly db: DbService,
    private readonly inbound: InboundService,
    private readonly activity: ActivityLogger,
    private readonly master: MasterDataService,
    private readonly putaway: PutawayService,
  ) {
    registerActions('inbound', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      stats: (c) => this.stats(c),
      search_products: (c) => this.searchProducts(c),
      create: (c) => this.create(c),
      update: (c) => this.update(c),
      delete: (c) => this.delete(c),
      add_item: (c) => this.addItem(c),
      update_item: (c) => this.updateItem(c),
      update_item_qty: (c) => this.updateItemQty(c),
      update_item_dates: (c) => this.updateItemDates(c),
      update_item_pallet_no: (c) => this.updateItemPalletNo(c),
      delete_item: (c) => this.deleteItem(c),
      update_item_status: (c) => this.updateItemStatus(c),
      save_pallet_locations: (c) => this.savePalletLocations(c),
      save_item_location: (c) => this.saveItemLocation(c),
      advance_status: (c) => this.advanceStatus(c),
      complete: (c) => this.complete(c),
      repair_ledger: (c) => this.repairLedger(c),
    });
    setPermission('inbound', 'delete', 'write');
    setModuleDepartments('inbound', ['inbound']);
    setActionDepartments('inbound', 'search_products', ['inbound', 'inventory']);
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
    const total = await this.inbound.countAll(status, odNo);
    const rows = await this.inbound.getAll(status, perPage, offset, odNo);
    const statuses = [
      'Draft', 'Dues In', 'Receiving', 'Good Received', 'Goods Received',
      'Unserviceable', 'Picked', 'ATP', 'Completed', 'Cancelled',
    ];
    return { rows, total, page, per_page: perPage, statuses };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const order = await this.inbound.getById(id);
    if (!order) throw ApiException.notFound('Inbound tidak ditemukan');
    const items = await this.inbound.getItems(id);
    const locations = await this.inbound.getOrderLocations(id);
    const itemPalletCounts: Record<number, number> = {};
    for (const it of items) {
      const locs = await this.inbound.getItemLocations(it.id);
      itemPalletCounts[Number(it.id)] = locs.length > 0 ? locs.length : Math.ceil(Number(it.pallet ?? 0));
      it.pallet_locations = locs;
      it.id = Number(it.id);
    }
    const crossDockOrders = await this.db.query(
      `SELECT o.id, o.order_number, o.so_number, o.do_number, c.customer_name,
              COALESCE(o.so_number, o.do_number, o.order_number) AS display_no
       FROM outbound_orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.status IN ('Open','Picking','Picked')
       ORDER BY o.order_number`,
    );
    return {
      order,
      items,
      locations,
      item_pallet_counts: itemPalletCounts,
      users: await this.master.activeUsers(),
      products: await this.master.productOptions(),
      cross_dock_orders: crossDockOrders.rows,
      putaway_task: await this.putaway.getInboundOpenTask(id),
    };
  }

  private async stats(_ctx: RequestContext): Promise<Q> {
    return { stats: await this.inbound.getStats() };
  }

  private async searchProducts(ctx: RequestContext): Promise<Q> {
    return { results: await this.master.searchProducts(String(ctx.query.q ?? '')) };
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    data.items = data.items ?? [];
    data.created_by = ctx.user.id;
    const id = await this.inbound.create(data);
    await this.activity.log(
      'CREATE_INBOUND', 'inbound', 'Inbound', id, null,
      'Buat inbound baru, PO: ' + (data.po_number ?? '—'),
      null, null, this.actCtx(ctx),
    );
    const order = await this.inbound.getById(id);
    return { id, order_number: order?.order_number ?? null };
  }

  private async update(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('ID wajib diisi');
    const cur = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [id]);
    data.status = cur.rows[0]?.status ?? 'Draft';
    await this.inbound.update(id, data);
    await this.activity.log('UPDATE_INBOUND', 'inbound', 'Inbound', id, null, 'Edit inbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async delete(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const st = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [id]);
    if (['Completed', 'Cancelled'].includes(st.rows[0]?.status)) {
      throw ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat dihapus.');
    }
    await this.inbound.delete(id);
    await this.activity.log('DELETE_INBOUND', 'inbound', 'Inbound', id, null, 'Hapus inbound ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async addItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
    if (!inboundId) throw ApiException.badRequest('inbound_id wajib diisi');
    const item = data.item ?? data;
    const inProcess = item.in_process_status ?? 'Dues In';
    const stockStatusMap: Record<string, string> = {
      'Dues In': 'Pending',
      'Goods Received': 'Pending',
      ATP: 'Accepted',
      Unserviceable: 'Rejected',
    };
    item.stock_status = stockStatusMap[inProcess] ?? 'Pending';
    if (inProcess === 'Unserviceable') item.location = 'QUA_SHELL';
    item.pallet_locations = data.pallet_locations ?? item.pallet_locations ?? [];
    const itemId = await this.inbound.addItem(inboundId, item);
    await this.activity.log(
      'ADD_INBOUND_ITEM', 'inbound', 'Inbound', inboundId, null,
      'Tambah item produk ID ' + (item.product_id ?? '?') + ', qty ' + (item.quantity ?? 0),
      null, null, this.actCtx(ctx),
    );
    return { item_id: itemId, inbound_id: inboundId };
  }

  private async updateItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? data.id ?? '0', 10) || 0;
    if (!itemId) throw ApiException.badRequest('item_id wajib diisi');
    await this.inbound.updateItem(itemId, data);
    return { item_id: itemId };
  }

  private async updateItemQty(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    const qty = Number(data.quantity ?? 0);
    if (itemId && qty > 0) {
      await this.inbound.updateItemQty(itemId, qty);
      await this.activity.log(
        'UPDATE_INBOUND_ITEM_QTY', 'inbound', 'Inbound', Number.parseInt(data.inbound_id ?? '0', 10) || 0,
        null, `Edit qty item ID ${itemId} → ${qty}`, null, null, this.actCtx(ctx),
      );
    }
    return { item_id: itemId };
  }

  private async updateItemDates(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    await this.inbound.updateItemDates(itemId, data.manufacture_date ?? null, data.exp_date ?? null);
    await this.activity.log('UPDATE_ITEM_DATES', 'inbound', 'Inbound', itemId, null, 'Update tanggal item ID ' + itemId, null, null, this.actCtx(ctx));
    return { item_id: itemId };
  }

  private async updateItemPalletNo(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    await this.inbound.updateItemPalletNo(itemId, data.pallet_no ?? null);
    await this.activity.log('UPDATE_PALLET_NO', 'inbound', 'Inbound', itemId, null, 'Update pallet no item ID ' + itemId, null, null, this.actCtx(ctx));
    return { item_id: itemId };
  }

  private async deleteItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
    const inboundId = Number.parseInt(data.inbound_id ?? ctx.query.inbound_id ?? '0', 10) || 0;
    const parentStatus = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [inboundId]);
    if (['Completed', 'Cancelled'].includes(parentStatus.rows[0]?.status)) {
      throw ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat diedit.');
    }
    const itemStatus = await this.db.query('SELECT in_process_status FROM inbound_items WHERE id=$1', [itemId]);
    if (itemStatus.rows[0]?.in_process_status === 'Goods Received' && ctx.user.role !== 'admin') {
      throw ApiException.forbidden('Hanya Admin yang dapat menghapus item berstatus Goods Received.');
    }
    await this.inbound.deleteItem(itemId);
    await this.activity.log(
      'DELETE_INBOUND_ITEM', 'inbound', 'Inbound', inboundId, null,
      `Hapus item ID ${itemId} dari inbound ID ${inboundId}`, null, null, this.actCtx(ctx),
    );
    return { item_id: itemId };
  }

  private async updateItemStatus(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
    const newProcess = String(data.status ?? '').trim();
    const allowed = ['Dues In', 'Goods Received', 'Unserviceable', 'ATP'];
    if (!allowed.includes(newProcess)) throw ApiException.badRequest('Status tidak valid.');
    await this.inbound.changeItemStatus(itemId, newProcess, ctx.user.id);
    await this.activity.log(
      'UPDATE_ITEM_STATUS', 'inbound', 'Inbound', inboundId, null,
      `Status item ID ${itemId} → ${newProcess}`, null, null, this.actCtx(ctx),
    );
    return { item_id: itemId, status: newProcess };
  }

  private async savePalletLocations(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
    const pallets = data.pallet_locations ?? [];
    if (!itemId || !Array.isArray(pallets)) throw ApiException.badRequest('Data tidak valid.');
    await this.inbound.savePalletLocations(itemId, pallets, ctx.user.id);
    await this.activity.log(
      'SAVE_PALLET_LOCATIONS', 'inbound', 'Inbound', inboundId, null,
      'Simpan ' + pallets.length + ' pallet location untuk item ID ' + itemId, null, null, this.actCtx(ctx),
    );
    return { ok: true };
  }

  private async saveItemLocation(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const loc = String(data.location ?? '').trim().toUpperCase();
    const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
    const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
    await this.inbound.saveItemLocation(itemId, loc);
    await this.activity.log('ASSIGN_LOCATION', 'inbound', 'Inbound', inboundId, null, `Assign lokasi item ID ${itemId} → ${loc}`, null, null, this.actCtx(ctx));
    return { ok: true };
  }

  private async advanceStatus(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    const newStatus = data.status ?? '';
    if (!['Dues In', 'Receiving'].includes(newStatus)) throw ApiException.badRequest('Status tidak valid.');
    await this.inbound.advanceStatus(id, newStatus, Number.parseInt(data.received_by_id ?? '0', 10) || 0, String(data.received_date ?? ''));
    await this.activity.log('ADVANCE_INBOUND_STATUS', 'inbound', 'Inbound', id, null, `Status inbound → ${newStatus}`, null, null, this.actCtx(ctx));
    return { id, status: newStatus };
  }

  private async complete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const cid = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    const pending = await this.db.query(
      `SELECT COUNT(*)::int AS c FROM inbound_items
       WHERE inbound_order_id = $1 AND in_process_status NOT IN ('ATP','Unserviceable')`,
      [cid],
    );
    const pendingCount = Number(pending.rows[0].c ?? 0);
    if (pendingCount > 0) {
      throw ApiException.conflict(
        `Tidak dapat complete: masih ada ${pendingCount} item yang belum ATP atau Unserviceable. Update status setiap item terlebih dahulu.`,
      );
    }
    await this.inbound.complete(cid);
    await this.activity.log('COMPLETE_INBOUND', 'inbound', 'Inbound', cid, null, 'Inbound ID ' + cid + ' diselesaikan', null, null, this.actCtx(ctx));
    return { id: cid };
  }

  private async repairLedger(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const rid = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.inbound.regenerateLedger(rid);
    await this.activity.log('REPAIR_LEDGER', 'inbound', 'Inbound', rid, null, 'Regenerasi ledger inbound ID ' + rid, null, null, this.actCtx(ctx));
    return { id: rid };
  }
}
