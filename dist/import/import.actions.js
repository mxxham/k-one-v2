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
exports.ImportActions = void 0;
const common_1 = require("@nestjs/common");
const import_service_1 = require("./import.service");
const import_queue_provider_1 = require("./import-queue.provider");
const registry_1 = require("../dispatcher/registry");
const import_templates_1 = require("./import-templates");
const api_exception_1 = require("../common/api-exception");
const shared_1 = require("@k-one/shared");
const crypto_1 = require("crypto");
let ImportActions = class ImportActions {
    importService;
    importQueue;
    constructor(importService, importQueue) {
        this.importService = importService;
        this.importQueue = importQueue;
        (0, registry_1.registerActions)('import', {
            tpl_inbound: () => this.tplInbound(),
            tpl_outbound: () => this.tplOutbound(),
            tpl_stock: () => this.tplStock(),
            inbound: (c) => this.inbound(c),
            outbound: (c) => this.outbound(c),
            stock_preview: (c) => this.stockPreview(c),
            stock_commit: (c) => this.stockCommit(c),
            auto: (c) => this.auto(c),
            auto_async: (c) => this.autoAsync(c),
            task_status: (c) => this.taskStatus(c),
        });
        (0, registry_1.setPermission)('import', 'inbound', 'write');
        (0, registry_1.setPermission)('import', 'outbound', 'write');
        (0, registry_1.setPermission)('import', 'stock_preview', 'write');
        (0, registry_1.setPermission)('import', 'stock_commit', 'write');
        (0, registry_1.setPermission)('import', 'auto', 'write');
        (0, registry_1.setPermission)('import', 'auto_async', 'write');
        (0, registry_1.setModuleDepartments)('import', ['all']);
    }
    async tplInbound() {
        const r = await (0, import_templates_1.tplInbound)();
        return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
    }
    async tplOutbound() {
        const r = await (0, import_templates_1.tplOutbound)();
        return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
    }
    async tplStock() {
        const r = await (0, import_templates_1.tplStock)();
        return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
    }
    async inbound(ctx) {
        if (ctx.user)
            ctx.raw.kone_user_id = ctx.user.id;
        return this.importService.runInbound(ctx.raw);
    }
    async outbound(ctx) {
        if (ctx.user)
            ctx.raw.kone_user_id = ctx.user.id;
        return this.importService.runOutbound(ctx.raw);
    }
    async stockPreview(ctx) {
        return this.importService.stockPreview(ctx.raw);
    }
    async stockCommit(ctx) {
        return this.importService.stockCommit(ctx.body);
    }
    async auto(ctx) {
        if (ctx.user)
            ctx.raw.kone_user_id = ctx.user.id;
        return this.importService.runAuto(ctx.raw);
    }
    async autoAsync(ctx) {
        if (ctx.user)
            ctx.raw.kone_user_id = ctx.user.id;
        const taskId = (0, crypto_1.randomUUID)();
        const { buffer, name } = this.importService.fileFromReq(ctx.raw);
        const ttl = 60 * 60 * 1000;
        await this.importQueue.redis.set(shared_1.TASK_KEYS.file(taskId), buffer, 'EX', ttl);
        await this.importQueue.enqueue(taskId, {
            task_id: taskId,
            kind: 'auto',
            file_key: shared_1.TASK_KEYS.file(taskId),
            filename: name,
            form: ctx.body ?? {},
            user_id: ctx.user ? ctx.user.id : 1,
        });
        return {
            message: 'Import sedang diproses',
            task_id: taskId,
        };
    }
    async taskStatus(ctx) {
        const taskId = String(ctx.query.task_id ?? ctx.body.task_id ?? '');
        if (taskId === '')
            throw api_exception_1.ApiException.badRequest('task_id required');
        const raw = await this.importQueue.redis.get(shared_1.TASK_KEYS.status(taskId));
        if (!raw) {
            return { status: 'queued', task_id: taskId, message: 'Import belum selesai diproses.' };
        }
        return JSON.parse(raw);
    }
};
exports.ImportActions = ImportActions;
exports.ImportActions = ImportActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [import_service_1.ImportService,
        import_queue_provider_1.ImportQueueProvider])
], ImportActions);
//# sourceMappingURL=import.actions.js.map