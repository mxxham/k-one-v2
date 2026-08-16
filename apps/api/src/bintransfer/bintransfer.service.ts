import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { monthCompact, nowCompactTime } from '../common/date-util';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

const SPECIAL_LOCS = ['QUA_SHELL', 'STAGING'];

@Injectable()
export class BinTransferService {
  constructor(private readonly db: DbService) {}

  // ---------------------------------------------------------------------------
  // Number generation (matches BinTransfer::generateNumber)
  // ---------------------------------------------------------------------------

  async generateNumber(): Promise<string> {
    const prefix = 'BTR-' + monthCompact() + '-';
    const last = await this.db.query<{ transfer_number: string }>(
      `SELECT transfer_number FROM bin_transfers WHERE transfer_number LIKE $1 ORDER BY transfer_number DESC LIMIT 1`,
      [prefix + '%'],
    );
    let seq = 1;
    if (last.rows.length > 0) {
      const idx = last.rows[0].transfer_number.lastIndexOf('-');
      seq = Number.parseInt(last.rows[0].transfer_number.slice(idx + 1), 10) + 1;
    }
    for (let i = 0; i < 20; i++) {
      const num = prefix + String(seq).padStart(4, '0');
      const chk = await this.db.query('SELECT id FROM bin_transfers WHERE transfer_number = $1', [num]);
      if (chk.rows.length === 0) return num;
      seq++;
    }
    return prefix + nowCompactTime() + Math.floor(Math.random() * 90 + 10);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getAll(status: string | null, limit = 200, offset = 0): Promise<any[]> {
    const where = status ? 'WHERE bt.status = $1' : '';
    const params: unknown[] = status ? [status] : [];
    const sql = `SELECT bt.*,
                 p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
                 u1.full_name AS created_by_name,
                 u2.full_name AS completed_by_name
                 FROM bin_transfers bt
                 JOIN products p ON bt.product_id = p.id
                 LEFT JOIN users u1 ON bt.created_by = u1.id
                 LEFT JOIN users u2 ON bt.completed_by = u2.id
                 ${where}
                 ORDER BY bt.transfer_date DESC, bt.created_at DESC
                 LIMIT ${limit} OFFSET ${offset}`;
    const r = await this.db.query(sql, params);
    return r.rows;
  }

  async countAll(status: string | null): Promise<number> {
    const where = status ? 'WHERE bt.status = $1' : '';
    const params: unknown[] = status ? [status] : [];
    const r = await this.db.query(`SELECT COUNT(*)::int as count FROM bin_transfers bt ${where}`, params);
    return Number(r.rows[0].count);
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT bt.*,
              p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              u1.full_name AS created_by_name,
              u2.full_name AS completed_by_name
       FROM bin_transfers bt
       JOIN products p ON bt.product_id = p.id
       LEFT JOIN users u1 ON bt.created_by = u1.id
       LEFT JOIN users u2 ON bt.completed_by = u2.id
       WHERE bt.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async getStockAtLocation(productId: number, location = ''): Promise<any[]> {
    if (location !== '') {
      const r = await this.db.query(
        `SELECT s.*, p.product_name, p.product_code, p.uom_type
         FROM stock s
         JOIN products p ON s.product_id = p.id
         WHERE s.product_id = $1 AND s.location = $2 AND s.stock_status = 'Available' AND s.quantity > 0
         ORDER BY CASE WHEN s.expiry_date IS NULL THEN 1 ELSE 0 END, s.expiry_date ASC`,
        [productId, location],
      );
      return r.rows;
    }
    const r = await this.db.query(
      `SELECT s.*, p.product_name, p.product_code, p.uom_type
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.product_id = $1 AND s.stock_status = 'Available' AND s.quantity > 0 AND s.location NOT IN ('STAGING')
       ORDER BY s.location, CASE WHEN s.expiry_date IS NULL THEN 1 ELSE 0 END, s.expiry_date ASC`,
      [productId],
    );
    return r.rows;
  }

  async getLocationsWithStock(productId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT s.location,
              SUM(s.quantity) AS total_qty, s.uom,
              MIN(s.expiry_date) AS earliest_expiry,
              COUNT(*) AS batch_count
       FROM stock s
       WHERE s.product_id = $1 AND s.stock_status = 'Available' AND s.quantity > 0 AND s.location NOT IN ('STAGING')
       GROUP BY s.location, s.uom
       ORDER BY s.location`,
      [productId],
    );
    return r.rows;
  }

  // ---------------------------------------------------------------------------
  // Create / execute / cancel
  // ---------------------------------------------------------------------------

  async create(data: Q, userId: number): Promise<number> {
    return this.db.transaction(async (client) => {
      const number = await this.generateNumber();
      const fromLocCode = String(data.from_location ?? '').trim().toUpperCase();
      const toLocCode = String(data.to_location ?? '').trim().toUpperCase();

      if (!SPECIAL_LOCS.includes(fromLocCode)) {
        const chk = await client.query(
          'SELECT id FROM location_master WHERE location_code = $1 AND is_active = 1 LIMIT 1',
          [fromLocCode],
        );
        if (chk.rows.length === 0) {
          throw ApiException.conflict(`Lokasi sumber '${fromLocCode}' tidak ditemukan di master lokasi.`);
        }
      }

      if (!SPECIAL_LOCS.includes(toLocCode)) {
        const chk = await client.query(
          'SELECT id FROM location_master WHERE location_code = $1 AND is_active = 1 LIMIT 1',
          [toLocCode],
        );
        if (chk.rows.length === 0) {
          throw ApiException.conflict(`Lokasi tujuan '${toLocCode}' tidak ditemukan di master lokasi.`);
        }
      }

      if (fromLocCode === toLocCode) {
        throw ApiException.conflict(`Lokasi sumber dan tujuan tidak boleh sama (${fromLocCode}).`);
      }

      const avail = await client.query(
        `SELECT id, quantity FROM stock
         WHERE product_id = $1 AND location = $2 AND stock_status = 'Available' AND quantity > 0
         ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC
         LIMIT 1`,
        [data.product_id, fromLocCode],
      );
      const stockRow = avail.rows[0];
      if (!stockRow) {
        throw ApiException.conflict(`Tidak ada stok tersedia di lokasi ${fromLocCode}.`);
      }

      const total = await client.query(
        `SELECT COALESCE(SUM(quantity),0) as total FROM stock
         WHERE product_id = $1 AND location = $2 AND stock_status = 'Available'`,
        [data.product_id, fromLocCode],
      );
      const totalAvail = Number(total.rows[0].total);

      if (Number(data.quantity) > totalAvail + 0.001) {
        throw ApiException.conflict(
          `Stok tidak cukup. Tersedia: ${totalAvail.toFixed(2)} — Diminta: ${Number(data.quantity).toFixed(2)}`,
        );
      }

      const ins = await client.query(
        `INSERT INTO bin_transfers
           (transfer_number, transfer_date, product_id, stock_id,
            batch_number, from_location, to_location,
            quantity, uom, reason, status, created_by,
            transfer_type, pick_face_target_id, is_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending',$11,$12,$13,$14) RETURNING id`,
        [
          number,
          data.transfer_date,
          data.product_id,
          stockRow.id,
          data.batch_number ?? null,
          fromLocCode,
          toLocCode,
          data.quantity,
          data.uom ?? 'Drum',
          data.reason ?? null,
          userId,
          data.transfer_type ?? 'MANUAL',
          data.pick_face_target_id != null ? Number(data.pick_face_target_id) : null,
          data.is_breakdown !== undefined ? Number(data.is_breakdown) : 0,
        ],
      );
      return Number(ins.rows[0].id);
    });
  }

