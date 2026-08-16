import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { generateNumber } from '../common/number-gen';
import { todayStr } from '../common/date-util';
import { ApiException } from '../common/api-exception';
import { PicklistService } from '../picklist/picklist.service';

/**
 * Waves service — Phase 4 Wave Planning (spec-4).
 * A wave groups one or more Open outbound orders (no picklist yet) into a
 * SINGLE consolidated picklist. The picklist header carries wave_id and has a
 * NULL outbound_order_id (see migration 006). Items are shared with the
 * single-order flow via PicklistService.insertPicklistItems and surface
 * location-sorted through picklist::detail for pick-path efficiency.
 */
@Injectable()
export class WavesService {
  constructor(
    private readonly db: DbService,
    private readonly picklist: PicklistService,
  ) {}

  async generateNumber(): Promise<string> {
    return generateNumber(this.db, {
      table: 'waves',
      column: 'wave_number',
      prefix: `WAV-${todayStr().slice(0, 7).replace('-', '')}-`,
      searchPrefix: `WAV-${todayStr().slice(0, 7).replace('-', '')}-`,
      pad: 4,
    });
  }

  async getAll(status: string | null, limit: number | null, offset: number): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`w.status = $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    let sql = `SELECT w.*,
              u.full_name AS created_by_name,
              COUNT(DISTINCT wo.outbound_order_id)::int AS order_count,
              COUNT(DISTINCT pki.id)::int AS item_count,
              pkl.id AS picklist_id,
              pkl.picklist_number,
              pkl.status AS picklist_status
       FROM waves w
       LEFT JOIN users u ON w.created_by = u.id
       LEFT JOIN wave_orders wo ON w.id = wo.wave_id
       LEFT JOIN picklists pkl ON pkl.wave_id = w.id
       LEFT JOIN picklist_items pki ON pki.picklist_id = pkl.id
       ${where}
       GROUP BY w.id, u.full_name, pkl.id, pkl.picklist_number, pkl.status
       ORDER BY w.created_at DESC`;
    if (limit) {
      params.push(limit, offset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const r = await this.db.query(sql, params);
    return r.rows;
  }

  async countAll(status: string | null): Promise<number> {
    const r = status
      ? await this.db.query('SELECT COUNT(*)::int FROM waves WHERE status = $1', [status])
      : await this.db.query('SELECT COUNT(*)::int FROM waves');
    return r.rows[0].count;
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT w.*, u.full_name AS created_by_name
       FROM waves w
       LEFT JOIN users u ON w.created_by = u.id
       WHERE w.id = $1`,
      [id],
    );
    const wave = r.rows[0] ?? null;
    if (!wave) return null;

    const ordersR = await this.db.query(
      `SELECT o.*, c.customer_name, c.customer_code, c.city,
              COUNT(DISTINCT oi.id)::int AS total_items,
              SUM(oi.actual_qty) AS total_qty
       FROM wave_orders wo
       JOIN outbound_orders o ON wo.outbound_order_id = o.id
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = o.id
       WHERE wo.wave_id = $1
       GROUP BY o.id, c.customer_name, c.customer_code, c.city
       ORDER BY o.order_number`,
      [id],
    );
    const plR = await this.db.query(
      'SELECT id, picklist_number, status FROM picklists WHERE wave_id = $1',
      [id],
    );
    wave.orders = ordersR.rows;
    wave.picklist = plR.rows[0] ?? null;
    return wave;
  }

  /**
   * Create a wave + its consolidated picklist inside ONE transaction.
   * Orders must exist, be status 'Open' and not already have a picklist;
   * ineligible ones are reported back in `skipped` (create still succeeds).
   */
  async create(data: Record<string, any>, createdBy: number): Promise<{ wave_id: number; picklist_id: number; skipped: number[] }> {
    const rawIds = Array.isArray(data.order_ids) ? (data.order_ids as unknown[]) : [];
    const orderIds = [...new Set(rawIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
    if (orderIds.length === 0) throw ApiException.badRequest('order_ids wajib diisi.');

    return this.db.transaction(async (client) => {
      const obR = await client.query('SELECT id FROM outbound_orders WHERE id = ANY($1::bigint[])', [orderIds]);
      const found = new Set(obR.rows.map((r) => Number(r.id)));
      const missing = orderIds.filter((id) => !found.has(id));
      if (missing.length) {
        throw ApiException.badRequest('Terdapat outbound order tidak ditemukan: ' + missing.join(', '));
      }

      const ineligR = await client.query(
        `SELECT id FROM outbound_orders o
         WHERE o.id = ANY($1::bigint[])
           AND (o.status <> 'Open'
                OR EXISTS (SELECT 1 FROM picklists pl WHERE pl.outbound_order_id = o.id))`,
        [orderIds],
      );
      const ineligible = new Set(ineligR.rows.map((r) => Number(r.id)));
      const validIds = orderIds.filter((id) => !ineligible.has(id));
      if (validIds.length === 0) {
        throw ApiException.badRequest('Tidak ada outbound order yang memenuhi syarat (status Open dan belum memiliki picklist).');
      }
      const skipped = orderIds.filter((id) => ineligible.has(id));

      const waveNumber = await this.generateNumber();
      const waveR = await client.query(
        `INSERT INTO waves (wave_number, status, carrier, cutoff_time, created_by)
         VALUES ($1,'Planning',$2,$3,$4) RETURNING id`,
        [waveNumber, data.carrier ?? null, data.cutoff_time ?? null, createdBy],
      );
      const waveId = Number(waveR.rows[0].id);
      for (const id of validIds) {
        await client.query('INSERT INTO wave_orders (wave_id, outbound_order_id) VALUES ($1,$2)', [waveId, id]);
      }

      const picklistId = await this.picklist.createFromOrders(validIds, createdBy, waveId, client);
      return { wave_id: waveId, picklist_id: picklistId, skipped };
    });
  }

  /** Cancel a wave; its picklist is removed only while still Draft. */
  async cancel(id: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const plR = await client.query('SELECT id, status FROM picklists WHERE wave_id = $1', [id]);
      for (const pl of plR.rows) {
        if (pl.status === 'Draft') {
          await client.query('DELETE FROM picklist_items WHERE picklist_id=$1', [pl.id]);
          await client.query('DELETE FROM picklists WHERE id=$1', [pl.id]);
        }
      }
      await client.query(`UPDATE waves SET status='Cancelled' WHERE id=$1`, [id]);
    });
  }

  /** Open orders that can still be added to a wave (no picklist yet). */
  async candidateOrders(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT o.id, o.order_number, o.order_date, o.so_number, o.do_number,
              o.destination, o.kota, o.armada_no, o.container_no, o.expected_date,
              c.customer_name, c.customer_code, c.city,
              COUNT(DISTINCT oi.id)::int AS total_items,
              SUM(oi.actual_qty) AS total_qty
       FROM outbound_orders o
       JOIN customers c ON o.customer_id = c.id
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = o.id
       WHERE o.status = 'Open'
         AND NOT EXISTS (SELECT 1 FROM picklists pl WHERE pl.outbound_order_id = o.id)
       GROUP BY o.id, c.customer_name, c.customer_code, c.city
       ORDER BY o.order_number`,
    );
    return r.rows;
  }
}
