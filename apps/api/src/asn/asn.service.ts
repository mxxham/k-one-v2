import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { generateNumber } from '../common/number-gen';
import { todayStr } from '../common/date-util';
import { ApiException } from '../common/api-exception';

/**
 * ASN — Advance Shipping Notice. Lets a supplier notify inbound of an expected
 * shipment before it arrives so receiving staff can prep. Receiving still
 * explicitly creates the inbound order against the ASN (confirm-vs-expect);
 * the ASN flips Pending -> Received only when that linked inbound completes.
 */
@Injectable()
export class AsnService {
  constructor(private readonly db: DbService) {}

  async generateNumber(): Promise<string> {
    return generateNumber(this.db, {
      table: 'asn',
      column: 'asn_number',
      prefix: `ASN-${todayStr().slice(0, 7).replace('-', '')}-`,
      searchPrefix: `ASN-${todayStr().slice(0, 7).replace('-', '')}-`,
      pad: 4,
    });
  }

  async getAll(status: string | null, limit: number | null, offset: number): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    let sql = `SELECT a.*,
              u.full_name AS created_by_name,
              COUNT(DISTINCT ai.id)::int AS total_items,
              SUM(ai.expected_qty) AS expected_qty
       FROM asn a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN asn_items ai ON a.id = ai.asn_id
       ${where}
       GROUP BY a.id, u.full_name
       ORDER BY a.created_at DESC`;
    if (limit) {
      params.push(limit, offset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const r = await this.db.query(sql, params);
    return r.rows;
  }

  async countAll(status: string | null): Promise<number> {
    const r = status
      ? await this.db.query('SELECT COUNT(*)::int FROM asn WHERE status = $1', [status])
      : await this.db.query('SELECT COUNT(*)::int FROM asn');
    return r.rows[0].count;
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT a.*, u.full_name AS created_by_name
       FROM asn a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1`,
      [id],
    );
    const asn = r.rows[0] ?? null;
    if (!asn) return null;
    const itemsR = await this.db.query(
      `SELECT ai.*, p.product_code, p.product_name, p.uom_type
       FROM asn_items ai
       JOIN products p ON ai.product_id = p.id
       WHERE ai.asn_id = $1
       ORDER BY ai.id`,
      [id],
    );
    asn.items = itemsR.rows;
    return asn;
  }

  async create(data: Record<string, any>, createdBy: number): Promise<number> {
    return this.db.transaction(async (client) => {
      const asnNumber = data.asn_number ?? (await this.generateNumber());
      const r = await client.query(
        `INSERT INTO asn
           (asn_number, supplier_name, supplier_reference, expected_arrival_date,
            status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          asnNumber,
          data.supplier_name ?? null,
          data.supplier_reference ?? null,
          data.expected_arrival_date || null,
          data.status ?? 'Pending',
          data.notes ?? null,
          createdBy,
        ],
      );
      const asnId = Number(r.rows[0].id);
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          await this.addItem(asnId, item, client);
        }
      }
      return asnId;
    });
  }

  async addItem(asnId: number, item: Record<string, any>, client?: any): Promise<number> {
    const dbc = client ?? this.db;
    const r = await dbc.query(
      `INSERT INTO asn_items (asn_id, product_id, expected_qty, uom, batch_number, exp_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        asnId,
        item.product_id,
        item.expected_qty ?? item.quantity ?? 0,
        item.uom ?? 'Drum',
        item.batch_number ?? item.batch_no ?? null,
        item.exp_date ?? item.expiry_date ?? null,
      ],
    );
    return Number(r.rows[0].id);
  }

  async update(id: number, data: Record<string, any>): Promise<void> {
    await this.db.transaction(async (client) => {
      const cur = await client.query('SELECT status FROM asn WHERE id = $1', [id]);
      const curStatus = cur.rows[0]?.status;
      if (!curStatus) throw ApiException.notFound('ASN tidak ditemukan');
      if (curStatus !== 'Pending') {
        throw ApiException.conflict('Hanya ASN berstatus Pending yang dapat diedit.');
      }
      await client.query(
        `UPDATE asn SET
           supplier_name = $1, supplier_reference = $2, expected_arrival_date = $3,
           notes = $4, updated_at = NOW()
         WHERE id = $5`,
        [
          data.supplier_name ?? null,
          data.supplier_reference ?? null,
          data.expected_arrival_date || null,
          data.notes ?? null,
          id,
        ],
      );
      // Full item replacement when an items array is supplied.
      if (Array.isArray(data.items)) {
        await client.query('DELETE FROM asn_items WHERE asn_id = $1', [id]);
        for (const item of data.items) {
          await this.addItem(id, item, client);
        }
      }
    });
  }

  async cancel(id: number): Promise<void> {
    const cur = await this.db.query('SELECT status FROM asn WHERE id = $1', [id]);
    const curStatus = cur.rows[0]?.status;
    if (!curStatus) throw ApiException.notFound('ASN tidak ditemukan');
    if (curStatus === 'Received') {
      throw ApiException.conflict('ASN yang sudah Received tidak dapat dibatalkan.');
    }
    await this.db.query("UPDATE asn SET status='Cancelled', updated_at=NOW() WHERE id=$1", [id]);
  }

  /** Linked inbound orders (for the ASN detail page). */
  async linkedInbounds(asnId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT io.id, io.order_number, io.status, io.order_date
       FROM inbound_orders io
       WHERE io.asn_id = $1
       ORDER BY io.created_at DESC`,
      [asnId],
    );
    return r.rows;
  }
}