  async execute(transferId: number, userId: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const transfer = await this.getById(transferId);
      if (!transfer) throw ApiException.conflict('Transfer tidak ditemukan');
      if (transfer.status !== 'Pending') {
        throw ApiException.conflict(`Transfer status harus Pending (saat ini: ${transfer.status})`);
      }

      const qty = Number(transfer.quantity);
      const productId = Number(transfer.product_id);
      const fromLoc = transfer.from_location;
      const toLoc = transfer.to_location;
      const uom = transfer.uom;

      const src = await client.query(
        `SELECT * FROM stock
         WHERE product_id = $1 AND location = $2 AND stock_status = 'Available' AND quantity > 0
         ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC`,
        [productId, fromLoc],
      );
      const srcRows = src.rows;
      if (srcRows.length === 0) {
        throw ApiException.conflict(`Tidak ada stok di lokasi sumber: ${fromLoc}`);
      }

      const totalAvail = srcRows.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (qty > totalAvail + 0.001) {
        throw ApiException.conflict(
          `Stok tidak cukup: tersedia ${Math.round(totalAvail * 100) / 100}, diminta ${Math.round(qty * 100) / 100}`,
        );
      }

      let remaining = qty;
      let usedBatch: string | null = null;
      let usedExpiry: string | null = null;

      for (const srcRow of srcRows) {
        if (remaining <= 0.001) break;
        const deduct = Math.min(remaining, Number(srcRow.quantity));
        const newQty = Number(srcRow.quantity) - deduct;

        if (!usedBatch) {
          usedBatch = srcRow.batch_number;
          usedExpiry = srcRow.expiry_date;
        }

        if (newQty <= 0.001) {
          await client.query('DELETE FROM stock WHERE id = $1', [srcRow.id]);
        } else {
          await client.query('UPDATE stock SET quantity = $1, updated_at = NOW() WHERE id = $2', [newQty, srcRow.id]);
        }

        const sl = await client.query(
          `SELECT id, quantity FROM stock_locations WHERE stock_id = $1 AND status = 'Available' ORDER BY pallet_seq ASC LIMIT 1`,
          [srcRow.id],
        );
        if (sl.rows.length > 0) {
          const slRow = sl.rows[0];
          const slNew = Math.max(0, Number(slRow.quantity) - deduct);
          await client.query('UPDATE stock_locations SET quantity = $1, status = $2 WHERE id = $3', [
            slNew,
            slNew <= 0 ? 'Picked' : 'Available',
            slRow.id,
          ]);
        }

        remaining -= deduct;
      }

      const existing = await client.query(
        `SELECT id, quantity FROM stock
         WHERE product_id = $1 AND location = $2 AND batch_number IS NOT DISTINCT FROM $3 AND stock_status = 'Available'
         LIMIT 1`,
        [productId, toLoc, usedBatch],
      );
      const dest = existing.rows[0];

      let destStockId: number;
      if (dest) {
        await client.query('UPDATE stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [
          qty,
          dest.id,
        ]);
        destStockId = Number(dest.id);
      } else {
        const ins = await client.query(
          `INSERT INTO stock
             (product_id, batch_number, location, quantity, uom,
              pallet, manufacture_date, expiry_date, stock_status)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'Available') RETURNING id`,
          [
            productId,
            usedBatch,
            toLoc,
            qty,
            uom,
            Math.ceil(qty / Math.max(1, Number(transfer.uom_per_pallet ?? 4))),
            usedExpiry,
          ],
        );
        destStockId = Number(ins.rows[0].id);
      }

