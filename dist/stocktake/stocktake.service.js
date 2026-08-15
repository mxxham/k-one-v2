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
exports.StockTakeService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const api_exception_1 = require("../common/api-exception");
const date_util_1 = require("../common/date-util");
const EXCLUDED_LOCATIONS = ['QUA_SHELL', 'STAGING'];
let StockTakeService = class StockTakeService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getAll(limit) {
        let sql = `SELECT st.*, u.full_name as created_by_name,
              COUNT(sti.id)::int as total_items,
              SUM(CASE WHEN sti.status = 'Plus' THEN 1 ELSE 0 END)::int as plus_count,
              SUM(CASE WHEN sti.status = 'Minus' THEN 1 ELSE 0 END)::int as minus_count,
              SUM(CASE WHEN sti.status = 'Clear' THEN 1 ELSE 0 END)::int as clear_count
       FROM stock_take st
       LEFT JOIN users u ON st.created_by = u.id
       LEFT JOIN stock_take_items sti ON st.id = sti.stock_take_id
       GROUP BY st.id, u.full_name
       ORDER BY st.take_date DESC, st.created_at DESC`;
        const params = [];
        if (limit > 0) {
            params.push(limit);
            sql += ` LIMIT $${params.length}`;
        }
        const r = await this.db.query(sql, params);
        return r.rows;
    }
    async getById(id) {
        const r = await this.db.query(`SELECT st.*, u.full_name as created_by_name
       FROM stock_take st
       LEFT JOIN users u ON st.created_by = u.id
       WHERE st.id = $1`, [id]);
        return r.rows[0] ?? null;
    }
    async getItems(stockTakeId) {
        const r = await this.db.query(`SELECT sti.*, p.product_code, p.product_name
       FROM stock_take_items sti
       LEFT JOIN products p ON sti.product_id = p.id
       WHERE sti.stock_take_id = $1
       ORDER BY p.product_code, sti.location`, [stockTakeId]);
        return r.rows;
    }
    async getStats() {
        const total = await this.db.query('SELECT COUNT(*)::int as count FROM stock_take');
        const thisMonth = await this.db.query(`SELECT COUNT(*)::int as count FROM stock_take
       WHERE to_char(take_date, 'MM') = to_char(CURRENT_DATE, 'MM')
       AND to_char(take_date, 'YYYY') = to_char(CURRENT_DATE, 'YYYY')`);
        const thisYear = await this.db.query(`SELECT COUNT(*)::int as count FROM stock_take
       WHERE to_char(take_date, 'YYYY') = to_char(CURRENT_DATE, 'YYYY')`);
        const avgRes = await this.db.query(`SELECT AVG(CASE
         WHEN (SELECT COUNT(*) FROM stock_take_items WHERE stock_take_id = st.id) > 0 THEN
           ((SELECT SUM(qty_physical) FROM stock_take_items WHERE stock_take_id = st.id AND status = 'Clear') /
            NULLIF((SELECT SUM(qty_physical) FROM stock_take_items WHERE stock_take_id = st.id), 0)) * 100
         ELSE 100
       END) as avg_accuracy
       FROM stock_take st
       WHERE to_char(take_date, 'YYYY') = to_char(CURRENT_DATE, 'YYYY')
       AND st.status = 'Adjusted'`);
        return {
            total: Number(total.rows[0].count),
            this_month: Number(thisMonth.rows[0].count),
            this_year: Number(thisYear.rows[0].count),
            avg_accuracy: Math.round(Number(avgRes.rows[0].avg_accuracy ?? 100) * 100) / 100,
        };
    }
    async calculateAccuracy(stockTakeId) {
        const items = await this.getItems(stockTakeId);
        if (items.length === 0) {
            return { total_stock_take: 0, plus: 0, minus: 0, clear: 0, accuracy: 100 };
        }
        let totalStockTake = 0;
        let plus = 0;
        let minus = 0;
        let clear = 0;
        for (const item of items) {
            totalStockTake += Number(item.qty_physical ?? 0);
            if (item.status === 'Plus')
                plus += Math.abs(Number(item.difference ?? 0));
            else if (item.status === 'Minus')
                minus += Math.abs(Number(item.difference ?? 0));
            else
                clear += Number(item.qty_physical ?? 0);
        }
        const accuracy = totalStockTake > 0 ? Math.round((clear / totalStockTake) * 10000) / 100 : 100;
        return { total_stock_take: totalStockTake, plus, minus, clear, accuracy };
    }
    async create(data, userId) {
        const takeNumber = `ST-${(0, date_util_1.todayCompact)()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
        let scopeLocs = data.scope_locations ?? null;
        if (Array.isArray(scopeLocs))
            scopeLocs = JSON.stringify(scopeLocs);
        const scopeType = data.scope_type ?? (scopeLocs !== null && scopeLocs !== '[]' ? 'location' : 'full');
        const r = await this.db.query(`INSERT INTO stock_take (take_number, take_date, status, notes, scope_locations, scope_type, schedule_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [
            takeNumber,
            data.take_date,
            data.status ?? 'Draft',
            data.notes ?? null,
            scopeLocs,
            scopeType,
            data.schedule_id ?? null,
            userId,
        ]);
        return Number(r.rows[0].id);
    }
    async autoLoadByLocations(stockTakeId, locations, velocityClass) {
        let sql = `SELECT s.product_id, s.batch_number, s.location, s.quantity, s.uom
               FROM stock s
               WHERE s.stock_status='Available' AND s.quantity>0
                 AND s.location IS NOT NULL
                 AND s.location NOT IN ('QUA_SHELL','STAGING')`;
        const params = [];
        if (locations && locations.length > 0) {
            const ph = locations.map((_, i) => `$${i + 1}`).join(',');
            sql += ` AND s.location IN (${ph})`;
            params.push(...locations);
        }
        if (velocityClass) {
            params.push(velocityClass);
            sql += ` AND s.product_id IN (SELECT id FROM products WHERE velocity_class = $${params.length})`;
        }
        sql += ' ORDER BY s.location, s.product_id';
        const r = await this.db.query(sql, params);
        for (const s of r.rows) {
            await this.addItemFull(stockTakeId, {
                product_id: s.product_id,
                batch_number: s.batch_number,
                location: s.location,
                uom: s.uom,
                qty_system: s.quantity,
                qty_physical: 0,
                counter_1: null,
                counter_2: null,
                counter_3: null,
            });
        }
    }
    async addItemFull(stockTakeId, data) {
        const qtySystem = Number(data.qty_system ?? 0);
        const qtyPhysical = Number(data.qty_physical ?? 0);
        const difference = qtyPhysical - qtySystem;
        const status = difference > 0 ? 'Plus' : difference < 0 ? 'Minus' : 'Clear';
        const r = await this.db.query(`INSERT INTO stock_take_items
         (stock_take_id, product_id, batch_number, uom, location,
          qty_system, counter_1, counter_2, counter_3,
          qty_physical, difference, status, notes, counter_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [
            stockTakeId,
            data.product_id,
            data.batch_number ?? null,
            data.uom ?? null,
            data.location ?? null,
            qtySystem,
            data.counter_1 ?? null,
            data.counter_2 ?? null,
            data.counter_3 ?? null,
            qtyPhysical,
            difference,
            status,
            data.notes ?? null,
            data.counter_by ?? null,
        ]);
        return Number(r.rows[0].id);
    }
    async update(id, data) {
        await this.db.query('UPDATE stock_take SET take_date=$1, status=$2, notes=$3 WHERE id=$4', [
            data.take_date,
            data.status,
            data.notes ?? null,
            id,
        ]);
    }
    async delete(id) {
        await this.db.transaction(async (client) => {
            await client.query('DELETE FROM stock_take_items WHERE stock_take_id = $1', [id]);
            await client.query('DELETE FROM stock_take WHERE id = $1', [id]);
        });
    }
    async getSystemStock(productId, location, batchNumber) {
        let sql = 'SELECT COALESCE(SUM(quantity),0) as total_qty FROM stock WHERE product_id = $1';
        const params = [productId];
        if (location !== null && location !== undefined && location !== '') {
            params.push(location);
            sql += ` AND location = $${params.length}`;
        }
        if (batchNumber !== null && batchNumber !== undefined && batchNumber !== '') {
            params.push(batchNumber);
            sql += ` AND batch_number = $${params.length}`;
        }
        const r = await this.db.query(sql, params);
        return Number(r.rows[0].total_qty);
    }
    async getActiveLockedLocations() {
        const r = await this.db.query(`SELECT DISTINCT sti.location
       FROM stock_take_items sti
       JOIN stock_take st ON st.id = sti.stock_take_id
       WHERE st.status IN ('Counting','Review')
         AND sti.location IS NOT NULL`);
        return r.rows.map((x) => x.location);
    }
    async getScopeLocations() {
        const locked = await this.getActiveLockedLocations();
        const r = await this.db.query(`SELECT DISTINCT location FROM stock
       WHERE location IS NOT NULL AND location NOT IN ('QUA_SHELL','STAGING') AND quantity > 0
       ORDER BY location`);
        const available = r.rows.map((x) => x.location).filter((l) => !locked.includes(l));
        return { locations: available, locked };
    }
    async getStock(productId, location, batch) {
        const totalQty = await this.getSystemStock(productId, location, batch);
        let sql = `SELECT s.id, s.product_id, s.batch_number, s.location, s.quantity, s.uom, s.expiry_date,
                      p.product_code, p.product_name
               FROM stock s JOIN products p ON p.id = s.product_id
               WHERE s.product_id = $1 AND s.quantity > 0 AND s.stock_status='Available'`;
        const params = [productId];
        if (location) {
            params.push(location);
            sql += ` AND s.location = $${params.length}`;
        }
        if (batch) {
            params.push(batch);
            sql += ` AND s.batch_number IS NOT DISTINCT FROM $${params.length}`;
        }
        sql += ' ORDER BY s.expiry_date';
        const r = await this.db.query(sql, params);
        return { total_qty: totalQty, rows: r.rows };
    }
    async startCounting(id) {
        const st = await this.getById(id);
        if (!st)
            throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
        if (st.status !== 'Draft')
            throw api_exception_1.ApiException.badRequest('Status harus Draft untuk memulai Counting');
        await this.db.query(`UPDATE stock_take SET status='Counting', counting_round='c1', updated_at=NOW() WHERE id=$1`, [id]);
    }
    async saveC1(id, values) {
        const st = await this.getById(id);
        if (!st)
            throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
        if (st.status !== 'Counting' || st.counting_round !== 'c1') {
            throw api_exception_1.ApiException.badRequest('Tidak bisa simpan Counter 1 — bukan giliran C1');
        }
        for (const [itemId, val] of Object.entries(values)) {
            const c1 = val !== null && val !== undefined && val !== '' ? Number(val) : null;
            await this.db.query('UPDATE stock_take_items SET counter_1=$1 WHERE id=$2 AND stock_take_id=$3', [c1, Number(itemId), id]);
        }
    }
    async advanceToC2(id, c1Values) {
        const st = await this.getById(id);
        if (!st)
            throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
        if (st.status !== 'Counting' || st.counting_round !== 'c1') {
            throw api_exception_1.ApiException.badRequest('Harus di tahap Counter 1 untuk maju ke Counter 2');
        }
        await this.saveC1(id, c1Values);
        await this.db.query(`UPDATE stock_take SET counting_round='c2', updated_at=NOW() WHERE id=$1`, [id]);
    }
    async saveCounters(id, counters) {
        for (const [itemId, v] of Object.entries(counters)) {
            const c1 = v.c1 !== '' && v.c1 !== null && v.c1 !== undefined ? Number(v.c1) : null;
            const c2 = v.c2 !== '' && v.c2 !== null && v.c2 !== undefined ? Number(v.c2) : null;
            const c3 = v.c3 !== '' && v.c3 !== null && v.c3 !== undefined ? Number(v.c3) : null;
            await this.db.query('UPDATE stock_take_items SET counter_1=$1, counter_2=$2, counter_3=$3 WHERE id=$4 AND stock_take_id=$5', [c1, c2, c3, Number(itemId), id]);
        }
    }
    async finishCounting(id, c2Values) {
        await this.db.transaction(async (client) => {
            const st = await this.getById(id);
            if (!st)
                throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
            if (st.status !== 'Counting')
                throw api_exception_1.ApiException.badRequest('Status harus Counting');
            if (st.counting_round !== 'c2') {
                throw api_exception_1.ApiException.badRequest('Counter 1 belum selesai — selesaikan Counter 1 dulu');
            }
            if (c2Values && Object.keys(c2Values).length > 0) {
                await this.saveC2WithClient(client, id, c2Values);
            }
            await client.query(`UPDATE stock_take_items sti
         SET qty_system = (
           SELECT COALESCE(SUM(s.quantity), 0)
           FROM stock s
           WHERE s.product_id = sti.product_id
             AND (sti.location IS NULL OR s.location = sti.location)
             AND (sti.batch_number IS NULL OR s.batch_number IS NOT DISTINCT FROM sti.batch_number)
             AND s.stock_status = 'Available'
         )
         WHERE stock_take_id = $1`, [id]);
            const items = await client.query('SELECT * FROM stock_take_items WHERE stock_take_id = $1', [id]);
            for (const item of items.rows) {
                const c1 = item.counter_1 !== null && item.counter_1 !== undefined ? Number(item.counter_1) : null;
                const c2 = item.counter_2 !== null && item.counter_2 !== undefined ? Number(item.counter_2) : null;
                const c3 = item.counter_3 !== null && item.counter_3 !== undefined ? Number(item.counter_3) : null;
                let qtyPhysical;
                if (c1 !== null && c2 !== null && Math.abs(c1 - c2) < 0.001) {
                    qtyPhysical = c1;
                }
                else if (c3 !== null) {
                    qtyPhysical = c3;
                }
                else if (c2 !== null) {
                    qtyPhysical = c2;
                }
                else if (c1 !== null) {
                    qtyPhysical = c1;
                }
                else {
                    qtyPhysical = 0;
                }
                const difference = qtyPhysical - Number(item.qty_system);
                const status = difference > 0.001 ? 'Plus' : difference < -0.001 ? 'Minus' : 'Clear';
                await client.query('UPDATE stock_take_items SET qty_physical=$1, difference=$2, status=$3 WHERE id=$4', [
                    qtyPhysical,
                    difference,
                    status,
                    item.id,
                ]);
            }
            await client.query(`UPDATE stock_take SET status='Review', updated_at=NOW() WHERE id=$1`, [id]);
        });
    }
    async saveC2WithClient(client, id, values) {
        for (const [itemId, val] of Object.entries(values)) {
            const c2 = val !== null && val !== undefined && val !== '' ? Number(val) : null;
            await client.query('UPDATE stock_take_items SET counter_2=$1 WHERE id=$2 AND stock_take_id=$3', [c2, Number(itemId), id]);
        }
    }
    async saveReview(id, physicals) {
        const st = await this.getById(id);
        if (!st)
            throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
        if (st.status !== 'Review')
            throw api_exception_1.ApiException.badRequest('Status harus Review');
        for (const [itemId, qtyPhysicalRaw] of Object.entries(physicals)) {
            const itemIdNum = Number(itemId);
            const getStmt = await this.db.query('SELECT qty_system FROM stock_take_items WHERE id=$1 AND stock_take_id=$2', [itemIdNum, id]);
            const row = getStmt.rows[0];
            if (!row)
                continue;
            const qtyPhysical = Number(qtyPhysicalRaw);
            const difference = qtyPhysical - Number(row.qty_system);
            const status = difference > 0.001 ? 'Plus' : difference < -0.001 ? 'Minus' : 'Clear';
            await this.db.query('UPDATE stock_take_items SET qty_physical=$1, difference=$2, status=$3 WHERE id=$4 AND stock_take_id=$5', [qtyPhysical, difference, status, itemIdNum, id]);
        }
    }
    async applyAdjustment(id) {
        await this.db.transaction(async (client) => {
            const st = await this.getById(id);
            if (!st)
                throw api_exception_1.ApiException.badRequest('Stock take tidak ditemukan');
            if (st.status !== 'Review')
                throw api_exception_1.ApiException.badRequest('Status harus Review untuk apply adjustment');
            const items = await client.query('SELECT * FROM stock_take_items WHERE stock_take_id = $1', [id]);
            for (const item of items.rows) {
                const diff = Number(item.difference);
                if (Math.abs(diff) < 0.001)
                    continue;
                const productId = Number(item.product_id);
                const location = item.location;
                const batch = item.batch_number;
                const uom = item.uom ?? 'Drum';
                const qtyPhysical = Number(item.qty_physical);
                const existing = await client.query(`SELECT id FROM stock
           WHERE product_id=$1 AND location=$2 AND batch_number IS NOT DISTINCT FROM $3
             AND stock_status='Available' LIMIT 1`, [productId, location, batch]);
                const stockRow = existing.rows[0];
                if (stockRow) {
                    if (qtyPhysical <= 0.001) {
                        await client.query('DELETE FROM stock WHERE id=$1', [stockRow.id]);
                    }
                    else {
                        await client.query('UPDATE stock SET quantity=$1, updated_at=NOW() WHERE id=$2', [qtyPhysical, stockRow.id]);
                    }
                }
                else if (qtyPhysical > 0.001) {
                    await client.query(`INSERT INTO stock (product_id, batch_number, location, quantity, uom, stock_status)
             VALUES ($1,$2,$3,$4,$5,'Available')`, [productId, batch, location, qtyPhysical, uom]);
                }
                const balStmt = await client.query('SELECT balance FROM stock_ledger WHERE product_id=$1 ORDER BY id DESC LIMIT 1', [productId]);
                let balance = Number(balStmt.rows[0]?.balance ?? 0);
                const qIn = diff > 0 ? diff : 0;
                const qOut = diff < 0 ? Math.abs(diff) : 0;
                balance += qIn - qOut;
                await client.query(`INSERT INTO stock_ledger
             (transaction_date, product_id, transaction_type, reference_type,
              reference_id, reference_number, batch_number,
              quantity_in, quantity_out, uom, balance, location, notes)
           VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
                    productId,
                    'ADJUSTMENT',
                    'StockTake',
                    id,
                    st.take_number,
                    batch,
                    qIn,
                    qOut,
                    uom,
                    balance,
                    location,
                    `Stock Take Adjustment ${diff > 0 ? `+${diff}` : `${diff}`}`,
                ]);
            }
            await client.query(`UPDATE stock_take SET status='Adjusted', updated_at=NOW() WHERE id=$1`, [id]);
        });
    }
};
exports.StockTakeService = StockTakeService;
exports.StockTakeService = StockTakeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], StockTakeService);
//# sourceMappingURL=stocktake.service.js.map