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
exports.AdminGuard = exports.WriteGuard = exports.AuthGuard = exports.DEPARTMENTS = void 0;
exports.isDepartment = isDepartment;
exports.resolveUser = resolveUser;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const api_exception_1 = require("../common/api-exception");
exports.DEPARTMENTS = ['inbound', 'outbound', 'inventory', 'all'];
function isDepartment(v) {
    return typeof v === 'string' && exports.DEPARTMENTS.includes(v);
}
const WRITE_ROLES = ['admin', 'operator', 'warehouse', 'supervisor', 'staff'];
async function resolveUser(db, req) {
    let token = null;
    const auth = req.headers?.authorization ?? req.query?.token;
    if (auth) {
        token = String(auth).startsWith('Bearer ') ? String(auth).slice(7) : String(auth);
    }
    if (!token)
        return null;
    const r = await db.query(`SELECT u.id, u.username, u.full_name, u.email, u.role, u.department
     FROM auth_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token = $1 AND t.expires_at > NOW() LIMIT 1`, [token]);
    if (r.rows.length === 0)
        return null;
    const row = r.rows[0];
    return {
        id: Number(row.id),
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        role: row.role,
        department: row.department ?? 'all',
    };
}
let AuthGuard = class AuthGuard {
    db;
    constructor(db) {
        this.db = db;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const user = await resolveUser(this.db, req);
        if (!user)
            throw new api_exception_1.UnauthorizedException2('Unauthorized');
        req.user = user;
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], AuthGuard);
let WriteGuard = class WriteGuard {
    db;
    constructor(db) {
        this.db = db;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const user = await resolveUser(this.db, req);
        if (!user)
            throw new api_exception_1.UnauthorizedException2('Unauthorized');
        if (!WRITE_ROLES.includes(user.role)) {
            throw new api_exception_1.ForbiddenException('Akses ditolak. Role Anda tidak memiliki izin untuk mengubah data.');
        }
        req.user = user;
        return true;
    }
};
exports.WriteGuard = WriteGuard;
exports.WriteGuard = WriteGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], WriteGuard);
let AdminGuard = class AdminGuard {
    db;
    constructor(db) {
        this.db = db;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const user = await resolveUser(this.db, req);
        if (!user)
            throw new api_exception_1.UnauthorizedException2('Unauthorized');
        if (user.role !== 'admin') {
            throw new api_exception_1.ForbiddenException('Akses ditolak. Khusus admin.');
        }
        req.user = user;
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], AdminGuard);
//# sourceMappingURL=guards.js.map