import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { InboundService } from '../inbound/inbound.service';
import { OutboundService } from '../outbound/outbound.service';
import { todayStr } from '../common/date-util';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable()
export class ReportService {
  constructor(
    private readonly db: DbService,
    private readonly inbound: InboundService,
    private readonly outbound: OutboundService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async dashboardStats(): Promise<Q> {
    const db = this.db;

    const stockByUom = await db.query(
      `SELECT p.uom_type, SUM(s.quantity) as total_qty, SUM(s.pallet) as total_pallet
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available' GROUP BY p.uom_type`,
    );
    let totalDrums = 0;
    let totalPallets = 0;
    for (const u of stockByUom.rows) {
      totalDrums += Number(u.total_qty ?? 0);
      totalPallets += Number(u.total_pallet ?? 0);
    }

    const expiringSoon = await db.query(
      `SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date <= CURRENT_DATE + INTERVAL '120 days'
       AND expiry_date > CURRENT_DATE AND stock_status = 'Available'`,
    );
    const expiredItems = await db.query(
      `SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date < CURRENT_DATE AND stock_status = 'Available'`,
    );
    const duesInCount = await db.query(
      `SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = 'Dues In'`,
    );
    const receivingNow = await db.query(
      `SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = 'Receiving'`,
    );
    const pendingOutboundCount = await db.query(
      `SELECT COUNT(*)::int as count FROM outbound_orders WHERE status IN ('Open','Picking')`,
    );
    const dispatchedToday = await db.query(
      `SELECT COUNT(*)::int as count FROM outbound_orders
       WHERE status = 'Completed' AND updated_at::date = CURRENT_DATE`,
    );
    const receivedToday = await db.query(
      `SELECT COUNT(*)::int as count FROM inbound_orders
       WHERE status IN ('Goods Received','Good Received') AND updated_at::date = CURRENT_DATE`,
    );
    const todayInbound = await db.query(
      `SELECT COUNT(*)::int as count FROM inbound_orders WHERE order_date = CURRENT_DATE`,
    );
    const todayOutbound = await db.query(
      `SELECT COUNT(*)::int as count FROM outbound_orders WHERE order_date = CURRENT_DATE`,
    );

    const expiredCount = Number(expiredItems.rows[0].count);
    const expiredDetail =
      expiredCount > 0
        ? (
            await db.query(
              `SELECT p.product_code, p.product_name, s.batch_number, s.expiry_date,
                      SUM(s.quantity) as qty, SUM(s.pallet) as pallet
               FROM stock s JOIN products p ON s.product_id = p.id
               WHERE s.expiry_date < CURRENT_DATE AND s.stock_status = 'Available'
               GROUP BY p.id, p.product_code, p.product_name, s.batch_number, s.expiry_date
               ORDER BY s.expiry_date ASC LIMIT 5`,
            )
          ).rows
        : [];

    const stockSummary = await db.query(
      `SELECT p.id, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              COUNT(DISTINCT s.batch_number)::int as batches,
              SUM(s.quantity) as total_qty, SUM(s.pallet) as total_pallet,
              MIN(s.expiry_date) as nearest_expiry,
              SUM(CASE WHEN s.expiry_date <= CURRENT_DATE + INTERVAL '120 days'
                       AND s.expiry_date > CURRENT_DATE THEN 1 ELSE 0 END)::int as expiring_count
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available'
       GROUP BY p.id HAVING SUM(s.quantity) > 0
       ORDER BY nearest_expiry ASC, total_qty DESC LIMIT 25`,
    );

    const monthlyActivity = await db.query(
      `SELECT to_char(transaction_date, 'YYYY-MM') as month,
              SUM(CASE WHEN transaction_type = 'IN' THEN quantity_in ELSE 0 END) as inbound_qty,
              SUM(CASE WHEN transaction_type = 'OUT' THEN quantity_out ELSE 0 END) as outbound_qty
       FROM stock_ledger WHERE transaction_date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY to_char(transaction_date, 'YYYY-MM') ORDER BY month DESC`,
    );

    const stockByLocation = await db.query(
      `SELECT lm.aisle,
              COUNT(DISTINCT lm.location_code)::int as total_locs,
              COUNT(DISTINCT CASE WHEN s1.quantity > 0 OR s2.quantity > 0 THEN lm.location_code END)::int as occupied_locs,
              COALESCE(SUM(CASE WHEN s1.quantity > 0 THEN s1.quantity ELSE s2.quantity END), 0) as total_qty,
              CEIL(COALESCE(SUM(CASE WHEN s1.quantity > 0 THEN s1.pallet ELSE s2.pallet END), 0))::int as total_pallet
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock s1 ON sl.stock_id = s1.id AND s1.quantity > 0
       LEFT JOIN stock s2 ON s2.location = lm.location_code
         AND s2.quantity > 0 AND s2.stock_status = 'Available' AND s1.id IS NULL
       WHERE lm.is_active = 1
       GROUP BY lm.aisle ORDER BY lm.aisle`,
    );

    const recentActivity = await db.query(
      `SELECT sl.*, p.product_code, p.product_name
       FROM stock_ledger sl JOIN products p ON sl.product_id = p.id
       ORDER BY sl.id DESC LIMIT 8`,
    );

    const pendingInbound = await db.query(
      `SELECT io.id, io.order_number, io.status, io.order_date, io.shipment_no, io.carrier_name,
              COUNT(ii.id)::int AS line_count, COALESCE(SUM(ii.quantity), 0) AS total_qty
       FROM inbound_orders io
       LEFT JOIN inbound_items ii ON ii.inbound_order_id = io.id
       WHERE io.status IN ('Dues In','Receiving')
       GROUP BY io.id, io.order_number, io.status, io.order_date, io.shipment_no, io.carrier_name
       ORDER BY CASE io.status WHEN 'Receiving' THEN 0 WHEN 'Dues In' THEN 1 ELSE 2 END,
                io.order_date ASC LIMIT 10`,
    );

    const pendingOutbound = await db.query(
      `SELECT oo.id, oo.order_number, oo.status, oo.order_date, oo.shipment_number,
              COUNT(oi.id)::int AS line_count, COALESCE(SUM(oi.quantity), 0) AS total_qty
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Open','Picking')
       GROUP BY oo.id, oo.order_number, oo.status, oo.order_date, oo.shipment_number
       ORDER BY CASE oo.status WHEN 'Picking' THEN 0 WHEN 'Open' THEN 1 ELSE 2 END,
                oo.order_date ASC LIMIT 10`,
    );

    // Pick accuracy: shipped orders today with actual_qty vs quantity match rate
    const pickAccuracy = await db.query(
      `SELECT 
        COUNT(*)::int as total_lines,
        COUNT(CASE WHEN oi.actual_qty IS NULL OR ABS(oi.actual_qty - oi.quantity) < 0.01 THEN 1 END)::int as accurate_lines
       FROM outbound_orders oo
       JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Shipped', 'Completed') 
       AND (oo.shipped_date = CURRENT_DATE OR oo.updated_at::date = CURRENT_DATE)`,
    );
    const pickAccuracyRate =
      Number(pickAccuracy.rows[0].total_lines) > 0
        ? (Number(pickAccuracy.rows[0].accurate_lines) / Number(pickAccuracy.rows[0].total_lines)) * 100
        : 100;

    // Aging inventory: stock older than 90 days
    const agingInventory = await db.query(
      `SELECT 
        COUNT(DISTINCT s.id)::int as aging_batch_count,
        SUM(s.quantity) as aging_quantity,
        SUM(s.pallet) as aging_pallets
       FROM stock s
       LEFT JOIN stock_ledger sl ON sl.product_id = s.product_id 
         AND sl.batch_number IS NOT DISTINCT FROM s.batch_number 
         AND sl.transaction_type = 'IN'
         AND sl.reference_type = 'Inbound'
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       AND (sl.transaction_date IS NULL OR sl.transaction_date <= CURRENT_DATE - INTERVAL '90 days')`,
    );

    // Orders shipped today (already have dispatched_today count, add quantity)
    const shippedToday = await db.query(
      `SELECT 
        COUNT(DISTINCT oo.id)::int as orders,
        COALESCE(SUM(oi.quantity), 0) as total_quantity
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Shipped', 'Completed') 
       AND (oo.shipped_date = CURRENT_DATE OR oo.updated_at::date = CURRENT_DATE)`,
    );

    return {
      kpi: {
        total_drums: Number(totalDrums),
        total_pallets: Number(totalPallets),
        expiring_soon: Number(expiringSoon.rows[0].count),
        expired_items: expiredCount,
        dues_in: Number(duesInCount.rows[0].count),
        receiving_now: Number(receivingNow.rows[0].count),
        pending_outbound: Number(pendingOutboundCount.rows[0].count),
        dispatched_today: Number(dispatchedToday.rows[0].count),
        received_today: Number(receivedToday.rows[0].count),
        today_inbound: Number(todayInbound.rows[0].count),
        today_outbound: Number(todayOutbound.rows[0].count),
        stock_by_uom: stockByUom.rows,
        // New KPIs
        pick_accuracy_percent: Number(pickAccuracyRate.toFixed(2)),
        pick_accurate_lines: Number(pickAccuracy.rows[0].accurate_lines),
        pick_total_lines: Number(pickAccuracy.rows[0].total_lines),
        shipped_today_orders: Number(shippedToday.rows[0].orders),
        shipped_today_quantity: Number(shippedToday.rows[0].total_quantity),
        aging_batch_count: Number(agingInventory.rows[0].aging_batch_count ?? 0),
        aging_quantity: Number(agingInventory.rows[0].aging_quantity ?? 0),
        aging_pallets: Number(agingInventory.rows[0].aging_pallets ?? 0),
      },
      expired_detail: expiredDetail,
      stock_summary: stockSummary.rows,
      monthly_activity: monthlyActivity.rows,
      stock_by_location: stockByLocation.rows,
      recent_activity: recentActivity.rows,
      pending_inbound: pendingInbound.rows,
      pending_outbound: pendingOutbound.rows,
    };
  }

  async aisleDetail(aisle: string): Promise<Q> {
    const r = await this.db.query(
      `SELECT
          lm.location_code AS code, lm.rack, lm.row_name, lm.zone,
          COALESCE(s1.quantity, s2.quantity, 0) AS qty,
          COALESCE(s1.pallet, s2.pallet, 0) AS pallet,
          COALESCE(s1.uom, s2.uom) AS uom,
          COALESCE(s1.batch_number, s2.batch_number) AS batch,
          COALESCE(s1.expiry_date, s2.expiry_date) AS expiry,

  async checkExpiryAlerts(): Promise<Q> {
    // Find stock expiring in next 30 days
    const expiring = await this.db.query(
      `SELECT 
        p.product_code, p.product_name, s.batch_number, s.expiry_date, s.location,
        s.quantity, s.pallet, s.uom,
        (s.expiry_date - CURRENT_DATE) as days_until_expiry
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       AND s.expiry_date IS NOT NULL
       AND s.expiry_date > CURRENT_DATE
       AND s.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY s.expiry_date ASC, p.product_name`,
    );

    const count = expiring.rows.length;
    const totalQty = expiring.rows.reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0);
    const totalPallets = expiring.rows.reduce((sum: number, r: any) => sum + Number(r.pallet || 0), 0);

    return {
      alert_count: count,
      total_quantity: Number(totalQty.toFixed(2)),
      total_pallets: Math.ceil(totalPallets),
      items: expiring.rows.map((r: any) => ({
        product_code: r.product_code,
        product_name: r.product_name,
        batch_number: r.batch_number,
        expiry_date: r.expiry_date,
        location: r.location,
        quantity: Number(r.quantity),
        pallet: Number(r.pallet),
        uom: r.uom,
        days_until_expiry: Number(r.days_until_expiry),
      })),
      message:
        count === 0
          ? 'Tidak ada stock yang akan expired dalam 30 hari'
          : `Ditemukan ${count} batch stock yang akan expired dalam 30 hari (${totalQty.toFixed(0)} units, ${Math.ceil(totalPallets)} pallets)`,
    };
  }

          COALESCE(p1.product_name, p2.product_name) AS product,
          COALESCE(p1.product_code, p2.product_code) AS product_code,
          COALESCE(p1.uom_per_pallet, p2.uom_per_pallet) AS uom_per_pallet
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock s1 ON sl.stock_id = s1.id AND s1.quantity > 0
       LEFT JOIN products p1 ON s1.product_id = p1.id
       LEFT JOIN stock s2 ON s2.location = lm.location_code
         AND s2.quantity > 0 AND s2.stock_status = 'Available' AND s1.id IS NULL
       LEFT JOIN products p2 ON s2.product_id = p2.id
       WHERE lm.aisle = $1 AND lm.is_active = 1
       ORDER BY lm.rack, lm.row_name, lm.position`,
      [aisle],
    );

    const locations = r.rows.map((l) => {
      const qty = Number(l.qty);
      let pallet = Number(l.pallet);
      const isEceran = l.row_name === 'A';
      const upp = Number(l.uom_per_pallet ?? 4);
      const isPartial = isEceran || (!isEceran && qty > 0 && upp > 0 && qty < upp);
      if (!isEceran && pallet > 0) pallet = Math.ceil(pallet);
      return {
        ...l,
        qty,
        pallet,
        is_eceran: isEceran,
        is_partial: isPartial,
        expiry: l.expiry ? this.formatDayMonthYear(l.expiry) : l.expiry,
      };
    });

    const total = locations.length;
    const occupied = locations.filter((l) => l.qty > 0).length;
    const totalQty = locations.reduce((sum, l) => sum + l.qty, 0);
    const totalPlt = Math.ceil(locations.reduce((sum, l) => sum + l.pallet, 0));

    return {
      locations,
      stats: {
        aisle,
        total,
        occupied,
        total_qty: phpNumberFormat(totalQty, 0),
        total_pallet: totalPlt,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  async dailyReport(date: string | null, dateTo: string | null): Promise<Q> {
    const from = date || todayStr();
    const to = dateTo || from;
    return {
      date: from,
      date_to: to,
      stock_summary: (await this.reportStockSummary()).rows,
      inbound_activity: (await this.reportInboundActivity(from, to)).rows,
      outbound_activity: (await this.reportOutboundActivity(from, to)).rows,
      expiring_items: (await this.reportExpiringItems()).rows,
      low_stock: (await this.reportLowStock()).rows,
      ledger_summary: await this.reportLedgerSummary(from, to),
    };
  }

  private async reportStockSummary(): Promise<any> {
    return this.db.query(
      `SELECT p.product_code, p.product_name,
              COALESCE(p.uom_type, 'Drum') as uom_type,
              COUNT(s.id)::int as batches,
              SUM(s.quantity) as total_qty, SUM(s.quantity) as total_drums,
              SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet,1))) as total_pallets,
              MIN(s.expiry_date) as nearest_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0 AND s.stock_status = 'Available'
       GROUP BY p.id ORDER BY p.product_name`,
    );
  }

  private async reportInboundActivity(from: string, to: string): Promise<any> {
    return this.db.query(
      `SELECT io.*, COUNT(ii.id)::int as item_count,
              SUM(COALESCE(ii.actual_qty, ii.quantity, 0)) as total_drums
       FROM inbound_orders io
       LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id
       WHERE (io.order_date BETWEEN $1 AND $2)
          OR (io.received_date BETWEEN $1 AND $2)
          OR (io.created_at::date BETWEEN $1 AND $2)
       GROUP BY io.id
       ORDER BY COALESCE(io.received_date, io.order_date) DESC, io.id DESC`,
      [from, to],
    );
  }

  private async reportOutboundActivity(from: string, to: string): Promise<any> {
    return this.db.query(
      `SELECT oo.*, COUNT(oi.id)::int as item_count,
              SUM(COALESCE(oi.actual_qty, oi.quantity, 0)) as total_drums
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oo.id = oi.outbound_order_id
       WHERE (oo.order_date BETWEEN $1 AND $2)
          OR (oo.created_at::date BETWEEN $1 AND $2)
       GROUP BY oo.id
       ORDER BY oo.order_date DESC, oo.id DESC`,
      [from, to],
    );
  }

  private async reportExpiringItems(): Promise<any> {
    return this.db.query(
      `SELECT s.*, p.product_code, p.product_name,
              (s.expiry_date - CURRENT_DATE)::int as days_until_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '180 days'
       AND s.quantity > 0 AND s.stock_status = 'Available'
       ORDER BY s.expiry_date ASC LIMIT 50`,
    );
  }

  private async reportLowStock(): Promise<any> {
    return this.db.query(
      `SELECT p.product_code, p.product_name,
              SUM(s.quantity) as total_drums
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0 AND s.stock_status = 'Available'
       GROUP BY p.id HAVING SUM(s.quantity) < 16
       ORDER BY total_drums ASC`,
    );
  }

  private async reportLedgerSummary(from: string, to: string): Promise<Q> {
    const db = this.db;
    const led = await db.query(
      `SELECT COUNT(CASE WHEN transaction_type = 'IN' THEN 1 END)::int as transactions_in,
              COUNT(CASE WHEN transaction_type = 'OUT' THEN 1 END)::int as transactions_out,
              SUM(CASE WHEN transaction_type = 'IN' THEN COALESCE(quantity_in, 0) ELSE 0 END) as qty_in,
              SUM(CASE WHEN transaction_type = 'OUT' THEN COALESCE(quantity_out, 0) ELSE 0 END) as qty_out
       FROM stock_ledger
       WHERE (transaction_date BETWEEN $1 AND $2) OR (created_at::date BETWEEN $1 AND $2)`,
      [from, to],
    );
    const row = led.rows[0];
    const qtyIn = Number(row.qty_in ?? 0);
    const qtyOut = Number(row.qty_out ?? 0);

    if (qtyIn === 0 && qtyOut === 0) {
      const inRes = await db.query(
        `SELECT COUNT(DISTINCT io.id)::int as transactions_in, COALESCE(SUM(ii.actual_qty), 0) as qty_in
         FROM inbound_orders io
         LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id
         WHERE (io.order_date BETWEEN $1 AND $2) OR (io.created_at::date BETWEEN $1 AND $2)`,
        [from, to],
      );
      const outRes = await db.query(
        `SELECT COUNT(DISTINCT oo.id)::int as transactions_out, COALESCE(SUM(oi.actual_qty), 0) as qty_out
         FROM outbound_orders oo
         LEFT JOIN outbound_items oi ON oo.id = oi.outbound_order_id
         WHERE (oo.order_date BETWEEN $1 AND $2) OR (oo.created_at::date BETWEEN $1 AND $2)`,
        [from, to],
      );
      return {
        transactions_in: Number(inRes.rows[0].transactions_in ?? 0),
        transactions_out: Number(outRes.rows[0].transactions_out ?? 0),
        qty_in: Number(inRes.rows[0].qty_in ?? 0),
        qty_out: Number(outRes.rows[0].qty_out ?? 0),
      };
    }

    return {
      transactions_in: Number(row.transactions_in ?? 0),
      transactions_out: Number(row.transactions_out ?? 0),
      qty_in: qtyIn,
      qty_out: qtyOut,
    };
  }

  // ---------------------------------------------------------------------------
  // Report — flat list actions
  // ---------------------------------------------------------------------------

  async reportProducts(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT p.*,
              COALESCE(SUM(s.quantity), 0) as total_drums,
              COALESCE(SUM(s.quantity), 0) as total_qty,
              COALESCE(SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet, 1))), 0) as total_pallets
       FROM products p
       LEFT JOIN stock s ON p.id = s.product_id
         AND (s.stock_status IN ('Available','Dues In') OR s.stock_status IS NULL OR s.stock_status = '')
         AND s.quantity > 0
         AND (s.location IS NULL OR s.location NOT IN ('QUA_SHELL','STAGING'))
       GROUP BY p.id
       ORDER BY p.product_name`,
    );
    return r.rows.map((p) => ({ ...p, id: Number(p.id) }));
  }

  async reportInbound(status: string | null, start: string | null, end: string | null): Promise<any[]> {
    let rows = await this.inbound.getAll(status, 2000, 0, null);
    if (start) rows = rows.filter((r) => String(r.order_date ?? '') >= start);
    if (end) rows = rows.filter((r) => String(r.order_date ?? '') <= end);
    return rows;
  }

  async reportOutbound(status: string | null, start: string | null, end: string | null): Promise<any[]> {
    let rows = await this.outbound.getAll(status, 2000, 0, null);
    if (start) rows = rows.filter((r) => String(r.order_date ?? '') >= start);
    if (end) rows = rows.filter((r) => String(r.order_date ?? '') <= end);
    return rows;
  }

  async reportStock(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT s.*, p.product_code, p.product_name, p.category, p.uom_type, p.uom_per_pallet
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0
       ORDER BY p.product_name, s.expiry_date ASC`,
    );
    return r.rows;
  }

