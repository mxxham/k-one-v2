import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';
import { deriveUppFromPackSize, palletFunctionFor, isFullPallet } from '../common/pallet';
import { insertStockLocation } from '../common/stock-locations';
import { generateNumber, DbLike } from '../common/number-gen';
import { todayCompact } from '../common/date-util';
import { LpnLabelData } from './label-printer.service';

const SPECIAL_LOCS = ['QUA_SHELL', 'STAGING', 'UNALLOCATED'];
const LEVEL_HEIGHT: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
const RESERVE_LEVELS = ['B', 'C', 'D', 'E'];
const PICK_LEVEL = 'A';
/** Stock UOM aliases → canonical uom_physical_limits key. */
const UOM_ALIAS: Record<string, string> = { CAR: 'Carton' };

export interface PutawayRequest {
  product_id: number;
  quantity: number;
  uom?: string;
  uom_per_pallet?: number;
  /** Reserve one pick-face slot (top up / keep a pick pallet at Level A). */
  prefer_pick?: boolean;
  /** Force the remainder (partial pallet) to a specific level. */
  force_level?: string;
}

export interface PalletPlacement {
  pallet_seq: number;
  quantity: number;
  is_full: boolean;
  location_code: string;
  zone_code: string | null;
  level: string;
  reason: string;
}

interface UomLimit {
  min_level: string;
  max_level: string;
  allow_pick_face: number;
  max_weight_kg: number | null;
  max_height_cm: number | null;
  requires_equipment: number;
}

interface PutawayRule {
  preferred_zone_code: string;
  max_level: string | null;
  allow_pick_face: number | null;
  full_pallet_to_pick: number;
  min_pick_face_qty: number;
  max_pick_face_qty: number;
  consolidate: number;
}

interface BlockRow {
  id: number;
  scope_type: 'aisle' | 'location';
  aisle_prefix: string | null;
  location_code: string | null;
  reason: string;
}

@Injectable()
export class PutawayService {
  constructor(private readonly db: DbService) {}

  private levelHeight(level: string): number {
    return LEVEL_HEIGHT[level?.toUpperCase()] ?? 0;
  }

  // --------------------------------------------------------------------------
  // Core recommendation
  // --------------------------------------------------------------------------

  /**
   * Zone- and UOM-aware putaway recommendation.
   *
   * Strategy:
   *  - Full pallets  -> reserve/bulk tiers (B–E) within the UOM max level.
   *  - Remainder     -> pick-fast Level A (if the UOM allows a pick face).
   *  - prefer_pick / full_pallet_to_pick keeps a full pallet at Level A.
   *  - Locations are scored by zone priority, same-rack clustering (if the
   *    product rule says consolidate), and level accessibility.
   */
  async recommendLocations(req: PutawayRequest): Promise<{
    success: boolean;
    message: string;
    product: Record<string, any> | null;
    uom: string;
    uom_per_pallet: number;
    limits: UomLimit | null;
    rule: PutawayRule | null;
    total_pallets: number;
    pallets: PalletPlacement[];
  }> {
    const product = await this.getProduct(req.product_id);
    if (!product) throw ApiException.notFound('Produk tidak ditemukan.');
    const blocks = await this.activeBlocks();
    const uom = (req.uom ?? product.uom_type ?? 'Drum').toUpperCase();
    const derivedUpp = deriveUppFromPackSize(product.product_name);
    const storedUpp = Math.max(1, Number(product.uom_per_pallet ?? 4) || 4);
    const upp = Math.max(1, Number(req.uom_per_pallet ?? derivedUpp ?? storedUpp) || 4);

    const limits = await this.getUomLimit(uom);
    const rule = await this.getPutawayRule(req.product_id);
    const maxLevel = this.effectiveMaxLevel(rule, limits);
    const allowPick = (rule?.allow_pick_face ?? limits.allow_pick_face) === 1;
    const qty = Math.max(0, Number(req.quantity || 0));
    const fullPallets = Math.floor(qty / upp);
    const remainder = Math.round((qty % upp) * 100) / 100;
    const totalPallets = fullPallets + (remainder > 0 ? 1 : 0);

    // Allowed reserve levels for this UOM (never above the UOM/rack max level,
    // never the quarantine/staging virtual locations).
    let reserveLevels = RESERVE_LEVELS.filter((l) => this.levelHeight(l) <= this.levelHeight(maxLevel));
    const pickAllowed = allowPick && this.levelHeight(PICK_LEVEL) >= this.levelHeight(limits.min_level);

    // Aisle-level zone bindings: a zone owns specific aisle+level ranges
    // (zone_aisles). When configured, putaway is restricted to those racks.
    const reserveZone = (rule?.preferred_zone_code ?? 'RESERVE').toUpperCase();
    const reserveBindings = await this.zoneBindings(reserveZone);
    const reserveZones: string[] = [];
    if (reserveBindings.length > 0) {
      const lvSet = new Set<string>();
      for (const b of reserveBindings) {
        const lo = this.levelHeight(b.min_level);
        const hi = this.levelHeight(b.max_level);
        for (const l of reserveLevels) {
          const h = this.levelHeight(l);
          if (h >= lo && h <= hi) lvSet.add(l);
        }
      }
      if (lvSet.size > 0) reserveLevels = [...lvSet];
      reserveZones.push(reserveZone);
    }

    const pickBindings = await this.zoneBindings('PICK_FAST');
    const pickZones: string[] = pickBindings.length > 0 ? ['PICK_FAST'] : [];

    // Existing same-SKU racks, used for consolidation ordering.
    const existingRacks = rule?.consolidate === 1 ? await this.getExistingRacks(req.product_id) : [];

    const placements: PalletPlacement[] = [];
    let seq = 1;

    // 1) Full pallets -> reserve. If a pick face is requested and no current
    //    pick stock exists, hold one full pallet at Level A.
    let fullToReserve = fullPallets;
    if (pickAllowed && (req.prefer_pick || rule?.full_pallet_to_pick === 1) && fullPallets > 0) {
      const pickQty = await this.currentPickQty(req.product_id);
      if (pickQty < Number(rule?.min_pick_face_qty ?? 0)) {
        const slots = await this.findAvailable({ levels: [PICK_LEVEL], limit: 1, existingRacks, zones: pickZones, heavyOnly: limits.requires_equipment === 1, blocks });
        const slot = slots[0];
        if (slot) {
          placements.push({ pallet_seq: seq++, quantity: upp, is_full: true, location_code: slot.location_code, zone_code: slot.zone_code, level: PICK_LEVEL, reason: 'PICK_FACE_FULL' });
          fullToReserve -= 1;
        }
      }
    }

    if (fullToReserve > 0) {
      const slots = await this.findAvailable({ levels: reserveLevels, limit: fullToReserve, existingRacks, zones: reserveZones, blocks });
      for (let i = 0; i < fullToReserve; i++) {
        const s = slots[i];
        if (!s) break;
        placements.push({ pallet_seq: seq++, quantity: upp, is_full: true, location_code: s.location_code, zone_code: s.zone_code, level: s.level, reason: 'RESERVE_FULL' });
      }
    }

    // 2) Remainder / partial pallet (qty not reaching max SKU) -> pick face
    //    (Level A). Per business rule, anything not reaching the max SKU qty
    //    automatically becomes PICK_FAST; only full pallets go to bulk/reserve.
    if (remainder > 0) {
      const targetLevel = req.force_level?.toUpperCase() ?? PICK_LEVEL;
      const targetZones = targetLevel === PICK_LEVEL ? pickZones : reserveZones;
      const slots = await this.findAvailable({ levels: [targetLevel], limit: 1, existingRacks, zones: targetZones, heavyOnly: limits.requires_equipment === 1, blocks });
      const slot = slots[0];
      if (slot) {
        placements.push({ pallet_seq: seq++, quantity: remainder, is_full: false, location_code: slot.location_code, zone_code: slot.zone_code, level: slot.level, reason: 'PICK_FACE_REMAINDER' });
      } else {
        placements.push({ pallet_seq: seq++, quantity: remainder, is_full: false, location_code: 'STAGING', zone_code: 'STAGING', level: '-', reason: 'NO_SLOT_STAGING' });
      }
    }

    const unassignedFull = Math.max(0, fullToReserve - placements.filter((p) => p.reason === 'RESERVE_FULL').length);
    const success = unassignedFull === 0 && (remainder === 0 || placements.some((p) => p.reason === 'PICK_FACE_REMAINDER'));

    return {
      success,
      message: success ? '' : `Hanya ${fullPallets - unassignedFull}/${fullPallets} lokasi full pallet tersedia di level ${reserveLevels.join('/')} — sisa diarahkan ke staging.`,
      product,
      uom,
      uom_per_pallet: upp,
      limits,
      rule,
      total_pallets: placements.length,
      pallets: placements,
    };
  }

