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
var StockActions_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockActions = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
const master_data_service_1 = require("../master/master-data.service");
const date_util_1 = require("../common/date-util");
let StockActions = class StockActions {
    static { StockActions_1 = this; }
    db;
    activity;
    master;
    constructor(db, activity, master) {
        this.db = db;
        this.activity = activity;
        this.master = master;
        (0, registry_1.registerActions)('stock', {
            list: (c) => this.list(c),
            summary: (c) => this.summary(c),
            expiring: (c) => this.expiring(c),
            by_location: (c) => this.byLocation(c),
            detail: (c) => this.detail(c),
            locations: (c) => this.locations(c),
            transfer: (c) => this.transfer(c),
            adjust: (c) => this.adjust(c),
            hold: (c) => this.hold(c),
            release: (c) => this.release(c),
            scan: (c) => this.scan(c),
            scan_override: (c) => this.scanOverride(c),
        });
        (0, registry_1.setPermission)('stock', 'transfer', 'write');
        (0, registry_1.setPermission)('stock', 'adjust', 'admin');
        (0, registry_1.setPermission)('stock', 'hold', 'write');
        (0, registry_1.setPermission)('stock', 'release', 'write');
        (0, registry_1.setPermission)('stock', 'scan', 'any');
        (0, registry_1.setPermission)('stock', 'scan_override', 'write');
        (0, registry_1.setModuleDepartments)('stock', ['inventory']);
        (0, registry_1.setActionDepartments)('stock', 'scan', ['inbound', 'outbound', 'inventory']);
        (0, registry_1.setActionDepartments)('stock', 'scan_override', ['inbound', 'outbound', 'inventory']);
        (0, registry_1.registerActions)('ledger', {
            list: (c) => this.ledgerList(c),
            repair_all: (c) => this.ledgerRepairAll(c),
        });
        (0, registry_1.setPermission)('ledger', 'repair_all', 'admin');
        (0, registry_1.setModuleDepartments)('ledger', ['inventory']);
    }
    async list(ctx) {
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const expiring = ctx.query.expiring === '1' || ctx.query.expiring === 'true';
        const search = String(ctx.query.q ?? '').trim().toLowerCase();
        const location = String(ctx.query.location ?? '').trim();
        const yearRaw = String(ctx.query.year ?? '').trim();
        const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
        let sql = `SELECT s.*, p.product_code, p.product_name, p.category, p.uom_type, p.uom_per_pallet, p.velocity_class
               FROM stock s
               JOIN products p ON s.product_id = p.id
               WHERE s.quantity > 0`;
        const params = [];
        if (status) {
            params.push(status);
            sql += ` AND s.stock_status = $${params.length}`;
        }
        if (year) {
            params.push(year);
            sql += ` AND EXTRACT(YEAR FROM s.expiry_date) = $${params.length}`;
        }
        if (expiring) {
            sql += ` AND s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days' ORDER BY s.expiry_date ASC`;
        }
        else {
            sql += ` ORDER BY p.product_name, s.expiry_date ASC`;
        }
        const r = await this.db.query(sql, params);
        let rows = r.rows;
        if (search) {
            rows = rows.filter((row) => {
                const fields = [row.product_code, row.product_name, row.batch_number, row.location]
                    .map((x) => (x ?? '').toString().toLowerCase());
                return fields.some((f) => f.includes(search));
            });
        }
        if (location) {
            rows = rows.filter((row) => (row.location ?? '').toString().toLowerCase() === location.toLowerCase());
        }
        return { rows, summary: await this.getSummary() };
    }
    async summary(_ctx) {
        return { summary: await this.getSummary() };
    }
    async getSummary() {
        const r = await this.db.query(`SELECT
         COUNT(DISTINCT product_id)::int as total_products,
         COALESCE(SUM(quantity),0) as total_drums,
         COALESCE(SUM(pallet),0) as total_pallets,
         COUNT(CASE WHEN stock_status = 'Available' THEN 1 END)::int as available_items,
         COUNT(CASE WHEN stock_status = 'Reserved' THEN 1 END)::int as reserved_items,
         COUNT(CASE WHEN stock_status = 'Expired' THEN 1 END)::int as expired_items,
         COUNT(CASE WHEN stock_status = 'Dues In' THEN 1 END)::int as dues_in_items
       FROM stock WHERE quantity > 0`);
        const summary = r.rows[0];
        const expiring = await this.db.query(`SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
         AND quantity > 0 AND stock_status = 'Available'`);
        const critical = await this.db.query(`SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '120 days'
         AND quantity > 0 AND stock_status = 'Available'`);
        const expired = await this.db.query(`SELECT COUNT(*)::int as count FROM stock
       WHERE expiry_date < CURRENT_DATE AND quantity > 0`);
        return {
            ...summary,
            expiring_soon: expiring.rows[0].count,
            critical: critical.rows[0].count,
            expired: expired.rows[0].count,
            total_qty: Number(summary.total_drums ?? 0),
        };
    }
    async expiring(ctx) {
        const days = Number.parseInt(ctx.query.days ?? '90', 10) || 90;
        const r = await this.db.query(`SELECT s.*, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              (s.expiry_date - CURRENT_DATE)::int as days_until_expiry
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + make_interval(days => $1)
         AND s.quantity > 0 AND s.stock_status = 'Available'
       ORDER BY s.expiry_date ASC`, [days]);
        return { rows: r.rows };
    }
    async byLocation(_ctx) {
        const r = await this.db.query(`SELECT split_part(location, '-', 1) as area,
              COUNT(DISTINCT product_id)::int as products,
              SUM(quantity) as total_qty,
              SUM(pallet) as total_pallet
       FROM stock WHERE quantity > 0 AND location IS NOT NULL
       GROUP BY split_part(location, '-', 1)
       ORDER BY area`);
        return { rows: r.rows };
    }
    async detail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const r = await this.db.query(`SELECT s.*, p.product_code, p.product_name, p.category, p.uom_type, p.uom_per_pallet
       FROM stock s JOIN products p ON s.product_id = p.id WHERE s.id = $1`, [id]);
        return { stock: r.rows[0] ?? null };
    }
    async locations(_ctx) {
        const r = await this.db.query(`SELECT DISTINCT location FROM stock WHERE location IS NOT NULL AND location != '' AND quantity > 0 ORDER BY location`);
        return { rows: r.rows.map((x) => x.location) };
    }
    async transfer(ctx) {
        const d = ctx.body;
        const stockId = Number.parseInt(d.stock_id ?? '0', 10) || 0;
        const newLocation = String(d.to_location ?? '').trim().toUpperCase();
        const quantity = d.quantity !== undefined && d.quantity !== '' ? Number(d.quantity) : null;
        if (!stockId || !newLocation)
            throw api_exception_1.ApiException.badRequest('stock_id dan to_location wajib diisi.');
        const st = await this.getById(stockId);
        if (!st)
            throw api_exception_1.ApiException.badRequest('Stock tidak ditemukan.');
        await this.transferStock(stockId, newLocation, quantity, st);
        await this.activity.log('STOCK_TRANSFER', 'stock', 'Stock', stockId, null, `Transfer stok ID ${stockId} → ${newLocation} qty ${quantity ?? 'all'}`, null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async getById(id) {
        const r = await this.db.query('SELECT * FROM stock WHERE id = $1', [id]);
        return r.rows[0] ?? null;
    }
    async transferStock(stockId, newLocation, quantity, stock) {
        await this.db.transaction(async (client) => {
            const transferQty = quantity ?? Number(stock.quantity);
            if (transferQty > Number(stock.quantity)) {
                throw new Error('Transfer quantity exceeds available stock');
            }
            if (transferQty < Number(stock.quantity)) {
                const uomPerPallet = Number(stock.uom_per_pallet ?? 4);
                const palletReduction = Math.ceil(transferQty / uomPerPallet);
                await client.query('UPDATE stock SET quantity = quantity - $1, pallet = pallet - $2 WHERE id = $3', [
                    transferQty, palletReduction, stockId,
                ]);
                await client.query(`INSERT INTO stock (product_id, batch_number, quantity, uom, pallet, manufacture_date, expiry_date, location, stock_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
                    stock.product_id,
                    stock.batch_number,
                    transferQty,
                    stock.uom,
                    palletReduction,
                    stock.manufacture_date,
                    stock.expiry_date,
                    newLocation,
                    stock.stock_status,
                ]);
            }
            else {
                await client.query('UPDATE stock SET location = $1 WHERE id = $2', [newLocation, stockId]);
            }
        });
    }
    async adjust(ctx) {
        const d = ctx.body;
        const stockId = Number.parseInt(d.stock_id ?? '0', 10) || 0;
        const newQty = Number(d.quantity ?? 0);
        const reason = String(d.reason ?? '').trim();
        if (!stockId)
            throw api_exception_1.ApiException.badRequest('stock_id wajib diisi.');
        if (newQty < 0)
            throw api_exception_1.ApiException.badRequest('Quantity tidak boleh negatif.');
        const stock = await this.getById(stockId);
        if (!stock)
            throw api_exception_1.ApiException.badRequest('Stock tidak ditemukan.');
        await this.adjustStock(stockId, newQty, reason, stock);
        await this.activity.log('STOCK_ADJUST', 'stock', 'Stock', stockId, null, `Adjust stok ID ${stockId} → ${newQty} (${reason || 'no reason'})`, null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async adjustStock(stockId, newQuantity, reason, stock) {
        await this.db.transaction(async (client) => {
            const oldQuantity = Number(stock.quantity);
            const difference = newQuantity - oldQuantity;
            const uomPerPallet = Number(stock.uom_per_pallet ?? 4);
            const newPallet = Math.ceil(newQuantity / uomPerPallet);
            await client.query('UPDATE stock SET quantity = $1, pallet = $2 WHERE id = $3', [newQuantity, newPallet, stockId]);
            const bal = await client.query(`SELECT COALESCE(SUM(quantity),0) as balance FROM stock WHERE product_id = $1 AND stock_status = 'Available'`, [stock.product_id]);
            const balance = Number(bal.rows[0].balance);
            const type = difference > 0 ? 'IN' : 'OUT';
            await client.query(`INSERT INTO stock_ledger (transaction_date, product_id, batch_number, transaction_type, quantity_in, quantity_out, uom, pallet, reference_number, reference_type, balance, location, notes)
         VALUES (CURRENT_DATE, $1,$2,$3,$4,$5,$6,$7,$8,'Adjustment',$9,$10,$11)`, [
                stock.product_id,
                stock.batch_number,
                type,
                type === 'IN' ? difference : 0,
                type === 'OUT' ? Math.abs(difference) : 0,
                stock.uom_type ?? stock.uom,
                difference / uomPerPallet,
                `ADJ-${(0, date_util_1.todayStr)().replace(/-/g, '')}${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`,
                balance + (type === 'IN' ? difference : 0),
                stock.location,
                reason,
            ]);
        });
    }
    async ledgerList(ctx) {
        const productId = String(ctx.query.product_id ?? '').trim();
        const startDate = String(ctx.query.start_date ?? '').trim();
        const endDate = String(ctx.query.end_date ?? '').trim();
        let limit = Number.parseInt(ctx.query.limit ?? '200', 10) || 200;
        if (limit <= 0 || limit > 5000)
            limit = 200;
        const where = [];
        const params = [];
        if (productId !== '') {
            params.push(Number.parseInt(productId, 10));
            where.push(`sl.product_id = $${params.length}`);
        }
        if (startDate !== '') {
            params.push(startDate);
            where.push(`sl.transaction_date >= $${params.length}`);
        }
        if (endDate !== '') {
            params.push(endDate);
            where.push(`sl.transaction_date <= $${params.length}`);
        }
        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        params.push(limit);
        const r = await this.db.query(`SELECT sl.id, sl.transaction_date, sl.product_id,
              p.product_code, p.product_name,
              sl.transaction_type, sl.reference_type, sl.reference_number,
              sl.batch_number, sl.quantity_in, sl.quantity_out,
              sl.uom, sl.pallet, sl.balance, sl.location, sl.notes, sl.created_at
       FROM stock_ledger sl
       JOIN products p ON sl.product_id = p.id
       ${whereSql}
       ORDER BY sl.transaction_date DESC, sl.created_at DESC, sl.id DESC
       LIMIT $${params.length}`, params);
        const rows = r.rows.map((row) => ({
            ...row,
            id: Number(row.id),
            quantity_in: Number(row.quantity_in),
            quantity_out: Number(row.quantity_out),
            pallet: Number(row.pallet),
            balance: Number(row.balance),
        }));
        return { rows, products: await this.master.productOptions() };
    }
    async ledgerRepairAll(ctx) {
        await this.db.transaction(async (client) => {
            const productIds = await client.query('SELECT id FROM products ORDER BY id');
            for (const row of productIds.rows) {
                const pid = row.id;
                const rows = await client.query(`SELECT id, quantity_in, quantity_out FROM stock_ledger
           WHERE product_id = $1 ORDER BY transaction_date ASC, created_at ASC, id ASC`, [pid]);
                let balance = 0;
                for (const m of rows.rows) {
                    balance += Number(m.quantity_in);
                    balance -= Number(m.quantity_out);
                    await client.query('UPDATE stock_ledger SET balance = $1 WHERE id = $2', [balance, m.id]);
                }
            }
        });
        await this.activity.log('REPAIR_LEDGER', 'ledger', 'Ledger', null, null, 'Perbaiki seluruh data ledger', null, null, this.actCtx(ctx));
        return { ok: true };
    }
    static HOLD_STATUSES = ['on_hold', 'quarantine', 'damaged'];
    async hold(ctx) {
        const d = ctx.body;
        const stockId = Number.parseInt(d.stock_id ?? '0', 10) || 0;
        const status = String(d.status ?? '').trim().toLowerCase();
        const reason = String(d.reason ?? '').trim();
        if (!stockId)
            throw api_exception_1.ApiException.badRequest('stock_id wajib diisi.');
        if (!StockActions_1.HOLD_STATUSES.includes(status)) {
            throw api_exception_1.ApiException.badRequest(`status harus salah satu dari: ${StockActions_1.HOLD_STATUSES.join(', ')}`);
        }
        if (!reason)
            throw api_exception_1.ApiException.badRequest('Alasan hold wajib diisi.');
        const stock = await this.getById(stockId);
        if (!stock)
            throw api_exception_1.ApiException.badRequest('Stock tidak ditemukan.');
        if (String(stock.hold_status ?? 'available') === status) {
            throw api_exception_1.ApiException.badRequest(`Stock sudah berstatus ${status}.`);
        }
        await this.db.transaction(async (client) => {
            await client.query(`UPDATE stock SET hold_status = $1, hold_reason = $2, hold_by = $3, hold_at = NOW(), updated_at = NOW() WHERE id = $4`, [status, reason, ctx.user.id, stockId]);
            await this.addHoldLedger(client, stock, status, reason, ctx, stockId);
        });
        await this.activity.log('STOCK_HOLD', 'stock', 'Stock', stockId, null, `Hold stok ID ${stockId} → ${status} (${reason})`, { hold_status: stock.hold_status ?? 'available' }, { hold_status: status }, this.actCtx(ctx));
        return { ok: true };
    }
    async release(ctx) {
        const d = ctx.body;
        const stockId = Number.parseInt(d.stock_id ?? '0', 10) || 0;
        const reason = String(d.reason ?? '').trim();
        if (!stockId)
            throw api_exception_1.ApiException.badRequest('stock_id wajib diisi.');
        const stock = await this.getById(stockId);
        if (!stock)
            throw api_exception_1.ApiException.badRequest('Stock tidak ditemukan.');
        const curStatus = String(stock.hold_status ?? 'available');
        if (curStatus === 'available')
            throw api_exception_1.ApiException.badRequest('Stock tidak sedang di-hold.');
        await this.db.transaction(async (client) => {
            await client.query(`UPDATE stock SET hold_status = 'available', hold_reason = NULL, hold_by = NULL, hold_at = NULL, updated_at = NOW() WHERE id = $1`, [stockId]);
            await this.addHoldLedger(client, stock, 'available', reason, ctx, stockId);
        });
        await this.activity.log('STOCK_RELEASE', 'stock', 'Stock', stockId, null, `Release stok ID ${stockId}${reason ? ` (${reason})` : ''}`, { hold_status: curStatus }, { hold_status: 'available' }, this.actCtx(ctx));
        return { ok: true };
    }
    async addHoldLedger(client, stock, status, reason, ctx, stockId) {
        const balR = await client.query(`SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS running_balance
       FROM stock_ledger WHERE product_id = $1`, [stock.product_id]);
        const balance = Number(balR.rows[0]?.running_balance ?? 0);
        const isRelease = status === 'available';
        const type = isRelease ? 'RELEASE' : 'HOLD';
        await client.query(`INSERT INTO stock_ledger
         (transaction_date, product_id, transaction_type, reference_type,
          reference_id, reference_number, batch_number, quantity_in,
          quantity_out, uom, balance, location, notes)
       VALUES (CURRENT_DATE,$1,$2,'Stock',$3,NULL,$4,0,0,$5,$6,$7,$8)`, [
            stock.product_id,
            type,
            stockId,
            stock.batch_number,
            stock.uom_type ?? stock.uom,
            balance,
            stock.location,
            isRelease
                ? `Stock ${stockId} di-release${reason ? `: ${reason}` : ''} oleh ${ctx.user.username}`
                : `Stock ${stockId} di-hold (${status})${reason ? `: ${reason}` : ''} oleh ${ctx.user.username}`,
        ]);
    }
    async scan(ctx) {
        const code = String(ctx.query.code ?? ctx.body.code ?? '').trim();
        if (!code)
            throw api_exception_1.ApiException.badRequest('Kode wajib diisi.');
        const r = await this.db.query(`SELECT p.id, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              p.default_location,
              COALESCE((SELECT s.location FROM stock s
                        WHERE s.product_id = p.id AND s.stock_status = 'Available'
                          AND (s.hold_status = 'available' OR s.hold_status IS NULL)
                          AND s.quantity > 0 AND s.location NOT IN ('QUA_SHELL','STAGING')
                        ORDER BY s.expiry_date ASC NULLS LAST, s.id ASC
                        LIMIT 1), p.default_location) AS expected_location
       FROM products p
       WHERE p.product_code = $1 AND p.is_active = 1
       LIMIT 1`, [code]);
        const row = r.rows[0];
        if (!row)
            return { found: false, code };
        return {
            found: true,
            code,
            product: {
                id: Number(row.id),
                product_code: row.product_code,
                product_name: row.product_name,
                uom_type: row.uom_type,
                uom_per_pallet: Number(row.uom_per_pallet),
                default_location: row.default_location ?? null,
            },
            expected_location: row.expected_location ?? null,
        };
    }
    async scanOverride(ctx) {
        const code = String(ctx.body.code ?? '').trim();
        const reason = String(ctx.body.reason ?? '').trim();
        const context = String(ctx.body.context ?? '').trim();
        if (!code)
            throw api_exception_1.ApiException.badRequest('Kode wajib diisi.');
        if (!reason)
            throw api_exception_1.ApiException.badRequest('Alasan override wajib diisi.');
        await this.activity.log('SCAN_OVERRIDE', 'stock', 'Stock', null, null, `Scan mismatch di-override${context ? ` [${context}]` : ''}: '${code}' — ${reason}`, { scanned: code, context: context || null }, { reason }, this.actCtx(ctx));
        return { ok: true };
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
};
exports.StockActions = StockActions;
exports.StockActions = StockActions = StockActions_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        activity_logger_1.ActivityLogger,
        master_data_service_1.MasterDataService])
], StockActions);
//# sourceMappingURL=stock.actions.js.map