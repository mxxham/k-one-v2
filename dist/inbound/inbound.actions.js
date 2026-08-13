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
exports.InboundActions = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const inbound_service_1 = require("./inbound.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
const master_data_service_1 = require("../master/master-data.service");
let InboundActions = class InboundActions {
    db;
    inbound;
    activity;
    master;
    constructor(db, inbound, activity, master) {
        this.db = db;
        this.inbound = inbound;
        this.activity = activity;
        this.master = master;
        (0, registry_1.registerActions)('inbound', {
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
        (0, registry_1.setPermission)('inbound', 'delete', 'write');
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
    async list(ctx) {
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
    async detail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const order = await this.inbound.getById(id);
        if (!order)
            throw api_exception_1.ApiException.notFound('Inbound tidak ditemukan');
        const items = await this.inbound.getItems(id);
        const locations = await this.inbound.getOrderLocations(id);
        const itemPalletCounts = {};
        for (const it of items) {
            const locs = await this.inbound.getItemLocations(it.id);
            itemPalletCounts[Number(it.id)] = locs.length > 0 ? locs.length : Math.ceil(Number(it.pallet ?? 0));
            it.pallet_locations = locs;
            it.id = Number(it.id);
        }
        return {
            order,
            items,
            locations,
            item_pallet_counts: itemPalletCounts,
            users: await this.master.activeUsers(),
            products: await this.master.productOptions(),
        };
    }
    async stats(_ctx) {
        return { stats: await this.inbound.getStats() };
    }
    async searchProducts(ctx) {
        return { results: await this.master.searchProducts(String(ctx.query.q ?? '')) };
    }
    async create(ctx) {
        const data = ctx.body;
        data.items = data.items ?? [];
        data.created_by = ctx.user.id;
        const id = await this.inbound.create(data);
        await this.activity.log('CREATE_INBOUND', 'inbound', 'Inbound', id, null, 'Buat inbound baru, PO: ' + (data.po_number ?? '—'), null, null, this.actCtx(ctx));
        const order = await this.inbound.getById(id);
        return { id, order_number: order?.order_number ?? null };
    }
    async update(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        if (!id)
            throw api_exception_1.ApiException.badRequest('ID wajib diisi');
        const cur = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [id]);
        data.status = cur.rows[0]?.status ?? 'Draft';
        await this.inbound.update(id, data);
        await this.activity.log('UPDATE_INBOUND', 'inbound', 'Inbound', id, null, 'Edit inbound ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async delete(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const st = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [id]);
        if (['Completed', 'Cancelled'].includes(st.rows[0]?.status)) {
            throw api_exception_1.ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat dihapus.');
        }
        await this.inbound.delete(id);
        await this.activity.log('DELETE_INBOUND', 'inbound', 'Inbound', id, null, 'Hapus inbound ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async addItem(ctx) {
        const data = ctx.body;
        const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
        if (!inboundId)
            throw api_exception_1.ApiException.badRequest('inbound_id wajib diisi');
        const item = data.item ?? data;
        const inProcess = item.in_process_status ?? 'Dues In';
        const stockStatusMap = {
            'Dues In': 'Pending',
            'Goods Received': 'Pending',
            ATP: 'Accepted',
            Unserviceable: 'Rejected',
        };
        item.stock_status = stockStatusMap[inProcess] ?? 'Pending';
        if (inProcess === 'Unserviceable')
            item.location = 'QUA_SHELL';
        item.pallet_locations = data.pallet_locations ?? item.pallet_locations ?? [];
        const itemId = await this.inbound.addItem(inboundId, item);
        await this.activity.log('ADD_INBOUND_ITEM', 'inbound', 'Inbound', inboundId, null, 'Tambah item produk ID ' + (item.product_id ?? '?') + ', qty ' + (item.quantity ?? 0), null, null, this.actCtx(ctx));
        return { item_id: itemId, inbound_id: inboundId };
    }
    async updateItem(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? data.id ?? '0', 10) || 0;
        if (!itemId)
            throw api_exception_1.ApiException.badRequest('item_id wajib diisi');
        await this.inbound.updateItem(itemId, data);
        return { item_id: itemId };
    }
    async updateItemQty(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        const qty = Number(data.quantity ?? 0);
        if (itemId && qty > 0) {
            await this.inbound.updateItemQty(itemId, qty);
            await this.activity.log('UPDATE_INBOUND_ITEM_QTY', 'inbound', 'Inbound', Number.parseInt(data.inbound_id ?? '0', 10) || 0, null, `Edit qty item ID ${itemId} → ${qty}`, null, null, this.actCtx(ctx));
        }
        return { item_id: itemId };
    }
    async updateItemDates(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        await this.inbound.updateItemDates(itemId, data.manufacture_date ?? null, data.exp_date ?? null);
        await this.activity.log('UPDATE_ITEM_DATES', 'inbound', 'Inbound', itemId, null, 'Update tanggal item ID ' + itemId, null, null, this.actCtx(ctx));
        return { item_id: itemId };
    }
    async updateItemPalletNo(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        await this.inbound.updateItemPalletNo(itemId, data.pallet_no ?? null);
        await this.activity.log('UPDATE_PALLET_NO', 'inbound', 'Inbound', itemId, null, 'Update pallet no item ID ' + itemId, null, null, this.actCtx(ctx));
        return { item_id: itemId };
    }
    async deleteItem(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
        const inboundId = Number.parseInt(data.inbound_id ?? ctx.query.inbound_id ?? '0', 10) || 0;
        const parentStatus = await this.db.query('SELECT status FROM inbound_orders WHERE id=$1', [inboundId]);
        if (['Completed', 'Cancelled'].includes(parentStatus.rows[0]?.status)) {
            throw api_exception_1.ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat diedit.');
        }
        const itemStatus = await this.db.query('SELECT in_process_status FROM inbound_items WHERE id=$1', [itemId]);
        if (itemStatus.rows[0]?.in_process_status === 'Goods Received' && ctx.user.role !== 'admin') {
            throw api_exception_1.ApiException.forbidden('Hanya Admin yang dapat menghapus item berstatus Goods Received.');
        }
        await this.inbound.deleteItem(itemId);
        await this.activity.log('DELETE_INBOUND_ITEM', 'inbound', 'Inbound', inboundId, null, `Hapus item ID ${itemId} dari inbound ID ${inboundId}`, null, null, this.actCtx(ctx));
        return { item_id: itemId };
    }
    async updateItemStatus(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
        const newProcess = String(data.status ?? '').trim();
        const allowed = ['Dues In', 'Goods Received', 'Unserviceable', 'ATP'];
        if (!allowed.includes(newProcess))
            throw api_exception_1.ApiException.badRequest('Status tidak valid.');
        await this.inbound.changeItemStatus(itemId, newProcess);
        await this.activity.log('UPDATE_ITEM_STATUS', 'inbound', 'Inbound', inboundId, null, `Status item ID ${itemId} → ${newProcess}`, null, null, this.actCtx(ctx));
        return { item_id: itemId, status: newProcess };
    }
    async savePalletLocations(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
        const pallets = data.pallet_locations ?? [];
        if (!itemId || !Array.isArray(pallets))
            throw api_exception_1.ApiException.badRequest('Data tidak valid.');
        await this.inbound.savePalletLocations(itemId, pallets);
        await this.activity.log('SAVE_PALLET_LOCATIONS', 'inbound', 'Inbound', inboundId, null, 'Simpan ' + pallets.length + ' pallet location untuk item ID ' + itemId, null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async saveItemLocation(ctx) {
        const data = ctx.body;
        const loc = String(data.location ?? '').trim().toUpperCase();
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        const inboundId = Number.parseInt(data.inbound_id ?? '0', 10) || 0;
        await this.inbound.saveItemLocation(itemId, loc);
        await this.activity.log('ASSIGN_LOCATION', 'inbound', 'Inbound', inboundId, null, `Assign lokasi item ID ${itemId} → ${loc}`, null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async advanceStatus(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        const newStatus = data.status ?? '';
        if (!['Dues In', 'Receiving'].includes(newStatus))
            throw api_exception_1.ApiException.badRequest('Status tidak valid.');
        await this.inbound.advanceStatus(id, newStatus, Number.parseInt(data.received_by_id ?? '0', 10) || 0, String(data.received_date ?? ''));
        await this.activity.log('ADVANCE_INBOUND_STATUS', 'inbound', 'Inbound', id, null, `Status inbound → ${newStatus}`, null, null, this.actCtx(ctx));
        return { id, status: newStatus };
    }
    async complete(ctx) {
        const data = ctx.body;
        const cid = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        const pending = await this.db.query(`SELECT COUNT(*)::int AS c FROM inbound_items
       WHERE inbound_order_id = $1 AND in_process_status NOT IN ('ATP','Unserviceable')`, [cid]);
        const pendingCount = Number(pending.rows[0].c ?? 0);
        if (pendingCount > 0) {
            throw api_exception_1.ApiException.conflict(`Tidak dapat complete: masih ada ${pendingCount} item yang belum ATP atau Unserviceable. Update status setiap item terlebih dahulu.`);
        }
        await this.inbound.complete(cid);
        await this.activity.log('COMPLETE_INBOUND', 'inbound', 'Inbound', cid, null, 'Inbound ID ' + cid + ' diselesaikan', null, null, this.actCtx(ctx));
        return { id: cid };
    }
    async repairLedger(ctx) {
        const data = ctx.body;
        const rid = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.inbound.regenerateLedger(rid);
        await this.activity.log('REPAIR_LEDGER', 'inbound', 'Inbound', rid, null, 'Regenerasi ledger inbound ID ' + rid, null, null, this.actCtx(ctx));
        return { id: rid };
    }
};
exports.InboundActions = InboundActions;
exports.InboundActions = InboundActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        inbound_service_1.InboundService,
        activity_logger_1.ActivityLogger,
        master_data_service_1.MasterDataService])
], InboundActions);
//# sourceMappingURL=inbound.actions.js.map