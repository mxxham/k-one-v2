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
exports.BinTransferActions = void 0;
const common_1 = require("@nestjs/common");
const bintransfer_service_1 = require("./bintransfer.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
let BinTransferActions = class BinTransferActions {
    binTransfer;
    activity;
    constructor(binTransfer, activity) {
        this.binTransfer = binTransfer;
        this.activity = activity;
        (0, registry_1.registerActions)('bintransfer', {
            list: (c) => this.list(c),
            detail: (c) => this.detail(c),
            locations_with_stock: (c) => this.locationsWithStock(c),
            stock_at_location: (c) => this.stockAtLocation(c),
            create: (c) => this.create(c),
            execute: (c) => this.execute(c),
            cancel: (c) => this.cancel(c),
        });
        (0, registry_1.setPermission)('bintransfer', 'create', 'write');
        (0, registry_1.setPermission)('bintransfer', 'execute', 'write');
        (0, registry_1.setPermission)('bintransfer', 'cancel', 'write');
        (0, registry_1.setModuleDepartments)('bintransfer', ['inventory']);
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
    async list(ctx) {
        const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '200', 10) || 200);
        const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
        const offset = (page - 1) * perPage;
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const total = await this.binTransfer.countAll(status);
        const rows = await this.binTransfer.getAll(status, perPage, offset);
        for (const r of rows)
            r.id = Number(r.id);
        return { rows, total, page, per_page: perPage, statuses: ['Pending', 'Completed', 'Cancelled'] };
    }
    async detail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const transfer = await this.binTransfer.getById(id);
        if (!transfer)
            throw api_exception_1.ApiException.notFound('Transfer tidak ditemukan');
        return { transfer };
    }
    async locationsWithStock(ctx) {
        const pid = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
        return { rows: await this.binTransfer.getLocationsWithStock(pid) };
    }
    async stockAtLocation(ctx) {
        const pid = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
        const loc = ctx.query.location ? String(ctx.query.location) : '';
        return { rows: await this.binTransfer.getStockAtLocation(pid, loc) };
    }
    async create(ctx) {
        const data = ctx.body;
        const id = await this.binTransfer.create(data, ctx.user.id);
        await this.activity.log('CREATE_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null, `Buat transfer ${data.from_location ?? ''} → ${data.to_location ?? ''} qty ${data.quantity ?? 0}`, null, null, this.actCtx(ctx));
        return { id };
    }
    async execute(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.binTransfer.execute(id, ctx.user.id);
        await this.activity.log('EXECUTE_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null, 'Eksekusi transfer ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async cancel(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.binTransfer.cancel(id);
        await this.activity.log('CANCEL_BIN_TRANSFER', 'bin_transfer', 'BinTransfer', id, null, 'Batalkan transfer ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
};
exports.BinTransferActions = BinTransferActions;
exports.BinTransferActions = BinTransferActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [bintransfer_service_1.BinTransferService,
        activity_logger_1.ActivityLogger])
], BinTransferActions);
//# sourceMappingURL=bintransfer.actions.js.map