      const bal = await client.query('SELECT balance FROM stock_ledger WHERE product_id = $1 ORDER BY id DESC LIMIT 1', [productId]);
      const currentBalance = Number(bal.rows[0]?.balance ?? 0);
      await this.addLedger(client, productId, 'TRANSFER_OUT', 'BinTransfer', transferId, transfer.transfer_number, usedBatch, 0, qty, uom, fromLoc, `Bin Transfer ke ${toLoc}`, currentBalance);
      await this.addLedger(client, productId, 'TRANSFER_IN', 'BinTransfer', transferId, transfer.transfer_number, usedBatch, qty, 0, uom, toLoc, `Bin Transfer dari ${fromLoc}`, currentBalance);

      await this.convertDestPalletFunction(client, destStockId, toLoc, qty, transfer, uom, usedBatch);

      await client.query(
        `UPDATE bin_transfers SET status='Completed', completed_by=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2`,
        [userId, transferId],
      );
    });
  }

  /**
   * Pallet function conversion on the destination:
   *  - A pallet moved to a pick-fast location (Level A) becomes a PICK_FACE:
   *    its contents are broken down for picking and it is no longer a full
   *    pallet in high storage (is_full_pallet = 0 unless still full).
   *  - Otherwise the moved stock stays a RESERVE pallet.
   */
  private async convertDestPalletFunction(
    client: any,
    destStockId: number,
    toLoc: string,
    qty: number,
    transfer: Record<string, any>,
    uom: string,
    batchNumber: string | null,
  ): Promise<void> {
    const destLoc = await client.query(
      `SELECT lm.is_pick_face, lm.row_name FROM location_master lm WHERE lm.location_code = $1 LIMIT 1`,
      [toLoc],
    );
    const isPickFace = Number(destLoc.rows[0]?.is_pick_face ?? 0) === 1 || (destLoc.rows[0]?.row_name ?? '') === 'A';
    if (!isPickFace) return;

    const upp = Math.max(1, Number(transfer.uom_per_pallet ?? 4) || 4);
    const isFull = qty >= upp - 0.001;

    const existing = await client.query(
      `SELECT id, quantity FROM stock_locations
       WHERE stock_id = $1 AND location_code = $2 AND status = 'Available'
       ORDER BY pallet_seq ASC LIMIT 1`,
      [destStockId, toLoc],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE stock_locations
         SET quantity = $1, pallet_function = 'PICK_FACE',
             is_full_pallet = $2, updated_at = NOW()
         WHERE id = $3`,
        [Number(existing.rows[0].quantity) + qty, isFull ? 1 : 0, existing.rows[0].id],
      );
      return;
    }

    await client.query(
      `INSERT INTO stock_locations
         (stock_id, location_code, pallet_seq, quantity, original_quantity, uom,
          is_full_pallet, batch_number, status, pallet_function)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'Available','PICK_FACE')`,
      [destStockId, toLoc, 1, qty, uom, isFull ? 1 : 0, batchNumber],
    );
  }

  async cancel(transferId: number): Promise<void> {
    const transfer = await this.getById(transferId);
    if (!transfer) throw ApiException.conflict('Transfer tidak ditemukan');
    if (transfer.status !== 'Pending') {
      throw ApiException.conflict('Hanya transfer berstatus Pending yang dapat dibatalkan');
    }
    await this.db.query(`UPDATE bin_transfers SET status = 'Cancelled', updated_at = NOW() WHERE id = $1`, [transferId]);
  }

  private async addLedger(
    client: any,
    productId: number,
    txType: string,
    refType: string,
    refId: number,
    refNo: string,
    batch: string | null,
    qIn: number,
    qOut: number,
    uom: string,
    location: string,
    notes: string,
    balance: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO stock_ledger
         (transaction_date, product_id, transaction_type, reference_type,
          reference_id, reference_number, batch_number,
          quantity_in, quantity_out, uom, balance, location, notes)
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [productId, txType, refType, refId, refNo, batch, qIn, qOut, uom, balance, location, notes],
    );
  }
}
