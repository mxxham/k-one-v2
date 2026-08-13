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
exports.PicklistActions = void 0;
const common_1 = require("@nestjs/common");
const picklist_service_1 = require("./picklist.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
let PicklistActions = class PicklistActions {
    picklist;
    activity;
    constructor(picklist, activity) {
        this.picklist = picklist;
        this.activity = activity;
        (0, registry_1.registerActions)('picklist', {
            list: (c) => this.list(c),
            detail: (c) => this.detail(c),
            stats: (c) => this.stats(c),
            create_from_outbound: (c) => this.createFromOutbound(c),
            confirm: (c) => this.confirm(c),
            complete: (c) => this.complete(c),
            delete: (c) => this.delete(c),
            update_item: (c) => this.updateItem(c),
            export_data: (c) => this.exportData(c),
        });
        (0, registry_1.setPermission)('picklist', 'create_from_outbound', 'write');
        (0, registry_1.setPermission)('picklist', 'confirm', 'write');
        (0, registry_1.setPermission)('picklist', 'complete', 'write');
        (0, registry_1.setPermission)('picklist', 'delete', 'write');
        (0, registry_1.setPermission)('picklist', 'update_item', 'write');
    }
    actCtx(ctx) {
        return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
    }
    async list(ctx) {
        const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
        const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
        const offset = (page - 1) * perPage;
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const total = await this.picklist.countAll(status);
        const rows = await this.picklist.getAll(status, perPage, offset);
        for (const r of rows)
            r.id = Number(r.id);
        return {
            rows,
            total,
            page,
            per_page: perPage,
            statuses: ['Draft', 'Confirmed', 'Picking', 'Picked', 'Completed', 'Cancelled'],
        };
    }
    async detail(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        const picklist = await this.picklist.getById(id);
        if (!picklist)
            throw api_exception_1.ApiException.notFound('Picklist tidak ditemukan');
        const items = await this.picklist.getItems(id);
        for (const it of items)
            it.id = Number(it.id);
        return { picklist, items };
    }
    async stats(_ctx) {
        return { stats: await this.picklist.getStats() };
    }
    async createFromOutbound(ctx) {
        const data = ctx.body;
        const outboundId = Number.parseInt(data.outbound_id ?? ctx.query.outbound_id ?? '0', 10) || 0;
        if (!outboundId)
            throw api_exception_1.ApiException.badRequest('outbound_id wajib diisi.');
        const id = await this.picklist.createFromOutbound(outboundId, ctx.user.id);
        await this.activity.log('CREATE_PICKLIST', 'picklist', 'Picklist', id, null, 'Buat picklist dari outbound ID ' + outboundId, null, null, this.actCtx(ctx));
        return { id };
    }
    async confirm(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.picklist.confirm(id);
        await this.activity.log('CONFIRM_PICKLIST', 'picklist', 'Picklist', id, null, 'Konfirmasi picklist ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async complete(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.picklist.complete(id);
        await this.activity.log('COMPLETE_PICKLIST', 'picklist', 'Picklist', id, null, 'Selesaikan picklist ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async delete(ctx) {
        const data = ctx.body;
        const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
        await this.picklist.delete(id);
        await this.activity.log('DELETE_PICKLIST', 'picklist', 'Picklist', id, null, 'Hapus picklist ID ' + id, null, null, this.actCtx(ctx));
        return { id };
    }
    async updateItem(ctx) {
        const data = ctx.body;
        const itemId = Number.parseInt(data.item_id ?? '0', 10) || 0;
        await this.picklist.updateItem(itemId, data);
        return { item_id: itemId };
    }
    async exportData(ctx) {
        const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
        return { data: await this.picklist.exportForPrint(id) };
    }
};
exports.PicklistActions = PicklistActions;
exports.PicklistActions = PicklistActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [picklist_service_1.PicklistService,
        activity_logger_1.ActivityLogger])
], PicklistActions);
//# sourceMappingURL=picklist.actions.js.map