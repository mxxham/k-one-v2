import { Injectable } from '@nestjs/common';
import { ExcelExportService } from './excel-export.service';
import { PrintService } from './print.service';
import { PicklistService } from '../picklist/picklist.service';
import { registerActions, RequestContext, setPermission } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

/**
 * Binary payload marker. The gateway detects this and streams the .xlsx file
 * (parity with ExcelExport.php template downloads).
 */
export interface BinaryResult {
  _binary: true;
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Inline HTML payload marker. The gateway streams this as text/html so the
 * document renders in a new tab for window.print() (parity with the PHP
 * print_*.php pages).
 */
export interface HtmlResult {
  _html: true;
  html: string;
}

@Injectable()
export class ExportActions {
  constructor(
    private readonly excel: ExcelExportService,
    private readonly print: PrintService,
    private readonly picklist: PicklistService,
  ) {
    registerActions('export', {
      inbound: (c) => this.inbound(c),
      outbound: (c) => this.outbound(c),
      customers: (c) => this.customers(c),
      products: (c) => this.products(c),
      ledger: (c) => this.ledger(c),
      stock: (c) => this.stock(c),
      stocktake: (c) => this.stocktake(c),
      report: (c) => this.report(c),
    });
    registerActions('print', {
      inbound_receipt: (c) => this.inboundReceipt(c),
      putaway: (c) => this.putaway(c),
      outbound_do: (c) => this.outboundDo(c),
      surat_jalan: (c) => this.suratJalan(c),
      picklist: (c) => this.picklistPrint(c),
      report: (c) => this.reportPrint(c),
    });
    setPermission('print', 'picklist', 'write');
  }

  private idFrom(ctx: RequestContext): number {
    return Number.parseInt(ctx.query.id ?? '0', 10) || 0;
  }

  private async inbound(ctx: RequestContext): Promise<BinaryResult> {
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const r = await this.excel.inboundReport(status);
    return { _binary: true, ...r };
  }

  private async outbound(ctx: RequestContext): Promise<BinaryResult> {
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const r = await this.excel.outboundReport(status);
    return { _binary: true, ...r };
  }

  private async customers(_ctx: RequestContext): Promise<BinaryResult> {
    const r = await this.excel.customersReport();
    return { _binary: true, ...r };
  }

  private async products(_ctx: RequestContext): Promise<BinaryResult> {
    const r = await this.excel.productsReport();
    return { _binary: true, ...r };
  }

  private async ledger(_ctx: RequestContext): Promise<BinaryResult> {
    const r = await this.excel.ledgerReport();
    return { _binary: true, ...r };
  }

  private async stock(_ctx: RequestContext): Promise<BinaryResult> {
    const r = await this.excel.stockReport();
    return { _binary: true, ...r };
  }

  private async stocktake(ctx: RequestContext): Promise<BinaryResult> {
    const id = this.idFrom(ctx);
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    const r = await this.excel.stocktakeReport(id);
    return { _binary: true, ...r };
  }

  private async report(ctx: RequestContext): Promise<BinaryResult> {
    const type = ctx.query.type ? String(ctx.query.type) : 'daily';
    const date = ctx.query.date ? String(ctx.query.date) : null;
    const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
    const r = await this.excel.reportsExcel(type, date, dateTo);
    return { _binary: true, ...r };
  }

  private async inboundReceipt(ctx: RequestContext): Promise<HtmlResult> {
    const id = this.idFrom(ctx);
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return { _html: true, html: await this.print.inboundReceipt(id) };
  }

  private async putaway(ctx: RequestContext): Promise<HtmlResult> {
    const id = this.idFrom(ctx);
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return { _html: true, html: await this.print.putawaySheet(id) };
  }

  private async outboundDo(ctx: RequestContext): Promise<HtmlResult> {
    const id = this.idFrom(ctx);
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return { _html: true, html: await this.print.outboundDo(id) };
  }

  private async suratJalan(ctx: RequestContext): Promise<HtmlResult> {
    const id = this.idFrom(ctx);
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return { _html: true, html: await this.print.suratJalan(id) };
  }

  private async picklistPrint(ctx: RequestContext): Promise<HtmlResult> {
    let id = this.idFrom(ctx);
    if (!id) {
      // print_picklist.php redirect parity: build the picklist from the
      // outbound first (idempotent — returns the existing picklist id).
      const outboundId = Number.parseInt(ctx.query.outbound_id ?? '0', 10) || 0;
      if (!outboundId) throw ApiException.badRequest('id atau outbound_id wajib diisi.');
      id = await this.picklist.createFromOutbound(outboundId, ctx.user.id);
    }
    return { _html: true, html: await this.print.picklist(id) };
  }

  private async reportPrint(ctx: RequestContext): Promise<HtmlResult> {
    const type = ctx.query.type ? String(ctx.query.type) : 'daily';
    const date = ctx.query.date ? String(ctx.query.date) : null;
    const dateTo = ctx.query.date_to ? String(ctx.query.date_to) : null;
    return { _html: true, html: await this.print.reportPrint(type, date, dateTo) };
  }
}