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
exports.PicklistService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const number_gen_1 = require("../common/number-gen");
const api_exception_1 = require("../common/api-exception");
const date_util_1 = require("../common/date-util");
const pallet_1 = require("../common/pallet");
let PicklistService = class PicklistService {
    db;
    constructor(db) {
        this.db = db;
    }
    async generateNumber() {
        return (0, number_gen_1.generateNumber)(this.db, {
            table: 'picklists',
            column: 'picklist_number',
            prefix: `PKL-${(0, date_util_1.todayStr)().slice(0, 7).replace('-', '')}-`,
            searchPrefix: `PKL-${(0, date_util_1.todayStr)().slice(0, 7).replace('-', '')}-`,
            pad: 4,
        });
    }
    async createFromOutbound(outboundId, createdBy) {
        return this.db.transaction(async (client) => {
            const obR = await client.query(`SELECT o.*, c.customer_name, c.address, c.city
         FROM outbound_orders o
         LEFT JOIN customers c ON o.customer_id = c.id
         WHERE o.id = $1`, [outboundId]);
            const outbound = obR.rows[0];
            if (!outbound)
                throw api_exception_1.ApiException.badRequest('Outbound order not found');
            const existingR = await client.query('SELECT id FROM picklists WHERE outbound_order_id = $1', [outboundId]);
            if (existingR.rows.length > 0)
                return Number(existingR.rows[0].id);
            const picklistNumber = await this.generateNumber();
            const insR = await client.query(`INSERT INTO picklists (outbound_order_id, picklist_number, created_date, status, created_by)
         VALUES ($1,$2,$3,'Draft',$4) RETURNING id`, [outboundId, picklistNumber, (0, date_util_1.todayStr)(), createdBy]);
            const picklistId = Number(insR.rows[0].id);
            const itemsR = await client.query(`SELECT oi.*, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet
         FROM outbound_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.outbound_order_id = $1
         ORDER BY oi.exp_date ASC, oi.id ASC`, [outboundId]);
            for (const item of itemsR.rows) {
                const batchNumber = item.batch_number ?? item.batch_no ?? null;
                const uomPerPallet = Math.max(1, Number.parseInt(item.uom_per_pallet ?? '4', 10) || 4);
                const locR = await client.query(`SELECT sl.*, oil.quantity as alloc_qty, lm.zone, lm.aisle
           FROM outbound_item_locations oil
           JOIN stock_locations sl ON oil.stock_location_id = sl.id
           LEFT JOIN location_master lm ON lm.location_code = sl.location_code
           WHERE oil.outbound_item_id = $1
           ORDER BY sl.location_code, sl.pallet_seq`, [item.id]);
                const locationRows = locR.rows;
                if (locationRows.length > 0) {
                    let palletSeq = 1;
                    for (const lr of locationRows) {
                        const locBatch = lr.batch_number ?? batchNumber;
                        const locCode = lr.location_code ?? '';
                        const qty = Number(lr.alloc_qty ?? 0);
                        const plt = (0, pallet_1.calcPalletByLocation)(qty, uomPerPallet, locCode);
                        await client.query(`INSERT INTO picklist_items
                 (picklist_id, outbound_item_id, product_id, batch_no, batch_number,
                  location, quantity, uom, pallet, pallet_seq, stock_location_id, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Pending')`, [picklistId, item.id, item.product_id, locBatch, locBatch, locCode, qty, item.uom_type, plt, palletSeq++, lr.id]);
                    }
                }
                else {
                    const distribution = this.calculatePalletDistribution(Number(item.actual_qty ?? item.quantity ?? 0), uomPerPallet);
                    let palletSeq = 1;
                    for (const pallet of distribution) {
                        let slId = null;
                        if (item.location && batchNumber) {
                            const slR = await client.query(`SELECT id FROM stock_locations
                 WHERE batch_number = $1 AND location_code = $2
                   AND status IN ('Available','Reserved') AND pallet_seq = $3 LIMIT 1`, [batchNumber, item.location, palletSeq]);
                            slId = slR.rows[0]?.id ?? null;
                        }
                        const locCode2 = item.location ?? 'TBD';
                        const qty2 = Number(pallet.quantity);
                        const plt2 = (0, pallet_1.calcPalletByLocation)(qty2, uomPerPallet, locCode2);
                        await client.query(`INSERT INTO picklist_items
                 (picklist_id, outbound_item_id, product_id, batch_no, batch_number,
                  location, quantity, uom, pallet, pallet_seq, stock_location_id, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Pending')`, [picklistId, item.id, item.product_id, batchNumber, batchNumber, locCode2, qty2, item.uom_type, plt2, palletSeq++, slId]);
                    }
                }
            }
            return picklistId;
        });
    }
    calculatePalletDistribution(quantity, uomPerPallet) {
        const upp = Math.max(1, Math.floor(uomPerPallet));
        const fullPallets = Math.floor(quantity / upp);
        const remainder = quantity % upp;
        const dist = [];
        for (let i = 0; i < fullPallets; i++) {
            dist.push({ quantity: upp, is_full: true });
        }
        if (remainder > 0) {
            dist.push({ quantity: remainder, is_full: false });
        }
        return dist;
    }
    async getById(id) {
        const r = await this.db.query(`SELECT pkl.*,
              o.order_number as outbound_number,
              o.so_number, o.do_number, o.shipment_number,
              o.destination, o.kota, o.armada_no, o.container_no,
              c.customer_name, c.address, c.city,
              u.full_name as created_by_name
       FROM picklists pkl
       JOIN outbound_orders o ON pkl.outbound_order_id = o.id
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON pkl.created_by = u.id
       WHERE pkl.id = $1`, [id]);
        return r.rows[0] ?? null;
    }
    async getItems(picklistId) {
        const r = await this.db.query(`SELECT pki.*,
              p.product_code, p.product_name,
              COALESCE(pki.batch_number, pki.batch_no) as resolved_batch,
              sl.pallet_seq as sl_pallet_seq,
              lm.zone, lm.aisle,
              oi.so_number  AS item_so_number,
              oi.od_number  AS item_od_number,
              COALESCE(ci.customer_name, co.customer_name) AS item_customer_name,
              COALESCE(NULLIF(od.ship_to_name,''), NULLIF(o.ship_to_name,'')) AS item_ship_to,
              COALESCE(NULLIF(od.kota,''), NULLIF(o.kota,''))                 AS item_kota
       FROM picklist_items pki
       JOIN products p ON pki.product_id = p.id
       LEFT JOIN stock_locations sl ON sl.id = pki.stock_location_id
       LEFT JOIN location_master lm ON lm.location_code = pki.location
       LEFT JOIN outbound_items oi ON oi.id = pki.outbound_item_id
       LEFT JOIN outbound_destinations od ON od.id = oi.destination_id
       LEFT JOIN outbound_orders o ON o.id = oi.outbound_order_id
       LEFT JOIN customers ci ON ci.id = oi.customer_id
       LEFT JOIN customers co ON co.id = o.customer_id
       WHERE pki.picklist_id = $1
       ORDER BY pki.location, pki.pallet_seq, pki.id`, [picklistId]);
        return r.rows;
    }
    async getAll(status, limit, offset) {
        const where = status ? 'WHERE pkl.status = $1' : '';
        const params = status ? [status] : [];
        let sql = `SELECT pkl.*,
              o.order_number as outbound_number,
              o.so_number, o.do_number, o.shipment_number,
              c.customer_name,
              COUNT(pki.id)::int as total_items,
              SUM(pki.quantity) as total_qty,
              CEIL(SUM(pki.pallet)) as total_pallet
       FROM picklists pkl
       JOIN outbound_orders o ON pkl.outbound_order_id = o.id
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN picklist_items pki ON pkl.id = pki.picklist_id
       ${where}
       GROUP BY pkl.id, o.order_number, o.so_number, o.do_number, o.shipment_number, c.customer_name
       ORDER BY pkl.created_date DESC, pkl.created_at DESC`;
        if (limit) {
            params.push(limit, offset);
            sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }
        const r = await this.db.query(sql, params);
        return r.rows;
    }
    async countAll(status) {
        const r = status
            ? await this.db.query('SELECT COUNT(*)::int FROM picklists WHERE status = $1', [status])
            : await this.db.query('SELECT COUNT(*)::int FROM picklists');
        return r.rows[0].count;
    }
    async getStats() {
        const r = await this.db.query('SELECT status, COUNT(*)::int AS cnt FROM picklists GROUP BY status');
        const s = { total: 0, pending: 0, picking: 0, completed: 0 };
        for (const row of r.rows) {
            s.total += Number(row.cnt);
            if (['Draft', 'Confirmed'].includes(row.status))
                s.pending += Number(row.cnt);
            else if (row.status === 'Picked')
                s.picking += Number(row.cnt);
            else if (row.status === 'Completed')
                s.completed += Number(row.cnt);
        }
        return s;
    }
    async updateItem(itemId, data) {
        const r = await this.db.query(`UPDATE picklist_items SET
         picked_quantity = $1,
         status = $2,
         location = COALESCE($3, location),
         batch_number = COALESCE(NULLIF($4, ''), batch_number),
         batch_no = COALESCE(NULLIF($5, ''), batch_no),
         notes = $6,
         picked_at = NOW()
       WHERE id = $7`, [
            Number(data.picked_quantity ?? 0),
            data.status ?? 'Pending',
            data.location ?? null,
            data.batch_number ?? null,
            data.batch_number ?? null,
            data.notes ?? null,
            itemId,
        ]);
        return (r.rowCount ?? 0) > 0;
    }
    async confirm(picklistId) {
        await this.db.query(`UPDATE picklists SET status='Confirmed', confirmed_at=NOW() WHERE id=$1`, [picklistId]);
    }
    async complete(picklistId) {
        await this.db.query(`UPDATE picklists SET status='Completed', completed_at=NOW() WHERE id=$1`, [picklistId]);
    }
    async delete(picklistId) {
        await this.db.transaction(async (client) => {
            await client.query('DELETE FROM picklist_items WHERE picklist_id=$1', [picklistId]);
            await client.query('DELETE FROM picklists WHERE id=$1', [picklistId]);
        });
    }
    async exportForPrint(picklistId) {
        return {
            picklist: await this.getById(picklistId),
            items: await this.getItems(picklistId),
        };
    }
};
exports.PicklistService = PicklistService;
exports.PicklistService = PicklistService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], PicklistService);
//# sourceMappingURL=picklist.service.js.map