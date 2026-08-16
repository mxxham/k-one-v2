import { Injectable } from '@nestjs/common';
import { ReplenishmentService } from './replenishment.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class ReplenishmentActions {
  constructor(
    private readonly replenishment: ReplenishmentService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('replenishment', {
      list: (c) => this.list(c),
      targets: (c) => this.targets(c),
      save_target: (c) => this.saveTarget(c),
      delete_target: (c) => this.deleteTarget(c),
      detect: (c) => this.detect(c),
      suggest: (c) => this.suggest(c),
      generate: (c) => this.generate(c),
      for_demand: (c) => this.forDemand(c),
    });
    setPermission('replenishment', 'save_target', 'write');
    setPermission('replenishment', 'delete_target', 'write');
    setPermission('replenishment', 'generate', 'write');
    setPermission('replenishment', 'for_demand', 'write');
    setModuleDepartments('replenishment', ['inventory']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(_ctx: RequestContext): Promise<Q> {
    return { suggestions: await this.replenishment.listSuggestions() };
  }

  private async detect(_ctx: RequestContext): Promise<Q> {
    return { shortages: await this.replenishment.detectShortages() };
  }

  private async suggest(_ctx: RequestContext): Promise<Q> {
    return await this.replenishment.suggestTransfers();
  }

  private async generate(ctx: RequestContext): Promise<Q> {
    const result = await this.replenishment.generateTransfers(ctx.user.id);
    await this.activity.log(
      'GENERATE_REPLENISHMENT', 'replenishment', 'Replenishment', null, null,
      `Generate replenishment: ${result.generated.length} transfer dibuat, ${result.insufficient.length} stok kurang, ${result.skipped.length} skip`,
      null, null, this.actCtx(ctx),
    );
    return result;
  }

  private async forDemand(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const productId = Number.parseInt(d.product_id ?? '0', 10) || 0;
    const demandQty = Number(d.quantity ?? 0);
    if (!productId) throw ApiException.badRequest('product_id wajib diisi.');
    if (!isFinite(demandQty) || demandQty <= 0) throw ApiException.badRequest('quantity harus lebih dari 0.');
    const create = d.create_transfer === true || d.create_transfer === '1' || d.create_transfer === 'true';
    const result = await this.replenishment.demandReplenishment(ctx.user.id, productId, demandQty, create);
    if (create && result.transfer_id) {
      await this.activity.log(
        'DEMAND_REPLENISHMENT', 'replenishment', 'Replenishment', result.transfer_id, null,
        `Replenishment demand produk #${productId} ${demandQty} (pick ${result.pick_available}, shortage ${result.shortage}, transfer ${result.transfer_number})`,
        null, null, this.actCtx(ctx),
      );
    }
    return result;
  }

  private async targets(_ctx: RequestContext): Promise<Q> {
    return { targets: await this.replenishment.listTargets() };
  }

  private async saveTarget(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const locationId = Number.parseInt(d.location_id ?? '0', 10) || 0;
    const productId = Number.parseInt(d.product_id ?? '0', 10) || 0;
    const minQty = Number(d.min_qty ?? 0);
    const maxQty = Number(d.max_qty ?? 0);
    if (!locationId || !(await this.replenishment.locationExists(locationId))) {
      throw ApiException.badRequest('Lokasi tidak ditemukan.');
    }
    if (!productId || !(await this.replenishment.productExists(productId))) {
      throw ApiException.badRequest('Produk tidak ditemukan.');
    }
    if (!isFinite(minQty) || minQty < 0 || !isFinite(maxQty) || maxQty < 0) {
      throw ApiException.badRequest('min_qty dan max_qty harus angka >= 0.');
    }
    if (maxQty > 0 && maxQty < minQty) {
      throw ApiException.badRequest('max_qty tidak boleh lebih kecil dari min_qty.');
    }
    const id = await this.replenishment.saveTarget(locationId, productId, minQty, maxQty);
    await this.activity.log(
      'SAVE_PICK_FACE_TARGET', 'replenishment', 'Replenishment', id, null,
      `Simpan target pick-face lokasi #${locationId} produk #${productId} (min ${minQty}, max ${maxQty})`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteTarget(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    const ok = await this.replenishment.deleteTarget(id);
    if (!ok) throw ApiException.notFound('Target tidak ditemukan');
    await this.activity.log('DELETE_PICK_FACE_TARGET', 'replenishment', 'Replenishment', id, null, 'Hapus target pick-face ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }
}