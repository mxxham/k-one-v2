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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayController = void 0;
const common_1 = require("@nestjs/common");
const registry_1 = require("./registry");
const guards_1 = require("../auth/guards");
const db_service_1 = require("../database/db.service");
const api_exception_1 = require("../common/api-exception");
const PUBLIC_ACTIONS = new Set([
    'auth::login',
    'import::tpl_inbound',
    'import::tpl_outbound',
    'import::tpl_stock',
]);
let GatewayController = class GatewayController {
    db;
    logger = new common_1.Logger('Gateway');
    constructor(db) {
        this.db = db;
    }
    async get(query, req, res) {
        return this.handle(query, req, {}, res);
    }
    async post(query, body, req, res) {
        const merged = { ...query, ...body };
        if (!query.module || !query.action) {
            return this.handle(merged, req, body, res);
        }
        return this.handle(query, req, body, res);
    }
    async handle(query, req, body = {}, res) {
        const module = String(query.module ?? '');
        const action = String(query.action ?? '');
        if (module === '' || action === '') {
            return { message: 'K-one API', version: '2.0.0', time: new Date().toISOString() };
        }
        if (!(0, registry_1.knownModule)(module)) {
            throw new common_1.NotFoundException('Unknown module: ' + module);
        }
        const handler = (0, registry_1.getActionHandler)(module, action);
        if (!handler) {
            throw new common_1.NotFoundException('Invalid action: ' + action);
        }
        const publicKey = `${module}::${action}`;
        let user = null;
        if (!PUBLIC_ACTIONS.has(publicKey)) {
            user = await (0, guards_1.resolveUser)(this.db, req);
            if (!user) {
                throw api_exception_1.ApiException.unauthorized();
            }
            const level = (0, registry_1.getPermission)(module, action);
            if (level === 'write' || level === 'admin') {
                const writeRoles = ['admin', 'operator', 'warehouse', 'supervisor', 'staff'];
                if (!writeRoles.includes(user.role)) {
                    throw api_exception_1.ApiException.forbidden('Akses ditolak. Role Anda tidak memiliki izin untuk mengubah data.');
                }
            }
            if (level === 'admin' && user.role !== 'admin') {
                throw api_exception_1.ApiException.forbidden('Akses ditolak. Khusus admin.');
            }
            const depts = (0, registry_1.getDepartments)(module, action);
            if (depts && user.department !== 'all' && !depts.includes(user.department)) {
                throw api_exception_1.ApiException.forbidden('Akses ditolak. Department Anda tidak memiliki izin untuk modul ini.');
            }
        }
        const result = (await handler({
            user: user,
            query: { ...query },
            body: body,
            raw: req,
        })) ?? {};
        if (result && typeof result === 'object' && result._binary) {
            const b = result;
            res.set({
                'Content-Type': b.contentType,
                'Content-Disposition': `attachment; filename="${b.filename}"`,
                'Cache-Control': 'max-age=0',
            });
            return new common_1.StreamableFile(b.buffer);
        }
        if (result && typeof result === 'object' && result._html) {
            const h = result;
            res.set({
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            return h.html;
        }
        return { success: true, ...result };
    }
};
exports.GatewayController = GatewayController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], GatewayController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], GatewayController.prototype, "post", null);
exports.GatewayController = GatewayController = __decorate([
    (0, common_1.Controller)('index.php'),
    __metadata("design:paramtypes", [db_service_1.DbService])
], GatewayController);
//# sourceMappingURL=gateway.controller.js.map