  async reportLedger(start: string | null, end: string | null): Promise<any[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (start) {
      params.push(start);
      where.push(`sl.transaction_date >= $${params.length}`);
    }
    if (end) {
      params.push(end);
      where.push(`sl.transaction_date <= $${params.length}`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await this.db.query(
      `SELECT sl.*, p.product_code, p.product_name
       FROM stock_ledger sl JOIN products p ON sl.product_id = p.id
       ${whereSql}
       ORDER BY sl.transaction_date DESC, sl.created_at DESC
       LIMIT 5000`,
      params,
    );
    return r.rows;
  }

  // ---------------------------------------------------------------------------
  // Activity Log
  // ---------------------------------------------------------------------------

  async activityLogList(module: string | null, limit: number): Promise<any[]> {
    let sql = 'SELECT al.* FROM activity_log al WHERE 1=1';
    const params: unknown[] = [];
    if (module) {
      params.push(module);
      sql += ` AND al.module = $${params.length}`;
    }
    sql += ' ORDER BY al.id DESC LIMIT ' + Math.max(0, Math.floor(limit));
    const r = await this.db.query(sql, params);
    return r.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      action_label: this.actionLabel(row.action),
      module_icon: this.moduleIcon(row.module),
    }));
  }

  async activityModules(): Promise<string[]> {
    const r = await this.db.query('SELECT DISTINCT module FROM activity_log ORDER BY module');
    return r.rows.map((x) => x.module);
  }

  private actionLabel(action: string): string {
    const labels: Record<string, string> = {
      CREATE_INBOUND: 'Buat Inbound',
      UPDATE_INBOUND: 'Edit Inbound',
      DELETE_INBOUND: 'Hapus Inbound',
      ADD_INBOUND_ITEM: 'Tambah Item Inbound',
      DELETE_INBOUND_ITEM: 'Hapus Item Inbound',
      UPDATE_ITEM_STATUS: 'Update Status Item',
      RECEIVE_INBOUND: 'Terima Inbound',
      CREATE_OUTBOUND: 'Buat Outbound',
      UPDATE_OUTBOUND: 'Edit Outbound',
      DELETE_OUTBOUND: 'Hapus Outbound',
      ADD_OUTBOUND_ITEM: 'Tambah Item Outbound',
      DELETE_OUTBOUND_ITEM: 'Hapus Item Outbound',
      PICK_OUTBOUND: 'Pick Outbound',
      SHIP_OUTBOUND: 'Kirim Outbound',
      COMPLETE_OUTBOUND: 'Selesai Outbound',
      BIN_TRANSFER: 'Transfer Bin-to-Bin',
      COMPLETE_BIN_TRANSFER: 'Selesai Bin Transfer',
      CANCEL_BIN_TRANSFER: 'Batal Bin Transfer',
    };
    if (labels[action]) return labels[action];
    return action
      .toLowerCase()
      .split('_')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');
  }

  private moduleIcon(module: string): string {
    const icons: Record<string, string> = {
      inbound: 'fas fa-arrow-down',
      outbound: 'fas fa-arrow-up',
      bin_transfer: 'fas fa-exchange-alt',
      stock: 'fas fa-boxes',
      user: 'fas fa-user',
    };
    return icons[module] ?? 'fas fa-circle';
  }

  // ---------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------

  async resetOperationalData(): Promise<void> {
    const tables = [
      'activity_log',
      'stock_ledger',
      'outbound_item_locations',
      'picklist_items',
      'picklists',
      'location_allocations',
      'stock_take_items',
      'stock_take',
      'bin_transfers',
      'outbound_destinations',
      'outbound_items',
      'outbound_orders',
      'inbound_items',
      'inbound_orders',
      'stock_locations',
      'stock',
    ];
    await this.db.transaction(async (client) => {
      await client.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY`);
    });
  }

  // ---------------------------------------------------------------------------

  private formatDayMonthYear(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) return dateStr;
    const day = Number(m[3]);
    const month = Number(m[2]);
    const year = m[1];
    return `${String(day).padStart(2, '0')} ${MONTHS_SHORT[month - 1] ?? m[2]} ${year}`;
  }
}

/** PHP number_format($v, $dec) parity: thousands separator + optional decimals. */
function phpNumberFormat(v: number, decimals = 0): string {
  const fixed = Number(v).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals > 0 ? `${withSep}.${decPart}` : withSep;
}
