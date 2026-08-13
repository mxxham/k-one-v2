"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MasterActions = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const db_service_1 = require("../database/db.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
const master_data_service_1 = require("./master-data.service");
let MasterActions = class MasterActions {
    db;
    activity;
    master;
    constructor(db, activity, master) {
        this.db = db;
        this.activity = activity;
        this.master = master;
        (0, registry_1.registerActions)('products', {
            list: (c) => this.productList(c),
            all: (c) => this.productAll(c),
            detail: (c) => this.productDetail(c),
            create: (c) => this.productCreate(c),
            update: (c) => this.productUpdate(c),
            delete: (c) => this.productDelete(c),
        });
        (0, registry_1.setPermission)('products', 'create', 'write');
        (0, registry_1.setPermission)('products', 'update', 'write');
        (0, registry_1.setPermission)('products', 'delete', 'admin');
        (0, registry_1.registerActions)('customers', {
            list: (c) => this.customerList(c),
            all: (c) => this.customerAll(c),
            detail: (c) => this.customerDetail(c),
            create: (c) => this.customerCreate(c),
            update: (c) => this.customerUpdate(c),
            delete: (c) => this.customerDelete(c),
        });
        (0, registry_1.setPermission)('customers', 'create', 'write');
        (0, registry_1.setPermission)('customers', 'update', 'write');
        (0, registry_1.setPermission)('customers', 'delete', 'write');
        (0, registry_1.registerActions)('locations', {
            list: (c) => this.locationList(c),
            all: (c) => this.locationAll(c),
            check: (c) => this.locationCheck(c),
            available: (c) => this.locationAvailable(c),
            zone_summary: (c) => this.locationZoneSummaryAction(c),
            suggest: (c) => this.locationSuggest(c),
            create: (c) => this.locationCreate(c),
            update: (c) => this.locationUpdate(c),
            delete: (c) => this.locationDelete(c),
        });
        (0, registry_1.setPermission)('locations', 'create', 'write');
        (0, registry_1.setPermission)('locations', 'update', 'write');
        (0, registry_1.setPermission)('locations', 'delete', 'admin');
        (0, registry_1.registerActions)('users', {
            list: (c) => this.userList(c),
            create: (c) => this.userCreate(c),
            update: (c) => this.userUpdate(c),
            delete: (c) => this.userDelete(c),
        });
        (0, registry_1.setPermission)('users', 'list', 'admin');
        (0, registry_1.setPermission)('users', 'create', 'admin');
        (0, registry_1.setPermission)('users', 'update', 'admin');
        (0, registry_1.setPermission)('users', 'delete', 'admin');
    }
    async productList(ctx) {
        const search = String(ctx.query.search ?? '').trim();
        const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '25', 10) || 25);
        const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
        const offset = (page - 1) * perPage;
        const total = await this.countProducts(search);
        const totalAll = search ? await this.countProducts('') : total;
        const rows = await this.getProducts(search, perPage, offset);
        const uomRows = await this.db.query('SELECT uom_type, COUNT(*)::int as cnt FROM products GROUP BY uom_type');
        const uomStats = {};
        for (const r of uomRows.rows)
            uomStats[r.uom_type] = Number(r.cnt);
        const uomStatsOut = Object.keys(uomStats).length > 0 ? uomStats : [];
        return {
            rows,
            total,
            total_all: totalAll,
            page,
            per_page: perPage,
            uom_stats: uomStatsOut,
        };
    }
    async countProducts(search) {
        if (search) {
            const term = `%${search}%`;
            const r = await this.db.query('SELECT COUNT(*)::int as c FROM products WHERE product_code LIKE $1 OR product_name LIKE $2 OR category LIKE $3', [term, term, term]);
            return r.rows[0].c;
        }
        const r = await this.db.query('SELECT COUNT(*)::int as c FROM products');
        return r.rows[0].c;
    }
    async getProducts(search, perPage, offset) {
        const where = search
            ? 'WHERE p.product_code LIKE $1 OR p.product_name LIKE $2 OR p.category LIKE $3'
            : '';
        const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
        params.push(perPage, offset);
        const r = await this.db.query(`SELECT p.*,
              COALESCE(SUM(s.quantity),0) as total_drums,
              COALESCE(SUM(s.quantity),0) as total_qty,
              COALESCE(SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet, 1))),0) as total_pallets
       FROM products p
       LEFT JOIN stock s ON p.id = s.product_id
         AND (s.stock_status IN ('Available','Dues In') OR s.stock_status IS NULL OR s.stock_status = '')
         AND s.quantity > 0
         AND (s.location IS NULL OR s.location NOT IN ('QUA_SHELL','STAGING'))
       ${where}
       GROUP BY p.id
       ORDER BY p.product_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return r.rows.map((p) => ({ ...p, id: Number(p.id) }));
    }
    async productAll(_ctx) {
        return { rows: await this.master.productOptions() };
    }
    async productDetail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const r = await this.db.query('SELECT * FROM products WHERE id = $1', [id]);
        return { product: r.rows[0] ?? null };
    }
    async productCreate(ctx) {
        const d = ctx.body;
        await this.db.query(`INSERT INTO products (product_code, product_name, category, description, drums_per_pallet,
         uom_type, uom_per_pallet, liters_per_unit, max_sku_qty, max_trans_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
            d.product_code,
            d.product_name,
            d.category ?? null,
            d.description ?? null,
            d.drums_per_pallet ?? 4,
            d.uom_type ?? 'Drum',
            d.uom_per_pallet ?? 4,
            d.liters_per_unit ?? 209.0,
            d.max_sku_qty ?? 44,
            d.max_trans_qty ?? 80,
        ]);
        await this.activity.log('CREATE_PRODUCT', 'stock', 'Product', null, d.product_code ?? null, 'Buat produk: ' + (d.product_name ?? '—'), null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async productUpdate(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? '0', 10) || 0;
        await this.db.query(`UPDATE products SET product_code=$1, product_name=$2, category=$3, description=$4,
         drums_per_pallet=$5, uom_type=$6, uom_per_pallet=$7, liters_per_unit=$8,
         max_sku_qty=$9, max_trans_qty=$10 WHERE id=$11`, [
            d.product_code,
            d.product_name,
            d.category ?? null,
            d.description ?? null,
            d.drums_per_pallet ?? 4,
            d.uom_type ?? 'Drum',
            d.uom_per_pallet ?? 4,
            d.liters_per_unit ?? 209.0,
            d.max_sku_qty ?? 44,
            d.max_trans_qty ?? 80,
            id,
        ]);
        await this.activity.log('UPDATE_PRODUCT', 'stock', 'Product', id, d.product_code ?? null, 'Edit produk: ' + (d.product_name ?? '—'), null, null, this.actCtx(ctx));
        return { id };
    }
    async productDelete(ctx) {
        const d = ctx.body;
        const pid = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
        const pInfo = await this.db.query('SELECT product_code, product_name FROM products WHERE id=$1', [pid]);
        const pRow = pInfo.rows[0];
        await this.db.query('DELETE FROM stock_locations sl USING stock s WHERE sl.stock_id = s.id AND s.product_id = $1', [pid]);
        await this.db.query('DELETE FROM stock_locations WHERE inbound_item_id IN (SELECT id FROM inbound_items WHERE product_id=$1)', [pid]);
        await this.db.query('DELETE FROM stock_ledger WHERE product_id=$1', [pid]);
        await this.db.query('DELETE FROM stock WHERE product_id=$1', [pid]);
        await this.db.query('DELETE FROM inbound_items WHERE product_id=$1', [pid]);
        await this.db.query('DELETE FROM outbound_items WHERE product_id=$1', [pid]);
        await this.db.query('DELETE FROM stock_take_items WHERE product_id=$1', [pid]);
        await this.db.query('DELETE FROM products WHERE id=$1', [pid]);
        await this.activity.log('DELETE_PRODUCT', 'stock', 'Product', pid, pRow?.product_code ?? null, 'Hapus produk: ' + (pRow?.product_name ?? String(pid)), null, null, this.actCtx(ctx));
        return { id: pid };
    }
    async customerList(ctx) {
        const search = String(ctx.query.search ?? '').trim();
        const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '25', 10) || 25);
        const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
        const offset = (page - 1) * perPage;
        const total = await this.countCustomers(search);
        const rows = await this.getCustomers(search, perPage, offset);
        const act = await this.db.query('SELECT COUNT(*)::int c FROM customers WHERE is_active = 1');
        const inact = await this.db.query('SELECT COUNT(*)::int c FROM customers WHERE is_active = 0');
        const typeStats = {};
        if (act.rows[0].c > 0)
            typeStats['Active'] = act.rows[0].c;
        if (inact.rows[0].c > 0)
            typeStats['Inactive'] = inact.rows[0].c;
        const typeStatsOut = Object.keys(typeStats).length > 0 ? typeStats : [];
        return { rows, total, page, per_page: perPage, type_stats: typeStatsOut };
    }
    async countCustomers(search) {
        if (search) {
            const term = `%${search}%`;
            const r = await this.db.query('SELECT COUNT(*)::int c FROM customers WHERE customer_code LIKE $1 OR customer_name LIKE $2 OR city LIKE $3', [term, term, term]);
            return r.rows[0].c;
        }
        const r = await this.db.query('SELECT COUNT(*)::int c FROM customers');
        return r.rows[0].c;
    }
    async getCustomers(search, perPage, offset) {
        const where = search
            ? 'WHERE customer_code LIKE $1 OR customer_name LIKE $2 OR city LIKE $3'
            : '';
        const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
        params.push(perPage, offset);
        const r = await this.db.query(`SELECT * FROM customers${where} ORDER BY customer_name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return r.rows.map((c) => ({ ...c, id: Number(c.id) }));
    }
    async customerAll(_ctx) {
        return { rows: await this.master.customerOptions() };
    }
    async customerDetail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const r = await this.db.query('SELECT * FROM customers WHERE id=$1', [id]);
        return { customer: r.rows[0] ?? null };
    }
    async customerCreate(ctx) {
        const d = ctx.body;
        await this.db.query(`INSERT INTO customers (customer_code, customer_name, contact_person, phone, email, address)
       VALUES ($1,$2,$3,$4,$5,$6)`, [d.customer_code, d.customer_name, d.contact_person ?? null, d.phone ?? null, d.email ?? null, d.address ?? null]);
        await this.activity.log('CREATE_CUSTOMER', 'customer', 'Customer', null, d.customer_code ?? null, 'Buat customer: ' + (d.customer_name ?? '—'), null, null, this.actCtx(ctx));
        return { ok: true };
    }
    async customerUpdate(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? '0', 10) || 0;
        await this.db.query(`UPDATE customers SET customer_code=$1, customer_name=$2, contact_person=$3, phone=$4, email=$5, address=$6 WHERE id=$7`, [d.customer_code, d.customer_name, d.contact_person ?? null, d.phone ?? null, d.email ?? null, d.address ?? null, id]);
        await this.activity.log('UPDATE_CUSTOMER', 'customer', 'Customer', id, d.customer_code ?? null, 'Edit customer: ' + (d.customer_name ?? '—'), null, null, this.actCtx(ctx));
        return { id };
    }
    async customerDelete(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.db.query('DELETE FROM customers WHERE id=$1', [id]);
        await this.activity.log('DELETE_CUSTOMER', 'customer', 'Customer', id, null, 'Hapus customer ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async locationList(ctx) {
        const zone = ctx.query.zone ? String(ctx.query.zone) : null;
        const availableOnly = ctx.query.available_only === '1' || ctx.query.available_only === 'true';
        const rows = await this.locationGetAll(zone, availableOnly);
        const zones = await this.locationZoneSummary();
        return { rows, zones };
    }
    async locationGetAll(zone, availableOnly) {
        const where = ['lm.is_active = 1'];
        const params = [];
        if (zone) {
            params.push(zone);
            where.push(`lm.zone = $${params.length}`);
        }
        const r = await this.db.query(`SELECT lm.*,
              COUNT(sl.id) as occupied_pallets,
              SUM(CASE WHEN sl.status = 'Available' THEN sl.quantity ELSE 0 END) as current_qty,
              MAX(sl2.batch_number) as current_batch,
              MAX(sl2.stock_id) as stock_id,
              CASE WHEN COUNT(CASE WHEN sl.status = 'Available' THEN 1 END) > 0 THEN 'Occupied' ELSE 'Available' END AS availability
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock_locations sl2 ON sl2.id = (
         SELECT id FROM stock_locations
         WHERE location_code = lm.location_code AND status IN ('Available','Reserved')
         ORDER BY id DESC LIMIT 1
       )
       WHERE ${where.join(' AND ')}
       GROUP BY lm.id
       ${availableOnly ? 'HAVING availability = \'Available\'' : ''}
       ORDER BY lm.aisle, lm.rack, lm.row_name, lm.position`, params);
        return r.rows;
    }
    async locationAll(_ctx) {
        return { rows: await this.master.locationOptions() };
    }
    async locationCheck(ctx) {
        const code = String(ctx.query.code ?? '').trim().toUpperCase();
        const info = await this.getLocationInfo(code);
        const available = await this.locationIsAvailable(code);
        return { available, info };
    }
    async locationIsAvailable(code) {
        const r = await this.db.query("SELECT COUNT(*)::int c FROM stock_locations WHERE location_code = $1 AND status IN ('Available','Reserved')", [code]);
        return r.rows[0].c === 0;
    }
    async getLocationInfo(code) {
        const r = await this.db.query(`SELECT lm.*,
              sl.id as sl_id, sl.quantity, sl.batch_number, sl.uom, sl.status as stock_status,
              st.expiry_date, p.product_name, p.product_code
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       LEFT JOIN stock st ON sl.stock_id = st.id
       LEFT JOIN products p ON st.product_id = p.id
       WHERE lm.location_code = $1
       LIMIT 1`, [code]);
        return r.rows[0] ?? null;
    }
    async locationAvailable(ctx) {
        const count = Math.max(1, Number.parseInt(ctx.query.count ?? '20', 10) || 20);
        const zone = ctx.query.zone ? String(ctx.query.zone) : null;
        return { rows: await this.getAvailableLocations(count, zone) };
    }
    async getAvailableLocations(count, preferZone) {
        const order = preferZone
            ? 'ORDER BY CASE WHEN lm.zone = $1 THEN 0 ELSE 1 END, lm.aisle, lm.rack, lm.row_name, lm.position LIMIT $2'
            : 'ORDER BY lm.aisle, lm.rack, lm.row_name, lm.position LIMIT $1';
        const params = preferZone ? [preferZone, count] : [count];
        const r = await this.db.query(`SELECT lm.location_code, lm.aisle, lm.rack, lm.row_name, lm.position, lm.zone
       FROM location_master lm
       WHERE lm.is_active = 1
         AND lm.location_code NOT IN (
           SELECT DISTINCT location_code FROM stock_locations WHERE status IN ('Available','Reserved')
         )
       ${order}`, params);
        return r.rows;
    }
    async locationZoneSummaryAction(_ctx) {
        return { rows: await this.locationZoneSummary2() };
    }
    async locationZoneSummary() {
        const r = await this.db.query(`SELECT lm.zone,
              COUNT(lm.id)::int as total,
              COUNT(CASE WHEN lm.is_active=1 THEN 1 END)::int as active
       FROM location_master lm GROUP BY lm.zone ORDER BY lm.zone`);
        return r.rows;
    }
    async locationZoneSummary2() {
        const r = await this.db.query(`SELECT lm.zone,
              COUNT(lm.id)::int as total_locations,
              COUNT(CASE WHEN sl.id IS NOT NULL THEN 1 END)::int as occupied,
              COUNT(CASE WHEN sl.id IS NULL THEN 1 END)::int as available
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code
         AND sl.status IN ('Available','Reserved')
       WHERE lm.is_active = 1
       GROUP BY lm.zone
       ORDER BY lm.zone`);
        return r.rows;
    }
    async locationSuggest(ctx) {
        const qty = Number(ctx.query.quantity ?? 0);
        const uom = String(ctx.query.uom ?? 'Drum');
        let upp = Number.parseInt(ctx.query.uom_per_pallet ?? '4', 10) || 4;
        const zone = ctx.query.zone ? String(ctx.query.zone) : null;
        return { rows: await this.suggestLocationsForInbound(qty, uom, upp, zone) };
    }
    async getAvailableLocationsByLevel(count, preferZone, levels) {
        const placeholders = levels.map((_, i) => `$${i + 1}`).join(',');
        const params = [...levels];
        let order = 'ORDER BY lm.aisle, lm.rack, lm.row_name, lm.position';
        if (preferZone) {
            params.push(preferZone);
            order = `ORDER BY CASE WHEN lm.zone = $${params.length} THEN 0 ELSE 1 END, lm.aisle, lm.rack, lm.row_name, lm.position`;
        }
        params.push(count);
        order += ` LIMIT $${params.length}`;
        const r = await this.db.query(`SELECT lm.location_code, lm.aisle, lm.rack, lm.row_name, lm.position, lm.zone
       FROM location_master lm
       WHERE lm.is_active = 1
         AND lm.row_name IN (${placeholders})
         AND lm.location_code NOT IN (
           SELECT DISTINCT location_code FROM stock_locations WHERE status IN ('Available','Reserved')
         )
       ${order}`, params);
        return r.rows;
    }
    async suggestLocationsForInbound(quantity, uom, uomPerPallet, preferZone) {
        if (uomPerPallet <= 0)
            uomPerPallet = 4;
        const fullPallets = Math.floor(Number(quantity) / uomPerPallet);
        const remainder = Number(quantity) % uomPerPallet;
        const totalPallets = fullPallets + (remainder > 0 ? 1 : 0);
        let fullLocations = await this.getAvailableLocationsByLevel(fullPallets + 20, preferZone, ['B', 'C', 'D', 'E']);
        if (fullLocations.length < fullPallets) {
            const extraNeeded = fullPallets - fullLocations.length;
            const extraLocs = await this.getAvailableLocations(extraNeeded + 10, preferZone);
            const existingCodes = new Set(fullLocations.map((x) => x.location_code));
            for (const el of extraLocs) {
                if (!existingCodes.has(el.location_code)) {
                    fullLocations.push(el);
                    existingCodes.add(el.location_code);
                }
                if (fullLocations.length >= fullPallets)
                    break;
            }
        }
        const canAssignFull = Math.min(fullPallets, fullLocations.length);
        let partialLocations = [];
        if (remainder > 0) {
            partialLocations = await this.getAvailableLocationsByLevel(5, preferZone, ['A']);
            if (partialLocations.length === 0) {
                const usedCodes = fullLocations.slice(0, canAssignFull).map((x) => x.location_code);
                const anyLocs = await this.getAvailableLocations(10, preferZone);
                for (const al of anyLocs) {
                    if (!usedCodes.includes(al.location_code)) {
                        partialLocations.push(al);
                        break;
                    }
                }
            }
        }
        const pallets = [];
        let palletSeq = 1;
        for (let i = 0; i < canAssignFull; i++) {
            pallets.push({
                pallet_seq: palletSeq,
                location_code: fullLocations[i].location_code,
                quantity: uomPerPallet,
                is_full: true,
                uom,
            });
            palletSeq++;
        }
        if (remainder > 0) {
            pallets.push({
                pallet_seq: palletSeq,
                location_code: partialLocations[0]?.location_code ?? 'STAGING',
                quantity: remainder,
                is_full: false,
                uom,
            });
        }
        const success = canAssignFull === fullPallets;
        return {
            success,
            message: success ? '' : `Hanya ${canAssignFull}/${fullPallets} lokasi full pallet tersedia — sisanya tidak ter-assign`,
            pallets,
            total_pallets: totalPallets,
        };
    }
    async locationCreate(ctx) {
        const d = ctx.body;
        const code = String(d.location_code ?? '').trim().toUpperCase();
        if (!code)
            throw api_exception_1.ApiException.badRequest('location_code wajib diisi.');
        const exists = await this.db.query('SELECT id FROM location_master WHERE location_code=$1', [code]);
        if (exists.rows.length > 0)
            throw api_exception_1.ApiException.conflict(`Lokasi '${code}' sudah ada.`);
        const r = await this.db.query(`INSERT INTO location_master (location_code, aisle, rack, row_name, position, zone, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [
            code,
            d.aisle ?? null,
            d.rack ?? null,
            d.row_name ?? null,
            d.position ?? null,
            d.zone ?? null,
            d.is_active !== undefined ? Number(d.is_active) : 1,
        ]);
        await this.activity.log('ADD_LOCATION', 'location', 'Location', null, code, 'Tambah lokasi ' + code, null, null, this.actCtx(ctx));
        return { id: Number(r.rows[0].id) };
    }
    async locationUpdate(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? '0', 10) || 0;
        await this.db.query(`UPDATE location_master SET location_code=$1, aisle=$2, rack=$3, row_name=$4, position=$5, zone=$6, is_active=$7 WHERE id=$8`, [
            String(d.location_code ?? '').trim().toUpperCase(),
            d.aisle ?? null,
            d.rack ?? null,
            d.row_name ?? null,
            d.position ?? null,
            d.zone ?? null,
            d.is_active !== undefined ? Number(d.is_active) : 1,
            id,
        ]);
        await this.activity.log('EDIT_LOCATION', 'location', 'Location', id, null, 'Edit lokasi ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async locationDelete(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
        const row = await this.db.query('SELECT location_code FROM location_master WHERE id=$1', [id]);
        const code = row.rows[0]?.location_code;
        const inUse = await this.db.query('SELECT COUNT(*)::int c FROM stock WHERE location=$1 AND quantity>0', [code]);
        if (Number(inUse.rows[0].c) > 0) {
            throw api_exception_1.ApiException.conflict(`Lokasi '${code}' masih memiliki stok dan tidak dapat dihapus.`);
        }
        await this.db.query('DELETE FROM location_master WHERE id=$1', [id]);
        await this.activity.log('DELETE_LOCATION', 'location', 'Location', id, code, 'Hapus lokasi ' + code, null, null, this.actCtx(ctx));
        return { id };
    }
    async userList(_ctx) {
        const r = await this.db.query('SELECT id, username, full_name, email, role, is_active, created_at, updated_at FROM users ORDER BY full_name');
        return {
            rows: r.rows.map((u) => ({ ...u, id: Number(u.id) })),
            roles: [
                { key: 'admin', label: 'Admin' },
                { key: 'operator', label: 'Operator' },
                { key: 'viewer', label: 'Viewer' },
            ],
        };
    }
    async userCreate(ctx) {
        const d = ctx.body;
        if (!String(d.password ?? '').trim())
            throw api_exception_1.ApiException.badRequest('Password is required.');
        if (!String(d.username ?? '').trim() || !String(d.full_name ?? '').trim()) {
            throw api_exception_1.ApiException.badRequest('Username dan full name wajib diisi.');
        }
        const hash = await bcrypt.hash(d.password, 10);
        const r = await this.db.query(`INSERT INTO users (username, password, full_name, email, role, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [
            String(d.username).trim(),
            hash,
            String(d.full_name).trim(),
            String(d.email ?? '').trim(),
            d.role ?? 'viewer',
            d.is_active !== undefined ? Number(d.is_active) : 1,
        ]);
        const newId = Number(r.rows[0].id);
        await this.activity.log('CREATE_USER', 'user', 'User', newId, String(d.username).trim(), 'Buat user baru: ' + String(d.full_name).trim() + ' (' + (d.role ?? 'viewer') + ')', null, null, this.actCtx(ctx));
        return { id: newId };
    }
    async userUpdate(ctx) {
        const d = ctx.body;
        const id = Number.parseInt(d.id ?? '0', 10) || 0;
        let sql = 'UPDATE users SET username=$1, full_name=$2, email=$3, role=$4, is_active=$5';
        const params = [
            String(d.username ?? '').trim(),
            String(d.full_name ?? '').trim(),
            String(d.email ?? '').trim(),
            d.role ?? 'viewer',
            d.is_active !== undefined ? Number(d.is_active) : 1,
        ];
        if (d.password) {
            params.push(await bcrypt.hash(d.password, 10));
            sql += `, password=$${params.length}`;
        }
        params.push(id);
        sql += ` WHERE id=$${params.length}`;
        await this.db.query(sql, params);
        await this.activity.log('UPDATE_USER', 'user', 'User', id, String(d.username ?? '').trim(), 'Edit user: ' + String(d.full_name ?? '').trim() + ' → role ' + (d.role ?? 'viewer') + (d.password ? ', password diubah' : ''), null, null, this.actCtx(ctx));
        return { id };
    }
    async userDelete(ctx) {
        const d = ctx.body;
        const userId = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
        if (userId === ctx.user.id)
            throw api_exception_1.ApiException.forbidden('Anda tidak dapat menghapus akun sendiri.');
        const tables = [
            ['inbound_orders', ['created_by', 'received_by']],
            ['outbound_orders', ['created_by', 'shipped_by']],
            ['picklists', ['created_by']],
        ];
        for (const [tbl, cols] of tables) {
            for (const col of cols) {
                try {
                    await this.db.query(`UPDATE ${tbl} SET ${col} = NULL WHERE ${col} = $1`, [userId]);
                }
                catch {
                }
            }
        }
        await this.db.query('DELETE FROM auth_tokens WHERE user_id=$1', [userId]);
        await this.db.query('DELETE FROM users WHERE id=$1', [userId]);
        await this.activity.log('DELETE_USER', 'user', 'User', userId, null, 'Hapus user ID ' + userId, null, null, this.actCtx(ctx));
        return { id: userId };
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
};
exports.MasterActions = MasterActions;
exports.MasterActions = MasterActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        activity_logger_1.ActivityLogger,
        master_data_service_1.MasterDataService])
], MasterActions);
//# sourceMappingURL=master.actions.js.map