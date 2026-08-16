import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';
import { deriveUppFromPackSize } from '../common/pallet';

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
        const slots = await this.findAvailable({ levels: [PICK_LEVEL], limit: 1, existingRacks, zones: pickZones, heavyOnly: limits.requires_equipment === 1 });
        const slot = slots[0];
        if (slot) {
          placements.push({ pallet_seq: seq++, quantity: upp, is_full: true, location_code: slot.location_code, zone_code: slot.zone_code, level: PICK_LEVEL, reason: 'PICK_FACE_FULL' });
          fullToReserve -= 1;
        }
      }
    }

    if (fullToReserve > 0) {
      const slots = await this.findAvailable({ levels: reserveLevels, limit: fullToReserve, existingRacks, zones: reserveZones });
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
      const slots = await this.findAvailable({ levels: [targetLevel], limit: 1, existingRacks, zones: targetZones, heavyOnly: limits.requires_equipment === 1 });
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
   */
  private async findAvailable(opts: {
    levels: string[];
    limit: number;
    existingRacks: string[];
    /** Restrict to locations inside these zone bindings (zone_code or empty = all). */
    zones?: string[];
    /** Only pick locations reachable by heavy equipment (for heavy UOMs). */
    heavyOnly?: boolean;
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
              SUM(CASE WHEN lm.equipment_accessible = 1 THEN 1 ELSE 0 END)::int AS equip_accessible
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
    }));

    let locations: any[] | null = null;
    if (aisle && level) {
      const loc = await this.db.query(
        `SELECT lm.location_code, lm.aisle, lm.rack, lm.row_name AS level, lm.position,
                COALESCE(lm.zone_code, lm.zone) AS zone_code, lm.is_pick_face, lm.equipment_accessible,
                sl.quantity, sl.batch_number, sl.pallet_function,
                st.expiry_date, p.product_code, p.product_name
         FROM location_master lm
         LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
         LEFT JOIN stock st ON st.id = sl.stock_id
         LEFT JOIN products p ON p.id = st.product_id
         WHERE lm.is_active = 1 AND lm.aisle = $1 AND lm.row_name = $2
         ORDER BY lm.rack, lm.position`,
        [aisle, level],
      );
      locations = loc.rows.map((x) => ({ ...x, is_pick_face: Number(x.is_pick_face), equipment_accessible: Number(x.equipment_accessible) }));
    }

    return { rows, locations };
  }

  /** Full per-bin list (occupancy + product) — feeds the 3D rack render. */
  async listAllBins(): Promise<any[]> {
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
    return r.rows.map((x) => ({
      ...x,
      occupied: x.quantity != null && Number(x.quantity) > 0 ? 1 : 0,
      quantity: x.quantity != null ? Number(x.quantity) : 0,
      is_pick_face: Number(x.is_pick_face),
      equipment_accessible: Number(x.equipment_accessible),
    }));
  }
}