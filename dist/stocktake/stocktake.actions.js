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
exports.StockTakeActions = void 0;
const common_1 = require("@nestjs/common");
const stocktake_service_1 = require("./stocktake.service");
const activity_logger_1 = require("../common/activity-logger");
const redis_lock_service_1 = require("../common/redis-lock.service");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
const db_service_1 = require("../database/db.service");
const shared_1 = require("@k-one/shared");
let StockTakeActions = class StockTakeActions {
    stocktake;
    activity;
    db;
    lock;
    constructor(stocktake, activity, db, lock) {
        this.stocktake = stocktake;
        this.activity = activity;
        this.db = db;
        this.lock = lock;
        (0, registry_1.registerActions)('stocktake', {
            list: (c) => this.list(c),
            detail: (c) => this.detail(c),
            stats: (c) => this.stats(c),
            get_locations: (c) => this.getLocations(c),
            get_scope_locations: (c) => this.getScopeLocations(c),
            get_stock: (c) => this.getStock(c),
            create: (c) => this.create(c),
            add_item: (c) => this.addItem(c),
            auto_load: (c) => this.autoLoad(c),
            update: (c) => this.update(c),
            delete_item: (c) => this.deleteItem(c),
            delete: (c) => this.delete(c),
            start_counting: (c) => this.startCounting(c),
            save_counters: (c) => this.saveCounters(c),
            advance_to_c2: (c) => this.advanceToC2(c),
            finish_counting: (c) => this.finishCounting(c),
            save_review: (c) => this.saveReview(c),
            apply_adjustment: (c) => this.applyAdjustment(c),
        });
        (0, registry_1.setPermission)('stocktake', 'create', 'write');
        (0, registry_1.setPermission)('stocktake', 'add_item', 'write');
        (0, registry_1.setPermission)('stocktake', 'auto_load', 'write');
        (0, registry_1.setPermission)('stocktake', 'update', 'write');
        (0, registry_1.setPermission)('stocktake', 'delete_item', 'write');
        (0, registry_1.setPermission)('stocktake', 'delete', 'write');
        (0, registry_1.setPermission)('stocktake', 'start_counting', 'write');
        (0, registry_1.setPermission)('stocktake', 'save_counters', 'write');
        (0, registry_1.setPermission)('stocktake', 'advance_to_c2', 'write');
        (0, registry_1.setPermission)('stocktake', 'finish_counting', 'write');
        (0, registry_1.setPermission)('stocktake', 'save_review', 'write');
        (0, registry_1.setPermission)('stocktake', 'apply_adjustment', 'admin');
        (0, registry_1.setModuleDepartments)('stocktake', ['inventory']);
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
    async list(ctx) {
        const limit = Number.parseInt(ctx.query.limit ?? '200', 10) || 200;
        const rows = await this.stocktake.getAll(limit);
        for (const r of rows)
            r.id = Number(r.id);
        return { rows, stats: await this.stocktake.getStats() };
    }
    async detail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const stockTake = await this.stocktake.getById(id);
        if (!stockTake)
            throw api_exception_1.ApiException.notFound('Stock take tidak ditemukan');
        const items = await this.stocktake.getItems(id);
        for (const it of items)
            it.id = Number(it.id);
        return {
            stock_take: stockTake,
            items,
            accuracy: await this.stocktake.calculateAccuracy(id),
            locked_locations: await this.stocktake.getActiveLockedLocations(),
        };
    }
    async stats(_ctx) {
        return { stats: await this.stocktake.getStats() };
    }
    async getLocations(_ctx) {
        const r = await this.db.query(`SELECT DISTINCT location FROM stock WHERE location IS NOT NULL AND location != '' AND quantity > 0 ORDER BY location`);
        return { rows: r.rows.map((x) => x.location) };
    }
    async getScopeLocations(_ctx) {
        return this.stocktake.getScopeLocations();
    }
    async getStock(ctx) {
        const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
        const location = ctx.query.location ? String(ctx.query.location) : null;
        const batch = ctx.query.batch ? String(ctx.query.batch) : null;
        if (!productId)
            throw api_exception_1.ApiException.badRequest('product_id wajib diisi.');
        return this.stocktake.getStock(productId, location, batch);
    }
    async create(ctx) {
        const data = ctx.body;
        const id = await this.stocktake.create(data, ctx.user.id);
        const scopeLocs = data.scope_locations;
        if (Array.isArray(scopeLocs) && scopeLocs.length > 0) {
            await this.stocktake.autoLoadByLocations(id, scopeLocs);
        }
        else if (typeof scopeLocs === 'string' && scopeLocs !== '' && scopeLocs !== '[]') {
            try {
                const parsed = JSON.parse(scopeLocs);
                if (Array.isArray(parsed) && parsed.length > 0)
                    await this.stocktake.autoLoadByLocations(id, parsed);
            }
            catch {
            }
        }
        else if (data.auto_load) {
            await this.stocktake.autoLoadByLocations(id, null);
        }
        await this.activity.log('CREATE_STOCKTAKE', 'stocktake', 'StockTake', id, null, 'Buat stock take ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async addItem(ctx) {
        const data = ctx.body;
        const stockTakeId = Number.parseInt(data.stock_take_id ?? '0', 10) || 0;
        const item = data.item ?? data;
        const itemId = await this.stocktake.addItemFull(stockTakeId, item);
        return { item_id: itemId };
    }
    async autoLoad(ctx) {
        const data = ctx.body;
        const stockTakeId = Number.parseInt(data.stock_take_id ?? ctx.query.stock_take_id ?? '0', 10) || 0;
        const locs = data.locations ?? null;
        await this.stocktake.autoLoadByLocations(stockTakeId, Array.isArray(locs) ? locs : null);
        return { ok: true };
    }
    async update(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        await this.stocktake.update(id, data);
        return { id };
    }
    async deleteItem(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
        await this.db.query('DELETE FROM stock_take_items WHERE id=$1', [itemId]);
        return { item_id: itemId };
    }
    async delete(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.stocktake.delete(id);
        await this.activity.log('DELETE_STOCKTAKE', 'stocktake', 'StockTake', id, null, 'Hapus stock take ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async startCounting(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.stocktake.startCounting(id);
        return { id };
    }
    async saveCounters(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        await this.stocktake.saveCounters(id, data.counters ?? {});
        return { id };
    }
    async advanceToC2(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        await this.stocktake.advanceToC2(id, data.counters ?? {});
        return { id };
    }
    async finishCounting(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        await this.lock.runLocked(shared_1.LOCK_KEYS.stocktake(id), () => this.stocktake.finishCounting(id, data.counters ?? {}), { ttlMs: 60_000 });
        return { id };
    }
    async saveReview(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? '0', 10) || 0;
        await this.stocktake.saveReview(id, data.physicals ?? {});
        return { id };
    }
    async applyAdjustment(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.lock.runLocked(shared_1.LOCK_KEYS.stocktake(id), () => this.stocktake.applyAdjustment(id), { ttlMs: 60_000 });
        await this.activity.log('APPLY_STOCKTAKE_ADJUSTMENT', 'stocktake', 'StockTake', id, null, 'Apply adjustment stock take ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
};
exports.StockTakeActions = StockTakeActions;
exports.StockTakeActions = StockTakeActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [stocktake_service_1.StockTakeService,
        activity_logger_1.ActivityLogger,
        db_service_1.DbService,
        redis_lock_service_1.RedisLockService])
], StockTakeActions);
//# sourceMappingURL=stocktake.actions.js.map