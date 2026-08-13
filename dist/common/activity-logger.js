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
exports.ActivityLogger = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
let ActivityLogger = class ActivityLogger {
    db;
    logger = new common_1.Logger('Activity');
    constructor(db) {
        this.db = db;
    }
    async log(action, module, refType = null, refId = null, refNo = null, description = null, oldValue = null, newValue = null, ctx = {}) {
        try {
            const refIdVal = refId != null ? refId : null;
            await this.db.query(`INSERT INTO activity_log
           (user_id, username, full_name, action, module,
            reference_type, reference_id, reference_no, description,
            old_value, new_value, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
                ctx.user_id ?? null,
                ctx.username ?? null,
                ctx.full_name ?? null,
                String(action).toUpperCase(),
                String(module).toLowerCase(),
                refType,
                refIdVal,
                refNo,
                description,
                oldValue != null ? JSON.stringify(oldValue) : null,
                newValue != null ? JSON.stringify(newValue) : null,
                ctx.ip_address ?? null,
            ]);
        }
        catch (e) {
            this.logger.error(`activity_log insert failed: ${e.message}`);
        }
    }
    async getRecent(opts) {
        const { limit = 50, offset = 0, module, userId, refType, refId } = opts;
        const where = [];
        const params = [];
        if (module) {
            params.push(module);
            where.push(`al.module = $${params.length}`);
        }
        if (userId) {
            params.push(userId);
            where.push(`al.user_id = $${params.length}`);
        }
        if (refType) {
            params.push(refType);
            where.push(`al.reference_type = $${params.length}`);
        }
        if (refId != null) {
            params.push(refId);
            where.push(`al.reference_id = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit, offset);
        const r = await this.db.query(`SELECT al.*, u.full_name AS user_full_name, u.role AS user_role
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereSql}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return r.rows;
    }
    async countRecent(opts) {
        const { module, userId, refType, refId } = opts;
        const where = [];
        const params = [];
        if (module) {
            params.push(module);
            where.push(`al.module = $${params.length}`);
        }
        if (userId) {
            params.push(userId);
            where.push(`al.user_id = $${params.length}`);
        }
        if (refType) {
            params.push(refType);
            where.push(`al.reference_type = $${params.length}`);
        }
        if (refId != null) {
            params.push(refId);
            where.push(`al.reference_id = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const r = await this.db.query(`SELECT COUNT(*)::int AS total FROM activity_log al ${whereSql}`, params);
        return r.rows[0].total;
    }
    getModules() {
        return [
            'inbound',
            'outbound',
            'stock',
            'picklist',
            'stocktake',
            'bintransfer',
            'ledger',
            'master',
            'user',
            'auth',
            'system',
            'import',
        ];
    }
};
exports.ActivityLogger = ActivityLogger;
exports.ActivityLogger = ActivityLogger = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], ActivityLogger);
//# sourceMappingURL=activity-logger.js.map