  /**
   * Validate a proposed placement against zone / UOM / level rules.
   * Used by inbound putaway confirmation and manual moves.
   */
  async validatePlacement(productId: number, locationCode: string, qty: number, uom: string): Promise<{ valid: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const code = String(locationCode ?? '').trim().toUpperCase();
    if (SPECIAL_LOCS.includes(code)) {
      return { valid: true, reasons: ['Virtual location — rule checks skipped.'] };
    }

    // Manual-save safety net: reject saves into an active putaway block, same
    // as the recommend engine excludes those bins. Keeps manual saves from
    // bypassing an aisle/bin that an admin explicitly blocked.
    const blocks = await this.activeBlocks();
    const hit = this.blockHit(blocks, code);
    if (hit.blocked) {
      return { valid: false, reasons: [`Lokasi ${code} diblokir untuk putaway: ${hit.reason ?? ''}`.trim()] };
    }

    const loc = await this.getLocation(code);
    if (!loc || Number(loc.is_active) !== 1) {
      return { valid: false, reasons: [`Lokasi '${code}' tidak ditemukan / nonaktif.`] };
    }
    const level = (loc.row_name ?? loc.level ?? '').toUpperCase();
    if (!level) {
      return { valid: false, reasons: [`Lokasi '${code}' tidak memiliki level.`] };
    }

    const product = await this.getProduct(productId);
    if (!product) return { valid: false, reasons: ['Produk tidak ditemukan.'] };
    const uomType = (uom ?? product.uom_type ?? 'Drum').toUpperCase();
    const limits = await this.getUomLimit(uomType);
    const rule = await this.getPutawayRule(productId);
    const maxLevel = this.effectiveMaxLevel(rule, limits);

    if (this.levelHeight(level) > this.levelHeight(maxLevel)) {
      reasons.push(`UOM ${uomType} tidak boleh melebihi level ${maxLevel} (lokasi berada di level ${level}).`);
    }
    if (this.levelHeight(level) < this.levelHeight(limits.min_level)) {
      reasons.push(`UOM ${uomType} tidak boleh di bawah level ${limits.min_level}.`);
    }
    if (level === PICK_LEVEL && (rule?.allow_pick_face ?? limits.allow_pick_face) === 0) {
      reasons.push(`UOM ${uomType} tidak diizinkan di pick-face (Level A).`);
    }
    if (limits.requires_equipment === 1 && this.levelHeight(level) >= 4 && Number(loc.equipment_accessible) !== 1) {
      reasons.push(`UOM ${uomType} memerlukan heavy equipment — level ${level} (D/E) hanya boleh dipakai jika lokasi ditandai 'akses alat berat'.`);
    }
    if (Number(loc.max_weight_kg) > 0 && Number(limits.max_weight_kg ?? 0) > Number(loc.max_weight_kg)) {
      reasons.push(`Berat pallet (${limits.max_weight_kg} kg) melebihi kapasitas lokasi (${loc.max_weight_kg} kg).`);
    }

    if (reasons.length === 0) return { valid: true, reasons };
    return { valid: false, reasons };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private effectiveMaxLevel(rule: PutawayRule | null, limits: UomLimit | null): string {
    const rl = rule?.max_level;
    if (rl && LEVEL_HEIGHT[rl]) return rl.toUpperCase();
    return (limits?.max_level ?? 'E').toUpperCase();
  }

  private async getProduct(productId: number): Promise<Record<string, any> | null> {
    const r = await this.db.query(
      'SELECT id, product_code, product_name, uom_type, uom_per_pallet FROM products WHERE id = $1',
      [productId],
    );
    return r.rows[0] ?? null;
  }

  private async getLocation(code: string): Promise<Record<string, any> | null> {
    const r = await this.db.query('SELECT * FROM location_master WHERE location_code = $1 LIMIT 1', [code]);
    return r.rows[0] ?? null;
  }

  private async getUomLimit(uom: string): Promise<UomLimit> {
    const candidates = [uom, UOM_ALIAS[uom] ?? null].filter(Boolean) as string[];
    for (const c of candidates) {
      const r = await this.db.query('SELECT * FROM uom_physical_limits WHERE UPPER(uom_type) = UPPER($1)', [c]);
      if (r.rows[0]) {
        return {
          min_level: r.rows[0].min_level,
          max_level: r.rows[0].max_level,
          allow_pick_face: Number(r.rows[0].allow_pick_face),
          max_weight_kg: r.rows[0].max_weight_kg == null ? null : Number(r.rows[0].max_weight_kg),
          max_height_cm: r.rows[0].max_height_cm == null ? null : Number(r.rows[0].max_height_cm),
          requires_equipment: Number(r.rows[0].requires_equipment),
        };
      }
    }
    return { min_level: 'A', max_level: 'E', allow_pick_face: 1, max_weight_kg: null, max_height_cm: null, requires_equipment: 0 };
  }

  private async getPutawayRule(productId: number): Promise<PutawayRule | null> {
    const r = await this.db.query('SELECT * FROM product_putaway_rules WHERE product_id = $1', [productId]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return {
      preferred_zone_code: row.preferred_zone_code,
      max_level: row.max_level ?? null,
      allow_pick_face: row.allow_pick_face == null ? null : Number(row.allow_pick_face),
      full_pallet_to_pick: Number(row.full_pallet_to_pick),
      min_pick_face_qty: Number(row.min_pick_face_qty),
      max_pick_face_qty: Number(row.max_pick_face_qty),
      consolidate: Number(row.consolidate),
    };
  }

  private async getExistingRacks(productId: number): Promise<string[]> {
    const r = await this.db.query(
      `SELECT DISTINCT lm.rack
       FROM stock_locations sl
       JOIN stock s ON s.id = sl.stock_id
       JOIN location_master lm ON lm.location_code = sl.location_code
       WHERE s.product_id = $1 AND sl.status IN ('Available','Reserved') AND lm.rack IS NOT NULL`,
      [productId],
    );
    return r.rows.map((x) => x.rack);
  }

  private async currentPickQty(productId: number): Promise<number> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(sl.quantity), 0) AS qty
       FROM stock_locations sl
       JOIN stock s ON s.id = sl.stock_id
       JOIN location_master lm ON lm.location_code = sl.location_code
       WHERE s.product_id = $1 AND lm.is_pick_face = 1
         AND sl.status IN ('Available','Reserved')`,
      [productId],
    );
    return Number(r.rows[0].qty ?? 0);
  }

  /**
   * Find free (unoccupied) locations on the requested levels.
   * Ordering: zone priority -> existing-SKU rack clustering -> level asc -> position.
   * Active putaway blocks (aisle prefix / exact bin) are excluded entirely.
   */
  private async findAvailable(opts: {
    levels: string[];
    limit: number;
    existingRacks: string[];
    /** Restrict to locations inside these zone bindings (zone_code or empty = all). */
    zones?: string[];
    /** Only pick locations reachable by heavy equipment (for heavy UOMs). */
    heavyOnly?: boolean;
    /** Active putaway location blocks — blocked bins are never suggested. */
    blocks?: BlockRow[];
  }): Promise<Array<{ location_code: string; zone_code: string | null; level: string }>> {
    const levels = opts.levels;
    if (levels.length === 0 || opts.limit <= 0) return [];
    const params: unknown[] = [];
    const next = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    const levelsPh = levels.map((lv) => next(lv)).join(',');

    const orderClauses: string[] = [];
    if (opts.existingRacks.length > 0) {
      const racksPh = opts.existingRacks.map((rk) => next(rk)).join(',');
      orderClauses.push(`CASE WHEN lm.rack = ANY (ARRAY[${racksPh}]) THEN 0 ELSE 1 END`);
    }
    orderClauses.push(`CASE WHEN lm.row_name = ${next('A')} THEN 0 ELSE 1 END`, 'lm.row_name ASC', 'lm.position ASC');
    const limitPh = next(opts.limit);

    const zoneJoins: string[] = [];
    const zoneWheres: string[] = [];
    if (opts.zones && opts.zones.length > 0) {
      const zonesPh = opts.zones.map((z) => next(z)).join(',');
      // Zone bindings restrict the aisle+level ranges a zone owns. A location
      // qualifies if it matches an active binding for any of the target zones.
      zoneJoins.push(
        `JOIN zone_aisles za ON za.zone_code IN (${zonesPh})
          AND za.is_active = 1
          AND za.aisle = lm.aisle
          AND lm.row_name BETWEEN za.min_level AND za.max_level`,
      );
    }

    // Active putaway blocks: exclude bins whose code starts with a blocked
    // aisle_prefix OR exactly matches a blocked location_code.
    const blockWheres: string[] = [];
    if (opts.blocks && opts.blocks.length > 0) {
      for (const b of opts.blocks) {
        if (b.scope_type === 'aisle' && b.aisle_prefix) {
          const ph = next(b.aisle_prefix + '%');
          blockWheres.push(`lm.location_code NOT LIKE ${ph}`);
        } else if (b.scope_type === 'location' && b.location_code) {
          const ph = next(b.location_code);
          blockWheres.push(`lm.location_code <> ${ph}`);
        }
      }
    }

    const sql = `SELECT lm.location_code,
                        COALESCE(lm.zone_code, lm.zone) AS zone_code,
                        lm.row_name AS level
                 FROM location_master lm
                 LEFT JOIN zones z ON z.zone_code = COALESCE(lm.zone_code, lm.zone) AND z.is_active = 1
                 ${zoneJoins.join('\n')}
                 WHERE lm.is_active = 1
                   AND lm.row_name IN (${levelsPh})
                   ${opts.heavyOnly ? `AND (lm.equipment_accessible = 1 OR lm.row_name IN ('A','B','C'))` : ''}
                   AND lm.location_code NOT IN (
                     SELECT DISTINCT location_code FROM stock_locations WHERE status IN ('Available','Reserved')
                   )
                   ${blockWheres.length > 0 ? 'AND ' + blockWheres.join(' AND ') : ''}
                 ORDER BY z.priority ASC NULLS LAST, ${orderClauses.join(', ')}
                 LIMIT ${limitPh}`;

    const r = await this.db.query(sql, params);
    return r.rows;
  }

  // --------------------------------------------------------------------------
  // Zones CRUD
  // --------------------------------------------------------------------------

  async listZones(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT z.*,
              COUNT(lm.id)::int AS location_count
       FROM zones z
       LEFT JOIN location_master lm ON lm.zone_code = z.zone_code
       GROUP BY z.id
       ORDER BY z.priority ASC, z.zone_code`,
    );
    return r.rows.map((x) => ({ ...x, id: Number(x.id), priority: Number(x.priority), location_count: Number(x.location_count) }));
  }

  async saveZone(data: Record<string, any>): Promise<number> {
    const code = String(data.zone_code ?? '').trim().toUpperCase();
    if (!code) throw ApiException.badRequest('zone_code wajib diisi.');
    const zoneType = String(data.zone_type ?? 'RESERVE').toUpperCase();
    if (!['PICK_FAST', 'RESERVE', 'BULK', 'QUARANTINE', 'STAGING', 'UNALLOCATED'].includes(zoneType)) {
      throw ApiException.badRequest('zone_type tidak valid.');
    }
    const priority = Math.max(0, Number(data.priority ?? 10) || 10);
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (id > 0) {
      const r = await this.db.query(
        `UPDATE zones SET zone_code=$1, zone_name=$2, zone_type=$3, priority=$4, is_active=$5 WHERE id=$6 RETURNING id`,
        [code, String(data.zone_name ?? ''), zoneType, priority, data.is_active !== undefined ? Number(data.is_active) : 1, id],
      );
      if (r.rows.length === 0) throw ApiException.notFound('Zone tidak ditemukan.');
      return Number(r.rows[0].id);
    }
    const ins = await this.db.query(
      `INSERT INTO zones (zone_code, zone_name, zone_type, priority, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [code, String(data.zone_name ?? ''), zoneType, priority, data.is_active !== undefined ? Number(data.is_active) : 1],
    );
    return Number(ins.rows[0].id);
  }

  async deleteZone(id: number): Promise<boolean> {
    const r = await this.db.query('DELETE FROM zones WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // --------------------------------------------------------------------------
  // UOM physical limits CRUD
  // --------------------------------------------------------------------------

  async listUomLimits(): Promise<any[]> {
    const r = await this.db.query('SELECT * FROM uom_physical_limits ORDER BY uom_type');
    return r.rows;
  }

  async saveUomLimit(data: Record<string, any>): Promise<string> {
    const uomType = String(data.uom_type ?? '').trim();
    if (!uomType) throw ApiException.badRequest('uom_type wajib diisi.');
    const minLevel = String(data.min_level ?? 'A').toUpperCase();
    const maxLevel = String(data.max_level ?? 'E').toUpperCase();
    if (!LEVEL_HEIGHT[minLevel] || !LEVEL_HEIGHT[maxLevel]) throw ApiException.badRequest('min_level / max_level tidak valid (A–E).');
    if (LEVEL_HEIGHT[minLevel] > LEVEL_HEIGHT[maxLevel]) throw ApiException.badRequest('min_level tidak boleh lebih tinggi dari max_level.');
    await this.db.query(
      `INSERT INTO uom_physical_limits
         (uom_type, min_level, max_level, allow_pick_face, max_weight_kg, max_height_cm, requires_equipment, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (uom_type) DO UPDATE SET
         min_level=EXCLUDED.min_level, max_level=EXCLUDED.max_level,
         allow_pick_face=EXCLUDED.allow_pick_face, max_weight_kg=EXCLUDED.max_weight_kg,
         max_height_cm=EXCLUDED.max_height_cm, requires_equipment=EXCLUDED.requires_equipment,
         updated_at=NOW()`,
      [
        uomType,
        minLevel,
        maxLevel,
        data.allow_pick_face !== undefined ? Number(data.allow_pick_face) : 1,
        data.max_weight_kg != null && data.max_weight_kg !== '' ? Number(data.max_weight_kg) : null,
        data.max_height_cm != null && data.max_height_cm !== '' ? Number(data.max_height_cm) : null,
        data.requires_equipment !== undefined ? Number(data.requires_equipment) : 0,
      ],
    );
    return uomType;
  }

  // --------------------------------------------------------------------------
  // Product putaway rules CRUD
  // --------------------------------------------------------------------------

  async listProductRules(productId: number | null): Promise<any[]> {
    const params: unknown[] = [];
    let where = '';
    if (productId && productId > 0) {
      params.push(productId);
      where = `WHERE ppr.product_id = $1`;
    }
    const r = await this.db.query(
      `SELECT ppr.*, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet
       FROM product_putaway_rules ppr
       JOIN products p ON p.id = ppr.product_id
       ${where}
       ORDER BY p.product_name`,
      params,
    );
    return r.rows;
  }

  async saveProductRule(data: Record<string, any>): Promise<number> {
    const productId = Number.parseInt(data.product_id ?? '0', 10) || 0;
    if (!productId || !(await this.getProduct(productId))) throw ApiException.badRequest('Produk tidak ditemukan.');
    const maxLevel = data.max_level ? String(data.max_level).toUpperCase() : null;
    if (maxLevel && !LEVEL_HEIGHT[maxLevel]) throw ApiException.badRequest('max_level tidak valid (A–E).');
    await this.db.query(
      `INSERT INTO product_putaway_rules
         (product_id, preferred_zone_code, max_level, allow_pick_face, full_pallet_to_pick,
          min_pick_face_qty, max_pick_face_qty, consolidate, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (product_id) DO UPDATE SET
         preferred_zone_code=EXCLUDED.preferred_zone_code, max_level=EXCLUDED.max_level,
         allow_pick_face=EXCLUDED.allow_pick_face, full_pallet_to_pick=EXCLUDED.full_pallet_to_pick,
         min_pick_face_qty=EXCLUDED.min_pick_face_qty, max_pick_face_qty=EXCLUDED.max_pick_face_qty,
         consolidate=EXCLUDED.consolidate, updated_at=NOW()`,
      [
        productId,
        String(data.preferred_zone_code ?? 'RESERVE').toUpperCase(),
        maxLevel,
        data.allow_pick_face != null && data.allow_pick_face !== '' ? Number(data.allow_pick_face) : null,
        data.full_pallet_to_pick !== undefined ? Number(data.full_pallet_to_pick) : 0,
        Number(data.min_pick_face_qty ?? 0),
        Number(data.max_pick_face_qty ?? 0),
        data.consolidate !== undefined ? Number(data.consolidate) : 1,
      ],
    );
    return productId;
  }

  async deleteProductRule(productId: number): Promise<boolean> {
    const r = await this.db.query('DELETE FROM product_putaway_rules WHERE product_id = $1', [productId]);
    return (r.rowCount ?? 0) > 0;
  }

  // --------------------------------------------------------------------------
  // Zone ↔ aisle/level bindings (aisle-level zoning)
  // --------------------------------------------------------------------------

  /** Active zone_aisles bindings for a zone: which aisle+level ranges it owns. */
  async zoneBindings(zoneCode: string | null): Promise<Array<{ aisle: string; min_level: string; max_level: string }>> {
    if (!zoneCode) return [];
    const r = await this.db.query(
      `SELECT aisle, min_level, max_level FROM zone_aisles WHERE zone_code = $1 AND is_active = 1`,
      [zoneCode],
    );
    return r.rows;
  }

  async listZoneAisles(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT za.*, z.zone_name, z.zone_type
       FROM zone_aisles za
       JOIN zones z ON z.zone_code = za.zone_code
       ORDER BY za.zone_code, za.aisle, za.min_level, za.max_level`,
    );
    return r.rows.map((x) => ({ ...x, id: Number(x.id), is_active: Number(x.is_active) }));
  }

  async saveZoneAisle(data: Record<string, any>): Promise<number> {
    const zoneCode = String(data.zone_code ?? '').trim().toUpperCase();
    const aisle = String(data.aisle ?? '').trim().toUpperCase();
    const minLevel = String(data.min_level ?? 'A').toUpperCase();
    const maxLevel = String(data.max_level ?? 'E').toUpperCase();
    if (!zoneCode) throw ApiException.badRequest('zone_code wajib diisi.');
    if (!aisle) throw ApiException.badRequest('aisle wajib diisi.');
    if (!LEVEL_HEIGHT[minLevel] || !LEVEL_HEIGHT[maxLevel]) throw ApiException.badRequest('min_level / max_level tidak valid (A–E).');
    if (LEVEL_HEIGHT[minLevel] > LEVEL_HEIGHT[maxLevel]) throw ApiException.badRequest('min_level tidak boleh lebih tinggi dari max_level.');
    const z = await this.db.query('SELECT id FROM zones WHERE zone_code = $1 AND is_active = 1', [zoneCode]);
    if (z.rows.length === 0) throw ApiException.badRequest('Zone tidak ditemukan / nonaktif.');
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (id > 0) {
      const r = await this.db.query(
        `UPDATE zone_aisles SET zone_code=$1, aisle=$2, min_level=$3, max_level=$4, is_active=$5 WHERE id=$6 RETURNING id`,
        [zoneCode, aisle, minLevel, maxLevel, data.is_active !== undefined ? Number(data.is_active) : 1, id],
      );
      if (r.rows.length === 0) throw ApiException.notFound('Binding zone-aisle tidak ditemukan.');
      return Number(r.rows[0].id);
    }
    const ins = await this.db.query(
      `INSERT INTO zone_aisles (zone_code, aisle, min_level, max_level, is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (zone_code, aisle, min_level, max_level) DO UPDATE SET is_active = EXCLUDED.is_active
       RETURNING id`,
      [zoneCode, aisle, minLevel, maxLevel, data.is_active !== undefined ? Number(data.is_active) : 1],
    );
    return Number(ins.rows[0].id);
  }

  async deleteZoneAisle(id: number): Promise<boolean> {
    const r = await this.db.query('DELETE FROM zone_aisles WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // --------------------------------------------------------------------------
  // Putaway location blocking (blocked aisles/bins — not to be confused with
  // stock "hold"/quarantine, which is a different concept)
  // --------------------------------------------------------------------------

  /** All active blocks — used by recommend / validate / rack render. */
  private async activeBlocks(): Promise<BlockRow[]> {
    const r = await this.db.query(
      `SELECT id, scope_type, aisle_prefix, location_code, reason
         FROM putaway_location_blocks
        WHERE is_active = TRUE
        ORDER BY id`,
    );
    return r.rows as BlockRow[];
  }

  /**
   * True when a location_code is covered by an active block:
   *  - aisle block: code starts with the aisle_prefix (e.g. 'CF' -> CF*)
   *  - location block: exact match on location_code
   */
  private blockHit(blocks: BlockRow[], code: string | null): { blocked: boolean; reason: string | null } {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c) return { blocked: false, reason: null };
    for (const b of blocks) {
      if (b.scope_type === 'aisle' && b.aisle_prefix && c.startsWith(b.aisle_prefix)) {
        return { blocked: true, reason: b.reason };
      }
      if (b.scope_type === 'location' && b.location_code && c === b.location_code) {
        return { blocked: true, reason: b.reason };
      }
    }
    return { blocked: false, reason: null };
  }

  /** All blocks, most recent first, with the blocking user's name joined. */
  async listBlocks(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT b.*, u.username AS blocked_by_username, u.full_name AS blocked_by_name
         FROM putaway_location_blocks b
         LEFT JOIN users u ON u.id = b.blocked_by
        ORDER BY b.is_active DESC, b.id DESC`,
    );
    return r.rows.map((x) => ({
      ...x,
      id: Number(x.id),
      is_active: Boolean(x.is_active),
      blocked_by: x.blocked_by == null ? null : Number(x.blocked_by),
    }));
  }

  /** Create an active block for an aisle (prefix) or an exact bin. */
  async createBlock(data: Record<string, any>, userId: number): Promise<number> {
    const scopeType = String(data.scope_type ?? '').trim().toLowerCase();
    if (scopeType !== 'aisle' && scopeType !== 'location') {
      throw ApiException.badRequest('scope_type wajib diisi (aisle atau location).');
    }
    const reason = String(data.reason ?? '').trim();
    if (!reason) throw ApiException.badRequest('reason wajib diisi.');

    let aislePrefix: string | null = null;
    let locationCode: string | null = null;
    if (scopeType === 'aisle') {
      aislePrefix = String(data.aisle_prefix ?? '').trim().toUpperCase();
      if (!aislePrefix) throw ApiException.badRequest('aisle_prefix wajib diisi untuk scope aisle.');
      if (aislePrefix.length > 10) throw ApiException.badRequest('aisle_prefix terlalu panjang (maks 10 karakter).');
    } else {
      locationCode = String(data.location_code ?? '').trim().toUpperCase();
      if (!locationCode) throw ApiException.badRequest('location_code wajib diisi untuk scope location.');
      const loc = await this.db.query('SELECT 1 FROM location_master WHERE location_code = $1 AND is_active = 1', [locationCode]);
      if (loc.rows.length === 0) throw ApiException.badRequest(`Lokasi '${locationCode}' tidak ditemukan di master lokasi.`);
    }

    // Reject a duplicate ACTIVE block on the same target. (Partial unique
    // indexes back this up; the query gives a friendlier error message.)
    const dup = await this.db.query(
      `SELECT 1 FROM putaway_location_blocks
        WHERE is_active = TRUE AND scope_type = $1
          AND (($2::text IS NOT NULL AND aisle_prefix = $2) OR ($3::text IS NOT NULL AND location_code = $3))
        LIMIT 1`,
      [scopeType, aislePrefix, locationCode],
    );
    if (dup.rows.length > 0) {
      throw ApiException.conflict(
        scopeType === 'aisle'
          ? `Aisle '${aislePrefix}' sudah diblokir untuk putaway.`
          : `Lokasi '${locationCode}' sudah diblokir untuk putaway.`,
      );
    }

    const ins = await this.db.query(
      `INSERT INTO putaway_location_blocks
         (scope_type, aisle_prefix, location_code, reason, is_active, blocked_by, blocked_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,TRUE,$5,NOW(),NOW(),NOW()) RETURNING id`,
      [scopeType, aislePrefix, locationCode, reason, userId],
    );
    return Number(ins.rows[0].id);
  }

  /** Soft-delete: is_active=false (history is kept, no hard delete). */
  async deactivateBlock(id: number): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE putaway_location_blocks SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id],
    );
    if (r.rows.length === 0) throw ApiException.notFound('Blokir lokasi tidak ditemukan.');
    return true;
  }

  // --------------------------------------------------------------------------
  // Putaway task queue
  // --------------------------------------------------------------------------

  /**
   * Enqueue an item's pallet suggestions into the inbound's putaway task.
   * Creates the task (Pending) when the inbound has none open yet, then appends
   * one row per pallet with the engine's suggested bin. Writes nothing to
   * stock_locations — that happens when the task is completed.
   */
  async enqueueForPutaway(params: {
    itemId: number;
    inboundOrderId: number;
    productId: number;
    userId: number;
    batch: string | null;
    uom: string;
    pallets: Array<{ location_code: string; pallet_seq: number; quantity: number; is_full: boolean; reason?: string | null }>;
    client?: any;
  }): Promise<number> {
    const dbc = params.client ?? this.db;
    const { inboundOrderId, userId, productId, batch, uom, pallets } = params;
    if (pallets.length === 0) return 0;

    const open = await dbc.query(
      `SELECT id FROM putaway_tasks
        WHERE inbound_order_id = $1 AND status IN ('Pending','In Progress')
        ORDER BY id DESC LIMIT 1`,
      [inboundOrderId],
    );
    let taskId = open.rows[0] ? Number(open.rows[0].id) : 0;

    if (!taskId) {
      const taskNumber = await generateNumber(this.db, {
        table: 'putaway_tasks',
        column: 'task_number',
        prefix: `PKA-${todayCompact()}-`,
        searchPrefix: `PKA-${todayCompact()}-`,
        pad: 4,
      });
      const ins = await dbc.query(
        `INSERT INTO putaway_tasks (task_number, inbound_order_id, status, created_by, created_at, updated_at)
         VALUES ($1,$2,'Pending',$3,NOW(),NOW()) RETURNING id`,
        [taskNumber, inboundOrderId, userId || null],
      );
      taskId = Number(ins.rows[0].id);
    }

    for (const p of pallets) {
      const loc = String(p.location_code ?? '').trim().toUpperCase();
      // Unique License Plate Number per pallet, generated at Goods Received so
      // the label can be printed immediately. Runs on the tx client (dbc) so
      // the sequence's existence-check sees this transaction's own inserts.
      const lpn = await generateNumber(dbc as DbLike, {
        table: 'putaway_task_items',
        column: 'lpn_code',
        prefix: `LPN-${todayCompact()}-`,
        searchPrefix: `LPN-${todayCompact()}-`,
        pad: 5,
      });
      await dbc.query(
        `INSERT INTO putaway_task_items
           (task_id, inbound_item_id, product_id, batch_number, uom, pallet_seq, quantity,
            suggested_location, actual_location, pallet_function, reason, lpn_code, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,'Pending')`,
        [taskId, params.itemId, productId, batch, uom, p.pallet_seq, Number(p.quantity ?? 0), loc, palletFunctionFor(loc), p.reason ?? null, lpn],
      );
    }
    return taskId;
  }

  /** Putaway queue: one row per task with pallet counts + assigned/creator. */
  async listTasks(filter: { status?: string | null; search?: string | null; mine?: number | null } = {}): Promise<any[]> {
    const params: unknown[] = [];
    const next = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const status = String(filter.status ?? '').trim() || null;
    const search = String(filter.search ?? '').trim() || null;
    const where: string[] = [];
    if (status) where.push(`t.status = ${next(status)}`);
    if (search) where.push(`(t.task_number ILIKE ${next(`%${search}%`)} OR io.order_number ILIKE ${next(`%${search}%`)})`);
    if (filter.mine) {
      where.push(`(t.assigned_to = ${next(filter.mine)} OR t.forklift_operator_id = ${next(filter.mine)} OR t.checklist_partner_id = ${next(filter.mine)})`);
    }

    const r = await this.db.query(
      `SELECT t.*, io.order_number, io.status AS inbound_status,
              u.username AS assigned_name, cu.username AS created_by_name,
              fu.username AS forklift_operator_name, fu.full_name AS forklift_operator_full_name,
              pu.username AS checklist_partner_name, pu.full_name AS checklist_partner_full_name,
              (SELECT COUNT(*)::int FROM putaway_task_items ti WHERE ti.task_id = t.id) AS pallet_count,
              (SELECT COUNT(*)::int FROM putaway_task_items ti WHERE ti.task_id = t.id AND ti.status = 'Done') AS done_count
         FROM putaway_tasks t
         LEFT JOIN inbound_orders io ON io.id = t.inbound_order_id
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN users cu ON cu.id = t.created_by
         LEFT JOIN users fu ON fu.id = t.forklift_operator_id
         LEFT JOIN users pu ON pu.id = t.checklist_partner_id
        ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (t.status IN ('Pending','In Progress')) DESC, t.created_at DESC`,
      params,
    );
    return r.rows.map((x) => ({
      ...x,
      id: Number(x.id),
      inbound_order_id: x.inbound_order_id == null ? null : Number(x.inbound_order_id),
      assigned_to: x.assigned_to == null ? null : Number(x.assigned_to),
      forklift_operator_id: x.forklift_operator_id == null ? null : Number(x.forklift_operator_id),
      checklist_partner_id: x.checklist_partner_id == null ? null : Number(x.checklist_partner_id),
      created_by: x.created_by == null ? null : Number(x.created_by),
      pallet_count: Number(x.pallet_count ?? 0),
      done_count: Number(x.done_count ?? 0),
    }));
  }

  /** Task header + pallet rows (product info + who completed each pallet). */
  async taskDetail(taskId: number): Promise<{ task: any; rows: any[] }> {
    const t = await this.db.query(
      `SELECT t.*, io.order_number, io.status AS inbound_status,
              u.username AS assigned_name, cu.username AS created_by_name,
              fu.username AS forklift_operator_name, fu.full_name AS forklift_operator_full_name,
              pu.username AS checklist_partner_name, pu.full_name AS checklist_partner_full_name
         FROM putaway_tasks t
         LEFT JOIN inbound_orders io ON io.id = t.inbound_order_id
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN users cu ON cu.id = t.created_by
         LEFT JOIN users fu ON fu.id = t.forklift_operator_id
         LEFT JOIN users pu ON pu.id = t.checklist_partner_id
        WHERE t.id = $1`,
      [taskId],
    );
    const task = t.rows[0];
    if (!task) throw ApiException.notFound('Putaway task tidak ditemukan.');
    const r = await this.db.query(
      `SELECT ti.*, p.product_code, p.product_name, u.username AS completed_by_name
         FROM putaway_task_items ti
         LEFT JOIN products p ON p.id = ti.product_id
         LEFT JOIN users u ON u.id = ti.completed_by
        WHERE ti.task_id = $1
        ORDER BY ti.inbound_item_id, ti.pallet_seq`,
      [taskId],
    );
    return {
      task: {
        ...task,
        id: Number(task.id),
        inbound_order_id: task.inbound_order_id == null ? null : Number(task.inbound_order_id),
        assigned_to: task.assigned_to == null ? null : Number(task.assigned_to),
        forklift_operator_id: task.forklift_operator_id == null ? null : Number(task.forklift_operator_id),
        checklist_partner_id: task.checklist_partner_id == null ? null : Number(task.checklist_partner_id),
        created_by: task.created_by == null ? null : Number(task.created_by),
      },
      rows: r.rows.map((x) => ({
        ...x,
        id: Number(x.id),
        inbound_item_id: x.inbound_item_id == null ? null : Number(x.inbound_item_id),
        product_id: x.product_id == null ? null : Number(x.product_id),
        quantity: Number(x.quantity ?? 0),
        completed_by: x.completed_by == null ? null : Number(x.completed_by),
      })),
    };
  }

  /** Claim a task: assign to an operator and move it to In Progress. */
  async assignTask(taskId: number, userId: number): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE putaway_tasks
          SET assigned_to = $2, status = 'In Progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status IN ('Pending','In Progress') RETURNING id`,
      [taskId, userId],
    );
    if (r.rows.length === 0) throw ApiException.conflict('Task tidak dapat diambil (sudah selesai/dibatalkan).');
    return true;
  }

  /** Change a pallet row's actual bin, re-validating against putaway rules. */
  async updateTaskPallet(rowId: number, location: string): Promise<boolean> {
    const loc = String(location ?? '').trim().toUpperCase();
    if (!loc) throw ApiException.badRequest('location wajib diisi.');
    const row = await this.db.query(
      `SELECT ti.*, t.id AS task_id, t.status AS task_status
         FROM putaway_task_items ti JOIN putaway_tasks t ON t.id = ti.task_id
        WHERE ti.id = $1`,
      [rowId],
    );
    const r = row.rows[0];
    if (!r) throw ApiException.notFound('Pallet task tidak ditemukan.');
    if (r.task_status === 'Completed' || r.task_status === 'Cancelled') {
      throw ApiException.conflict('Task sudah selesai/dibatalkan — pallet tidak dapat diubah.');
    }

    if (!SPECIAL_LOCS.includes(loc)) {
      const val = await this.validatePlacement(
        Number(r.product_id),
        loc,
        Number(r.quantity),
        String(r.uom || 'Drum'),
      );
      if (!val.valid) throw ApiException.badRequest(val.reasons.join(' | '));
    }
    await this.db.query(
      `UPDATE putaway_task_items SET actual_location = $2, updated_at = NOW() WHERE id = $1`,
      [rowId, loc],
    );
    return true;
  }

  /** Mark one pallet row Done (operator physically put it away). */
  async completeTaskPallet(rowId: number, userId: number): Promise<boolean> {
    // Confirming without overriding the bin = put it in the suggested location.
    const r = await this.db.query(
      `UPDATE putaway_task_items ti
          SET status = 'Done', actual_location = COALESCE(ti.actual_location, ti.suggested_location),
              completed_by = $2, completed_at = NOW(), updated_at = NOW()
         FROM putaway_tasks t
        WHERE ti.id = $1 AND t.id = ti.task_id AND t.status IN ('Pending','In Progress')
          AND ti.status = 'Pending'
        RETURNING ti.id, ti.task_id`,
      [rowId, userId],
    );
    if (r.rows.length === 0) throw ApiException.conflict('Pallet tidak dapat ditandai (sudah selesai atau task tidak aktif).');
    await this.db.query(
      `UPDATE putaway_tasks SET status = 'In Progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [Number(r.rows[0].task_id)],
    );
    return true;
  }

  /**
   * Finish the task: write every Done pallet into stock_locations (shared
   * insertStockLocation — same pallet_function derivation as everywhere else),
   * then mark the task Completed with labour fields. All rows must be Done.
   */
  async completeTask(taskId: number, userId: number): Promise<{ task_number: string; pallets: number; quantity: number }> {
    const t = await this.db.query(`SELECT * FROM putaway_tasks WHERE id = $1`, [taskId]);
    const task = t.rows[0];
    if (!task) throw ApiException.notFound('Putaway task tidak ditemukan.');
    if (task.status === 'Completed') return { task_number: task.task_number, pallets: 0, quantity: 0 };
    if (task.status === 'Cancelled') throw ApiException.conflict('Task sudah dibatalkan.');

    const pending = await this.db.query(
      `SELECT COUNT(*)::int AS c FROM putaway_task_items WHERE task_id = $1 AND status = 'Pending'`,
      [taskId],
    );
    if (Number(pending.rows[0].c ?? 0) > 0) {
      throw ApiException.conflict(
        `Task ${task.task_number} masih memiliki ${pending.rows[0].c} pallet Pending. Tandai semua pallet selesai terlebih dahulu.`,
      );
    }

    const done = await this.db.query(
      `SELECT ti.inbound_item_id, ti.product_id, ti.batch_number, ti.uom, ti.pallet_seq,
              ti.quantity, ti.actual_location, p.uom_per_pallet
         FROM putaway_task_items ti
         LEFT JOIN products p ON p.id = ti.product_id
        WHERE ti.task_id = $1 AND ti.status = 'Done' AND ti.actual_location IS NOT NULL`,
      [taskId],
    );

    await this.db.transaction(async (client) => {
      let quantity = 0;
      for (const row of done.rows) {
        const qty = Number(row.quantity ?? 0);
        const upp = Number(row.uom_per_pallet ?? 4);
        await insertStockLocation(client, {
          stock_id: null,
          location_code: row.actual_location,
          pallet_seq: Number(row.pallet_seq ?? 1),
          quantity: qty,
          original_quantity: qty,
          uom: row.uom ?? 'Drum',
          is_full_pallet: isFullPallet(qty, upp),
          batch_number: row.batch_number ?? null,
          inbound_item_id: row.inbound_item_id == null ? null : Number(row.inbound_item_id),
        });
        quantity += qty;
      }
      await client.query(
        `UPDATE putaway_tasks SET status='Completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [taskId],
      );
    });

    return { task_number: task.task_number, pallets: done.rows.length, quantity: done.rows.reduce((a: number, r: any) => a + Number(r.quantity ?? 0), 0) };
  }

  /** Cancel a Pending/In Progress task (marks its open rows Cancelled). */
  async cancelTask(taskId: number, userId: number): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE putaway_tasks SET status='Cancelled', cancelled_at=NOW(), cancelled_by=$2, updated_at=NOW()
        WHERE id=$1 AND status IN ('Pending','In Progress') RETURNING id`,
      [taskId, userId],
    );
    if (r.rows.length === 0) throw ApiException.conflict('Task tidak dapat dibatalkan.');
    await this.db.query(
      `UPDATE putaway_task_items SET status='Cancelled', updated_at=NOW() WHERE task_id=$1 AND status='Pending'`,
      [taskId],
    );
    return true;
  }

  // --------------------------------------------------------------------------
  // Two-person team assignment + LPN labels + mobile task view
  // --------------------------------------------------------------------------

  /** Active users for the forklift-operator / checklist-partner pickers. */
  async listAssignableUsers(): Promise<Array<{ id: number; username: string; full_name: string; department: string; role: string }>> {
    const r = await this.db.query(
      `SELECT id, username, full_name, department, role FROM users WHERE is_active = 1 ORDER BY full_name`,
    );
    return r.rows.map((u) => ({ ...u, id: Number(u.id) }));
  }

  /**
   * Assign the 2-person putaway team (forklift operator + checklist partner).
   * Also moves a Pending task to In Progress + stamps started_at (mirrors the
   * S42 claim behaviour). Both users must exist AND be active.
   */
  async assignTeam(taskId: number, forkliftOperatorId: number, checklistPartnerId: number): Promise<boolean> {
    if (!forkliftOperatorId || !checklistPartnerId) {
      throw ApiException.badRequest('forklift_operator_id dan checklist_partner_id wajib diisi.');
    }
    if (forkliftOperatorId === checklistPartnerId) {
      throw ApiException.badRequest('Forklift operator dan checklist partner tidak boleh orang yang sama.');
    }
    const r = await this.db.query(
      `SELECT id, is_active FROM users WHERE id = ANY ($1::bigint[])`,
      [[forkliftOperatorId, checklistPartnerId]],
    );
    const active = new Set<number>(r.rows.filter((u) => Number(u.is_active) === 1).map((u) => Number(u.id)));
    const missing = [forkliftOperatorId, checklistPartnerId].filter((id) => !active.has(id));
    if (missing.length > 0) {
      throw ApiException.badRequest('User yang dipilih tidak ditemukan / tidak aktif.');
    }
    const upd = await this.db.query(
      `UPDATE putaway_tasks
          SET forklift_operator_id = $2, checklist_partner_id = $3,
              status = CASE WHEN status = 'Pending' THEN 'In Progress' ELSE status END,
              started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status IN ('Pending','In Progress') RETURNING id`,
      [taskId, forkliftOperatorId, checklistPartnerId],
    );
    if (upd.rows.length === 0) throw ApiException.conflict('Task tidak dapat ditugaskan (sudah selesai/dibatalkan).');
    return true;
  }

  /** Clear the team off an open task (both team columns back to NULL). */
  async unassignTeam(taskId: number): Promise<boolean> {
    const upd = await this.db.query(
      `UPDATE putaway_tasks SET forklift_operator_id = NULL, checklist_partner_id = NULL, updated_at = NOW()
        WHERE id = $1 AND status IN ('Pending','In Progress') RETURNING id`,
      [taskId],
    );
    if (upd.rows.length === 0) throw ApiException.conflict('Task tidak dapat di-unassign (sudah selesai/dibatalkan).');
    return true;
  }

  /**
   * The inbound detail screen's view of the open putaway task for an inbound
   * order (Pending / In Progress — per-inbound granularity so there is one).
   * Returns the task header (team + counts) and its pallet rows (LPN, product,
   * suggested bin, status) so receiving staff can print labels and assign the
   * forklift operator / checklist partner right from the inbound screen.
   */
  async getInboundOpenTask(
    inboundOrderId: number,
  ): Promise<{ task: Record<string, any>; rows: Array<Record<string, any>> } | null> {
    const t = await this.db.query(
      `SELECT t.id, t.task_number, t.status, t.priority, t.assigned_to, a.full_name AS assigned_name,
              t.forklift_operator_id, fo.full_name AS forklift_operator_name,
              t.checklist_partner_id, cp.full_name AS checklist_partner_name,
              COUNT(ti.id)::int AS pallet_count,
              COUNT(*) FILTER (WHERE ti.status = 'Done')::int AS done_count
         FROM putaway_tasks t
         LEFT JOIN users a ON a.id = t.assigned_to
         LEFT JOIN users fo ON fo.id = t.forklift_operator_id
         LEFT JOIN users cp ON cp.id = t.checklist_partner_id
         LEFT JOIN putaway_task_items ti ON ti.task_id = t.id
        WHERE t.inbound_order_id = $1 AND t.status IN ('Pending','In Progress')
        GROUP BY t.id, a.full_name, fo.full_name, cp.full_name
        ORDER BY t.id DESC
        LIMIT 1`,
      [inboundOrderId],
    );
    if (t.rows.length === 0) return null;
    const task = t.rows[0];
    const r = await this.db.query(
      `SELECT ti.id, ti.inbound_item_id, ti.product_id, p.product_code, p.product_name,
              ti.batch_number, ti.uom, ti.pallet_seq, ti.quantity, ti.suggested_location,
              ti.actual_location, ti.status, ti.lpn_code
         FROM putaway_task_items ti
         LEFT JOIN products p ON p.id = ti.product_id
        WHERE ti.task_id = $1
        ORDER BY ti.pallet_seq`,
      [Number(task.id)],
    );
    return {
      task: {
        ...task,
        id: Number(task.id),
        assigned_to: task.assigned_to != null ? Number(task.assigned_to) : null,
        forklift_operator_id: task.forklift_operator_id != null ? Number(task.forklift_operator_id) : null,
        checklist_partner_id: task.checklist_partner_id != null ? Number(task.checklist_partner_id) : null,
      },
      rows: r.rows.map((x) => ({
        ...x,
        id: Number(x.id),
        inbound_item_id: x.inbound_item_id != null ? Number(x.inbound_item_id) : null,
        product_id: x.product_id != null ? Number(x.product_id) : null,
      })),
    };
  }

  /** Everything the browser needs to render an LPN label for one pallet row. */
  async getLpnLabelData(rowId: number): Promise<LpnLabelData> {
    const r = await this.db.query(
      `SELECT ti.lpn_code, ti.product_id, ti.batch_number, ti.uom, ti.pallet_seq, ti.quantity,
              ti.suggested_location, t.task_number, io.order_number,
              p.product_code, p.product_name, to_char(ii.exp_date, 'YYYY-MM-DD') AS exp_date
         FROM putaway_task_items ti
         JOIN putaway_tasks t ON t.id = ti.task_id
         LEFT JOIN inbound_orders io ON io.id = t.inbound_order_id
         LEFT JOIN products p ON p.id = ti.product_id
         LEFT JOIN inbound_items ii ON ii.id = ti.inbound_item_id
        WHERE ti.id = $1`,
      [rowId],
    );
    const row = r.rows[0];
    if (!row) throw ApiException.notFound('Pallet task tidak ditemukan.');
    if (!row.lpn_code) throw ApiException.conflict('Pallet ini belum memiliki LPN.');
    return {
      lpn_code: row.lpn_code,
      product_code: row.product_code ?? null,
      product_name: row.product_name ?? null,
      batch_number: row.batch_number ?? null,
      uom: row.uom ?? null,
      quantity: Number(row.quantity ?? 0),
      pallet_seq: Number(row.pallet_seq ?? 1),
      suggested_location: row.suggested_location ?? null,
      expiry_date: row.exp_date ? String(row.exp_date).slice(0, 10) : null,
      task_number: row.task_number ?? null,
      order_number: row.order_number ?? null,
    };
  }

  /**
   * The checklist partner's own open tasks (Pending/In Progress) with their
   * pallet rows — LPN, target bin, product info — so the mobile dual-scan
   * screen needs a single action call. Open to any authenticated user (the
   * gateway lifts the module department restriction for this action).
   */
  async myTasks(userId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT t.id AS task_id, t.task_number, t.inbound_order_id, t.status, t.priority, t.created_at,
              io.order_number, fu.username AS forklift_operator_name,
              ti.id AS row_id, ti.lpn_code, ti.product_id, ti.batch_number, ti.uom, ti.pallet_seq,
              ti.quantity, ti.suggested_location, ti.actual_location, ti.status AS row_status,
              p.product_code, p.product_name
         FROM putaway_tasks t
         JOIN inbound_orders io ON io.id = t.inbound_order_id
         LEFT JOIN users fu ON fu.id = t.forklift_operator_id
         LEFT JOIN putaway_task_items ti ON ti.task_id = t.id
         LEFT JOIN products p ON p.id = ti.product_id
        WHERE t.checklist_partner_id = $1 AND t.status IN ('Pending','In Progress')
        ORDER BY (t.status = 'In Progress') DESC, t.created_at DESC, ti.pallet_seq`,
      [userId],
    );
    const map = new Map<number, any>();
    for (const row of r.rows) {
      const taskId = Number(row.task_id);
      let task = map.get(taskId);
      if (!task) {
        task = {
          id: taskId,
          task_number: row.task_number,
          inbound_order_id: row.inbound_order_id == null ? null : Number(row.inbound_order_id),
          order_number: row.order_number,
          status: row.status,
          forklift_operator_name: row.forklift_operator_name ?? null,
          rows: [],
        };
        map.set(taskId, task);
      }
      if (row.row_id != null) {
        task.rows.push({
          id: Number(row.row_id),
          lpn_code: row.lpn_code ?? null,
          product_id: row.product_id == null ? null : Number(row.product_id),
          product_code: row.product_code ?? null,
          product_name: row.product_name ?? null,
          batch_number: row.batch_number ?? null,
          uom: row.uom ?? null,
          pallet_seq: Number(row.pallet_seq ?? 1),
          quantity: Number(row.quantity ?? 0),
          suggested_location: row.suggested_location ?? null,
          actual_location: row.actual_location ?? null,
          status: row.row_status,
        });
      }
    }
    return [...map.values()];
  }

  /** Open tasks (Pending/In Progress with Pending pallets) for an inbound — gates completion. */
  async openTaskNumbers(inboundOrderId: number): Promise<string[]> {
    const r = await this.db.query(
      `SELECT t.task_number
         FROM putaway_tasks t JOIN putaway_task_items ti ON ti.task_id = t.id
        WHERE t.inbound_order_id = $1 AND t.status IN ('Pending','In Progress') AND ti.status = 'Pending'
        GROUP BY t.task_number`,
      [inboundOrderId],
    );
    return r.rows.map((x) => x.task_number);
  }

  /** Mark an item's open task rows Done (manual Manage Pallet Locations path). */
  async reconcileItemRows(itemId: number, userId: number): Promise<void> {
    await this.db.query(
      `UPDATE putaway_task_items ti
          SET status='Done', completed_by=$2, completed_at=NOW(), updated_at=NOW()
         FROM putaway_tasks t
        WHERE ti.inbound_item_id = $1 AND ti.status = 'Pending'
          AND t.id = ti.task_id AND t.status IN ('Pending','In Progress')`,
      [itemId, userId],
    );
  }

  // --------------------------------------------------------------------------
  // Rack map (2D summary) + full bin list (for the 3D render)
  // --------------------------------------------------------------------------

  /** Per-aisle × per-level occupancy summary for the 2D rack map. */
  async listAisleMap(aisle?: string | null, level?: string | null): Promise<any> {
    const params: unknown[] = [];
    const next = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = ['lm.is_active = 1'];
    if (aisle) where.push(`lm.aisle = ${next(aisle)}`);
    if (level) where.push(`lm.row_name = ${next(level)}`);

    const r = await this.db.query(
      `SELECT lm.aisle,
              lm.row_name AS level,
              COUNT(lm.id)::int AS total,
              COUNT(CASE WHEN sl.id IS NOT NULL THEN 1 END)::int AS occupied,
              COUNT(CASE WHEN sl.id IS NULL THEN 1 END)::int AS free,
              COALESCE(lm.zone_code, lm.zone) AS zone_code,
              MAX(CASE WHEN lm.is_pick_face = 1 THEN 1 ELSE 0 END)::int AS is_pick_face,
              SUM(CASE WHEN lm.equipment_accessible = 1 THEN 1 ELSE 0 END)::int AS equip_accessible,
              MAX(CASE WHEN EXISTS (
                SELECT 1 FROM putaway_location_blocks b
                WHERE b.is_active = TRUE
                  AND ((b.scope_type = 'aisle' AND lm.location_code LIKE b.aisle_prefix || '%')
                    OR (b.scope_type = 'location' AND lm.location_code = b.location_code))
              ) THEN 1 ELSE 0 END)::int AS blocked
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
       WHERE ${where.join(' AND ')}
       GROUP BY lm.aisle, lm.row_name, COALESCE(lm.zone_code, lm.zone)
       ORDER BY lm.aisle, lm.row_name`,
      params,
    );
    const rows = r.rows.map((x) => ({
      ...x,
      total: Number(x.total),
      occupied: Number(x.occupied),
      free: Number(x.free),
      is_pick_face: Number(x.is_pick_face),
      equip_accessible: Number(x.equip_accessible),
      blocked: Number(x.blocked),
    }));

    let locations: any[] | null = null;
    if (aisle && level) {
      const loc = await this.db.query(
        `SELECT lm.location_code, lm.aisle, lm.rack, lm.row_name AS level, lm.position,
                COALESCE(lm.zone_code, lm.zone) AS zone_code, lm.is_pick_face, lm.equipment_accessible,
                sl.quantity, sl.batch_number, sl.pallet_function,
                st.expiry_date, p.product_code, p.product_name,
                CASE WHEN EXISTS (
                  SELECT 1 FROM putaway_location_blocks b
                  WHERE b.is_active = TRUE
                    AND ((b.scope_type = 'aisle' AND lm.location_code LIKE b.aisle_prefix || '%')
                      OR (b.scope_type = 'location' AND lm.location_code = b.location_code))
                ) THEN 1 ELSE 0 END AS blocked,
                (SELECT b.reason FROM putaway_location_blocks b
                  WHERE b.is_active = TRUE
                    AND ((b.scope_type = 'aisle' AND lm.location_code LIKE b.aisle_prefix || '%')
                      OR (b.scope_type = 'location' AND lm.location_code = b.location_code))
                  ORDER BY b.id LIMIT 1) AS block_reason
         FROM location_master lm
         LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
         LEFT JOIN stock st ON st.id = sl.stock_id
         LEFT JOIN products p ON p.id = st.product_id
         WHERE lm.is_active = 1 AND lm.aisle = $1 AND lm.row_name = $2
         ORDER BY lm.rack, lm.position`,
        [aisle, level],
      );
      locations = loc.rows.map((x) => ({ ...x, is_pick_face: Number(x.is_pick_face), equipment_accessible: Number(x.equipment_accessible), blocked: Number(x.blocked) }));
    }

    return { rows, locations };
  }

  /** Full per-bin list (occupancy + product) — feeds the 3D rack render. */
  async listAllBins(): Promise<any[]> {
    const blocks = await this.activeBlocks();
    const r = await this.db.query(
      `SELECT lm.location_code, lm.aisle, lm.rack, lm.row_name AS level, lm.position,
              COALESCE(lm.zone_code, lm.zone) AS zone_code, lm.is_pick_face, lm.equipment_accessible,
              SUM(sl.quantity)::numeric AS quantity,
              MAX(sl.pallet_function) AS pallet_function,
              MAX(sl.batch_number) AS batch_number,
              MAX(st.product_id) AS product_id,
              MAX(p.product_code) AS product_code,
              MAX(p.product_name) AS product_name,
              MAX(st.expiry_date) AS expiry_date
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock st ON st.id = sl.stock_id
       LEFT JOIN products p ON p.id = st.product_id
       WHERE lm.is_active = 1
       GROUP BY lm.id, lm.location_code, lm.aisle, lm.rack, lm.row_name, lm.position,
                COALESCE(lm.zone_code, lm.zone), lm.is_pick_face, lm.equipment_accessible
       ORDER BY lm.aisle, lm.rack, lm.row_name, lm.position`,
    );
    return r.rows.map((x) => {
      const hit = this.blockHit(blocks, x.location_code);
      return {
        ...x,
        occupied: x.quantity != null && Number(x.quantity) > 0 ? 1 : 0,
        quantity: x.quantity != null ? Number(x.quantity) : 0,
        is_pick_face: Number(x.is_pick_face),
        equipment_accessible: Number(x.equipment_accessible),
        blocked: hit.blocked ? 1 : 0,
        block_reason: hit.reason,
      };
    });
  }
}