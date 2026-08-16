import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../database/db.service';
import { generateNumber } from '../common/number-gen';
import { ApiException } from '../common/api-exception';
import { ActivityLogger } from '../common/activity-logger';
import { MasterDataService } from '../master/master-data.service';
import { todayStr } from '../common/date-util';
import { calcPalletByLocation } from '../common/pallet';

/**
 * Outbound service — 1:1 port of classes/Outbound.php + api/handlers/outbound.php.
 * Key parity gotchas (session.md §4):
 *  - addItemWithFEFO is in-memory only (no writes to allocations/stock/ledger).
 *  - pickItems is the ONLY place stock is decremented + outbound_item_locations written.
 *  - ship writes the OUT ledger rows (balance = whole-ledger sum, no seed rows).
 *  - Outbound::deleteItem uses plain `= ?` for batch_number (NOT `<=>`).
 *  - update() NULLs ship_to_name/location/street always.
 */
@Injectable()
export class OutboundService {
  constructor(private readonly db: DbService, private readonly activity: ActivityLogger, private readonly master: MasterDataService) {}

  displayOrderNo(outbound: any): string {
    const ship = String(outbound?.shipment_number ?? '').trim();
    if (ship !== '') return ship;
    const ord = String(outbound?.order_number ?? '').trim();
    return ord !== '' ? ord : '-';
  }

  async generateNumber(): Promise<string> {
    return generateNumber(this.db, {
      table: 'outbound_orders',
      column: 'order_number',
      prefix: `OUT-${todayStr().slice(0, 7).replace('-', '')}-`,
      searchPrefix: `OUT-${todayStr().slice(0, 7).replace('-', '')}-`,
      pad: 4,
    });
  }

