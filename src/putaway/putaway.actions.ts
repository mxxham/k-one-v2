import { Injectable } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class PutawayActions {
  constructor(
    private readonly putaway: PutawayService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('putaway', {
      recommend: (c) => this.recommend(c),
      validate: (c) => this.validate(c),
      zones: (c) => this.zones(c),
      save_zone: (c) => this.saveZone(c),
      delete_zone: (c) => this.deleteZone(c),
      zone_aisles: (c) => this.zoneAisles(c),
      save_zone_aisle: (c) => this.saveZoneAisle(c),
      delete_zone_aisle: (c) => this.deleteZoneAisle(c),
      uom_limits: (c) => this.uomLimits(c),
      save_uom_limit: (c) => this.saveUomLimit(c),
      product_rules: (c) => this.productRules(c),
      save_product_rule: (c) => this.saveProductRule(c),
      delete_product_rule: (c) => this.deleteProductRule(c),
      aisle_map: (c) => this.aisleMap(c),
      bins: (c) => this.bins(c),
    });
    setPermission('putaway', 'save_zone', 'write');
    setPermission('putaway', 'delete_zone', 'admin');
    setPermission('putaway', 'save_zone_aisle', 'write');
    setPermission('putaway', 'delete_zone_aisle', 'write');
    setPermission('putaway', 'save_uom_limit', 'write');
    setPermission('putaway', 'save_product_rule', 'write');
    setPermission('putaway', 'delete_product_rule', 'write');
    setModuleDepartments('putaway', ['inbound', 'inventory']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async recommend(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    if (!productId) throw ApiException.badRequest('product_id wajib diisi.');
    const quantity = Number(ctx.query.quantity ?? 0);
    if (quantity <= 0) throw ApiException.badRequest('quantity harus lebih dari 0.');
    const result = await this.putaway.recommendLocations({
      product_id: productId,
      quantity,
      uom: ctx.query.uom ? String(ctx.query.uom) : undefined,
      uom_per_pallet: ctx.query.uom_per_pallet ? Number(ctx.query.uom_per_pallet) : undefined,
      prefer_pick: ctx.query.prefer_pick === '1' || ctx.query.prefer_pick === 'true',
      force_level: ctx.query.force_level ? String(ctx.query.force_level) : undefined,
    });
    return result;
  }

  private async validate(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const location = String(ctx.query.location ?? '').trim().toUpperCase();
    const uom = String(ctx.query.uom ?? 'Drum');
    const qty = Number(ctx.query.quantity ?? 0);
    if (!productId || !location) throw ApiException.badRequest('product_id dan location wajib diisi.');
    const result = await this.putaway.validatePlacement(productId, location, qty, uom);
    return { ...result };
  }

  private async zones(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listZones() };
  }

  private async saveZone(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = await this.putaway.saveZone(d);
    await this.activity.log(
      'SAVE_ZONE', 'putaway', 'Zone', id, d.zone_code ?? null,
      `Simpan zone ${d.zone_code ?? ''} (${d.zone_type ?? ''})`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteZone(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteZone(id);
    if (!ok) throw ApiException.notFound('Zone tidak ditemukan.');
    await this.activity.log('DELETE_ZONE', 'putaway', 'Zone', id, null, 'Hapus zone ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async zoneAisles(ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listZoneAisles() };
  }

  private async saveZoneAisle(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = await this.putaway.saveZoneAisle(d);
    await this.activity.log(
      'SAVE_ZONE_AISLE', 'putaway', 'ZoneAisle', id, null,
      `Simpan binding zone ${d.zone_code ?? ''} aisle ${d.aisle ?? ''} (${d.min_level ?? 'A'}–${d.max_level ?? 'E'})`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteZoneAisle(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteZoneAisle(id);
    if (!ok) throw ApiException.notFound('Binding zone-aisle tidak ditemukan.');
    await this.activity.log('DELETE_ZONE_AISLE', 'putaway', 'ZoneAisle', id, null, 'Hapus binding zone-aisle ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async aisleMap(ctx: RequestContext): Promise<Q> {
    const aisle = ctx.query.aisle ? String(ctx.query.aisle).toUpperCase() : null;
    const level = ctx.query.level ? String(ctx.query.level).toUpperCase() : null;
    return await this.putaway.listAisleMap(aisle, level);
  }

  private async bins(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listAllBins() };
  }

  private async uomLimits(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listUomLimits() };
  }

  private async saveUomLimit(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const uomType = await this.putaway.saveUomLimit(d);
    await this.activity.log(
      'SAVE_UOM_LIMIT', 'putaway', 'UomLimit', null, uomType,
      `Simpan batas level UOM ${uomType}`,
      null, null, this.actCtx(ctx),
    );
    return { uom_type: uomType };
  }

  private async productRules(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    return { rows: await this.putaway.listProductRules(productId || null) };
  }

  private async saveProductRule(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const productId = await this.putaway.saveProductRule(d);
    await this.activity.log(
      'SAVE_PRODUCT_PUTAWAY_RULE', 'putaway', 'ProductPutawayRule', productId, null,
      `Simpan aturan putaway produk #${productId}`,
      null, null, this.actCtx(ctx),
    );
    return { product_id: productId };
  }

  private async deleteProductRule(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const productId = Number.parseInt(d.product_id ?? ctx.query.product_id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteProductRule(productId);
    if (!ok) throw ApiException.notFound('Aturan produk tidak ditemukan.');
    await this.activity.log('DELETE_PRODUCT_PUTAWAY_RULE', 'putaway', 'ProductPutawayRule', productId, null, 'Hapus aturan putaway produk #' + productId, null, null, this.actCtx(ctx));
    return { product_id: productId };
  }
}