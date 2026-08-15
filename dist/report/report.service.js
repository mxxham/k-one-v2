"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const inbound_service_1 = require("../inbound/inbound.service");
const outbound_service_1 = require("../outbound/outbound.service");
const date_util_1 = require("../common/date-util");
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let ReportService = class ReportService {
    db;
    inbound;
    outbound;
    constructor(db, inbound, outbound) {
        this.db = db;
        this.inbound = inbound;
        this.outbound = outbound;
    }
    async dashboardStats() {
        const db = this.db;
        const stockByUom = await db.query(`SELECT p.uom_type, SUM(s.quantity) as total_qty, SUM(s.pallet) as total_pallet
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available' GROUP BY p.uom_type`);
        let totalDrums = 0;
        let totalPallets = 0;
        for (const u of stockByUom.rows) {
            totalDrums += Number(u.total_qty ?? 0);
            totalPallets += Number(u.total_pallet ?? 0);
        }
        const prevWeekStock = await db.query(`SELECT COALESCE(SUM(balance), 0) as prev_total
       FROM stock_ledger
       WHERE transaction_date = CURRENT_DATE - INTERVAL '7 days'
       AND id IN (
         SELECT MAX(id) FROM stock_ledger
         WHERE transaction_date <= CURRENT_DATE - INTERVAL '7 days'
         GROUP BY product_id, batch_number
       )`);
        const prevTotal = Number(prevWeekStock.rows[0]?.prev_total ?? totalDrums);
        const stockTrend = prevTotal > 0 ? ((totalDrums - prevTotal) / prevTotal) * 100 : 0;
        const expiringSoon = await db.query(`SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date <= CURRENT_DATE + INTERVAL '120 days'
       AND expiry_date > CURRENT_DATE AND stock_status = 'Available'`);
        const expiredItems = await db.query(`SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date < CURRENT_DATE AND stock_status = 'Available'`);
        const duesInCount = await db.query(`SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = 'Dues In'`);
        const receivingNow = await db.query(`SELECT COUNT(*)::int as count FROM inbound_orders WHERE status = 'Receiving'`);
        const pendingOutboundCount = await db.query(`SELECT COUNT(*)::int as count FROM outbound_orders WHERE status IN ('Open','Picking')`);
        const dispatchedToday = await db.query(`SELECT COUNT(*)::int as count FROM outbound_orders
       WHERE status = 'Completed' AND updated_at::date = CURRENT_DATE`);
        const receivedToday = await db.query(`SELECT COUNT(*)::int as count FROM inbound_orders
       WHERE status IN ('Goods Received','Good Received') AND updated_at::date = CURRENT_DATE`);
        const todayInbound = await db.query(`SELECT COUNT(*)::int as count FROM inbound_orders WHERE order_date = CURRENT_DATE`);
        const todayOutbound = await db.query(`SELECT COUNT(*)::int as count FROM outbound_orders WHERE order_date = CURRENT_DATE`);
        const expiredCount = Number(expiredItems.rows[0].count);
        const expiredDetail = expiredCount > 0
            ? (await db.query(`SELECT p.product_code, p.product_name, s.batch_number, s.expiry_date,
                      SUM(s.quantity) as qty, SUM(s.pallet) as pallet
               FROM stock s JOIN products p ON s.product_id = p.id
               WHERE s.expiry_date < CURRENT_DATE AND s.stock_status = 'Available'
               GROUP BY p.id, p.product_code, p.product_name, s.batch_number, s.expiry_date
               ORDER BY s.expiry_date ASC LIMIT 5`)).rows
            : [];
        const stockSummary = await db.query(`SELECT p.id, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              COUNT(DISTINCT s.batch_number)::int as batches,
              SUM(s.quantity) as total_qty, SUM(s.pallet) as total_pallet,
              MIN(s.expiry_date) as nearest_expiry,
              SUM(CASE WHEN s.expiry_date <= CURRENT_DATE + INTERVAL '120 days'
                       AND s.expiry_date > CURRENT_DATE THEN 1 ELSE 0 END)::int as expiring_count
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available'
       GROUP BY p.id HAVING SUM(s.quantity) > 0
       ORDER BY nearest_expiry ASC, total_qty DESC LIMIT 25`);
        const monthlyActivity = await db.query(`SELECT to_char(transaction_date, 'YYYY-MM') as month,
              SUM(CASE WHEN transaction_type = 'IN' THEN quantity_in ELSE 0 END) as inbound_qty,
              SUM(CASE WHEN transaction_type = 'OUT' THEN quantity_out ELSE 0 END) as outbound_qty
       FROM stock_ledger WHERE transaction_date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY to_char(transaction_date, 'YYYY-MM') ORDER BY month DESC`);
        const stockByLocation = await db.query(`SELECT lm.aisle,
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
       GROUP BY lm.aisle ORDER BY lm.aisle`);
        const recentActivity = await db.query(`SELECT sl.*, p.product_code, p.product_name
       FROM stock_ledger sl JOIN products p ON sl.product_id = p.id
       ORDER BY sl.id DESC LIMIT 8`);
        const pendingInbound = await db.query(`SELECT io.id, io.order_number, io.status, io.order_date, io.shipment_no, io.carrier_name,
              COUNT(ii.id)::int AS line_count, COALESCE(SUM(ii.quantity), 0) AS total_qty
       FROM inbound_orders io
       LEFT JOIN inbound_items ii ON ii.inbound_order_id = io.id
       WHERE io.status IN ('Dues In','Receiving')
       GROUP BY io.id, io.order_number, io.status, io.order_date, io.shipment_no, io.carrier_name
       ORDER BY CASE io.status WHEN 'Receiving' THEN 0 WHEN 'Dues In' THEN 1 ELSE 2 END,
                io.order_date ASC LIMIT 10`);
        const pendingOutbound = await db.query(`SELECT oo.id, oo.order_number, oo.status, oo.order_date, oo.shipment_number,
              COUNT(oi.id)::int AS line_count, COALESCE(SUM(oi.quantity), 0) AS total_qty
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Open','Picking')
       GROUP BY oo.id, oo.order_number, oo.status, oo.order_date, oo.shipment_number
       ORDER BY CASE oo.status WHEN 'Picking' THEN 0 WHEN 'Open' THEN 1 ELSE 2 END,
                oo.order_date ASC LIMIT 10`);
        const pickAccuracy = await db.query(`SELECT 
        COUNT(*)::int as total_lines,
        COUNT(CASE WHEN oi.actual_qty IS NULL OR ABS(oi.actual_qty - oi.quantity) < 0.01 THEN 1 END)::int as accurate_lines
       FROM outbound_orders oo
       JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Shipped', 'Completed') 
       AND (oo.shipped_date = CURRENT_DATE OR oo.updated_at::date = CURRENT_DATE)`);
        const pickAccuracyRate = Number(pickAccuracy.rows[0].total_lines) > 0
            ? (Number(pickAccuracy.rows[0].accurate_lines) / Number(pickAccuracy.rows[0].total_lines)) * 100
            : 100;
        const agingInventory = await db.query(`SELECT 
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
       AND (sl.transaction_date IS NULL OR sl.transaction_date <= CURRENT_DATE - INTERVAL '90 days')`);
        const shippedToday = await db.query(`SELECT 
        COUNT(DISTINCT oo.id)::int as orders,
        COALESCE(SUM(oi.quantity), 0) as total_quantity
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oi.outbound_order_id = oo.id
       WHERE oo.status IN ('Shipped', 'Completed') 
       AND (oo.shipped_date = CURRENT_DATE OR oo.updated_at::date = CURRENT_DATE)`);
        return {
            kpi: {
                total_drums: Number(totalDrums),
                total_drums_trend: Number(stockTrend.toFixed(2)),
                total_pallets: Number(totalPallets),
                total_pallets_utilization: 0,
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
                pick_accuracy_percent: Number(pickAccuracyRate.toFixed(2)),
                pick_accurate_lines: Number(pickAccuracy.rows[0].accurate_lines),
                pick_total_lines: Number(pickAccuracy.rows[0].total_lines),
                shipped_today_orders: Number(shippedToday.rows[0].orders),
                shipped_today_quantity: Number(shippedToday.rows[0].total_quantity),
                aging_batch_count: Number(agingInventory.rows[0].aging_batch_count ?? 0),
                aging_quantity: Number(agingInventory.rows[0].aging_quantity ?? 0),
                aging_pallets: Number(agingInventory.rows[0].aging_pallets ?? 0),
                total_locations: stockByLocation.rows.reduce((sum, r) => sum + Number(r.total_locs ?? 0), 0),
                occupied_locations: stockByLocation.rows.reduce((sum, r) => sum + Number(r.occupied_locs ?? 0), 0),
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
    async aisleDetail(aisle) {
        const r = await this.db.query(`SELECT
          lm.location_code AS code, lm.rack, lm.row_name, lm.zone,
          COALESCE(s1.quantity, s2.quantity, 0) AS qty,
          COALESCE(s1.pallet, s2.pallet, 0) AS pallet,
          COALESCE(s1.uom, s2.uom) AS uom,
          COALESCE(s1.batch_number, s2.batch_number) AS batch,
          COALESCE(s1.expiry_date, s2.expiry_date) AS expiry,
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
       ORDER BY lm.rack, lm.row_name, lm.position`, [aisle]);
        const locations = r.rows.map((l) => {
            const qty = Number(l.qty);
            let pallet = Number(l.pallet);
            const isEceran = l.row_name === 'A';
            const upp = Number(l.uom_per_pallet ?? 4);
            const isPartial = isEceran || (!isEceran && qty > 0 && upp > 0 && qty < upp);
            if (!isEceran && pallet > 0)
                pallet = Math.ceil(pallet);
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
    async checkExpiryAlerts() {
        const expiring = await this.db.query(`SELECT 
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
       ORDER BY s.expiry_date ASC, p.product_name`);
        const count = expiring.rows.length;
        const totalQty = expiring.rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        const totalPallets = expiring.rows.reduce((sum, r) => sum + Number(r.pallet || 0), 0);
        return {
            alert_count: count,
            total_quantity: Number(totalQty.toFixed(2)),
            total_pallets: Math.ceil(totalPallets),
            items: expiring.rows.map((r) => ({
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
            message: count === 0
                ? 'Tidak ada stock yang akan expired dalam 30 hari'
                : `Ditemukan ${count} batch stock yang akan expired dalam 30 hari (${totalQty.toFixed(0)} units, ${Math.ceil(totalPallets)} pallets)`,
        };
    }
    async fefoQueue(limit = 50) {
        const queue = await this.db.query(`SELECT 
        s.id, s.product_id, p.product_code, p.product_name, 
        s.batch_number, s.expiry_date, s.location,
        s.quantity, s.pallet, s.uom,
        CASE 
          WHEN s.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN s.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
          WHEN s.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
          ELSE 'safe'
        END as priority_level,
        (s.expiry_date - CURRENT_DATE)::int as days_remaining
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       AND s.expiry_date IS NOT NULL
       ORDER BY s.expiry_date ASC, p.product_name ASC
       LIMIT $1`, [limit]);
        const summary = await this.db.query(`SELECT 
        EXTRACT(YEAR FROM s.expiry_date)::int as year,
        COUNT(*)::int as count,
        COALESCE(SUM(s.quantity),0) as quantity
       FROM stock s
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       AND s.expiry_date IS NOT NULL
       GROUP BY year
       ORDER BY year ASC`);
        const yearRows = summary.rows.map((r) => ({
            year: Number(r.year),
            count: Number(r.count),
            quantity: Number(r.quantity),
        }));
        return {
            summary: {
                total: yearRows.reduce((a, r) => a + r.count, 0),
                years: yearRows,
            },
            queue: queue.rows.map((r) => ({
                id: Number(r.id),
                product_id: Number(r.product_id),
                product_code: r.product_code,
                product_name: r.product_name,
                batch_number: r.batch_number,
                expiry_date: r.expiry_date,
                location: r.location,
                quantity: Number(r.quantity),
                pallet: Number(r.pallet),
                uom: r.uom,
                priority_level: r.priority_level,
                days_remaining: Number(r.days_remaining ?? 0),
            })),
        };
    }
    async dashboardAlerts() {
        const db = this.db;
        const expired = await db.query(`SELECT COUNT(*)::int as count, SUM(quantity) as qty
       FROM stock 
       WHERE stock_status = 'Available' 
       AND quantity > 0
       AND expiry_date < CURRENT_DATE`);
        const critical = await db.query(`SELECT COUNT(*)::int as count, SUM(quantity) as qty
       FROM stock 
       WHERE stock_status = 'Available' 
       AND quantity > 0
       AND expiry_date >= CURRENT_DATE
       AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'`);
        const stocktakeLocks = await db.query(`SELECT COUNT(DISTINCT location)::int as locked_locations
       FROM stock_take_items sti
       JOIN stock_take st ON st.id = sti.stock_take_id
       WHERE st.status IN ('Counting', 'Review')
       AND sti.location IS NOT NULL`);
        const stalePicks = await db.query(`SELECT COUNT(*)::int as count
       FROM outbound_orders
       WHERE status = 'Picking'
       AND updated_at < CURRENT_DATE - INTERVAL '1 day'`);
        const overdueInbound = await db.query(`SELECT COUNT(*)::int as count
       FROM inbound_orders
       WHERE status = 'Dues In'
       AND order_date < CURRENT_DATE - INTERVAL '7 days'`);
        const alerts = [];
        if (Number(expired.rows[0].count) > 0) {
            alerts.push({
                level: 'critical',
                type: 'expired',
                message: `${expired.rows[0].count} batch expired (${Number(expired.rows[0].qty ?? 0).toFixed(0)} units)`,
                count: Number(expired.rows[0].count),
                action_link: '/stock?filter=expired',
            });
        }
        if (Number(critical.rows[0].count) > 0) {
            alerts.push({
                level: 'warning',
                type: 'critical_expiry',
                message: `${critical.rows[0].count} batch expiring dalam 30 hari (${Number(critical.rows[0].qty ?? 0).toFixed(0)} units)`,
                count: Number(critical.rows[0].count),
                action_link: '/stock?filter=expiring',
            });
        }
        if (Number(stocktakeLocks.rows[0].locked_locations) > 0) {
            alerts.push({
                level: 'info',
                type: 'stocktake_lock',
                message: `${stocktakeLocks.rows[0].locked_locations} lokasi terkunci (stock take aktif)`,
                count: Number(stocktakeLocks.rows[0].locked_locations),
                action_link: '/stocktake',
            });
        }
        if (Number(stalePicks.rows[0].count) > 0) {
            alerts.push({
                level: 'warning',
                type: 'stale_picks',
                message: `${stalePicks.rows[0].count} outbound stuck di status Picking`,
                count: Number(stalePicks.rows[0].count),
                action_link: '/outbound?status=Picking',
            });
        }
        if (Number(overdueInbound.rows[0].count) > 0) {
            alerts.push({
                level: 'info',
                type: 'overdue_inbound',
                message: `${overdueInbound.rows[0].count} inbound overdue (> 7 hari)`,
                count: Number(overdueInbound.rows[0].count),
                action_link: '/inbound?status=Dues In',
            });
        }
        return { alerts };
    }
    async dashboardInsights() {
        const db = this.db;
        const fastMovers = await db.query(`SELECT 
        p.id, p.product_code, p.product_name,
        COUNT(DISTINCT sl.id)::int as transaction_count,
        SUM(sl.quantity_out) as total_shipped,
        SUM(sl.quantity_out) / 30.0 as avg_daily_qty
       FROM stock_ledger sl
       JOIN products p ON sl.product_id = p.id
       WHERE sl.transaction_type = 'OUT'
       AND sl.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY p.id
       ORDER BY total_shipped DESC
       LIMIT 5`);
        const slowMovers = await db.query(`SELECT 
        p.id, p.product_code, p.product_name,
        COUNT(DISTINCT s.id)::int as batch_count,
        SUM(s.quantity) as total_qty,
        MIN(sl.transaction_date) as oldest_receipt
       FROM stock s
       JOIN products p ON s.product_id = p.id
       LEFT JOIN stock_ledger sl ON sl.product_id = s.product_id 
         AND sl.batch_number IS NOT DISTINCT FROM s.batch_number
         AND sl.transaction_type = 'IN'
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       AND (sl.transaction_date IS NULL OR sl.transaction_date <= CURRENT_DATE - INTERVAL '90 days')
       GROUP BY p.id
       ORDER BY total_qty DESC
       LIMIT 5`);
        const lowStock = await db.query(`SELECT 
        p.id, p.product_code, p.product_name, p.uom_type,
        SUM(s.quantity) as current_qty,
        100 as reorder_point
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.stock_status = 'Available'
       AND s.quantity > 0
       GROUP BY p.id
       HAVING SUM(s.quantity) < 100
       ORDER BY current_qty ASC
       LIMIT 5`);
        const locationUtil = await db.query(`SELECT 
        lm.aisle,
        COUNT(DISTINCT lm.location_code)::int as total_locations,
        COUNT(DISTINCT CASE WHEN s1.quantity > 0 OR s2.quantity > 0 THEN lm.location_code END)::int as occupied,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN s1.quantity > 0 OR s2.quantity > 0 THEN lm.location_code END) / NULLIF(COUNT(DISTINCT lm.location_code), 0), 1) as utilization_percent
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock s1 ON sl.stock_id = s1.id AND s1.quantity > 0
       LEFT JOIN stock s2 ON s2.location = lm.location_code
         AND s2.quantity > 0 AND s2.stock_status = 'Available' AND s1.id IS NULL
       WHERE lm.is_active = 1
       GROUP BY lm.aisle
       ORDER BY utilization_percent DESC`);
        return {
            fast_movers: fastMovers.rows.map((r) => ({
                id: Number(r.id),
                product_code: r.product_code,
                product_name: r.product_name,
                transaction_count: Number(r.transaction_count),
                total_shipped: Number(r.total_shipped ?? 0),
                avg_daily_qty: Number(Number(r.avg_daily_qty ?? 0).toFixed(2)),
            })),
            slow_movers: slowMovers.rows.map((r) => ({
                id: Number(r.id),
                product_code: r.product_code,
                product_name: r.product_name,
                batch_count: Number(r.batch_count),
                total_qty: Number(r.total_qty ?? 0),
                oldest_receipt: r.oldest_receipt,
            })),
            low_stock: lowStock.rows.map((r) => ({
                id: Number(r.id),
                product_code: r.product_code,
                product_name: r.product_name,
                uom_type: r.uom_type,
                current_qty: Number(r.current_qty ?? 0),
                reorder_point: Number(r.reorder_point ?? 100),
            })),
            location_utilization: locationUtil.rows.map((r) => ({
                aisle: r.aisle,
                total_locations: Number(r.total_locations),
                occupied: Number(r.occupied),
                utilization_percent: Number(r.utilization_percent ?? 0),
            })),
        };
    }
    async dailyReport(date, dateTo) {
        const from = date || (0, date_util_1.todayStr)();
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
    async reportStockSummary() {
        return this.db.query(`SELECT p.product_code, p.product_name,
              COALESCE(p.uom_type, 'Drum') as uom_type,
              COUNT(s.id)::int as batches,
              SUM(s.quantity) as total_qty, SUM(s.quantity) as total_drums,
              SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet,1))) as total_pallets,
              MIN(s.expiry_date) as nearest_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0 AND s.stock_status = 'Available'
       GROUP BY p.id ORDER BY p.product_name`);
    }
    async reportInboundActivity(from, to) {
        return this.db.query(`SELECT io.*, COUNT(ii.id)::int as item_count,
              SUM(COALESCE(ii.actual_qty, ii.quantity, 0)) as total_drums
       FROM inbound_orders io
       LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id
       WHERE (io.order_date BETWEEN $1 AND $2)
          OR (io.received_date BETWEEN $1 AND $2)
          OR (io.created_at::date BETWEEN $1 AND $2)
       GROUP BY io.id
       ORDER BY COALESCE(io.received_date, io.order_date) DESC, io.id DESC`, [from, to]);
    }
    async reportOutboundActivity(from, to) {
        return this.db.query(`SELECT oo.*, COUNT(oi.id)::int as item_count,
              SUM(COALESCE(oi.actual_qty, oi.quantity, 0)) as total_drums
       FROM outbound_orders oo
       LEFT JOIN outbound_items oi ON oo.id = oi.outbound_order_id
       WHERE (oo.order_date BETWEEN $1 AND $2)
          OR (oo.created_at::date BETWEEN $1 AND $2)
       GROUP BY oo.id
       ORDER BY oo.order_date DESC, oo.id DESC`, [from, to]);
    }
    async reportExpiringItems() {
        return this.db.query(`SELECT s.*, p.product_code, p.product_name,
              (s.expiry_date - CURRENT_DATE)::int as days_until_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '180 days'
       AND s.quantity > 0 AND s.stock_status = 'Available'
       ORDER BY s.expiry_date ASC LIMIT 50`);
    }
    async reportLowStock() {
        return this.db.query(`SELECT p.product_code, p.product_name,
              SUM(s.quantity) as total_drums
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0 AND s.stock_status = 'Available'
       GROUP BY p.id HAVING SUM(s.quantity) < 16
       ORDER BY total_drums ASC`);
    }
    async reportLedgerSummary(from, to) {
        const db = this.db;
        const led = await db.query(`SELECT COUNT(CASE WHEN transaction_type = 'IN' THEN 1 END)::int as transactions_in,
              COUNT(CASE WHEN transaction_type = 'OUT' THEN 1 END)::int as transactions_out,
              SUM(CASE WHEN transaction_type = 'IN' THEN COALESCE(quantity_in, 0) ELSE 0 END) as qty_in,
              SUM(CASE WHEN transaction_type = 'OUT' THEN COALESCE(quantity_out, 0) ELSE 0 END) as qty_out
       FROM stock_ledger
       WHERE (transaction_date BETWEEN $1 AND $2) OR (created_at::date BETWEEN $1 AND $2)`, [from, to]);
        const row = led.rows[0];
        const qtyIn = Number(row.qty_in ?? 0);
        const qtyOut = Number(row.qty_out ?? 0);
        if (qtyIn === 0 && qtyOut === 0) {
            const inRes = await db.query(`SELECT COUNT(DISTINCT io.id)::int as transactions_in, COALESCE(SUM(ii.actual_qty), 0) as qty_in
         FROM inbound_orders io
         LEFT JOIN inbound_items ii ON io.id = ii.inbound_order_id
         WHERE (io.order_date BETWEEN $1 AND $2) OR (io.created_at::date BETWEEN $1 AND $2)`, [from, to]);
            const outRes = await db.query(`SELECT COUNT(DISTINCT oo.id)::int as transactions_out, COALESCE(SUM(oi.actual_qty), 0) as qty_out
         FROM outbound_orders oo
         LEFT JOIN outbound_items oi ON oo.id = oi.outbound_order_id
         WHERE (oo.order_date BETWEEN $1 AND $2) OR (oo.created_at::date BETWEEN $1 AND $2)`, [from, to]);
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
    async reportProducts() {
        const r = await this.db.query(`SELECT p.*,
              COALESCE(SUM(s.quantity), 0) as total_drums,
              COALESCE(SUM(s.quantity), 0) as total_qty,
              COALESCE(SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet, 1))), 0) as total_pallets
       FROM products p
       LEFT JOIN stock s ON p.id = s.product_id
         AND (s.stock_status IN ('Available','Dues In') OR s.stock_status IS NULL OR s.stock_status = '')
         AND s.quantity > 0
         AND (s.location IS NULL OR s.location NOT IN ('QUA_SHELL','STAGING'))
       GROUP BY p.id
       ORDER BY p.product_name`);
        return r.rows.map((p) => ({ ...p, id: Number(p.id) }));
    }
    async reportInbound(status, start, end) {
        let rows = await this.inbound.getAll(status, 2000, 0, null);
        if (start)
            rows = rows.filter((r) => String(r.order_date ?? '') >= start);
        if (end)
            rows = rows.filter((r) => String(r.order_date ?? '') <= end);
        return rows;
    }
    async reportOutbound(status, start, end) {
        let rows = await this.outbound.getAll(status, 2000, 0, null);
        if (start)
            rows = rows.filter((r) => String(r.order_date ?? '') >= start);
        if (end)
            rows = rows.filter((r) => String(r.order_date ?? '') <= end);
        return rows;
    }
    async reportStock() {
        const r = await this.db.query(`SELECT s.*, p.product_code, p.product_name, p.category, p.uom_type, p.uom_per_pallet
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0
       ORDER BY p.product_name, s.expiry_date ASC`);
        return r.rows;
    }
    async reportLedger(start, end) {
        const where = [];
        const params = [];
        if (start) {
            params.push(start);
            where.push(`sl.transaction_date >= $${params.length}`);
        }
        if (end) {
            params.push(end);
            where.push(`sl.transaction_date <= $${params.length}`);
        }
        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const r = await this.db.query(`SELECT sl.*, p.product_code, p.product_name
       FROM stock_ledger sl JOIN products p ON sl.product_id = p.id
       ${whereSql}
       ORDER BY sl.transaction_date DESC, sl.created_at DESC
       LIMIT 5000`, params);
        return r.rows;
    }
    async activityLogList(module, limit) {
        let sql = 'SELECT al.* FROM activity_log al WHERE 1=1';
        const params = [];
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
    async activityModules() {
        const r = await this.db.query('SELECT DISTINCT module FROM activity_log ORDER BY module');
        return r.rows.map((x) => x.module);
    }
    actionLabel(action) {
        const labels = {
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
            SCAN_OVERRIDE: 'Override Scan (Mismatch)',
            CREATE_ASN: 'Buat ASN',
            UPDATE_ASN: 'Edit ASN',
            CANCEL_ASN: 'Batal ASN',
            RECOMPUTE_ABC: 'Recompute Analisis ABC',
            CREATE_CYCLECOUNT: 'Buat Jadwal Cycle Count',
            UPDATE_CYCLECOUNT: 'Edit Jadwal Cycle Count',
            DELETE_CYCLECOUNT: 'Hapus Jadwal Cycle Count',
            RUN_CYCLECOUNT: 'Run Cycle Count',
        };
        if (labels[action])
            return labels[action];
        return action
            .toLowerCase()
            .split('_')
            .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
            .join(' ');
    }
    moduleIcon(module) {
        const icons = {
            inbound: 'fas fa-arrow-down',
            outbound: 'fas fa-arrow-up',
            bin_transfer: 'fas fa-exchange-alt',
            stock: 'fas fa-boxes',
            user: 'fas fa-user',
            abc: 'fas fa-chart-pie',
            cyclecount: 'fas fa-calendar-check',
        };
        return icons[module] ?? 'fas fa-circle';
    }
    async resetOperationalData() {
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
    formatDayMonthYear(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
        if (!m)
            return dateStr;
        const day = Number(m[3]);
        const month = Number(m[2]);
        const year = m[1];
        return `${String(day).padStart(2, '0')} ${MONTHS_SHORT[month - 1] ?? m[2]} ${year}`;
    }
};
exports.ReportService = ReportService;
exports.ReportService = ReportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        inbound_service_1.InboundService,
        outbound_service_1.OutboundService])
], ReportService);
function phpNumberFormat(v, decimals = 0) {
    const fixed = Number(v).toFixed(decimals);
    const [intPart, decPart] = fixed.split('.');
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimals > 0 ? `${withSep}.${decPart}` : withSep;
}
//# sourceMappingURL=report.service.js.map