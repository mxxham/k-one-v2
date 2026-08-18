import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { PutawayService } from '../putaway/putaway.service';
import { PicklistService } from '../picklist/picklist.service';
import { generateNumber } from '../common/number-gen';
import { todayStr, nowDatetime, addYears } from '../common/date-util';
import { ApiException } from '../common/api-exception';
import { calculatePalletDistribution as palletDist, calcPalletByLocation, palletFunctionFor } from '../common/pallet';
import { insertStockLocation } from '../common/stock-locations';

type Client = any;

interface InboundItem {
  id: number;
  inbound_order_id: number;
  product_id: number;
  uom?: string;
  uom_per_pallet?: number;
  quantity?: number;
  actual_qty?: number;
  batch_number?: string | null;
  batch_no?: string | null;
  location?: string | null;
  in_process_status?: string;
  stock_status?: string;
  pallet?: number;
  manufacture_date?: string | null;
  exp_date?: string | null;
  cross_dock_outbound_order_id?: number | null;
  [k: string]: any;
}

@Injectable()
export class InboundService {
  constructor(
    private readonly db: DbService,
    @Inject(forwardRef(() => PutawayService))
    private readonly putaway: PutawayService,
    private readonly picklist: PicklistService,
  ) {}

  async generateNumber(): Promise<string> {
    return generateNumber(this.db, {
      table: 'inbound_orders',
      column: 'order_number',
      prefix: `IN-${todayStr().slice(0, 7).replace('-', '')}-`,
      searchPrefix: `IN-${todayStr().slice(0, 7).replace('-', '')}-`,
      pad: 4,
    });
  }

