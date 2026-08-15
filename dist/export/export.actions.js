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
exports.ExportActions = void 0;
const common_1 = require("@nestjs/common");
const excel_export_service_1 = require("./excel-export.service");
const print_service_1 = require("./print.service");
const picklist_service_1 = require("../picklist/picklist.service");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
let ExportActions = class ExportActions {
    excel;
    print;
    picklist;
    constructor(excel, print, picklist) {
        this.excel = excel;
        this.print = print;
        this.picklist = picklist;
        (0, registry_1.registerActions)('export', {
            inbound: (c) => this.inbound(c),
            outbound: (c) => this.outbound(c),
            customers: (c) => this.customers(c),
            products: (c) => this.products(c),
            ledger: (c) => this.ledger(c),
            stock: (c) => this.stock(c),
            stocktake: (c) => this.stocktake(c),
            asn: (c) => this.asn(c),
            report: (c) => this.report(c),
        });
        (0, registry_1.registerActions)('print', {
            inbound_receipt: (c) => this.inboundReceipt(c),
            putaway: (c) => this.putaway(c),
            outbound_do: (c) => this.outboundDo(c),
            surat_jalan: (c) => this.suratJalan(c),
            picklist: (c) => this.picklistPrint(c),
            report: (c) => this.reportPrint(c),
        });
        (0, registry_1.setPermission)('print', 'picklist', 'write');
        (0, registry_1.setModuleDepartments)('export', ['all']);
        (0, registry_1.setModuleDepartments)('print', ['all']);
    }
    idFrom(ctx) {
        return Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    }
    async inbound(ctx) {
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const r = await this.excel.inboundReport(status);
        return { _binary: true, ...r };
    }
    async outbound(ctx) {
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const r = await this.excel.outboundReport(status);
        return { _binary: true, ...r };
    }
    async customers(_ctx) {
        const r = await this.excel.customersReport();
        return { _binary: true, ...r };
    }
    async products(_ctx) {
        const r = await this.excel.productsReport();
        return { _binary: true, ...r };
    }
    async ledger(_ctx) {
        const r = await this.excel.ledgerReport();
        return { _binary: true, ...r };
    }
    async stock(_ctx) {
        const r = await this.excel.stockReport();
        return { _binary: true, ...r };
    }
    async stocktake(ctx) {
        const id = this.idFrom(ctx);
        if (!id)
            throw api_exception_1.ApiException.badRequest('id wajib diisi.');
        const r = await this.excel.stocktakeReport(id);
        return { _binary: true, ...r };
    }
    async asn(ctx) {
        const status = ctx.query.status ? String(ctx.query.status) : null;
        const r = await this.excel.asnReport(status);
        return { _binary: true, ...r };
    }
    async report(ctx) {
        const type = ctx.query.type ? String(ctx.query.type) : 'daily';
        const date = ctx.query.date ? String(ctx.query.date) : null;
        const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
        const r = await this.excel.reportsExcel(type, date, dateTo);
        return { _binary: true, ...r };
    }
    async inboundReceipt(ctx) {
        const id = this.idFrom(ctx);
        if (!id)
            throw api_exception_1.ApiException.badRequest('id wajib diisi.');
        return { _html: true, html: await this.print.inboundReceipt(id) };
    }
    async putaway(ctx) {
        const id = this.idFrom(ctx);
        if (!id)
            throw api_exception_1.ApiException.badRequest('id wajib diisi.');
        return { _html: true, html: await this.print.putawaySheet(id) };
    }
    async outboundDo(ctx) {
        const id = this.idFrom(ctx);
        if (!id)
            throw api_exception_1.ApiException.badRequest('id wajib diisi.');
        return { _html: true, html: await this.print.outboundDo(id) };
    }
    async suratJalan(ctx) {
        const id = this.idFrom(ctx);
        if (!id)
            throw api_exception_1.ApiException.badRequest('id wajib diisi.');
        return { _html: true, html: await this.print.suratJalan(id) };
    }
    async picklistPrint(ctx) {
        let id = this.idFrom(ctx);
        if (!id) {
            const outboundId = Number.parseInt(ctx.query.outbound_id ?? '0', 10) || 0;
            if (!outboundId)
                throw api_exception_1.ApiException.badRequest('id atau outbound_id wajib diisi.');
            id = await this.picklist.createFromOutbound(outboundId, ctx.user.id);
        }
        return { _html: true, html: await this.print.picklist(id) };
    }
    async reportPrint(ctx) {
        const type = ctx.query.type ? String(ctx.query.type) : 'daily';
        const date = ctx.query.date ? String(ctx.query.date) : null;
        const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
        return { _html: true, html: await this.print.reportPrint(type, date, dateTo) };
    }
};
exports.ExportActions = ExportActions;
exports.ExportActions = ExportActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [excel_export_service_1.ExcelExportService,
        print_service_1.PrintService,
        picklist_service_1.PicklistService])
], ExportActions);
//# sourceMappingURL=export.actions.js.map