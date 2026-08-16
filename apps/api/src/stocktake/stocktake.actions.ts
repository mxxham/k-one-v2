import { Injectable } from '@nestjs/common';
import { StockTakeService } from './stocktake.service';
import { ActivityLogger } from '../common/activity-logger';
import { RedisLockService } from '../common/redis-lock.service';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';
import { DbService } from '../database/db.service';
import { LOCK_KEYS } from '@k-one/shared';

type Q = Record<string, any>;

@Injectable()
export class StockTakeActions {
  constructor(
    private readonly stocktake: StockTakeService,
    private readonly activity: ActivityLogger,
    private readonly db: DbService,
    private readonly lock: RedisLockService,
  ) {
    registerActions('stocktake', {
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
    setPermission('stocktake', 'create', 'write');
    setPermission('stocktake', 'add_item', 'write');
    setPermission('stocktake', 'auto_load', 'write');
    setPermission('stocktake', 'update', 'write');
    setPermission('stocktake', 'delete_item', 'write');
    setPermission('stocktake', 'delete', 'write');
    setPermission('stocktake', 'start_counting', 'write');
    setPermission('stocktake', 'save_counters', 'write');
    setPermission('stocktake', 'advance_to_c2', 'write');
    setPermission('stocktake', 'finish_counting', 'write');
    setPermission('stocktake', 'save_review', 'write');
    setPermission('stocktake', 'apply_adjustment', 'admin');
    setModuleDepartments('stocktake', ['inventory']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const limit = Number.parseInt(ctx.query.limit ?? '200', 10) || 200;
    const rows = await this.stocktake.getAll(limit);
    for (const r of rows) r.id = Number(r.id);
    return { rows, stats: await this.stocktake.getStats() };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const stockTake = await this.stocktake.getById(id);
    if (!stockTake) throw ApiException.notFound('Stock take tidak ditemukan');
    const items = await this.stocktake.getItems(id);
    for (const it of items) it.id = Number(it.id);
    return {
      stock_take: stockTake,
      items,
      accuracy: await this.stocktake.calculateAccuracy(id),
      locked_locations: await this.stocktake.getActiveLockedLocations(),
    };
  }

  private async stats(_ctx: RequestContext): Promise<Q> {
    return { stats: await this.stocktake.getStats() };
  }

  private async getLocations(_ctx: RequestContext): Promise<Q> {
    const r = await this.db.query(
      `SELECT DISTINCT location FROM stock WHERE location IS NOT NULL AND location != '' AND quantity > 0 ORDER BY location`,
    );
    return { rows: r.rows.map((x) => x.location) };
  }

  private async getScopeLocations(_ctx: RequestContext): Promise<Q> {
    return this.stocktake.getScopeLocations();
  }

  private async getStock(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const location = ctx.query.location ? String(ctx.query.location) : null;
    const batch = ctx.query.batch ? String(ctx.query.batch) : null;
    if (!productId) throw ApiException.badRequest('product_id wajib diisi.');
    return this.stocktake.getStock(productId, location, batch);
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = await this.stocktake.create(data, ctx.user.id);
    const scopeLocs = data.scope_locations;
    if (Array.isArray(scopeLocs) && scopeLocs.length > 0) {
      await this.stocktake.autoLoadByLocations(id, scopeLocs);
    } else if (typeof scopeLocs === 'string' && scopeLocs !== '' && scopeLocs !== '[]') {
      try {
        const parsed = JSON.parse(scopeLocs);
        if (Array.isArray(parsed) && parsed.length > 0) await this.stocktake.autoLoadByLocations(id, parsed);
      } catch {
        /* not a JSON array — ignore */
      }
    } else if (data.auto_load) {
      await this.stocktake.autoLoadByLocations(id, null);
    }
    await this.activity.log('CREATE_STOCKTAKE', 'stocktake', 'StockTake', id, null, 'Buat stock take ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async addItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const stockTakeId = Number.parseInt(data.stock_take_id ?? '0', 10) || 0;
    const item = data.item ?? data;
    const itemId = await this.stocktake.addItemFull(stockTakeId, item);
    return { item_id: itemId };
  }

  private async autoLoad(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const stockTakeId = Number.parseInt(data.stock_take_id ?? ctx.query.stock_take_id ?? '0', 10) || 0;
    const locs = data.locations ?? null;
    await this.stocktake.autoLoadByLocations(stockTakeId, Array.isArray(locs) ? locs : null);
    return { ok: true };
  }

  private async update(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    await this.stocktake.update(id, data);
    return { id };
  }

  private async deleteItem(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const itemId = Number.parseInt(data.item_id ?? ctx.query.item_id ?? '0', 10) || 0;
    await this.db.query('DELETE FROM stock_take_items WHERE id=$1', [itemId]);
    return { item_id: itemId };
  }

  private async delete(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.stocktake.delete(id);
    await this.activity.log('DELETE_STOCKTAKE', 'stocktake', 'StockTake', id, null, 'Hapus stock take ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async startCounting(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.stocktake.startCounting(id);
    return { id };
  }

  private async saveCounters(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    await this.stocktake.saveCounters(id, data.counters ?? {});
    return { id };
  }

  private async advanceToC2(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    await this.stocktake.advanceToC2(id, data.counters ?? {});
    return { id };
  }

  private async finishCounting(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    await this.lock.runLocked(LOCK_KEYS.stocktake(id), () => this.stocktake.finishCounting(id, data.counters ?? {}), { ttlMs: 60_000 });
    return { id };
  }

  private async saveReview(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    await this.stocktake.saveReview(id, data.physicals ?? {});
    return { id };
  }

  private async applyAdjustment(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    await this.lock.runLocked(LOCK_KEYS.stocktake(id), () => this.stocktake.applyAdjustment(id), { ttlMs: 60_000 });
    await this.activity.log('APPLY_STOCKTAKE_ADJUSTMENT', 'stocktake', 'StockTake', id, null, 'Apply adjustment stock take ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }
}