  async saveDestinations(
    outboundId: number,
    names: string[],
    locations: string[],
    streets: string[],
    kotas: string[],
    notes: string[],
  ): Promise<void> {
    const db = this.db;
    await db.query('DELETE FROM outbound_destinations WHERE outbound_id = $1', [outboundId]);
    for (let i = 0; i < names.length; i++) {
      const name = String(names[i] ?? '').trim();
      if (name === '') continue;
      await db.query(
        `INSERT INTO outbound_destinations (outbound_id, seq, ship_to_name, ship_to_location, ship_to_street, kota, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          outboundId,
          i + 1,
          name,
          String(locations[i] ?? '').trim(),
          String(streets[i] ?? '').trim(),
          String(kotas[i] ?? '').trim(),
          String(notes[i] ?? '').trim(),
        ],
      );
    }
  }

  async attachDestination(outboundId: number, newItemId: number, item: Record<string, any>): Promise<void> {
    const itemShipToName = String(item.item_ship_to_name ?? item.ship_to_name ?? '').trim();
    const itemShipToLoc = String(item.item_ship_to_location ?? item.ship_to_location ?? '').trim();
    const itemShipToStreet = String(item.item_ship_to_street ?? item.ship_to_street ?? '').trim();
    if (itemShipToName === '' && itemShipToLoc === '') return;

    const db = this.db;
    const last = await db.query(
      'SELECT id FROM outbound_items WHERE outbound_order_id = $1 ORDER BY id DESC LIMIT 1',
      [outboundId],
    );
    const lastItemId = last.rows[0]?.id ?? null;
    const seqR = await db.query(
      'SELECT COALESCE(MAX(seq),0)+1 as next_seq FROM outbound_destinations WHERE outbound_id = $1',
      [outboundId],
    );
    const nextSeq = Number(seqR.rows[0].next_seq ?? 1);
    const existsR = await db.query(
      'SELECT id FROM outbound_destinations WHERE outbound_id = $1 AND ship_to_name = $2 LIMIT 1',
      [outboundId, itemShipToName],
    );
    const existing = existsR.rows[0];
    try {
      if (!existing) {
        const ins = await db.query(
          `INSERT INTO outbound_destinations (outbound_id, seq, ship_to_name, ship_to_location, kota, ship_to_street, notes)
           VALUES ($1,$2,$3,$4,$4,$5,NULL) RETURNING id`,
          [outboundId, nextSeq, itemShipToName, itemShipToLoc, itemShipToStreet],
        );
        const newDestId = Number(ins.rows[0].id);
        if (lastItemId) {
          await db.query('UPDATE outbound_items SET destination_id = $1 WHERE id = $2', [newDestId, lastItemId]);
        }
      } else if (lastItemId) {
        await db.query('UPDATE outbound_items SET destination_id = $1 WHERE id = $2', [Number(existing.id), lastItemId]);
      }
    } catch (e) {
      /* PHP swallows PDOException here */
    }
  }

  async getAll(status: string | null, limit: number | null, offset: number, odNo: string | null): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (odNo) {
      params.push(`%${odNo}%`);
      conditions.push(`oi.od_number LIKE $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    let sql = `SELECT o.*,
              c.customer_name, c.customer_code, c.city,
              u.full_name as created_by_name,
              s.full_name as shipped_by_name,
              COUNT(DISTINCT oi.id)::int as total_items,
              SUM(oi.actual_qty) as total_qty,
              SUM(oi.pallet) as total_pallet,
              STRING_AGG(DISTINCT oi.od_number, ', ' ORDER BY oi.od_number) as od_numbers,
              (SELECT COUNT(*)::int FROM inbound_items cdi WHERE cdi.cross_dock_outbound_order_id = o.id) as cross_dock_count
       FROM outbound_orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.created_by = u.id
       LEFT JOIN users s ON o.shipped_by = s.id
       LEFT JOIN outbound_items oi ON o.id = oi.outbound_order_id
       ${where}
       GROUP BY o.id, c.customer_name, c.customer_code, c.city, u.full_name, s.full_name
       ORDER BY o.order_date DESC, o.created_at DESC`;
    if (limit) {
      params.push(limit, offset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const r = await this.db.query(sql, params);
    return r.rows;
  }

  async countAll(status: string | null, odNo: string | null): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (odNo) {
      params.push(`%${odNo}%`);
      conditions.push(`oi.od_number LIKE $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await this.db.query(
      `SELECT COUNT(DISTINCT o.id)::int FROM outbound_orders o
       LEFT JOIN outbound_items oi ON o.id = oi.outbound_order_id ${where}`,
      params,
    );
    return r.rows[0].count;
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT o.*,
              c.customer_name, c.customer_code, c.address, c.city,
              u.full_name as created_by_name,
              s.full_name as shipped_by_name
       FROM outbound_orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.created_by = u.id
       LEFT JOIN users s ON o.shipped_by = s.id
       WHERE o.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async getItems(outboundId: number): Promise<any[]> {
    const rowsR = await this.db.query(
      `SELECT oi.*,
              p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              COALESCE(oi.batch_number, oi.batch_no) AS resolved_batch,
              oi.location AS resolved_location,
              oi.exp_date AS resolved_expiry,
              COALESCE(NULLIF(od.ship_to_name,''), NULLIF(o.ship_to_name,'')) AS item_ship_to_name,
              COALESCE(NULLIF(od.ship_to_location,''), NULLIF(od.kota,''), NULLIF(o.ship_to_location,''), NULLIF(o.kota,'')) AS item_ship_to_location,
              NULLIF(od.ship_to_street,'') AS item_ship_to_street,
              COALESCE(NULLIF(od.kota,''), NULLIF(o.kota,'')) AS item_ship_to_kota,
              COALESCE(ci.customer_name, co.customer_name) AS order_customer_name,
              COALESCE(ci.customer_code, co.customer_code) AS order_customer_code,
              cd.inbound_item_id AS cross_dock_inbound_item_id,
              cd.batch_number AS cross_dock_batch,
              io.order_number AS cross_dock_inbound_number
       FROM outbound_items oi
       JOIN products p ON oi.product_id = p.id
       LEFT JOIN outbound_destinations od ON oi.destination_id = od.id
       LEFT JOIN outbound_orders o ON oi.outbound_order_id = o.id
       LEFT JOIN customers ci ON oi.customer_id = ci.id
       LEFT JOIN customers co ON o.customer_id = co.id
       LEFT JOIN LATERAL (
         SELECT ii.id AS inbound_item_id, ii.batch_number
         FROM inbound_items ii
         WHERE ii.cross_dock_outbound_order_id = oi.outbound_order_id
           AND ii.product_id = oi.product_id
         ORDER BY ii.id
         LIMIT 1
       ) cd ON TRUE
       LEFT JOIN inbound_orders io ON io.id = (SELECT ii2.inbound_order_id FROM inbound_items ii2 WHERE ii2.id = cd.inbound_item_id)
       WHERE oi.outbound_order_id = $1
       ORDER BY oi.id`,
      [outboundId],
    );
    const rows = rowsR.rows;

    for (const row of rows) {
      if (!row.resolved_batch) {
        const fefo = await this.db.query(
          `SELECT batch_number, location, expiry_date
           FROM stock
           WHERE product_id = $1 AND quantity > 0
             AND (stock_status IN ('Available','Dues In') OR stock_status IS NULL OR stock_status = '')
             AND (location IS NULL OR location NOT IN ('QUA_SHELL','STAGING'))
           ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC
           LIMIT 1`,
          [row.product_id],
        );
        const f = fefo.rows[0];
        if (f) {
          row.resolved_batch = f.batch_number;
          row.resolved_location = f.location;
          row.resolved_expiry = f.expiry_date;
        }
      }

      row.batch_number = row.resolved_batch;
      row.location = row.resolved_location;
      row.expiry_date = row.resolved_expiry;
      row.exp_date = row.resolved_expiry;

      const currentStatus = row.in_process_status ?? 'Goods Received';
      if (currentStatus !== 'Unserviceable') {
        const batch = row.batch_number;
        // Cross-docked items arrive staged at STAGING (bypassing putaway), so
        // the stock-availability probe must consider STAGING for those lines.
        const locExclusion = row.cross_dock_inbound_item_id
          ? "location NOT IN ('QUA_SHELL')"
          : "location NOT IN ('QUA_SHELL','STAGING')";
        const inStockR = await this.db.query(
          `SELECT COUNT(*)::int FROM stock
           WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2
             AND stock_status = 'Available' AND quantity > 0
             AND (location IS NULL OR ${locExclusion})`,
          [row.product_id, batch],
        );
        const inStock = Number(inStockR.rows[0].count) > 0;
        if (inStock && currentStatus !== 'ATP') {
          await this.db.query(`UPDATE outbound_items SET in_process_status = 'ATP' WHERE id = $1`, [row.id]);
          row.in_process_status = 'ATP';
        } else if (!inStock && currentStatus === 'ATP') {
          await this.db.query(`UPDATE outbound_items SET in_process_status = 'Goods Received' WHERE id = $1`, [row.id]);
          row.in_process_status = 'Goods Received';
        }
      }
    }
    return rows;
  }

  async getItemPickedLocations(outboundItemId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT oil.quantity AS picked_qty,
              COALESCE(sl.location_code, oi.location) AS location_code,
              sl.pallet_seq,
              COALESCE(sl.batch_number, oi.batch_number, oi.batch_no) AS batch_number,
              COALESCE(sl.original_quantity, sl.quantity, oil.quantity) AS original_qty,
              sl.is_full_pallet,
              COALESCE(sl.uom, oi.uom) AS uom
       FROM outbound_item_locations oil
       JOIN outbound_items oi ON oi.id = oil.outbound_item_id
       LEFT JOIN stock_locations sl ON oil.stock_location_id = sl.id
       WHERE oil.outbound_item_id = $1
       ORDER BY COALESCE(sl.location_code, oi.location), sl.pallet_seq`,
      [outboundItemId],
    );
    return r.rows;
  }

  async getDestinations(outboundId: number): Promise<any[]> {
    const r = await this.db.query(
      'SELECT * FROM outbound_destinations WHERE outbound_id = $1 ORDER BY seq',
      [outboundId],
    );
    return r.rows;
  }

  async getAvailableStock(productId: number, location?: string | null): Promise<any[]> {
    const loc = location !== null && location !== undefined ? String(location).trim() : '';
    let locClause = '';
    const params: unknown[] = [productId];
    if (loc !== '') {
      locClause = 'AND LOWER(TRIM(st.location)) = LOWER($2)';
      params.push(loc);
    }
    const r = await this.db.query(
      `SELECT st.id, st.product_id, st.batch_number, st.location,
              st.quantity, st.uom, st.pallet,
              st.manufacture_date,
              COALESCE(
                (SELECT ii_exp.exp_date
                 FROM stock_locations sl_exp
                 JOIN inbound_items ii_exp ON ii_exp.id = sl_exp.inbound_item_id
                 WHERE sl_exp.stock_id = st.id
                 ORDER BY ii_exp.id DESC
                 LIMIT 1),
                st.expiry_date
              ) AS expiry_date,
              st.stock_status,
              p.product_name, p.uom_type, p.uom_per_pallet
       FROM stock st
       JOIN products p ON st.product_id = p.id
       WHERE st.product_id = $1
         AND (st.stock_status IN ('Available','Dues In') OR st.stock_status IS NULL OR st.stock_status = '')
         AND (st.hold_status = 'available' OR st.hold_status IS NULL)
         AND st.quantity > 0
         AND (st.location IS NULL OR st.location NOT IN ('QUA_SHELL','STAGING'))
         ${locClause}
       ORDER BY
         CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END ASC,
         expiry_date ASC,
         st.id ASC`,
      params,
    );
    return r.rows;
  }

  async getTotalAvailableQty(productId: number): Promise<number> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(quantity),0) as total FROM stock
       WHERE product_id = $1
         AND (stock_status IN ('Available','Dues In') OR stock_status IS NULL OR stock_status = '')
         AND (hold_status = 'available' OR hold_status IS NULL)
         AND quantity > 0
         AND (location IS NULL OR location NOT IN ('QUA_SHELL','STAGING'))`,
      [productId],
    );
    return Number(r.rows[0].total ?? 0);
  }

  /** Exactly mirrors PHP getFEFOAllocation shape. */
  async getFEFOAllocation(productId: number, requiredQty: number, location: string | null = null): Promise<any> {
    const stockRows = await this.getAvailableStock(productId, location);
    const allocation: any[] = [];
    let remainingQty = Number(Number(requiredQty).toFixed(6));

    for (const stock of stockRows) {
      if (remainingQty <= 1e-9) break;
      const availableQty = Number(stock.quantity);
      const take = Math.min(remainingQty, availableQty);
      allocation.push({
        stock_id: Number(stock.id),
        batch_number: stock.batch_number,
        location: stock.location,
        expiry_date: stock.expiry_date,
        required_qty: take,
        available_qty: availableQty,
        is_partial: take < availableQty,
      });
      remainingQty = Number((remainingQty - take).toFixed(6));
    }

    let totalAvailable = 0;
    for (const row of stockRows) totalAvailable += Number(row.quantity ?? 0);

    return {
      allocation,
      sufficient: remainingQty <= 1e-5,
      shortage: Math.max(0, remainingQty),
      total_available: totalAvailable,
    };
  }

  async checkStock(productId: number, quantity: number, location: string | null = null): Promise<any> {
    const avail = await this.getTotalAvailableQty(productId);
    const fefo = await this.getFEFOAllocation(productId, quantity, location);
    return { available: avail, fefo };
  }

  /**
   * addItemWithFEFO — in-memory FEFO feasibility + insert row. Writes NOTHING
   * to stock_locations / outbound_item_locations / stock / ledger.
   *
   * When called with a `client` (inside an outer transaction), all reads and the
   * insert run on that same client so the row is visible within the transaction.
   * Without a client it falls back to the shared pool (standalone `add_item`).
   */
  async addItemWithFEFO(outboundId: number, item: Record<string, any>, client?: PoolClient): Promise<number> {
    const db: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> } = client ?? this.db;
    const product = await db.query(
      'SELECT uom_type, uom_per_pallet, max_sku_qty, max_trans_qty FROM products WHERE id = $1',
      [item.product_id],
    );
    const productInfo = product.rows[0];
    if (!productInfo) throw new ApiException('Product not found', 409);

    const quantity = Number(item.quantity ?? 0);
    const uom = item.uom ?? productInfo.uom_type;
    const uomPerPallet = Math.max(1, Number.parseInt(productInfo.uom_per_pallet ?? '4', 10) || 4);

    const manualLocs = Array.isArray(item.manual_locs) && item.manual_locs.length > 0 ? item.manual_locs : null;
    const manualLoc = item.manual_location ? String(item.manual_location).trim() : null;

    const totalAvailable = await this.getTotalAvailableQty(Number(item.product_id));
    if (quantity > totalAvailable) {
      throw new ApiException(
        'Stok tidak mencukupi. Stok tersedia: ' + Math.round(totalAvailable).toLocaleString('en-US') +
        ', Qty diminta: ' + Math.round(quantity).toLocaleString('en-US'),
        409,
      );
    }

    let fefo: any;
    if (manualLocs) {
      const manualTotal = manualLocs.reduce((a: number, b: any) => a + Number(b.qty ?? 0), 0);
      if (Math.abs(manualTotal - quantity) > 0.01) {
        throw new ApiException(
          'Total qty bin manual (' + Math.round(manualTotal).toLocaleString('en-US') +
          ') tidak sama dengan qty order (' + Math.round(quantity).toLocaleString('en-US') + ')',
          409,
        );
      }
      const allAllocations: any[] = [];
      for (const binEntry of manualLocs) {
        const binLoc = String(binEntry.location ?? '').trim();
        const binQty = Number(binEntry.qty ?? 0);
        if (binQty <= 0) continue;
        const binFefo = await this.getFEFOAllocation(Number(item.product_id), binQty, binLoc || null);
        if (!binFefo.sufficient) {
          throw new ApiException(
            `Stok di bin '${binLoc}' tidak mencukupi. Diminta: ${Math.round(binQty).toLocaleString('en-US')}, Tersedia: ${Math.round(binFefo.total_available).toLocaleString('en-US')}`,
            409,
          );
        }
        for (const alloc of binFefo.allocation) {
          allAllocations.push({ ...alloc, _bin: binLoc });
        }
      }
      fefo = { sufficient: true, shortage: 0, total_available: totalAvailable, allocation: allAllocations };
    } else {
      fefo = await this.getFEFOAllocation(Number(item.product_id), quantity, manualLoc || null);
      if (!fefo.sufficient) {
        const scoped = (manualLoc !== null && manualLoc !== '') || !!manualLocs;
        let msg = 'Stok tidak mencukupi untuk alokasi FEFO. Qty diminta: ' + Math.round(quantity).toLocaleString('en-US') + '.';
        if (scoped) {
          msg += ' Stok di lokasi/bin terpilih: ' + Math.round(fefo.total_available).toLocaleString('en-US') +
            ' (total pickable gudang: ' + Math.round(totalAvailable).toLocaleString('en-US') + ').';
        } else {
          msg += ' Tersedia (FEFO): ' + Math.round(fefo.total_available).toLocaleString('en-US') + '.';
        }
        throw new ApiException(msg, 409);
      }
    }

    const pallet = this.calculatePallet(quantity, uomPerPallet);
    const firstBatch = fefo.allocation[0];

    let locSummary: string | null = null;
    if (manualLocs && manualLocs.length > 1) {
      locSummary = manualLocs.map((b: any) => b.location).join(', ');
    } else {
      locSummary = (firstBatch?.location as string | null) ?? manualLoc;
    }

    const ins = await db.query(
      `INSERT INTO outbound_items
         (outbound_order_id, product_id, quantity, uom,
          actual_qty, pallet, batch_no, exp_date, location, notes, od_number, so_number, destination_id, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        outboundId,
        item.product_id,
        quantity,
        uom,
        item.actual_qty ?? quantity,
        pallet,
        firstBatch?.batch_number ?? null,
        firstBatch?.expiry_date ?? null,
        locSummary,
        item.notes ?? null,
        item.od_number ?? null,
        item.so_number ?? null,
        item.destination_id ?? null,
        item.customer_id ?? null,
      ],
    );
    return Number(ins.rows[0].id);
  }

  calculatePallet(quantity: number, uomPerPallet: number): number {
    if (uomPerPallet === 0) return 0;
    return Math.ceil(quantity / uomPerPallet);
  }

  async create(data: Record<string, any>): Promise<number> {
    return this.db.transaction(async (client) => {
      const outboundNumber = data.shipment_number ? String(data.shipment_number) : await this.generateNumber();
      const ins = await client.query(
        `INSERT INTO outbound_orders
           (order_number, order_date, customer_id, so_number, do_number,
            shipment_number, ship_to_name, ship_to_location, ship_to_street,
            destination, kota, armada_no, container_no, jenis_armada,
            expected_date, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          outboundNumber,
          data.order_date,
          data.customer_id ?? null,
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
          data.expected_date ?? null,
          data.status ?? 'Open',
          data.notes ?? null,
          data.created_by,
        ],
      );
      const outboundId = Number(ins.rows[0].id);
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          await this.addItemWithFEFO(outboundId, item, client);
        }
      }
      return outboundId;
    });
  }

  async update(id: number, data: Record<string, any>, currentUserId: number | null = null): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE outbound_orders SET
           order_date = $1,
           customer_id = $2,
           so_number = $3,
           do_number = $4,
           shipment_number = $5,
           ship_to_name = $6,
           ship_to_location = $7,
           ship_to_street = $8,
           destination = $9,
           kota = $10,
           armada_no = $11,
           container_no = $12,
           jenis_armada = $13,
           expected_date = $14,
           status = $15,
           notes = $16
         WHERE id = $17`,
        [
          data.order_date,
          data.customer_id,
          data.so_number ?? null,
          data.do_number ?? null,
          data.shipment_number ?? null,
          null,
          null,
          null,
          data.destination ?? null,
          data.kota ?? null,
          data.armada_no ?? null,
          data.container_no ?? null,
          data.jenis_armada ?? null,
          data.expected_date ?? null,
          data.status ?? 'Open',
          data.notes ?? null,
          id,
        ],
      );

      if (data.shipped_date !== undefined || data.status !== undefined) {
        await client.query(
          'UPDATE outbound_orders SET shipped_by = $1, status = $2 WHERE id = $3',
          [currentUserId, data.status ?? 'Open', id],
        );
      }
    });
  }

  async updateItem(itemId: number, data: Record<string, any>): Promise<boolean> {
    await this.db.query(
      `UPDATE outbound_items SET
         quantity = $1, uom = $2, actual_qty = $3,
         batch_no = $4, exp_date = $5, location = $6, notes = $7
       WHERE id = $8`,
      [
        data.quantity ?? 0,
        data.uom ?? 'Drum',
        data.actual_qty ?? data.quantity ?? 0,
        data.batch_no ?? null,
        data.exp_date ?? null,
        data.location ?? null,
        data.notes ?? null,
        itemId,
      ],
    );
    return true;
  }

  async deleteItem(itemId: number): Promise<void> {
    const db = this.db;
    await db.transaction(async (client) => {
      const itemR = await client.query(
        `SELECT oi.*, oo.status AS order_status, p.uom_per_pallet
         FROM outbound_items oi
         JOIN outbound_orders oo ON oo.id = oi.outbound_order_id
         JOIN products p ON p.id = oi.product_id
         WHERE oi.id = $1`,
        [itemId],
      );
      const item = itemR.rows[0];
      if (!item) {
        const destRow = await client.query(
          'SELECT destination_id, outbound_order_id FROM outbound_items WHERE id = $1',
          [itemId],
        );
        const destInfo = destRow.rows[0];
        await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = $1', [itemId]);
        await client.query('DELETE FROM outbound_items WHERE id = $1', [itemId]);
        if (destInfo?.destination_id) {
          const remaining = await client.query(
            'SELECT COUNT(*)::int FROM outbound_items WHERE destination_id = $1',
            [destInfo.destination_id],
          );
          if (Number(remaining.rows[0].count) === 0) {
            await client.query('DELETE FROM outbound_destinations WHERE id = $1', [destInfo.destination_id]);
          }
        }
        return;
      }

      const wasPicked = ['Picking', 'Shipped', 'Completed'].includes(item.order_status ?? '');
      const isUnserv = (item.in_process_status ?? '') === 'Unserviceable';
      const pid = Number(item.product_id);
      const batch = item.batch_no ?? item.batch_number ?? null;
      const qty = Number(item.actual_qty ?? item.quantity ?? 0);

      if (wasPicked && qty > 0 && !isUnserv) {
        const obLocs = await client.query(
          `SELECT oil.quantity AS restore_qty,
                  sl.id AS sl_id, sl.stock_id, sl.location_code AS loc,
                  sl.batch_number AS sl_batch, sl.original_quantity AS orig_qty
           FROM outbound_item_locations oil
           JOIN stock_locations sl ON sl.id = oil.stock_location_id
           WHERE oil.outbound_item_id = $1`,
          [itemId],
        );
        for (const pr of obLocs.rows) {
          const rQty = Number(pr.restore_qty ?? 0);
          const rLoc = pr.loc ?? null;
          const rBatch = pr.sl_batch ?? batch;
          const slId = pr.sl_id ?? null;
          const sid = pr.stock_id ?? null;
          if (rQty <= 0) continue;

          let restored = false;
          if (sid) {
            const srow = await client.query('SELECT id, quantity FROM stock WHERE id = $1', [sid]);
            if (srow.rows[0]) {
              await client.query('UPDATE stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [rQty, sid]);
              restored = true;
            }
          }
          if (!restored && rLoc) {
            const find = await client.query(
              'SELECT id FROM stock WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2 AND location = $3 AND stock_status = \'Available\'',
              [pid, rBatch, rLoc],
            );
            const found = find.rows[0];
            if (found) {
              await client.query('UPDATE stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [rQty, found.id]);
              if (slId) {
                await client.query('UPDATE stock_locations SET stock_id = $1, status = \'Available\' WHERE id = $2', [found.id, slId]);
              }
            } else {
              const uomPerPallet = Math.max(1, Number(item.uom_per_pallet ?? 4));
              const ins = await client.query(
                `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, stock_status)
                 VALUES ($1,$2,$3,$4,$5,$6,'Available') RETURNING id`,
                [pid, rBatch, rLoc, rQty, item.uom ?? 'Drum', Math.max(1, Math.ceil(rQty / uomPerPallet))],
              );
              const nid = Number(ins.rows[0].id);
              if (slId) {
                await client.query('UPDATE stock_locations SET stock_id = $1, status = \'Available\' WHERE id = $2', [nid, slId]);
              }
            }
          }
          if (slId) {
            const origQty = Number(pr.orig_qty ?? rQty);
            await client.query('UPDATE stock_locations SET status = \'Available\', quantity = $1 WHERE id = $2', [origQty, slId]);
          }
        }
      }

      const destRow = await client.query(
        'SELECT destination_id, outbound_order_id FROM outbound_items WHERE id = $1',
        [itemId],
      );
      const destInfo = destRow.rows[0];

      if (item.order_status === 'Shipped') {
        await client.query(
          `DELETE FROM stock_ledger WHERE reference_type='Outbound' AND reference_id=$1 AND product_id=$2`,
          [destInfo?.outbound_order_id, pid],
        );
      }

      await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = $1', [itemId]);
      await client.query('DELETE FROM outbound_items WHERE id = $1', [itemId]);

      if (destInfo?.destination_id) {
        const remaining = await client.query(
          'SELECT COUNT(*)::int FROM outbound_items WHERE destination_id = $1',
          [destInfo.destination_id],
        );
        if (Number(remaining.rows[0].count) === 0) {
          await client.query('DELETE FROM outbound_destinations WHERE id = $1', [destInfo.destination_id]);
        }
      }
    });
  }

  /** outbound_change_item_status — ported from handler. */
  async changeItemStatus(itemId: number, newSt: string): Promise<void> {
    const db = this.db;
    if (!['Goods Received', 'ATP', 'Unserviceable'].includes(newSt)) {
      throw ApiException.badRequest('Status tidak valid.');
    }
    const itR = await db.query(
      `SELECT oi.*, oo.status AS order_status
       FROM outbound_items oi JOIN outbound_orders oo ON oo.id = oi.outbound_order_id WHERE oi.id = $1`,
      [itemId],
    );
    const it = itR.rows[0];
    if (!it) throw ApiException.notFound('Item tidak ditemukan');

    if (newSt === 'ATP' && (it.in_process_status ?? '') !== 'ATP') {
      const stockCheck = await db.query(
        `SELECT COUNT(*)::int FROM stock
         WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM COALESCE($2,$3)
           AND stock_status = 'Available' AND quantity > 0
           AND (location IS NULL OR location NOT IN ('QUA_SHELL','STAGING'))`,
        [it.product_id, it.batch_number ?? null, it.batch_no ?? null],
      );
      if (Number(stockCheck.rows[0].count) === 0) {
        throw ApiException.conflict('Inbound belum ATP. Stock belum tersedia untuk item ini.');
      }
    }

    await db.transaction(async (client) => {
      if (newSt === 'Unserviceable') {
        if (['Picking', 'Shipped'].includes(it.order_status ?? '')) {
          const batch = it.batch_no ?? it.batch_number ?? null;
          const qty = Number(it.actual_qty ?? it.quantity ?? 0);
          const loc = it.location ?? null;
          if (loc && loc !== 'QUA_SHELL') {
            await client.query(
              `UPDATE stock SET quantity = GREATEST(0, quantity - $1)
               WHERE product_id=$2 AND batch_number IS NOT DISTINCT FROM $3 AND location=$4 AND stock_status='Available'`,
              [qty, it.product_id, batch, loc],
            );
            await client.query(
              `DELETE FROM stock WHERE quantity<=0 AND location=$1 AND stock_status='Available'`,
              [loc],
            );
          }
          const upsert = await client.query(
            `SELECT id FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND location='QUA_SHELL' AND stock_status='Rejected' LIMIT 1`,
            [it.product_id, batch],
          );
          if (upsert.rows[0]) {
            await client.query(
              `UPDATE stock SET quantity = quantity + $1, pallet = pallet + $2 WHERE id = $3`,
              [qty, Number(it.pallet ?? 0), upsert.rows[0].id],
            );
          } else {
            await client.query(
              `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, stock_status)
               VALUES ($1,$2,'QUA_SHELL',$3,$4,$5,'Rejected')`,
              [it.product_id, batch, qty, it.uom ?? 'Drum', Number(it.pallet ?? 0)],
            );
          }
          await client.query(`UPDATE outbound_items SET location='QUA_SHELL' WHERE id=$1`, [itemId]);
          await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id=$1', [itemId]);
        }
      }
      if (newSt === 'ATP' && (it.in_process_status ?? '') === 'Unserviceable') {
        const batch = it.batch_no ?? it.batch_number ?? null;
        const qty = Number(it.actual_qty ?? it.quantity ?? 0);
        await client.query(
          `UPDATE stock SET quantity=GREATEST(0,quantity-$1)
           WHERE product_id=$2 AND batch_number IS NOT DISTINCT FROM $3 AND location='QUA_SHELL' AND stock_status='Rejected'`,
          [qty, it.product_id, batch],
        );
        await client.query(`DELETE FROM stock WHERE quantity<=0 AND stock_status='Rejected'`);
        await client.query(`UPDATE outbound_items SET location=NULL WHERE id=$1 AND location='QUA_SHELL'`, [itemId]);
      }
      await client.query('UPDATE outbound_items SET in_process_status=$1 WHERE id=$2', [newSt, itemId]);
    });
  }

  /** pickItems — decrements stock, writes outbound_item_locations. No ledger. */
  async pickItems(outboundId: number): Promise<void> {
    const db = this.db;
    await db.transaction(async (client) => {
      const outbound = await this.getById(outboundId);
      if (!outbound) throw ApiException.notFound('Outbound tidak ditemukan');
      if (outbound.status !== 'Open') throw ApiException.conflict('Hanya order berstatus Open yang bisa di-pick');

      const items = await this.getItems(outboundId);

      const pickLocs = Array.from(new Set(items.map((it: any) => it.location).filter(Boolean)));
      if (pickLocs.length > 0) {
        const locked = await client.query(
          `SELECT st.take_number, sti.location
           FROM stock_take_items sti JOIN stock_take st ON st.id = sti.stock_take_id
           WHERE st.status IN ('Counting','Review') AND sti.location IN (${Array.from(pickLocs, (_, i) => `$${i + 1}`).join(',')})
           LIMIT 5`,
          pickLocs,
        );
        const rows = locked.rows;
        if (rows.length > 0) {
          const takeNo = rows[0].take_number;
          const locs = Array.from(new Set(rows.map((r: any) => r.location))).join(', ');
          throw ApiException.conflict(
            `Picking diblokir — lokasi [${locs}] sedang dalam sesi Stock Take aktif (${takeNo}). Selesaikan atau batalkan stock take terlebih dahulu.`,
          );
        }
      }

      for (const item of items) {
        const itemProcessStatus = item.in_process_status ?? '';
        if (itemProcessStatus !== 'ATP') continue;

        const needed = Number(item.actual_qty ?? item.quantity ?? 0);
        const productId = Number(item.product_id);
        const preferBatch = item.batch_number ?? item.batch_no ?? null;
        // Cross-docked lines are staged at STAGING (bypass putaway), so their
        // stock must be eligible here; normal lines keep excluding STAGING.
        const isCrossDock = Boolean(item.cross_dock_inbound_item_id);

        const qR = await client.query(
          `SELECT * FROM stock
           WHERE product_id = $1
             AND (stock_status IN ('Available','Dues In') OR stock_status IS NULL OR stock_status = '')
             AND (hold_status = 'available' OR hold_status IS NULL)
             AND quantity > 0
             AND location != 'QUA_SHELL'
             ${isCrossDock ? "AND location = 'STAGING'" : "AND location != 'STAGING'"}
           ORDER BY
             CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END ASC,
             expiry_date ASC,
             id ASC`,
          [productId],
        );
        let stockRows = qR.rows;

        if (preferBatch) {
          stockRows = stockRows
            .map((s: any) => ({ s, match: s.batch_number === preferBatch ? 0 : 1 }))
            .sort((a: any, b: any) => {
              if (a.match !== b.match) return a.match - b.match;
              const aExp = a.s.expiry_date ? new Date(a.s.expiry_date).getTime() : new Date('9999-12-31').getTime();
              const bExp = b.s.expiry_date ? new Date(b.s.expiry_date).getTime() : new Date('9999-12-31').getTime();
              return aExp - bExp;
            })
            .map((x: any) => x.s);
        }

        if (!stockRows.length) {
          throw ApiException.conflict('Stok tidak tersedia untuk produk: ' + (item.product_name ?? productId));
        }

        const totalAvail = stockRows.reduce((a: number, s: any) => a + Number(s.quantity), 0);
        if (totalAvail < needed - 0.001) {
          throw ApiException.conflict(
            'Stok kurang ' + (needed - totalAvail).toFixed(2) +
            ' unit untuk produk: ' + (item.product_name ?? productId) +
            ' (tersedia: ' + totalAvail.toFixed(2) + ', dibutuhkan: ' + needed.toFixed(2) + ')',
          );
        }

        let remaining = needed;
        let usedBatch: string | null = null;
        let usedLocation: string | null = null;
        const pickedRows: any[] = [];

        for (const stock of stockRows) {
          if (remaining <= 0.001) break;
          const deduct = Math.min(remaining, Number(stock.quantity));
          const newQty = Number(stock.quantity) - deduct;

          const palletRatio = Number(stock.quantity) > 0 ? deduct / Number(stock.quantity) : 0;
          const newPlt = Math.max(0, Number(stock.pallet) - Number(stock.pallet) * palletRatio);

          if (newQty <= 0.001) {
            await client.query('DELETE FROM stock WHERE id = $1', [stock.id]);
          } else {
            await client.query(
              `UPDATE stock SET quantity = $1, pallet = $2, stock_status = 'Available', updated_at = NOW() WHERE id = $3`,
              [newQty, Number(newPlt.toFixed(4)), stock.id],
            );
          }

          const slRow = await client.query(
            `SELECT id, quantity FROM stock_locations WHERE stock_id = $1 AND status = 'Available' ORDER BY pallet_seq ASC LIMIT 1`,
            [stock.id],
          );
          let sl = slRow.rows[0];
          let slId: number | null = null;
          if (sl) {
            slId = Number(sl.id);
            const slNewQty = Math.max(0, Number(sl.quantity) - deduct);
            await client.query(
              `UPDATE stock_locations SET quantity = $1, status = $2 WHERE id = $3`,
              [slNewQty, slNewQty <= 0 ? 'Picked' : 'Available', slId],
            );
          } else {
            const slFind = await client.query(
              `SELECT sl.id, sl.quantity
               FROM stock_locations sl JOIN stock sx ON sx.id = sl.stock_id
               WHERE sx.product_id = $1 AND sx.batch_number IS NOT DISTINCT FROM $2 AND sx.location IS NOT DISTINCT FROM $3
                 AND sl.status IN ('Available','Picked')
               ORDER BY (sl.status='Available') DESC, sl.pallet_seq ASC LIMIT 1`,
              [productId, stock.batch_number ?? null, stock.location ?? null],
            );
            sl = slFind.rows[0];
            if (sl) {
              slId = Number(sl.id);
              const slNewQty = Math.max(0, Number(sl.quantity) - deduct);
              await client.query(
                `UPDATE stock_locations SET quantity = $1, status = $2 WHERE id = $3`,
                [slNewQty, slNewQty <= 0 ? 'Picked' : 'Available', slId],
              );
            } else {
              const insSl = await client.query(
                `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
                 VALUES (NULL, $1, 999, 0, $2, $3, 0, $4, NULL, 'Picked') RETURNING id`,
                [stock.location ?? 'UNALLOCATED', deduct, stock.uom ?? (item.uom ?? 'EA'), stock.batch_number ?? null],
              );
              slId = Number(insSl.rows[0].id);
            }
          }

          pickedRows.push({
            stock_location_id: slId,
            location: stock.location,
            batch: stock.batch_number,
            quantity: deduct,
            expiry_date: stock.expiry_date,
          });

          if (!usedBatch) usedBatch = stock.batch_number;
          if (!usedLocation) usedLocation = stock.location;
          remaining -= deduct;
        }

        await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = $1', [item.id]);
        for (const pr of pickedRows) {
          if (pr.stock_location_id) {
            await client.query(
              `INSERT INTO outbound_item_locations (outbound_item_id, stock_location_id, quantity)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [item.id, pr.stock_location_id, pr.quantity],
            );
          }
        }

        await client.query(
          `UPDATE outbound_items SET batch_no = $1, batch_number = $1, location = COALESCE($2, location), exp_date = $3 WHERE id = $4`,
          [usedBatch, usedLocation, stockRows[0].expiry_date ?? null, item.id],
        );
      }

      await client.query('UPDATE outbound_orders SET status = \'Picking\', updated_at = NOW() WHERE id = $1', [outboundId]);
    });
  }

  /** ship — writes OUT ledger rows per item. */
  async ship(outboundId: number, currentUserId: number | null = null): Promise<void> {
    const db = this.db;
    await db.transaction(async (client) => {
      const outbound = await this.getById(outboundId);
      if (!outbound) throw ApiException.notFound('Outbound tidak ditemukan');
      const items = await this.getItems(outboundId);

      await client.query(
        `UPDATE outbound_orders SET status = 'Shipped', shipped_by = $1, shipped_date = $2, updated_at = NOW() WHERE id = $3`,
        [currentUserId, todayStr(), outboundId],
      );

      for (const item of items) {
        const qty = Number(item.actual_qty ?? item.quantity ?? 0);
        if (qty <= 0) continue;
        await this.addToLedger(item, outbound, client);
      }
    });
  }

  private async addToLedger(item: any, outbound: any, client: any): Promise<void> {
    const balR = await client.query(
      `SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS running_balance
       FROM stock_ledger WHERE product_id = $1`,
      [item.product_id],
    );
    const balance = Number(balR.rows[0].running_balance ?? 0) - Number(item.actual_qty ?? 0);

    await client.query(
      `INSERT INTO stock_ledger
         (transaction_date, product_id, transaction_type, reference_type,
          reference_id, reference_number, batch_number, quantity_in,
          quantity_out, uom, pallet, balance, location, notes)
       VALUES ($1,$2,'OUT','Outbound',$3,$4,$5,0,$6,$7,$8,$9,$10,$11)`,
      [
        todayStr(),
        item.product_id,
        outbound.id,
        outbound.order_number,
        item.batch_no ?? null,
        item.actual_qty ?? 0,
        item.uom,
        item.pallet,
        balance,
        item.location,
        '[Outbound] Shipped | Status: Shipped | ' + outbound.order_number,
      ],
    );
  }

  async complete(outboundId: number): Promise<void> {
    const db = this.db;
    const current = await this.getById(outboundId);
    if (!current) throw ApiException.notFound('Outbound tidak ditemukan.');
    if (current.status === 'Cancelled') {
      throw ApiException.conflict('Order sudah dibatalkan dan tidak dapat diselesaikan.');
    }
    if (current.status === 'Completed') return;
    await db.query(`UPDATE outbound_orders SET status = 'Completed', updated_at = NOW() WHERE id = $1`, [outboundId]);
  }

  async delete(outboundId: number): Promise<void> {
    const db = this.db;
    await db.transaction(async (client) => {
      const outbound = await this.getById(outboundId);
      if (!outbound) throw ApiException.notFound('Outbound tidak ditemukan.');
      if (['Completed', 'Cancelled', 'Shipped', 'Delivered'].includes(outbound.status ?? '')) {
        throw ApiException.conflict('Order sudah ' + (outbound.status ?? '') + ' dan tidak dapat dihapus.');
      }

      const items = await this.getItems(outboundId);
      const wasPickedOrShipped = ['Picking', 'Shipped', 'Completed'].includes(outbound.status ?? '');

      for (const item of items) {
        const batch = item.batch_no ?? item.batch_number ?? null;
        const qty = Number(item.actual_qty ?? item.quantity ?? 0);
        const pid = Number(item.product_id);
        const isUnserv = (item.in_process_status ?? '') === 'Unserviceable';

        if (wasPickedOrShipped && qty > 0 && !isUnserv) {
          const obLocs = await client.query(
            `SELECT oil.quantity AS restore_qty, sl.id AS sl_id, sl.stock_id,
                    sl.location_code AS loc, sl.batch_number AS sl_batch,
                    sl.original_quantity AS orig_qty, sl.uom AS sl_uom
             FROM outbound_item_locations oil JOIN stock_locations sl ON sl.id = oil.stock_location_id
             WHERE oil.outbound_item_id = $1`,
            [item.id],
          );
          const pickRows = obLocs.rows;

          if (pickRows.length > 0) {
            for (const pr of pickRows) {
              const rQty = Number(pr.restore_qty ?? 0);
              const rLoc = pr.loc ?? null;
              const rBatch = pr.sl_batch ?? batch;
              const slId = pr.sl_id ?? null;
              const sid = pr.stock_id ?? null;
              if (rQty <= 0) continue;

              let restored = false;
              if (sid) {
                const srow = await client.query('SELECT id, quantity, pallet, uom_per_pallet FROM stock WHERE id = $1', [sid]);
                const stockRow = srow.rows[0];
                if (stockRow) {
                  const upp = Math.max(1, Number(stockRow.uom_per_pallet ?? 4));
                  const newQty = Number(stockRow.quantity) + rQty;
                  const newPlt = Math.ceil(newQty / upp);
                  await client.query('UPDATE stock SET quantity = $1, pallet = $2, updated_at = NOW() WHERE id = $3', [newQty, newPlt, sid]);
                  restored = true;
                }
              }

              if (!restored && rLoc) {
                const find = await client.query(
                  `SELECT id, quantity FROM stock WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2 AND location = $3 AND stock_status = 'Available'`,
                  [pid, rBatch, rLoc],
                );
                const found = find.rows[0];
                if (found) {
                  await client.query('UPDATE stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [rQty, found.id]);
                  if (slId) {
                    await client.query('UPDATE stock_locations SET stock_id = $1, status = \'Available\' WHERE id = $2', [found.id, slId]);
                  }
                } else {
                  const uomPerPallet = Math.max(1, Number(item.uom_per_pallet ?? 4));
                  const ins = await client.query(
                    `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, expiry_date, stock_status)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,'Available') RETURNING id`,
                    [pid, rBatch, rLoc, rQty, item.uom ?? 'Drum', Math.max(1, Math.ceil(rQty / uomPerPallet)), item.exp_date ?? item.expiry_date ?? null],
                  );
                  const newSid = Number(ins.rows[0].id);
                  if (slId) {
                    await client.query('UPDATE stock_locations SET stock_id = $1, status = \'Available\' WHERE id = $2', [newSid, slId]);
                  }
                }
                restored = true;
              }

              if (slId) {
                const origQty = Number(pr.orig_qty ?? rQty);
                await client.query('UPDATE stock_locations SET status = \'Available\', quantity = $1 WHERE id = $2', [origQty, slId]);
              }
            }
          } else {
            const loc = item.location ?? null;
            if (loc && loc !== 'QUA_SHELL' && qty > 0) {
              const find = await client.query(
                `SELECT id FROM stock WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2 AND location = $3 AND stock_status = 'Available'`,
                [pid, batch, loc],
              );
              const row = find.rows[0];
              if (row) {
                await client.query('UPDATE stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [qty, row.id]);
              } else {
                const uomPerPallet = Math.max(1, Number(item.uom_per_pallet ?? 4));
                await client.query(
                  `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, stock_status)
                   VALUES ($1,$2,$3,$4,$5,$6,'Available')`,
                  [pid, batch, loc, qty, item.uom ?? 'Drum', Math.max(1, Math.ceil(qty / uomPerPallet))],
                );
              }
            }
          }
        }

        if (isUnserv && qty > 0) {
          await client.query(
            `DELETE FROM stock WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2
             AND location='QUA_SHELL' AND stock_status='Rejected'`,
            [pid, batch],
          );
        }

        await client.query(
          `DELETE FROM stock_ledger WHERE reference_type='Outbound' AND reference_id=$1 AND product_id=$2`,
          [outboundId, pid],
        );
        await client.query('DELETE FROM outbound_item_locations WHERE outbound_item_id = $1', [item.id]);
      }

      await client.query(`DELETE FROM stock_ledger WHERE reference_type='Outbound' AND reference_id=$1`, [outboundId]);
      await client.query(`DELETE FROM location_allocations WHERE reference_type='Outbound' AND reference_id=$1`, [outboundId]);
      await client.query(
        `DELETE FROM picklist_items pi USING picklists pl WHERE pi.picklist_id = pl.id AND pl.outbound_order_id = $1`,
        [outboundId],
      );
      await client.query(`DELETE FROM picklists WHERE outbound_order_id = $1`, [outboundId]);
      await client.query(`DELETE FROM outbound_items WHERE outbound_order_id = $1`, [outboundId]);
      await client.query(`DELETE FROM outbound_destinations WHERE outbound_id = $1`, [outboundId]);
      await client.query(`DELETE FROM outbound_orders WHERE id = $1`, [outboundId]);
    });
  }

  async getStats(): Promise<any> {
    const db = this.db;
    const stats: Record<string, any> = {};
    const month = await db.query(
      `SELECT COUNT(*)::int as count FROM outbound_orders
       WHERE EXTRACT(YEAR FROM order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND EXTRACT(MONTH FROM order_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
    );
    stats['this_month'] = month.rows[0].count;
    const byStatus = await db.query('SELECT status, COUNT(*)::int as count FROM outbound_orders GROUP BY status');
    stats['by_status'] = byStatus.rows;
    const pending = await db.query(`SELECT COUNT(*)::int as count FROM outbound_orders WHERE status IN ('Open','Picking')`);
    stats['pending'] = pending.rows[0].count;
    return stats;
  }
}