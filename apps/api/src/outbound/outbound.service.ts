import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { generateNumber } from '../common/number-gen';
import { ApiException } from '../common/api-exception';
import { ActivityLogger } from '../common/activity-logger';
import { MasterDataService } from '../master/master-data.service';
import { addYears, todayStr } from '../common/date-util';
import { calculatePalletDistribution as palletDist, calcPalletByLocation } from '../common/pallet';

@Injectable()
export class OutboundService {
  constructor(private readonly db: DbService, private readonly activity: ActivityLogger, private readonly master: MasterDataService) {}

  async generateNumber(): Promise<string> {
    return generateNumber(this.db, {
      table: 'outbound_orders',
      column: 'order_number',
      prefix: `OUT-${todayStr().slice(0, 7).replace('-', '')}-`,
      searchPrefix: `OUT-${todayStr().slice(0, 7).replace('-', '')}-`,
      pad: 4,
    });
  }

  async getAll(status: string | null, limit: number | null, offset: number, q: string | null): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`oo.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(oo.order_number ILIKE $${params.length} OR oo.shipment_number ILIKE $${params.length} OR oo.do_number ILIKE $${params.length} OR oo.so_number ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `SELECT oo.*, u.full_name as created_by_name, s.full_name as shipped_by_name
               FROM outbound_orders oo
               LEFT JOIN users u ON oo.created_by = u.id
               LEFT JOIN users s ON oo.shipped_by = s.id
               ${where}
               ORDER BY oo.order_date DESC, oo.created_at DESC`;
    if (limit) {
      params.push(limit, offset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const r = await this.db.query(sql, params);
    return r.rows;
  }

  async countAll(status: string | null, q: string | null): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`oo.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(oo.order_number ILIKE $${params.length} OR oo.shipment_number ILIKE $${params.length} OR oo.do_number ILIKE $${params.length} OR oo.so_number ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await this.db.query(`SELECT COUNT(*)::int as count FROM outbound_orders oo ${where}`, params);
    return r.rows[0].count;
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT oo.*, u.full_name as created_by_name, s.full_name as shipped_by_name
       FROM outbound_orders oo
       LEFT JOIN users u ON oo.created_by = u.id
       LEFT JOIN users s ON oo.shipped_by = s.id
       WHERE oo.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async getItems(outboundId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT oi.*, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet
       FROM outbound_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.outbound_order_id = $1
       ORDER BY oi.id`,
      [outboundId],
    );
    return r.rows;
  }

  async create(data: Record<string, any>): Promise<number> {
    return this.db.transaction(async (client) => {
      const orderNumber = await this.generateNumber();
      const customerId = Number(data.customer_id ?? 0);
      if (!customerId) throw ApiException.badRequest('Customer wajib diisi.');
      const r = await client.query(
        `INSERT INTO outbound_orders
           (order_number, order_date, customer_id, so_number, do_number, shipment_number,
            ship_to_name, ship_to_location, ship_to_street, destination, kota,
            armada_no, container_no, jenis_armada, expected_date, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id`,
        [
          orderNumber,
          data.order_date,
          customerId,
          data.so_number ?? null,
          data.do_number ?? null,
          data.shipment_number ?? null,
          data.ship_to_name ?? null,
          data.ship_to_location ?? null,
          data.ship_to_street ?? null,
          data.destination ?? null,
          data.kota ?? null,
          data.armada_no ?? null,
          data.container_no ?? null,
          data.jenis_armada ?? null,
          data.expected_date || null,
          data.status ?? 'Open',
          data.notes ?? null,
          data.created_by,
        ],
      );
      const outboundId = Number(r.rows[0].id);
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          await this.addItem(outboundId, item, client);
        }
      }
      return outboundId;
    });
  }

  async addItem(outboundId: number, item: Record<string, any>, client?: any): Promise<number> {
    const dbc = client ?? this.db;
    const prod = await dbc.query('SELECT uom_type, uom_per_pallet FROM products WHERE id = $1', [item.product_id]);
    if (prod.rows.length === 0) throw ApiException.badRequest('Product tidak ditemukan.');
    const productInfo = prod.rows[0];
    const quantity = Number(item.quantity ?? 0);
    const uom = item.uom ?? productInfo.uom_type;
    const uomPerPallet = Math.max(1, Number(productInfo.uom_per_pallet ?? 4));
    const pallet = Math.ceil(quantity / uomPerPallet);
    const r = await dbc.query(
      `INSERT INTO outbound_items
         (outbound_order_id, product_id, quantity, uom, actual_qty, pallet,
          batch_no, exp_date, location, in_process_status, gr_plan_no,
          transaction_no, notes, od_number, so_number, destination_id, batch_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        outboundId,
        item.product_id,
        quantity,
        uom,
        item.actual_qty ?? quantity,
        pallet,
        item.batch_no ?? null,
        item.exp_date ?? null,
        item.location ?? null,
        item.in_process_status ?? 'Goods Received',
        item.gr_plan_no ?? null,
        item.transaction_no ?? null,
        item.notes ?? null,
        item.od_number ?? null,
        item.so_number ?? null,
        item.destination_id ?? null,
        item.batch_number ?? null,
      ],
    );
    return Number(r.rows[0].id);
  }

  async update(id: number, data: Record<string, any>, currentUserId: number | null = null): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw ApiException.notFound('Outbound tidak ditemukan.');
    if (['Completed', 'Cancelled'].includes(current.status)) {
      throw ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat diubah.');
    }
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE outbound_orders SET
           order_date = $1, customer_id = $2, so_number = $3, do_number = $4,
           shipment_number = $5, destination = $6, kota = $7,
           armada_no = $8, container_no = $9, jenis_armada = $10,
           expected_date = $11, notes = $12, status = $13, updated_at = NOW()
         WHERE id = $14`,
        [
          data.order_date ?? current.order_date,
          Number(data.customer_id ?? current.customer_id),
          data.so_number ?? current.so_number,
          data.do_number ?? current.do_number,
          data.shipment_number ?? current.shipment_number,
          data.destination ?? current.destination,
          data.kota ?? current.kota,
          data.armada_no ?? current.armada_no,
          data.container_no ?? current.container_no,
          data.jenis_armada ?? current.jenis_armada,
          data.expected_date ?? current.expected_date,
          data.notes ?? current.notes,
          data.status ?? current.status,
          id,
        ],
      );
      if ((data.shipped_date && String(data.shipped_date).trim() !== '') || data.status) {
        const newStatus = data.status ?? current.status;
        await client.query(
          `UPDATE outbound_orders SET shipped_by = $1, shipped_date = $2, status = $3 WHERE id = $4`,
          [currentUserId, data.shipped_date ?? current.shipped_date ?? null, newStatus, id],
        );
      }
    });
  }

  async delete(id: number): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw ApiException.notFound('Outbound tidak ditemukan.');
    if (['Completed', 'Cancelled'].includes(current.status)) {
      throw ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat dihapus.');
    }
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id IN (SELECT id FROM outbound_items WHERE outbound_order_id = $1)', [id]);
      await client.query('DELETE FROM outbound_items WHERE outbound_order_id = $1', [id]);
      await client.query('DELETE FROM outbound_destinations WHERE outbound_id = $1', [id]);
      await client.query('DELETE FROM outbound_orders WHERE id = $1', [id]);
    });
  }

  async deleteItem(itemId: number): Promise<void> {
    const itemR = await this.db.query('SELECT oi.*, oo.status FROM outbound_items oi JOIN outbound_orders oo ON oi.outbound_order_id = oo.id WHERE oi.id = $1', [itemId]);
    const item = itemR.rows[0];
    if (!item) throw ApiException.notFound('Item tidak ditemukan.');
    if (['Completed', 'Cancelled'].includes(item.status)) {
      throw ApiException.conflict('Order sudah selesai/dibatalkan dan tidak dapat diedit.');
    }
    await this.db.transaction(async (client) => {
      const allocations = await client.query(
        `SELECT oil.quantity, sl.id, sl.status, sl.quantity as sl_quantity
         FROM outbound_item_locations oil
         JOIN stock_locations sl ON oil.stock_location_id = sl.id
         WHERE oil.outbound_item_id = $1`,
        [itemId],
      );
      for (const alloc of allocations.rows) {
        if (alloc.status === 'Reserved') {
          const remainingQty = Number(alloc.sl_quantity) - Number(alloc.quantity);
          if (remainingQty > 0) {
            await client.query('UPDATE stock_locations SET quantity = $1 WHERE id = $2', [remainingQty, alloc.id]);
            await client.query(
              `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
               SELECT stock_id, location_code, pallet_seq, $1, $1, uom, is_full_pallet, batch_number, inbound_item_id, 'Available'
               FROM stock_locations WHERE id = $2`,
              [alloc.quantity, alloc.id],
            );
          } else {
            await client.query('UPDATE stock_locations SET status = $1 WHERE id = $2', ['Available', alloc.id]);
          }
        }
      }
      await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = $1', [itemId]);
      await client.query('DELETE FROM outbound_items WHERE id = $1', [itemId]);
    });
  }

  async changeItemStatus(itemId: number, status: string): Promise<void> {
    const allowed = ['Goods Received', 'ATP', 'Unserviceable'];
    if (!allowed.includes(status)) throw ApiException.badRequest('Status tidak valid.');
    await this.db.query('UPDATE outbound_items SET in_process_status = $1 WHERE id = $2', [status, itemId]);
  }

  async complete(id: number): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw ApiException.notFound('Outbound tidak ditemukan.');
    if (current.status === 'Cancelled') {
      throw ApiException.conflict('Order sudah dibatalkan dan tidak dapat diselesaikan.');
    }
    if (current.status === 'Completed') {
      return;
    }
    await this.db.query('UPDATE outbound_orders SET status = $1 WHERE id = $2', ['Completed', id]);
  }

  async getStats(): Promise<any> {
    const month = await this.db.query(
      `SELECT COUNT(*)::int as count, COALESCE(SUM(oi.quantity),0)::numeric(10,2) as total_quantity
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE EXTRACT(YEAR FROM oo.order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND EXTRACT(MONTH FROM oo.order_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
    );
    const byStatus = await this.db.query('SELECT status, COUNT(*)::int as count FROM outbound_orders GROUP BY status');
    const pending = await this.db.query("SELECT COUNT(*)::int as count FROM outbound_orders WHERE status IN ('Open','Picking')");
    return {
      this_month: month.rows[0],
      by_status: byStatus.rows,
      pending: pending.rows[0].count,
    };
  }

  async checkStock(productId: number, quantity: number, location?: string): Promise<any> {
    const params: unknown[] = [productId];
    let sql = `SELECT sl.id, sl.quantity, st.batch_number, st.expiry_date, sl.location_code, sl.pallet_seq
               FROM stock_locations sl
               JOIN stock st ON sl.stock_id = st.id
               WHERE st.product_id = $1
                 AND st.stock_status = 'Available'
                 AND sl.status = 'Available'
                 AND sl.quantity > 0
                 AND (st.expiry_date IS NULL OR st.expiry_date > CURRENT_DATE)`;
    if (location) {
      params.push(location);
      sql += ` AND sl.location_code = $${params.length}`;
    }
    sql += ` ORDER BY (st.expiry_date IS NULL), st.expiry_date ASC, sl.id ASC`;
    const r = await this.db.query(sql, params);
    const allocations: any[] = [];
    let remaining = quantity;
    let total = 0;
    for (const row of r.rows) {
      const take = Math.min(remaining, Number(row.quantity));
      if (take <= 0) continue;
      allocations.push({ ...row, quantity: take });
      remaining -= take;
      total += take;
      if (remaining <= 0) break;
    }
    const available = remaining <= 0;
    return {
      available,
      available_qty: total,
      fefo: allocations,
      message: available ? 'Stok tersedia.' : `Stok tidak cukup. Tersedia: ${total}, Dibutuhkan: ${quantity}`,
    };
  }

  /**
   * pickItems — spec §1.6 (docs/spec-2-outbound-picklist-bintransfer.md).
   * Only writer of outbound_item_locations + Reserved stock_locations + a picklist.
   * Does NOT write ledger (that happens in `ship`) and does NOT decrement stock.quantity.
   * Requires order status 'Open'. Supports re-pick (clears prior allocations for the items first).
   *
   * NOTE: the source PHP spec mentions `outbound_orders.picked_by/picked_at`, but the ported
   * schema (001-schema.sql, S2) has no such columns on outbound_orders — that bookkeeping lives
   * on `picklists`/`picklist_items` instead, so this only sets order status here.
   */
  async pickItems(outboundId: number, itemIds: number[], pickerId: number | null): Promise<void> {
    const order = await this.getById(outboundId);
    if (!order) throw ApiException.notFound('Outbound tidak ditemukan');
    if (order.status !== 'Open') {
      throw ApiException.conflict('Hanya order berstatus Open yang bisa di-pick');
    }

    await this.db.transaction(async (client) => {
      const itemsR = await client.query(
        `SELECT oi.*, p.uom_per_pallet as product_upp
         FROM outbound_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.outbound_order_id = $1 ${itemIds.length ? 'AND oi.id = ANY($2::bigint[])' : ''}
         ORDER BY oi.id`,
        itemIds.length ? [outboundId, itemIds] : [outboundId],
      );
      const items = itemsR.rows;
      if (items.length === 0) throw ApiException.badRequest('Tidak ada item untuk di-pick.');

      // Re-pick support: drop any previous allocations for these items before re-allocating.
      const idList = items.map((it: any) => Number(it.id));
      await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = ANY($1::bigint[])', [idList]);

      const existingPicklist = await client.query(
        `SELECT id FROM picklists WHERE outbound_order_id = $1 AND status IN ('Draft','Confirmed','Picking') ORDER BY id DESC LIMIT 1`,
        [outboundId],
      );
      let picklistId: number;
      if (existingPicklist.rows.length > 0) {
        picklistId = Number(existingPicklist.rows[0].id);
      } else {
        const picklistNumber = await generateNumber(this.db, {
          table: 'picklists',
          column: 'picklist_number',
          prefix: `PKL-${todayStr().slice(0, 7).replace('-', '')}-`,
          searchPrefix: `PKL-${todayStr().slice(0, 7).replace('-', '')}-`,
          pad: 4,
        });
        const ins = await client.query(
          `INSERT INTO picklists (outbound_order_id, picklist_number, created_date, status, created_by, confirmed_at)
           VALUES ($1,$2,$3,'Confirmed',$4,NOW()) RETURNING id`,
          [outboundId, picklistNumber, todayStr(), pickerId],
        );
        picklistId = Number(ins.rows[0].id);
      }

      for (const item of items) {
        const productId = Number(item.product_id);
        const needed = Number(item.quantity ?? 0);
        if (needed <= 0) continue;

        const params: unknown[] = [productId];
        let sql = `SELECT sl.id, sl.stock_id, sl.quantity, sl.location_code, sl.pallet_seq, sl.batch_number, sl.uom, sl.inbound_item_id
                   FROM stock_locations sl
                   JOIN stock st ON sl.stock_id = st.id
                   WHERE st.product_id = $1
                     AND st.stock_status = 'Available'
                     AND sl.status = 'Available'
                     AND sl.quantity > 0
                     AND (st.expiry_date IS NULL OR st.expiry_date > CURRENT_DATE)`;
        if (item.location) {
          params.push(item.location);
          sql += ` AND sl.location_code = $${params.length}`;
        }
        sql += ` ORDER BY (st.expiry_date IS NULL) ASC, st.expiry_date ASC, sl.id ASC FOR UPDATE OF sl`;
        const rowsR = await client.query(sql, params);

        let remaining = needed;
        let taken = 0;
        const allocations: Array<{ id: number; take: number; full: boolean; location_code: string; batch_number: string | null; pallet_seq: number }> = [];
        for (const row of rowsR.rows) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Number(row.quantity));
          if (take <= 0) continue;
          allocations.push({
            id: Number(row.id),
            take,
            full: take === Number(row.quantity),
            location_code: row.location_code,
            batch_number: row.batch_number,
            pallet_seq: row.pallet_seq,
          });
          remaining -= take;
          taken += take;
        }
        if (remaining > 0) {
          throw ApiException.conflict(`Stok tidak cukup untuk item ${productId}: tersedia ${taken}, dibutuhkan ${needed}`);
        }

        for (const alloc of allocations) {
          let reservedId = alloc.id;
          if (alloc.full) {
            await client.query(`UPDATE stock_locations SET status = 'Reserved', updated_at = NOW() WHERE id = $1`, [alloc.id]);
          } else {
            await client.query(`UPDATE stock_locations SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2`, [alloc.take, alloc.id]);
            const src = await client.query('SELECT * FROM stock_locations WHERE id = $1', [alloc.id]);
            const s = src.rows[0];
            const insLoc = await client.query(
              `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
               VALUES ($1,$2,$3,$4,$4,$5,0,$6,$7,'Reserved') RETURNING id`,
              [s.stock_id, s.location_code, s.pallet_seq, alloc.take, s.uom, s.batch_number, s.inbound_item_id],
            );
            reservedId = Number(insLoc.rows[0].id);
          }
          await client.query(
            'INSERT INTO outbound_item_locations (outbound_item_id, stock_location_id, quantity) VALUES ($1,$2,$3)',
            [item.id, reservedId, alloc.take],
          );
        }

        const firstAlloc = allocations[0];
        const upp = Math.max(1, Number(item.product_upp ?? 4));
        const palletQty = calcPalletByLocation(needed, upp, firstAlloc?.location_code ?? item.location ?? null);
        await client.query(
          `INSERT INTO picklist_items (picklist_id, product_id, batch_no, location, quantity, uom, pallet, picked_quantity, status, picker_id, batch_number, pallet_seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,0,'Pending',$8,$9,$10)`,
          [
            picklistId,
            productId,
            firstAlloc?.batch_number ?? item.batch_no ?? 'BAIK',
            firstAlloc?.location_code ?? item.location ?? null,
            needed,
            item.uom,
            palletQty,
            pickerId,
            firstAlloc?.batch_number ?? item.batch_number ?? null,
            firstAlloc?.pallet_seq ?? 1,
          ],
        );
      }

      await client.query(`UPDATE outbound_orders SET status = 'Picking', updated_at = NOW() WHERE id = $1`, [outboundId]);
    });
  }

  /**
   * ship — spec §1.7. Only writer of the outbound ledger OUT rows (per gotcha §4/§3: Outbound
   * balance = plain SUM(quantity_in)-SUM(quantity_out) over the WHOLE ledger for the product,
   * no QUA_SHELL/TRANSFER exclusions — unlike Inbound's runningBalance). Marks the Reserved
   * stock_locations rows Picked and decrements the parent stock.quantity. Requires order status
   * 'Picking' (i.e. already picked via pickItems).
   */
  async ship(outboundId: number, currentUserId: number | null): Promise<void> {
    const order = await this.getById(outboundId);
    if (!order) throw ApiException.notFound('Outbound tidak ditemukan');
    if (['Shipped', 'Delivered', 'Completed'].includes(order.status)) {
      throw ApiException.conflict('Order sudah dikirim/selesai.');
    }
    if (order.status !== 'Picking') {
      throw ApiException.conflict('Order harus berstatus Picking sebelum dikirim.');
    }

    await this.db.transaction(async (client) => {
      const allocR = await client.query(
        `SELECT oil.stock_location_id, oil.quantity, sl.location_code, sl.stock_id, sl.batch_number,
                oi.product_id, oi.uom
         FROM outbound_item_locations oil
         JOIN stock_locations sl ON oil.stock_location_id = sl.id
         JOIN outbound_items oi ON oil.outbound_item_id = oi.id
         WHERE oi.outbound_order_id = $1
         ORDER BY oil.id`,
        [outboundId],
      );
      if (allocR.rows.length === 0) {
        throw ApiException.conflict('Order belum di-pick, tidak ada alokasi stok.');
      }

      const balanceCache = new Map<number, number>();
      const getBalance = async (productId: number): Promise<number> => {
        const cached = balanceCache.get(productId);
        if (cached !== undefined) return cached;
        const r = await client.query(
          'SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS balance FROM stock_ledger WHERE product_id = $1',
          [productId],
        );
        const bal = Number(r.rows[0].balance ?? 0);
        balanceCache.set(productId, bal);
        return bal;
      };

      const stockDecrements = new Map<number, number>();

      for (const alloc of allocR.rows) {
        const productId = Number(alloc.product_id);
        const qty = Number(alloc.quantity);
        const prodR = await client.query('SELECT uom_per_pallet FROM products WHERE id = $1', [productId]);
        const upp = Math.max(1, Number(prodR.rows[0]?.uom_per_pallet ?? 4));
        const pallet = calcPalletByLocation(qty, upp, alloc.location_code);

        const cur = await getBalance(productId);
        const newBalance = cur - qty;
        balanceCache.set(productId, newBalance);

        await client.query(
          `INSERT INTO stock_ledger
             (transaction_date, product_id, transaction_type, reference_type,
              reference_id, reference_number, batch_number, quantity_in,
              quantity_out, uom, pallet, balance, location, notes)
           VALUES ($1,$2,'OUT','Outbound',$3,$4,$5,0,$6,$7,$8,$9,$10,$11)`,
          [
            todayStr(),
            productId,
            outboundId,
            order.order_number,
            alloc.batch_number,
            qty,
            alloc.uom,
            pallet,
            newBalance,
            alloc.location_code,
            `[Outbound] Ship | ${order.order_number}`,
          ],
        );

        const stockId = Number(alloc.stock_id);
        stockDecrements.set(stockId, (stockDecrements.get(stockId) ?? 0) + qty);
      }

      const allocIds = allocR.rows.map((r: any) => Number(r.stock_location_id));
      await client.query(
        `UPDATE stock_locations SET status = 'Picked', updated_at = NOW() WHERE id = ANY($1::bigint[]) AND status = 'Reserved'`,
        [allocIds],
      );

      for (const [stockId, qty] of stockDecrements) {
        await client.query('UPDATE stock SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE id = $2', [qty, stockId]);
      }

      await client.query(
        `UPDATE outbound_orders SET status = 'Shipped', shipped_by = $1, shipped_date = $2, updated_at = NOW() WHERE id = $3`,
        [currentUserId, todayStr(), outboundId],
      );
    });
  }

  async getPicklistLocations(outboundItemId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT sl.*, lm.zone
       FROM stock_locations sl
       LEFT JOIN location_master lm ON lm.location_code = sl.location_code
       WHERE sl.status IN ('Reserved','Available')
         AND sl.id IN (SELECT stock_location_id FROM outbound_item_locations WHERE outbound_item_id = $1)
       ORDER BY sl.pallet_seq`,
      [outboundItemId],
    );
    return r.rows;
  }
}