  async getAll(status: string | null, limit: number | null, offset: number, odNo: string | null): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`io.status = $${params.length}`);
    }
    if (odNo) {
      params.push(`%${odNo}%`);
      conditions.push(`ii.od_number LIKE $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    let sql = `SELECT io.*,
              u.full_name as created_by_name,
              r.full_name as received_by_name,
              COUNT(DISTINCT ii.id)::int as total_items,
              SUM(ii.actual_qty) as total_qty,
              SUM(ii.pallet) as total_pallet,
              STRING_AGG(DISTINCT ii.od_number, ', ' ORDER BY ii.od_number) as od_numbers,
              COUNT(*) FILTER (WHERE ii.cross_dock_outbound_order_id IS NOT NULL)::int as cross_dock_count
       FROM inbound_orders io
       LEFT JOIN users u ON io.created_by = u.id
       LEFT JOIN users r ON io.received_by = r.id
       LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id
       ${where}
       GROUP BY io.id, u.full_name, r.full_name
       ORDER BY COALESCE(NULLIF(TRIM(io.shipment_no), ''), io.order_number) DESC,
                io.order_date DESC, io.created_at DESC`;
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
      conditions.push(`io.status = $${params.length}`);
    }
    if (odNo) {
      params.push(`%${odNo}%`);
      conditions.push(`ii.od_number LIKE $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await this.db.query(
      `SELECT COUNT(DISTINCT io.id)::int FROM inbound_orders io
       LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id ${where}`,
      params,
    );
    return r.rows[0].count;
  }

  async getById(id: number): Promise<any> {
    const r = await this.db.query(
      `SELECT io.*,
              u.full_name as created_by_name,
              r.full_name as received_by_name
       FROM inbound_orders io
       LEFT JOIN users u ON io.created_by = u.id
       LEFT JOIN users r ON io.received_by = r.id
       WHERE io.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async getItems(inboundId: number): Promise<InboundItem[]> {
    const r = await this.db.query(
      `SELECT ii.*, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              ob.order_number AS cross_dock_order_number, ob.status AS cross_dock_order_status
       FROM inbound_items ii
       JOIN products p ON ii.product_id = p.id
       LEFT JOIN outbound_orders ob ON ob.id = ii.cross_dock_outbound_order_id
       WHERE ii.inbound_order_id = $1
       ORDER BY ii.id`,
      [inboundId],
    );
    return r.rows;
  }

  async getItemLocations(itemId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT sl.*, COALESCE(sl.original_quantity, sl.quantity) AS display_quantity
       FROM stock_locations sl
       WHERE sl.inbound_item_id = $1
       ORDER BY sl.pallet_seq`,
      [itemId],
    );
    return r.rows;
  }

  async getOrderLocations(inboundId: number): Promise<any[]> {
    const r = await this.db.query(
      `SELECT sl.*, p.product_code, p.product_name, ii.batch_number, ii.uom, ii.exp_date
       FROM stock_locations sl
       JOIN inbound_items ii ON sl.inbound_item_id = ii.id
       JOIN products p ON ii.product_id = p.id
       WHERE ii.inbound_order_id = $1
       ORDER BY sl.pallet_seq`,
      [inboundId],
    );
    return r.rows;
  }

  // --------------------------------------------------------------------------
  // create / addItem / saveItemLocations
  // --------------------------------------------------------------------------
  async create(data: Record<string, any>): Promise<number> {
    return this.db.transaction(async (client) => {
      const inboundNumber = data.shipment_no ? data.shipment_no : await this.generateNumber();

      let receivedBy: number | null = null;
      if (data.received_by) {
        if (/^\d+$/.test(String(data.received_by))) {
          receivedBy = Number(data.received_by);
        } else {
          const u = await client.query('SELECT id FROM users WHERE full_name = $1 LIMIT 1', [data.received_by]);
          receivedBy = u.rows[0]?.id ?? null;
        }
      }

      // ASN linking: receiving staff may create an inbound against a Pending ASN.
      const asnId = data.asn_id ? Number(data.asn_id) : null;
      if (asnId) {
        const asnR = await client.query('SELECT id, status FROM asn WHERE id = $1', [asnId]);
        const asn = asnR.rows[0];
        if (!asn) throw ApiException.notFound('ASN tidak ditemukan');
        if (asn.status !== 'Pending') {
          throw ApiException.conflict('Hanya ASN berstatus Pending yang dapat dijadikan inbound.');
        }
      }

      const r = await client.query(
        `INSERT INTO inbound_orders
           (order_number, order_date, carrier_name, po_number, shipment_no, do_number,
            container_no, armada_no, production_date, expected_date,
            received_by, received_date, status, notes, created_by, asn_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          inboundNumber,
          data.order_date,
          data.carrier_name ?? null,
          data.po_number ?? null,
          data.shipment_no ?? null,
          data.do_number ?? null,
          data.container_no ?? null,
          data.armada_no ?? null,
          data.production_date || null,
          data.expected_date || null,
          receivedBy,
          data.received_date || null,
          data.status ?? 'Draft',
          data.notes ?? null,
          data.created_by,
          asnId,
        ],
      );
      const inboundId = Number(r.rows[0].id);

      // Pre-fill items from the ASN's expected lines when none are provided, so
      // receiving staff confirm against expectation rather than typing fresh.
      let items: Record<string, any>[] = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0 && asnId) {
        const asnItems = await client.query(
          `SELECT product_id, expected_qty, uom, batch_number, exp_date
           FROM asn_items WHERE asn_id = $1 ORDER BY id`,
          [asnId],
        );
        items = asnItems.rows.map((ai: any) => ({
          product_id: Number(ai.product_id),
          quantity: Number(ai.expected_qty),
          uom: ai.uom,
          batch_number: ai.batch_number,
          exp_date: ai.exp_date,
          in_process_status: 'Dues In',
        }));
      }
      for (const item of items) {
        await this.addItem(inboundId, item, client);
      }
      return inboundId;
    });
  }

  async addItem(inboundId: number, item: Record<string, any>, client?: Client): Promise<number> {
    const dbc = client ?? this.db;
    const prod = await dbc.query(
      'SELECT uom_type, uom_per_pallet, liters_per_unit, max_sku_qty, max_trans_qty FROM products WHERE id = $1',
      [item.product_id],
    );
    if (prod.rows.length === 0) throw new Error('Product not found');
    const productInfo = prod.rows[0];

    const quantity = Number(item.quantity ?? 0);
    const uom = item.uom ?? productInfo.uom_type;
    const uomPerPallet = Math.max(1, Number.parseInt(productInfo.uom_per_pallet ?? '4', 10) || 4);
    const pallet = this.calculatePallet(quantity, uomPerPallet);

    const inbound = await this.getById(inboundId);
    let mfgDate = item.manufacture_date ?? null;
    let expDate = item.exp_date ?? null;
    if (mfgDate) {
      expDate = addYears(String(mfgDate), 4) ?? expDate;
    } else if (!expDate && inbound?.production_date) {
      expDate = this.calculateExpiryDate(inbound.production_date);
    }

    const batchNumber = item.batch_number ?? item.batch_no ?? null;
    let firstLocation = item.location ?? null;
    if (Array.isArray(item.pallet_locations) && item.pallet_locations.length > 0) {
      firstLocation = item.pallet_locations[0].location_code ?? firstLocation;
    }

    const r = await dbc.query(
      `INSERT INTO inbound_items
         (inbound_order_id, od_number, so_number, product_id, batch_number, location,
          quantity, uom, actual_qty, pallet, pallet_no,
          manufacture_date, exp_date, stock_status, in_process_status, notes,
          cross_dock_outbound_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        inboundId,
        item.od_number ?? null,
        item.so_number ?? null,
        item.product_id,
        batchNumber,
        firstLocation,
        quantity,
        uom,
        item.actual_qty ?? quantity,
        pallet,
        item.pallet_no ?? null,
        item.manufacture_date ?? null,
        expDate,
        item.stock_status ?? 'Pending',
        item.in_process_status ?? 'Dues In',
        item.notes ?? null,
        item.cross_dock_outbound_order_id ? Number(item.cross_dock_outbound_order_id) : null,
      ],
    );
    const itemId = Number(r.rows[0].id);

    const skipPallets = (item.in_process_status ?? '') === 'Unserviceable' || (item.stock_status ?? '') === 'Rejected';
    if (!skipPallets) {
      if (Array.isArray(item.pallet_locations) && item.pallet_locations.length > 0) {
        await this.saveItemLocations(itemId, null, item.pallet_locations, batchNumber, uom, dbc);
      } else if (item.location) {
        const dist = palletDist(quantity, uomPerPallet);
        const palletLocs = dist.map((p) => ({ ...p, location_code: item.location }));
        await this.saveItemLocations(itemId, null, palletLocs, batchNumber, uom, dbc);
      }
    }
    return itemId;
  }

  async saveItemLocations(
    itemId: number,
    stockId: number | null,
    palletLocs: any[],
    batchNumber: string | null,
    uom = 'EA',
    client?: Client,
  ): Promise<void> {
    const dbc = client ?? this.db;
    await dbc.query('DELETE FROM stock_locations WHERE inbound_item_id = $1', [itemId]);
    if (!palletLocs || palletLocs.length === 0) return;
    for (const p of palletLocs) {
      const qty = Number(p.quantity ?? 0);
      await insertStockLocation(dbc, {
        stock_id: stockId,
        location_code: p.location_code,
        pallet_seq: p.pallet_seq ?? p.pallet_number ?? 1,
        quantity: qty,
        original_quantity: qty,
        uom,
        is_full_pallet: (p.is_full ?? true) ? 1 : 0,
        batch_number: batchNumber,
        inbound_item_id: itemId,
      });
    }
  }

  calculatePallet(quantity: number, uomPerPallet: number): number {
    if (uomPerPallet === 0) return 0;
    return Math.ceil(quantity / uomPerPallet);
  }

  calcPalletByLocation(quantity: number, uomPerPallet: number, locationCode: string | null): number {
    return calcPalletByLocation(quantity, uomPerPallet, locationCode);
  }

  calculateExpiryDate(productionDate: string | null | undefined, years = 4): string | null {
    if (!productionDate) return null;
    return addYears(String(productionDate), years);
  }

  // --------------------------------------------------------------------------
  // update / items
  // --------------------------------------------------------------------------
  async update(id: number, data: Record<string, any>): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE inbound_orders SET
           order_date = $1, carrier_name = $2, po_number = $3,
           shipment_no = $4, do_number = $5,
           container_no = $6, armada_no = $7,
           production_date = $8, expected_date = $9, status = $10, notes = $11
         WHERE id = $12`,
        [
          data.order_date,
          data.carrier_name ?? null,
          data.po_number ?? null,
          data.shipment_no ?? null,
          data.do_number ?? null,
          data.container_no ?? null,
          data.armada_no ?? null,
          data.production_date || null,
          data.expected_date || null,
          data.status ?? 'Draft',
          data.notes ?? null,
          id,
        ],
      );
      if (data.received_date !== undefined || data.received_by !== undefined) {
        let receivedBy: number | null = null;
        if (data.received_by) {
          if (/^\d+$/.test(String(data.received_by))) {
            receivedBy = Number(data.received_by);
          } else {
            const u = await client.query('SELECT id FROM users WHERE full_name = $1 LIMIT 1', [data.received_by]);
            receivedBy = u.rows[0]?.id ?? data.created_by ?? null;
          }
        }
        await client.query('UPDATE inbound_orders SET received_by = $1, received_date = $2 WHERE id = $3', [
          receivedBy, data.received_date || null, id,
        ]);
      }
    });
  }

  async updateItem(itemId: number, data: Record<string, any>): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE inbound_items SET
         batch_number = $1, location = $2, quantity = $3, uom = $4, actual_qty = $5,
         manufacture_date = $6, exp_date = $7, stock_status = $8, notes = $9,
         cross_dock_outbound_order_id = $10
       WHERE id = $11`,
      [
        data.batch_number ?? data.batch_no ?? null,
        data.location ?? null,
        data.quantity ?? 0,
        data.uom ?? 'EA',
        data.actual_qty ?? data.quantity ?? 0,
        data.manufacture_date ?? null,
        data.exp_date ?? null,
        data.stock_status ?? 'Accepted',
        data.notes ?? null,
        data.cross_dock_outbound_order_id ? Number(data.cross_dock_outbound_order_id) : null,
        itemId,
      ],
    );
    if ((r.rowCount ?? 0) > 0 && data.pallet_locations) {
      await this.saveItemLocations(itemId, null, data.pallet_locations, data.batch_number ?? null, data.uom ?? 'EA');
    }
    return (r.rowCount ?? 0) > 0;
  }

  async updateItemDates(itemId: number, manufactureDate: string | null, expDate: string | null): Promise<boolean> {
    const rowR = await this.db.query(
      `SELECT ii.*, io.status AS ord_status
       FROM inbound_items ii JOIN inbound_orders io ON ii.inbound_order_id = io.id
       WHERE ii.id = $1`,
      [itemId],
    );
    const row = rowR.rows[0];
    if (!row) return false;
    const mfg = manufactureDate !== null && manufactureDate !== '' ? manufactureDate : null;
    const exp = expDate !== null && expDate !== '' ? expDate : null;
    await this.db.query('UPDATE inbound_items SET manufacture_date = $1, exp_date = $2 WHERE id = $3', [mfg, exp, itemId]);

    if ((row.ord_status ?? '') === 'Completed') {
      const batch = row.batch_number ?? row.batch_no ?? null;
      const pid = Number(row.product_id);
      await this.db.query(
        `UPDATE stock s SET manufacture_date = $1, expiry_date = $2
         FROM stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $3`,
        [mfg, exp, itemId],
      );
      await this.db.query(
        'UPDATE stock SET manufacture_date = $1, expiry_date = $2 WHERE product_id = $3 AND batch_number IS NOT DISTINCT FROM $4',
        [mfg, exp, pid, batch],
      );
    }
    return true;
  }

  async updateItemPalletNo(itemId: number, palletNo: string | null): Promise<boolean> {
    const val = palletNo !== null && palletNo.trim() !== '' ? palletNo.trim().toUpperCase() : null;
    await this.db.query('UPDATE inbound_items SET pallet_no = $1 WHERE id = $2', [val, itemId]);
    return true;
  }

  // --------------------------------------------------------------------------
  // real-time receive flow (mirrors inbound_change_item_status)
  // --------------------------------------------------------------------------
  async changeItemStatus(itemId: number, newProcess: string, createdBy?: number): Promise<void> {
    const stockBadge: Record<string, string> = {
      'Dues In': 'Pending',
      'Goods Received': 'Pending',
      ATP: 'Accepted',
      Unserviceable: 'Rejected',
    };
    const newBadge = stockBadge[newProcess] ?? 'Pending';

    const itRow = await this.db.query(
      `SELECT ii.*, p.uom_per_pallet, io.order_number, io.order_date, io.id AS io_id
       FROM inbound_items ii
       JOIN products p ON p.id = ii.product_id
       JOIN inbound_orders io ON io.id = ii.inbound_order_id
       WHERE ii.id = $1`,
      [itemId],
    );
    const it = itRow.rows[0];
    if (!it) throw ApiException.notFound('Item tidak ditemukan');
    const oldProcess = it.in_process_status ?? 'Dues In';
    const pid = Number(it.product_id);
    const batch = it.batch_number ?? it.batch_no ?? null;
    const totalQty = Number(it.actual_qty ?? it.quantity ?? 0);
    const uomPerPlt = Math.max(1, Number(it.uom_per_pallet ?? 4));
    const plt = Math.ceil(totalQty / uomPerPlt);

    await this.db.transaction(async (client) => {
      if (newProcess === 'Unserviceable') {
        await client.query(
          `UPDATE inbound_items SET in_process_status=$1, stock_status=$2, location='QUA_SHELL' WHERE id=$3`,
          [newProcess, newBadge, itemId],
        );
      } else if (oldProcess === 'Unserviceable') {
        await client.query(
          `UPDATE inbound_items SET in_process_status=$1, stock_status=$2, location=NULL WHERE id=$3`,
          [newProcess, newBadge, itemId],
        );
      } else {
        await client.query(
          `UPDATE inbound_items SET in_process_status=$1, stock_status=$2 WHERE id=$3`,
          [newProcess, newBadge, itemId],
        );
      }

      const delLedger = async (): Promise<void> => {
        await client.query(
          `DELETE FROM stock_ledger
           WHERE reference_type='Inbound' AND reference_id=$1 AND product_id=$2 AND batch_number IS NOT DISTINCT FROM $3`,
          [it.io_id, pid, batch],
        );
      };
      const runningBal = async (): Promise<number> => {
        const b = await client.query(
          `SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS bal
           FROM stock_ledger WHERE product_id=$1
             AND (location IS NULL OR location != 'QUA_SHELL')
             AND transaction_type NOT IN ('TRANSFER_IN','TRANSFER_OUT')`,
          [pid],
        );
        return Number(b.rows[0].bal ?? 0);
      };
      const insertLedger = async (notes: string, qtyIn: number, loc: string | null, balance: number): Promise<void> => {
        await client.query(
          `INSERT INTO stock_ledger
             (transaction_date, product_id, transaction_type, reference_type, reference_id,
              reference_number, batch_number, quantity_in, quantity_out, uom, pallet, balance, location, notes)
           VALUES ($1,$2,'IN','Inbound',$3,$4,$5,$6,0,$7,$8,$9,$10,$11)`,
          [todayStr(), pid, it.io_id, it.order_number, batch, qtyIn, it.uom, plt, balance, loc, notes],
        );
      };

      const crossDockObId = it.cross_dock_outbound_order_id ? Number(it.cross_dock_outbound_order_id) : null;

      if (newProcess === 'ATP') {
        await client.query(
          `DELETE FROM stock s USING stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $1`,
          [itemId],
        );
        await client.query('UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=$1', [itemId]);
        if (oldProcess === 'Unserviceable') {
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND location='QUA_SHELL' AND stock_status='Rejected'`,
            [pid, batch],
          );
        }
        await delLedger();
        if (crossDockObId) {
          // Cross-dock: bypass normal putaway/FEFO. Stage directly at the
          // dedicated STAGING location (reused special loc) and attach a
          // picklist item to the linked outbound order. No general stock row is
          // created — the goods are pre-allocated/pre-sold to that outbound.
          const cur = await runningBal();
          await insertLedger(
            `[Inbound] Cross-Dock | STAGING → Outbound | ${it.order_number}`,
            totalQty,
            'STAGING',
            cur + totalQty,
          );
          const slIns = await client.query(
            `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
             VALUES (NULL, 'STAGING', 1, $1, $1, $2, 1, $3, $4, 'Available') RETURNING id`,
            [totalQty, it.uom ?? 'Drum', batch, itemId],
          );
          await client.query(
            `UPDATE inbound_items SET location='STAGING' WHERE id=$1`,
            [itemId],
          );
          await this.picklist.addCrossDockItem(
            client,
            crossDockObId,
            pid,
            totalQty,
            it.uom ?? 'Drum',
            batch,
            createdBy ?? it.created_by ?? 0,
            Number(slIns.rows[0].id),
          );
        } else {
          const cur = await runningBal();
          await insertLedger(`[Inbound] ATP | In-Process: ATP | ${it.order_number}`, totalQty, it.location ?? null, cur + totalQty);
        }
      } else if (newProcess === 'Goods Received') {
        if (oldProcess === 'ATP') {
          await client.query(
            `DELETE FROM stock s USING stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $1`,
            [itemId],
          );
          await client.query('UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=$1', [itemId]);
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND stock_status='Available'`,
            [pid, batch],
          );
        }
        if (oldProcess === 'Unserviceable') {
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND location='QUA_SHELL' AND stock_status='Rejected'`,
            [pid, batch],
          );
        }
        await delLedger();
        const cur = await runningBal();
        await insertLedger(`[Inbound] Goods Received | In-Process: Goods Received | ${it.order_number}`, totalQty, it.location ?? null, cur + totalQty);

        const hasLocs = await client.query('SELECT 1 FROM stock_locations WHERE inbound_item_id=$1 LIMIT 1', [itemId]);
        if (hasLocs.rows.length === 0 && !it.cross_dock_outbound_order_id) {
          // Putaway task queue: pallet suggestions (fixed bin or engine-driven)
          // go into the inbound's putaway task — stock_locations rows are only
          // written when the operator completes the task.
          let palletLocs: Array<{ location_code: string; pallet_seq: number; quantity: number; is_full: boolean; reason?: string | null }> = [];
          if (it.location) {
            palletLocs = palletDist(totalQty, uomPerPlt).map((p) => ({
              location_code: it.location,
              pallet_seq: p.pallet_number,
              quantity: p.quantity,
              is_full: p.is_full !== false,
            }));
          } else {
            const rec = await this.putaway.recommendLocations({
              product_id: pid,
              quantity: totalQty,
              uom: it.uom,
            });
            palletLocs = (rec?.pallets ?? []).map((p) => ({
              location_code: p.location_code,
              pallet_seq: p.pallet_seq,
              quantity: p.quantity,
              is_full: p.is_full !== false,
              reason: p.reason ?? null,
            }));
          }
          if (palletLocs.length > 0) {
            await this.putaway.enqueueForPutaway({
              itemId,
              inboundOrderId: Number(it.io_id),
              productId: pid,
              userId: createdBy ?? 0,
              batch,
              uom: it.uom ?? 'Drum',
              pallets: palletLocs,
              client,
            });
          }
        }
      } else if (newProcess === 'Unserviceable') {
        await client.query(
          `DELETE FROM stock s USING stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $1`,
          [itemId],
        );
        await client.query('DELETE FROM stock_locations WHERE inbound_item_id=$1', [itemId]);
        await client.query(
          `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND stock_status IN ('Available','Dues In','Pending')`,
          [pid, batch],
        );
        await client.query(
          `INSERT INTO stock (product_id,batch_number,location,quantity,uom,pallet,manufacture_date,expiry_date,stock_status)
           VALUES ($1,$2,'QUA_SHELL',$3,$4,$5,$6,$7,'Rejected')`,
          [pid, batch, totalQty, it.uom, plt, it.manufacture_date, it.exp_date],
        );
        await delLedger();
        const cur = await runningBal();
        await insertLedger(`[Inbound] Unserviceable (QUA_SHELL) | In-Process: Unserviceable | ${it.order_number}`, totalQty, 'QUA_SHELL', cur);
      } else if (newProcess === 'Dues In') {
        await client.query(
          `DELETE FROM stock s USING stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $1`,
          [itemId],
        );
        await client.query('UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=$1', [itemId]);
        await client.query(
          `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND stock_status IN ('Available','Dues In','Pending','Rejected')`,
          [pid, batch],
        );
        await delLedger();
      }
    });
  }

  async savePalletLocations(itemId: number, pallets: any[], userId = 0): Promise<void> {
    const db = this.db;
    const specialLocs = ['QUA_SHELL', 'STAGING'];
    const invalidLocs: string[] = [];
    const invalidRules: string[] = [];
    for (const p of pallets) {
      const pLoc = String(p.location_code ?? '').trim().toUpperCase();
      if (pLoc && !specialLocs.includes(pLoc)) {
        const locCheck = await db.query(
          'SELECT id FROM location_master WHERE location_code=$1 AND is_active=1 LIMIT 1',
          [pLoc],
        );
        if (locCheck.rows.length === 0) {
          invalidLocs.push(pLoc);
          continue;
        }
        const itemInfo = await db.query(
          `SELECT ii.product_id, ii.uom, p.uom_type
           FROM inbound_items ii JOIN products p ON p.id = ii.product_id WHERE ii.id = $1`,
          [itemId],
        );
        const itInfo = itemInfo.rows[0];
        if (itInfo) {
          const val = await this.putaway.validatePlacement(
            Number(itInfo.product_id),
            pLoc,
            Number(p.quantity ?? 0),
            String(itInfo.uom || itInfo.uom_type || 'Drum'),
          );
          if (!val.valid) invalidRules.push(`${pLoc}: ${val.reasons.join('; ')}`);
        }
      }
    }
    if (invalidLocs.length > 0) throw ApiException.badRequest('Lokasi tidak valid: ' + invalidLocs.join(', '));
    if (invalidRules.length > 0) throw ApiException.badRequest('Lokasi ditolak aturan putaway: ' + invalidRules.join(' | '));

    await db.query('DELETE FROM stock_locations WHERE inbound_item_id=$1', [itemId]);
    const itRow = await db.query('SELECT * FROM inbound_items WHERE id=$1', [itemId]);
    const it = itRow.rows[0];
    if (!it) throw ApiException.notFound('Item tidak ditemukan');
    const batch = it.batch_number ?? it.batch_no ?? null;
    const firstLoc = pallets[0]?.location_code ?? null;
    await db.query('UPDATE inbound_items SET location=$1 WHERE id=$2', [firstLoc, itemId]);
    for (const p of pallets) {
      const pQty = Number(p.quantity ?? 0);
      await db.query(
        `INSERT INTO stock_locations
           (inbound_item_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, status, pallet_function)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'Available',$8)`,
        [
          itemId,
          String(p.location_code ?? '').trim().toUpperCase(),
          p.pallet_seq ?? 1,
          pQty,
          it.uom ?? 'Drum',
          (p.is_full ? 1 : 0),
          batch,
          palletFunctionFor(String(p.location_code ?? '').trim().toUpperCase()),
        ],
      );
    }
    // Manual Manage Pallet Locations path: mark the item's open putaway task
    // rows Done so an uncompleted task never blocks inbound completion.
    await this.putaway.reconcileItemRows(itemId, userId);
  }

  async saveItemLocation(itemId: number, loc: string): Promise<void> {
    const specialLocs = ['QUA_SHELL', 'STAGING'];
    if (!loc || !itemId) throw ApiException.badRequest('Lokasi dan item wajib diisi.');
    const db = this.db;
    if (!specialLocs.includes(loc)) {
      const locCheck = await db.query(
        'SELECT id FROM location_master WHERE location_code=$1 AND is_active=1 LIMIT 1',
        [loc],
      );
      if (locCheck.rows.length === 0) throw ApiException.badRequest(`Lokasi '${loc}' tidak ditemukan di master lokasi.`);
    }
    await db.query('UPDATE inbound_items SET location=$1 WHERE id=$2', [loc, itemId]);
    await db.query('UPDATE stock_locations SET location_code=$1 WHERE inbound_item_id=$2', [loc, itemId]);
    const itRow = await db.query(
      `SELECT ii.*, io.status AS ord_status FROM inbound_items ii JOIN inbound_orders io ON io.id = ii.inbound_order_id WHERE ii.id=$1`,
      [itemId],
    );
    const it = itRow.rows[0];
    if (it && it.ord_status === 'Completed') {
      const batch = it.batch_number ?? it.batch_no ?? null;
      await db.query(
        `UPDATE stock SET location=$1 WHERE product_id=$2 AND batch_number IS NOT DISTINCT FROM $3`,
        [loc, it.product_id, batch],
      );
    }
  }

  async advanceStatus(id: number, newStatus: string, receivedById: number, receivedDate: string): Promise<void> {
    if (newStatus === 'Receiving') {
      if (!receivedById || !String(receivedDate).trim()) {
        throw ApiException.badRequest('Received By dan Received Date wajib diisi saat Start Receiving.');
      }
      await this.db.query(
        'UPDATE inbound_orders SET status=$1, received_by=$2, received_date=$3 WHERE id=$4',
        [newStatus, receivedById, String(receivedDate).trim() || null, id],
      );
    } else {
      await this.db.query('UPDATE inbound_orders SET status=$1 WHERE id=$2', [newStatus, id]);
    }
  }

  async updateItemQty(itemId: number, newQty: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const itemR = await client.query(
        `SELECT ii.*, io.status AS ord_status, p.uom_per_pallet
         FROM inbound_items ii
         JOIN inbound_orders io ON io.id = ii.inbound_order_id
         JOIN products p ON p.id = ii.product_id
         WHERE ii.id = $1`,
        [itemId],
      );
      const item = itemR.rows[0];
      if (!item) throw new Error('Item tidak ditemukan');
      if (item.in_process_status !== 'Dues In') throw new Error('Hanya item berstatus Dues In yang bisa diedit qty-nya');
      if (newQty <= 0) throw new Error('Qty harus lebih dari 0');

      const uomPlt = Math.max(1, Number(item.uom_per_pallet ?? 4));
      const newPallet = Math.ceil(newQty / uomPlt);
      await client.query('UPDATE inbound_items SET quantity=$1, actual_qty=$1, pallet=$2 WHERE id=$3', [newQty, newPallet, itemId]);

      const batch = item.batch_number ?? item.batch_no ?? null;
      await client.query(
        `UPDATE stock SET quantity=$1, pallet=$2, updated_at=NOW()
         WHERE product_id=$3 AND batch_number IS NOT DISTINCT FROM $4 AND stock_status IN ('Dues In','Pending')`,
        [newQty, newPallet, item.product_id, batch],
      );

      const locR = await client.query(
        `SELECT pallet_seq, location_code FROM stock_locations
         WHERE inbound_item_id=$1 AND stock_id IS NULL ORDER BY pallet_seq ASC`,
        [itemId],
      );
      const existingLocs = locR.rows;
      if (existingLocs.length > 0) {
        const dist = palletDist(newQty, uomPlt);
        const lastLoc = existingLocs[existingLocs.length - 1].location_code;
        const palletLocs = dist.map((p, i) => ({
          ...p,
          location_code: existingLocs[i]?.location_code ?? lastLoc,
        }));
        await this.saveItemLocations(itemId, null, palletLocs, batch, item.uom, client);
      }
    });
  }

  async deleteItem(itemId: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const itemR = await client.query(
        `SELECT ii.*, io.status as inbound_status
         FROM inbound_items ii JOIN inbound_orders io ON ii.inbound_order_id = io.id
         WHERE ii.id = $1`,
        [itemId],
      );
      const itemData = itemR.rows[0];

      if (itemData && itemData.inbound_status === 'Completed') {
        const batchVal = itemData.batch_number ?? itemData.batch_no ?? null;
        const location = itemData.location ?? null;
        const qty = Number(itemData.actual_qty || itemData.quantity || 0);

        if (batchVal && qty > 0) {
          const params: unknown[] = [itemData.product_id, batchVal];
          let locSql = '';
          if (location) {
            params.push(location);
            locSql = `AND location = $${params.length}`;
          }
          const st = await client.query(
            `SELECT id, quantity, pallet FROM stock
             WHERE product_id = $1 AND batch_number = $2 ${locSql} LIMIT 1`,
            params,
          );
          const stockRow = st.rows[0];
          if (stockRow) {
            const newQty = Math.max(0, Number(stockRow.quantity) - qty);
            const palletRatio = Number(stockRow.quantity) > 0 ? qty / Number(stockRow.quantity) : 1;
            const newPlt = Math.max(0, Number(stockRow.pallet) - Number(stockRow.pallet) * palletRatio);
            if (newQty <= 0) {
              await client.query('DELETE FROM stock WHERE id = $1', [stockRow.id]);
            } else {
              await client.query('UPDATE stock SET quantity = $1, pallet = $2, updated_at = NOW() WHERE id = $3', [newQty, Number(newPlt.toFixed(4)), stockRow.id]);
            }
            await client.query(
              `INSERT INTO stock_ledger
                 (transaction_date, product_id, transaction_type, reference_type,
                  reference_id, batch_number, quantity_in, quantity_out, uom, balance, notes)
               VALUES (NOW(), $1, 'OUT', 'Inbound-Reversal', $2, $3, 0, $4, $5, 0, 'Item deleted from completed inbound')`,
              [itemData.product_id, itemData.inbound_order_id, batchVal, qty, itemData.uom ?? 'Drum'],
            );
          }
        }
      }

      await client.query('DELETE FROM stock_locations WHERE inbound_item_id = $1', [itemId]);
      await client.query('DELETE FROM inbound_items WHERE id = $1', [itemId]);
    });
  }

  // --------------------------------------------------------------------------
  // complete
  // --------------------------------------------------------------------------
  async complete(id: number): Promise<void> {
    const openTasks = await this.putaway.openTaskNumbers(id);
    if (openTasks.length > 0) {
      throw ApiException.conflict(
        `Selesaikan putaway task terlebih dahulu: ${openTasks.join(', ')} masih memiliki pallet yang belum diputaway.`,
      );
    }
    await this.db.transaction(async (client) => {
      const inbound = await this.getById(id);
      const items = await this.getItems(id);
      const stockStatusMap: Record<string, string> = {
        ATP: 'Available',
        Picked: 'Available',
        'Dues In': 'Dues In',
        Unserviceable: 'Rejected',
      };

      for (const item of items) {
        const batchVal = item.batch_number ?? item.batch_no ?? null;
        const inProcess = item.in_process_status ?? 'Dues In';
        if (inProcess === 'Dues In') continue;
        if (inProcess === 'Goods Received') continue;

        const stockTarget = stockStatusMap[inProcess] ?? 'Available';
        const pid = Number(item.product_id);
        const totalQty = Number(item.actual_qty ?? item.quantity ?? 0);
        const uomPerPlt = Math.max(1, Number(item.uom_per_pallet ?? 4));

        await client.query(
          `DELETE FROM stock s USING stock_locations sl WHERE sl.stock_id = s.id AND sl.inbound_item_id = $1`,
          [item.id],
        );
        await client.query('UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=$1', [item.id]);
        await client.query(
          `DELETE FROM stock s
           WHERE s.product_id = $1 AND s.batch_number IS NOT DISTINCT FROM $2
             AND (s.location IS NULL OR s.location = 'UNALLOCATED')
             AND NOT EXISTS (SELECT 1 FROM stock_locations sl2 WHERE sl2.stock_id = s.id)`,
          [pid, batchVal],
        );
        await client.query(
          `DELETE FROM stock
           WHERE product_id = $1 AND batch_number IS NOT DISTINCT FROM $2
             AND stock_status IN ('Dues In','Pending')
             AND NOT EXISTS (SELECT 1 FROM stock_locations sl3 WHERE sl3.stock_id = stock.id)`,
          [pid, batchVal],
        );

        if (inProcess === 'Unserviceable') {
          await client.query(`UPDATE inbound_items SET stock_status='Rejected', location='QUA_SHELL' WHERE id=$1`, [item.id]);
          await client.query('DELETE FROM stock_locations WHERE inbound_item_id=$1', [item.id]);
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2 AND location='QUA_SHELL' AND stock_status='Rejected'`,
            [pid, batchVal],
          );
          const plt = uomPerPlt > 0 ? Math.ceil(totalQty / uomPerPlt) : 1;
          await client.query(
            `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, manufacture_date, expiry_date, stock_status)
             VALUES ($1,$2,'QUA_SHELL',$3,$4,$5,$6,$7,'Rejected')`,
            [pid, batchVal, totalQty, item.uom, plt, item.manufacture_date, item.exp_date],
          );
          continue;
        }

        const palletRows = await this.getItemLocations(item.id);
        if (palletRows.length > 0) {
          const palletTotal = palletRows.reduce((a: number, r: any) => a + Number(r.quantity), 0);
          if (palletTotal > 0.001 && Math.abs(palletTotal - totalQty) > 0.001) {
            const scale = totalQty / palletTotal;
            for (const pr of palletRows) pr.quantity = Number((Number(pr.quantity) * scale).toFixed(4));
          }

          const locGroups: Record<string, { loc: string; batch: string; qty: number; rows: number[] }> = {};
          for (const pl of palletRows) {
            const loc = pl.location_code ?? 'UNALLOCATED';
            const qty = Number(pl.quantity);
            const batch = pl.batch_number ?? batchVal;
            const key = loc + '|' + batch;
            if (!locGroups[key]) {
              locGroups[key] = { loc, batch, qty: 0, rows: [] };
            }
            locGroups[key].qty += qty;
            locGroups[key].rows.push(Number(pl.id));
          }

          let assignedQty = 0;
          for (const group of Object.values(locGroups)) {
            const loc = group.loc;
            const qty = group.qty;
            const batch = group.batch;
            assignedQty += qty;
            let plt: number;
            const level = loc.length > 4 ? loc[4].toUpperCase() : 'B';
            if (level === 'A') {
              plt = uomPerPlt > 0 ? Number((qty / uomPerPlt).toFixed(4)) : 1;
            } else {
              plt = group.rows.length;
            }
            plt = Math.max(1, plt);
            await client.query(
              `DELETE FROM stock s
               WHERE s.product_id = $1 AND s.batch_number IS NOT DISTINCT FROM $2
                 AND s.location IS NOT DISTINCT FROM $3 AND s.stock_status IN ('Available','Dues In','Pending')
                 AND NOT EXISTS (SELECT 1 FROM stock_locations sl4 WHERE sl4.stock_id = s.id)`,
              [pid, batch, loc],
            );
            const ins = await client.query(
              `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, manufacture_date, expiry_date, stock_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [pid, batch, loc, qty, item.uom, plt, item.manufacture_date, item.exp_date, stockTarget],
            );
            const newId = Number(ins.rows[0].id);
            for (const slId of group.rows) {
              await client.query('UPDATE stock_locations SET stock_id=$1 WHERE id=$2', [newId, slId]);
            }
          }

          const remainderQty = totalQty - assignedQty;
          if (remainderQty > 0.001) {
            const fallbackLoc = 'UNALLOCATED';
            const plt = Math.max(1, uomPerPlt > 0 ? Math.ceil(remainderQty / uomPerPlt) : 1);
            const ins = await client.query(
              `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, manufacture_date, expiry_date, stock_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [pid, batchVal, fallbackLoc, remainderQty, item.uom, plt, item.manufacture_date, item.exp_date, stockTarget],
            );
            const remStockId = Number(ins.rows[0].id);
            await client.query(
              `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
               VALUES ($1,$2,999,$3,$3,$4,0,$5,$6,'Available')`,
              [remStockId, fallbackLoc, remainderQty, item.uom, batchVal, item.id],
            );
          }
        } else {
          const loc = item.location ?? 'UNALLOCATED';
          const plt = Math.max(1, uomPerPlt > 0 ? Math.ceil(totalQty / uomPerPlt) : 1);
          await client.query(
            `DELETE FROM stock s
             WHERE s.product_id = $1 AND s.batch_number IS NOT DISTINCT FROM $2
               AND s.location IS NOT DISTINCT FROM $3 AND s.stock_status IN ('Available','Dues In','Pending')
               AND NOT EXISTS (SELECT 1 FROM stock_locations sl4 WHERE sl4.stock_id = s.id)`,
            [pid, batchVal, loc],
          );
          const ins = await client.query(
            `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, manufacture_date, expiry_date, stock_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [pid, batchVal, loc, totalQty, item.uom, plt, item.manufacture_date, item.exp_date, stockTarget],
          );
          const newId = Number(ins.rows[0].id);
          await client.query('UPDATE stock_locations SET stock_id=$1 WHERE inbound_item_id=$2', [newId, item.id]);
        }

        await client.query('UPDATE inbound_items SET stock_status=$1 WHERE id=$2', [stockTarget === 'Available' ? 'Accepted' : 'Pending', item.id]);
        if (stockTarget === 'Available') {
          await this.syncBatchToOutbound(pid, batchVal, item.exp_date, client);
        }
      }

      await client.query(`UPDATE inbound_orders SET status='Completed' WHERE id=$1`, [id]);

      // ASN linkage: a Pending ASN flips to Received once its inbound completes.
      if (inbound?.asn_id) {
        await client.query(
          `UPDATE asn SET status='Received', updated_at=NOW() WHERE id=$1 AND status='Pending'`,
          [inbound.asn_id],
        );
      }
    });
  }

  private async syncBatchToOutbound(
    productId: number,
    batchNumber: string | null,
    expDate: string | null | undefined,
    client?: Client,
  ): Promise<void> {
    if (!batchNumber) return;
    const dbc = client ?? this.db;
    await dbc.query(
      `UPDATE outbound_items oi
       SET batch_number = $1, batch_no = $1, exp_date = $2
       FROM outbound_orders oo
       WHERE oi.outbound_order_id = oo.id
         AND oi.product_id = $3
         AND (oi.batch_number IS NULL OR oi.batch_number = '')
         AND oo.status IN ('Open','Picking','Draft')`,
      [batchNumber, expDate, productId],
    );
    await dbc.query(
      `UPDATE picklist_items pki
       SET batch_number = $1, batch_no = $1
       FROM picklists pkl, outbound_orders oo
       WHERE pki.picklist_id = pkl.id AND pkl.outbound_order_id = oo.id
         AND pki.product_id = $2
         AND (pki.batch_number IS NULL OR pki.batch_number = '')
         AND pkl.status IN ('Draft','Confirmed')
         AND oo.status IN ('Open','Picking','Draft')`,
      [batchNumber, productId],
    );
  }

  private async addToLedger(item: InboundItem, inbound: any, batchVal: string | null = null): Promise<void> {
    const isRejected = (item.in_process_status ?? '') === 'Unserviceable' || (item.stock_status ?? '') === 'Rejected';
    let ledgerQty = Number(item.actual_qty ?? 0);
    if (ledgerQty <= 0) ledgerQty = Number(item.quantity ?? 0);

    const cur = await this.runningBalance(Number(item.product_id));
    const balance = isRejected ? cur : cur + ledgerQty;
    const locForLedger = isRejected ? 'QUA_SHELL' : (item.location ?? null);
    const inProcessLabel = item.in_process_status ?? (isRejected ? 'Unserviceable' : 'ATP');
    const notes = isRejected
      ? `[Inbound] Unserviceable (QUA_SHELL) | In-Process: ${inProcessLabel} | ${inbound.order_number}`
      : `[Inbound] ${inProcessLabel} | In-Process: ${inProcessLabel} | ${inbound.order_number}`;
    const uomPP = Math.max(1, Number(item.uom_per_pallet ?? 4));
    const palletForLedger = uomPP > 0 ? Math.ceil(ledgerQty / uomPP) : Number(item.pallet ?? 0);

    await this.db.query(
      `INSERT INTO stock_ledger
         (transaction_date, product_id, transaction_type, reference_type,
          reference_id, reference_number, batch_number, quantity_in,
          quantity_out, uom, pallet, balance, location, notes)
       VALUES ($1,$2,'IN','Inbound',$3,$4,$5,$6,0,$7,$8,$9,$10,$11)`,
      [
        todayStr(),
        item.product_id,
        inbound.id,
        inbound.order_number,
        batchVal ?? (item.batch_number ?? item.batch_no ?? null),
        ledgerQty,
        item.uom,
        palletForLedger,
        balance,
        locForLedger,
        notes,
      ],
    );
  }

  private async runningBalance(productId: number): Promise<number> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS running_balance
       FROM stock_ledger
       WHERE product_id = $1
         AND (location IS NULL OR location != 'QUA_SHELL')
         AND transaction_type NOT IN ('TRANSFER_IN','TRANSFER_OUT')`,
      [productId],
    );
    return Number(r.rows[0].running_balance ?? 0);
  }

  async regenerateLedger(id: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const inbound = await this.getById(id);
      const items = await this.getItems(id);
      await this.db.query('DELETE FROM stock_ledger WHERE reference_type=\'Inbound\' AND reference_id=$1', [id]);
      for (const item of items) {
        const inProcess = item.in_process_status ?? 'Dues In';
        if (inProcess === 'Dues In') continue;
        await this.addToLedger(item, inbound, item.batch_number ?? item.batch_no ?? null);
      }
    });
  }

  async delete(id: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const items = await this.getItems(id);
      for (const item of items) {
        const batch = item.batch_number ?? item.batch_no ?? null;
        const pid = Number(item.product_id);
        const isUnserv = (item.in_process_status ?? '') === 'Unserviceable' || (item.stock_status ?? '') === 'Rejected';

        const linked = await client.query(
          'SELECT DISTINCT stock_id FROM stock_locations WHERE inbound_item_id=$1 AND stock_id IS NOT NULL',
          [item.id],
        );
        for (const lnk of linked.rows) {
          await client.query('DELETE FROM stock WHERE id=$1', [lnk.stock_id]);
        }

        if (!isUnserv) {
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2
             AND stock_status IN ('Available','Dues In','Reserved')`,
            [pid, batch],
          );
        }
        if (isUnserv) {
          await client.query(
            `DELETE FROM stock WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2
             AND location='QUA_SHELL' AND stock_status='Rejected'`,
            [pid, batch],
          );
        }
        await client.query(
          'DELETE FROM stock_ledger WHERE reference_type=\'Inbound\' AND reference_id=$1 AND product_id=$2',
          [id, pid],
        );
      }

      await client.query('DELETE FROM stock_ledger WHERE reference_type=\'Inbound\' AND reference_id=$1', [id]);
      await client.query(
        `DELETE FROM stock_locations sl USING inbound_items ii
         WHERE sl.inbound_item_id = ii.id AND ii.inbound_order_id = $1`,
        [id],
      );
      await client.query('DELETE FROM location_allocations WHERE reference_type=\'Inbound\' AND reference_id=$1', [id]);
      await client.query('DELETE FROM inbound_items WHERE inbound_order_id=$1', [id]);
      await client.query('DELETE FROM inbound_orders WHERE id=$1', [id]);
    });
  }

  async getStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    const month = await this.db.query(
      `SELECT COUNT(*)::int as count FROM inbound_orders
       WHERE EXTRACT(YEAR FROM order_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND EXTRACT(MONTH FROM order_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
    );
    stats['this_month'] = month.rows[0].count;
    const byStatus = await this.db.query('SELECT status, COUNT(*)::int as count FROM inbound_orders GROUP BY status');
    stats['by_status'] = byStatus.rows;
    const duesIn = await this.db.query('SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = \'Dues In\'');
    stats['dues_in'] = duesIn.rows[0].count;
    stats['pending'] = stats['dues_in'];
    const receiving = await this.db.query('SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = \'Receiving\'');
    stats['receiving'] = receiving.rows[0].count;
    return stats;
  }
}
