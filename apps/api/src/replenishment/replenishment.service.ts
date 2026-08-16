import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { BinTransferService } from '../bintransfer/bintransfer.service';
import { todayStr } from '../common/date-util';
import { ApiException } from '../common/api-exception';

@Injectable()
export class ReplenishmentService {
  constructor(
    private readonly db: DbService,
    private readonly binTransfer: BinTransferService,
  ) {}

  /**
   * Replenishment suggestions (Phase 3). For every pick_face_targets row whose
   * current available (non-hold) stock at the pick-face location is below
   * min_qty, return the shortage plus candidate bulk/reserve source locations
   * that have available (non-hold) stock of that SKU. Suggestion-only.
   */
  async listSuggestions(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT
         t.id AS target_id,
         lm.id AS location_id,
         lm.location_code AS pick_face_location,
         p.id AS product_id,
         p.product_code,
         p.product_name,
         p.uom_type,
         p.uom_per_pallet,
         t.min_qty,
         t.max_qty,
         COALESCE(cur.current_qty, 0) AS current_qty,
         GREATEST(t.min_qty - COALESCE(cur.current_qty, 0), 0) AS shortage
       FROM pick_face_targets t
       JOIN location_master lm ON lm.id = t.location_id
       JOIN products p ON p.id = t.product_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(s.quantity), 0) AS current_qty
         FROM stock s
         WHERE s.product_id = t.product_id
           AND s.location = lm.location_code
           AND s.stock_status = 'Available'
           AND (s.hold_status = 'available' OR s.hold_status IS NULL)
           AND s.quantity > 0
       ) cur ON TRUE
       WHERE COALESCE(cur.current_qty, 0) < t.min_qty
       ORDER BY lm.location_code, p.product_code`,
    );
    const suggestions = r.rows.map((row) => ({
      ...row,
      target_id: Number(row.target_id),
      location_id: Number(row.location_id),
      product_id: Number(row.product_id),
      min_qty: Number(row.min_qty),
      max_qty: Number(row.max_qty),
      current_qty: Number(row.current_qty),
      shortage: Number(row.shortage),
    }));

    if (suggestions.length > 0) {
      const productIds = [...new Set(suggestions.map((s) => Number(s.product_id)))];
      const src = await this.db.query(
        `SELECT s.product_id,
                s.location AS source_location,
                COALESCE(SUM(s.quantity), 0) AS available_qty,
                MIN(s.expiry_date) AS earliest_expiry,
                COUNT(DISTINCT s.batch_number)::int AS batch_count
         FROM stock s
         WHERE s.product_id = ANY($1::bigint[])
           AND s.stock_status = 'Available'
           AND (s.hold_status = 'available' OR s.hold_status IS NULL)
           AND s.quantity > 0
           AND s.location NOT IN ('QUA_SHELL','STAGING')
         GROUP BY s.product_id, s.location
         ORDER BY s.product_id, MIN(s.expiry_date) ASC NULLS LAST, s.location`,
        [productIds],
      );
      const byProduct: Record<number, any[]> = {};
      for (const row of src.rows) {
        const pid = Number(row.product_id);
        (byProduct[pid] ??= []).push({
          location: row.source_location,
          available_qty: Number(row.available_qty),
          earliest_expiry: row.earliest_expiry ?? null,
          batch_count: Number(row.batch_count),
        });
      }
      for (const s of suggestions) {
        const all = byProduct[Number(s.product_id)] ?? [];
        s.sources = all.filter((x) => x.location !== s.pick_face_location);
      }
    }
    return suggestions;
  }

  /** All pick_face_targets rows with location/product names + current pick-face qty. */
  async listTargets(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT t.id,
              t.location_id,
              t.product_id,
              t.min_qty,
              t.max_qty,
              lm.location_code,
              lm.aisle,
              lm.row_name,
              lm.zone,
              p.product_code,
              p.product_name,
              p.uom_type,
              COALESCE(cur.current_qty, 0) AS current_qty
       FROM pick_face_targets t
       JOIN location_master lm ON lm.id = t.location_id
       JOIN products p ON p.id = t.product_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(s.quantity), 0) AS current_qty
         FROM stock s
         WHERE s.product_id = t.product_id
           AND s.location = lm.location_code
           AND s.stock_status = 'Available'
           AND (s.hold_status = 'available' OR s.hold_status IS NULL)
           AND s.quantity > 0
       ) cur ON TRUE
       ORDER BY lm.location_code, p.product_code`,
    );
    return r.rows.map((row) => ({ ...row, id: Number(row.id), location_id: Number(row.location_id), product_id: Number(row.product_id) }));
  }

  /** Upsert a target on (location_id, product_id). */
  async saveTarget(locationId: number, productId: number, minQty: number, maxQty: number): Promise<number> {
    const r = await this.db.query(
      `INSERT INTO pick_face_targets (location_id, product_id, min_qty, max_qty)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (location_id, product_id) DO UPDATE SET
         min_qty = EXCLUDED.min_qty,
         max_qty = EXCLUDED.max_qty,
         updated_at = NOW()
       RETURNING id`,
      [locationId, productId, minQty, maxQty],
    );
    return Number(r.rows[0].id);
  }

  async deleteTarget(id: number): Promise<boolean> {
    const r = await this.db.query('DELETE FROM pick_face_targets WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async locationExists(id: number): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM location_master WHERE id = $1', [id]);
    return r.rows.length > 0;
  }

  async productExists(id: number): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM products WHERE id = $1', [id]);
    return r.rows.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Replenishment trigger — shortage detection + bin transfer generation
  // ---------------------------------------------------------------------------

  /**
   * For every pick_face_targets row whose current pick-face stock (Level A) is
   * below min_qty, compute how much must be moved from reserve/bulk (B–E) to
   * bring the pick face back up to max_qty (top-up target).
   */
  async detectShortages(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT t.id AS target_id,
              t.location_id,
              lm.location_code AS pick_face_location,
              p.id AS product_id,
              p.product_code,
              p.product_name,
              p.uom_type,
              p.uom_per_pallet,
              t.min_qty,
              t.max_qty,
              COALESCE(cur.current_qty, 0) AS current_qty,
              GREATEST(COALESCE(t.max_qty, t.min_qty) - COALESCE(cur.current_qty, 0), 0) AS shortage
       FROM pick_face_targets t
       JOIN location_master lm ON lm.id = t.location_id
       JOIN products p ON p.id = t.product_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(s.quantity), 0) AS current_qty
         FROM stock s
         WHERE s.product_id = t.product_id
           AND s.location = lm.location_code
           AND s.stock_status = 'Available'
           AND (s.hold_status = 'available' OR s.hold_status IS NULL)
           AND s.quantity > 0
       ) cur ON TRUE
       WHERE COALESCE(cur.current_qty, 0) < t.min_qty
         AND COALESCE(t.max_qty, t.min_qty) > COALESCE(cur.current_qty, 0)
       ORDER BY lm.location_code, p.product_code`,
    );
    return r.rows.map((row) => ({
      ...row,
      target_id: Number(row.target_id),
      location_id: Number(row.location_id),
      product_id: Number(row.product_id),
      min_qty: Number(row.min_qty),
      max_qty: Number(row.max_qty),
      current_qty: Number(row.current_qty),
      shortage: Number(row.shortage),
    }));
  }

  /**
   * Find candidate reserve source rows for a shortage using FEFO
   * (earliest expiry first). Only reserve/bulk tiers (B–E) are eligible;
   * the pick-face location itself and virtual locations are excluded.
   */
  private async findSourceRows(
    productId: number,
    pickFaceLocation: string,
    needed: number,
  ): Promise<Array<Record<string, any>>> {
    const r = await this.db.query(
      `SELECT s.*, lm.row_name AS level, lm.rack
       FROM stock s
       JOIN location_master lm ON lm.location_code = s.location
       WHERE s.product_id = $1
         AND s.stock_status = 'Available'
         AND (s.hold_status = 'available' OR s.hold_status IS NULL)
         AND s.quantity > 0
         AND s.location != $2
         AND s.location NOT IN ('QUA_SHELL','STAGING','UNALLOCATED')
         AND lm.row_name IN ('B','C','D','E')
       ORDER BY CASE WHEN s.expiry_date IS NULL THEN 1 ELSE 0 END,
                s.expiry_date ASC NULLS LAST,
                s.location,
                s.id
       LIMIT 50`,
      [productId, pickFaceLocation],
    );
    let remaining = needed;
    const rows: Array<Record<string, any>> = [];
    for (const row of r.rows) {
      if (remaining <= 0.001) break;
      const take = Math.min(remaining, Number(row.quantity));
      rows.push({ ...row, take_qty: take });
      remaining -= take;
    }
    return rows;
  }

  /**
   * Generate Pending replenishment bin transfers for every shortage found.
   * Each transfer: RESERVE (B–E, FEFO) -> pick-face Level A, type REPLENISHMENT.
   * The pallet/stock moved is flagged as a pick-face breakdown (handled at
   * execute time). Returns created transfer ids per target.
   */
  async generateTransfers(userId: number): Promise<{
    generated: Array<{ target_id: number; pick_face_location: string; transfer_id: number; transfer_number: string; quantity: number }>;
    insufficient: Array<{ target_id: number; pick_face_location: string; product_id: number; shortage: number; available: number }>;
    skipped: Array<{ target_id: number; pick_face_location: string; reason: string }>;
  }> {
    const shortages = await this.detectShortages();
    const generated: Array<{ target_id: number; pick_face_location: string; transfer_id: number; transfer_number: string; quantity: number }> = [];
    const insufficient: Array<{ target_id: number; pick_face_location: string; product_id: number; shortage: number; available: number }> = [];
    const skipped: Array<{ target_id: number; pick_face_location: string; reason: string }> = [];

    for (const s of shortages) {
      const needed = s.shortage;
      const sourceRows = await this.findSourceRows(s.product_id, s.pick_face_location, needed);
      const available = sourceRows.reduce((sum, r) => sum + Number(r.take_qty), 0);

      if (available < needed - 0.001) {
        insufficient.push({
          target_id: s.target_id,
          pick_face_location: s.pick_face_location,
          product_id: s.product_id,
          shortage: needed,
          available,
        });
        continue;
      }

      try {
        const transferId = await this.binTransfer.create(
          {
            transfer_date: todayStr(),
            product_id: s.product_id,
            from_location: sourceRows[0].location,
            to_location: s.pick_face_location,
            quantity: needed,
            uom: s.uom_type,
            reason: `Auto-replenishment pick-face ${s.pick_face_location} (min ${s.min_qty})`,
            transfer_type: 'REPLENISHMENT',
            pick_face_target_id: s.target_id,
            is_breakdown: 1,
            source_rows: sourceRows,
          },
          userId,
        );
        generated.push({
          target_id: s.target_id,
          pick_face_location: s.pick_face_location,
          transfer_id: transferId,
          transfer_number: await this.getTransferNumber(transferId),
          quantity: needed,
        });
      } catch {
        skipped.push({ target_id: s.target_id, pick_face_location: s.pick_face_location, reason: 'Gagal membuat transfer' });
      }
    }

    return { generated, insufficient, skipped };
  }

  /** Dry-run: return what would be created without persisting anything. */
  async suggestTransfers(): Promise<{
    suggestions: Array<{
      target_id: number;
      pick_face_location: string;
      product_id: number;
      product_code: string;
      current_qty: number;
      min_qty: number;
      max_qty: number;
      shortage: number;
      source: Array<{ location: string; level: string; batch: string | null; expiry_date: string | null; take_qty: number }>;
    }>;
  }> {
    const shortages = await this.detectShortages();
    const suggestions = [];
    for (const s of shortages) {
      const sourceRows = await this.findSourceRows(s.product_id, s.pick_face_location, s.shortage);
      suggestions.push({
        target_id: s.target_id,
        pick_face_location: s.pick_face_location,
        product_id: s.product_id,
        product_code: s.product_code,
        current_qty: s.current_qty,
        min_qty: s.min_qty,
        max_qty: s.max_qty,
        shortage: s.shortage,
        source: sourceRows.map((r) => ({
          location: r.location,
          level: r.level,
          batch: r.batch_number,
          expiry_date: r.expiry_date,
          take_qty: Number(r.take_qty),
        })),
      });
    }
    return { suggestions };
  }

  private async getTransferNumber(transferId: number): Promise<string> {
    const r = await this.db.query('SELECT transfer_number FROM bin_transfers WHERE id = $1', [transferId]);
    return r.rows[0]?.transfer_number ?? '';
  }

  /**
   * Demand-driven replenishment trigger. Given an outbound demand for a SKU,
   * compute how much of it is covered by available pick-face (Level A) stock.
   * When there is a shortage and bulk/reserve stock exists (FEFO), offer (and
   * optionally create) a top-up transfer into a pick-face location. The
   * transfer is flagged REPLENISHMENT + is_breakdown so it consumes a bin and
   * flips the target to PICK_FACE on execution.
   */
  async demandReplenishment(
    userId: number,
    productId: number,
    demandQty: number,
    createTransfer: boolean,
  ): Promise<any> {
    const prod = await this.db.query(
      'SELECT id, product_code, product_name, uom_type, uom_per_pallet FROM products WHERE id = $1',
      [productId],
    );
    const product = prod.rows[0];
    if (!product) throw ApiException.badRequest('Produk tidak ditemukan.');

    const pick = await this.db.query(
      `SELECT COALESCE(SUM(s.quantity), 0)::float AS qty
       FROM stock s
       JOIN location_master lm ON lm.location_code = s.location
       WHERE s.product_id = $1
         AND s.stock_status = 'Available'
         AND (s.hold_status = 'available' OR s.hold_status IS NULL)
         AND s.quantity > 0
         AND lm.row_name = 'A'
         AND lm.is_pick_face = 1`,
      [productId],
    );
    const pickAvailable = Number(pick.rows[0]?.qty ?? 0);
    const shortage = Math.max(0, demandQty - pickAvailable);

    if (shortage <= 0.001) {
      return {
        triggered: false,
        product,
        pick_available: pickAvailable,
        demand_qty: demandQty,
        shortage: 0,
        message: 'Stok pick-face (Level A) mencukupi kebutuhan.',
      };
    }

    // Target: existing pick-face bin of the SKU, else first free Level A bin.
    const targetRow = await this.db.query(
      `SELECT lm.location_code
       FROM stock_locations sl
       JOIN location_master lm ON lm.location_code = sl.location_code
       JOIN stock s ON s.id = sl.stock_id
       WHERE s.product_id = $1
         AND lm.row_name = 'A'
         AND lm.is_pick_face = 1
         AND sl.status IN ('Available','Reserved')
         AND s.quantity > 0
       ORDER BY lm.location_code LIMIT 1`,
      [productId],
    );
    let target = targetRow.rows[0]?.location_code ?? null;
    if (!target) {
      const free = await this.db.query(
        `SELECT lm.location_code
         FROM location_master lm
         WHERE lm.is_active = 1
           AND lm.row_name = 'A'
           AND lm.is_pick_face = 1
           AND lm.location_code NOT IN (
             SELECT DISTINCT location_code FROM stock_locations
             WHERE status IN ('Available','Reserved'))
         ORDER BY lm.aisle, lm.rack, lm.position LIMIT 1`,
      );
      target = free.rows[0]?.location_code ?? null;
    }

    const sourceRows = await this.findSourceRows(productId, target ?? '', shortage);
    const available = sourceRows.reduce((s, r) => s + Number(r.take_qty), 0);
    const canFulfill = available >= shortage - 0.001;

    let transferId: number | null = null;
    let transferNumber = '';
    if (createTransfer && canFulfill && target) {
      try {
        transferId = await this.binTransfer.create(
          {
            transfer_date: todayStr(),
            product_id: productId,
            from_location: sourceRows[0].location,
            to_location: target,
            quantity: shortage,
            uom: product.uom_type,
            reason: `Auto-replenishment untuk demand ${demandQty} (pick ${pickAvailable})`,
            transfer_type: 'REPLENISHMENT',
            is_breakdown: 1,
          },
          userId,
        );
        transferNumber = await this.getTransferNumber(transferId);
      } catch {
        transferId = null;
      }
    }

    return {
      triggered: true,
      product,
      pick_available: pickAvailable,
      demand_qty: demandQty,
      shortage,
      target,
      available,
      can_fulfill: canFulfill,
      transfer_id: transferId,
      transfer_number: transferNumber,
      source: sourceRows.map((r) => ({
        location: r.location,
        level: r.level,
        batch: r.batch_number,
        expiry_date: r.expiry_date,
        take_qty: Number(r.take_qty),
      })),
    };
  }
}