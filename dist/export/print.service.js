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
exports.PrintService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../database/db.service");
const inbound_service_1 = require("../inbound/inbound.service");
const outbound_service_1 = require("../outbound/outbound.service");
const picklist_service_1 = require("../picklist/picklist.service");
const report_service_1 = require("../report/report.service");
const api_exception_1 = require("../common/api-exception");
function esc(v) {
    if (v === null || v === undefined)
        return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function numFmt(v) {
    const n = Number(v ?? 0);
    if (Number.isNaN(n))
        return '0';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtLong(d) {
    if (!d)
        return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m)
        return String(d);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
function fmtShort(d) {
    if (!d)
        return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m)
        return String(d);
    return `${m[3]}/${m[2]}/${m[1]}`;
}
function fmtDmy(d) {
    if (!d)
        return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m)
        return String(d);
    return `${m[3]}/${m[2]}/${m[1]}`;
}
function nowPrint() {
    const d = new Date();
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mm = MONTHS[d.getMonth()];
    const wd = d.getDate();
    const y = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${wd} ${mm} ${y} ${hh}:${mi}`;
}
function monthsAgo3(dateStr) {
    if (!dateStr)
        return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
    if (!m)
        return false;
    const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    const three = Date.UTC(now.getFullYear(), now.getMonth() + 3, now.getDate());
    return exp < three;
}
function pageShell(title, body) {
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10pt; color: #1a1a1a; background: #fff; }
  @page { size: A4; margin: 0; }
  @media print {
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
    .page-break { page-break-before: always; }
  }
</style>
</head>
<body>${body}</body>
</html>`;
}
let PrintService = class PrintService {
    db;
    inbound;
    outbound;
    picklistService;
    report;
    constructor(db, inbound, outbound, picklistService, report) {
        this.db = db;
        this.inbound = inbound;
        this.outbound = outbound;
        this.picklistService = picklistService;
        this.report = report;
    }
    async inboundReceipt(id) {
        const inbound = await this.inbound.getById(id);
        if (!inbound)
            throw api_exception_1.ApiException.badRequest('Inbound tidak ditemukan');
        const items = await this.inbound.getItems(id);
        const itemLocations = {};
        for (const item of items) {
            const locs = await this.inbound.getItemLocations(Number(item.id));
            if (locs.length > 0)
                itemLocations[String(item.id)] = locs;
        }
        const totalQty = items.reduce((s, i) => s + Number(i.actual_qty ?? 0), 0);
        const accepted = items.filter((i) => i.stock_status === 'Accepted').length;
        const rejected = items.filter((i) => i.stock_status === 'Rejected').length;
        let totalPallet = 0;
        for (const item of items) {
            const locs = itemLocations[String(item.id)] ?? [];
            totalPallet += locs.length > 0 ? locs.length : Number(item.pallet ?? 0);
        }
        const status = String(inbound.status ?? 'Dues In');
        const cls = status === 'Dues In' ? 'dues-in' : status === 'ATP' ? 'atp' : status === 'Completed' ? 'completed' : status.includes('Received') ? 'received' : 'default';
        const rowsHtml = items
            .map((item, i) => {
            const pltLocs = itemLocations[String(item.id)] ?? [];
            const plt = pltLocs.length > 0 ? pltLocs.length : Number(item.pallet ?? 0);
            const mfg = item.manufacture_date ? fmtDmy(item.manufacture_date) : '—';
            const exp = item.exp_date ? fmtDmy(item.exp_date) : '—';
            const expWarn = monthsAgo3(item.exp_date) ? 'style="color:#014f4e;font-weight:700"' : '';
            const locHtml = pltLocs.length > 0
                ? `<div class="loc-stack">${pltLocs
                    .map((pl) => {
                    const dq = Number(pl.display_quantity ?? pl.original_quantity ?? pl.quantity ?? 0);
                    const isFull = Boolean(pl.is_full_pallet ?? dq >= 4);
                    return `<div class="loc-row"><strong>P${Number(pl.pallet_seq)}</strong> <code style="font-size:7pt">${esc(pl.location_code)}</code> · ${numFmt(dq)} ${esc(pl.uom ?? '')} <span class="loc-meta"> · ${isFull ? 'full' : 'partial'}</span></div>`;
                })
                    .join('')}</div>`
                : `<span class="loc-badge ${String(item.location ?? '') === 'QUA_SHELL' ? 'qua' : ''}">${esc(item.location || '—')}</span>`;
            return `<tr>
          <td class="num" style="color:#90a4ae">${i + 1}</td>
          <td><div class="ref-stack"><div class="ref-od">OD: ${esc(item.od_number ?? '—')}</div><div class="ref-so">SO: ${esc(item.so_number ?? '—')}</div></div></td>
          <td><div style="font-weight:600;color:#1a1a1a">${esc(item.product_name ?? '—')}</div><div class="sku">${esc(item.product_code ?? '')}</div></td>
          <td style="font-family:monospace;font-size:7.5pt">${esc(item.batch_number ?? '—')}</td>
          <td class="right">${numFmt(item.actual_qty ?? item.quantity ?? 0)}</td>
          <td class="num">${esc(item.uom ?? '—')}</td>
          <td class="right">${numFmt(plt)}</td>
          <td>${locHtml}</td>
          <td style="font-size:7.5pt">${mfg}</td>
          <td style="font-size:7.5pt" ${expWarn}>${exp}</td>
          <td class="num">${item.stock_status === 'Accepted' ? '<span class="status-acc">✓</span>' : '<span class="status-rej">✗</span>'}</td>
        </tr>`;
        })
            .join('') || '<tr><td colspan="11" style="text-align:center;color:#90a4ae;padding:20px">Tidak ada item</td></tr>';
        const orderNo = inbound.order_number ?? inbound.inbound_number ?? '-';
        const body = `<div class="print-bar no-print">
  <span>🖨️ Inbound Report Preview</span>
  <div class="btns">
    <button class="btn-print" onclick="window.print()">🖨️ Print / Save PDF</button>
  </div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="doc-logo">
      <div class="hdr-logo">K</div>
      <div class="doc-company"><div class="name"><span class="nk">K</span><span class="none">-one</span></div></div>
    </div>
    <div class="doc-title-block">
      <div class="title">INBOUND REPORT</div>
      <div class="sub">Goods Receipt Document</div>
      <div class="number">${esc(orderNo)}</div>
      <div style="margin-top:5px"><span class="badge badge-${cls}">${esc(status)}</span></div>
    </div>
  </div>
  <div class="section-title">📋 Detail Order</div>
  <div class="info-grid">
    <div class="info-cell"><div class="lbl">Carrier</div><div class="val">${esc(inbound.carrier_name ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Order Date</div><div class="val">${inbound.order_date ? fmtLong(inbound.order_date) : '—'}</div></div>
    <div class="info-cell"><div class="lbl">Status</div><div class="val"><span class="badge badge-${cls}">${esc(status)}</span></div></div>
    <div class="info-cell"><div class="lbl">Shipment No.</div><div class="val">${esc(inbound.shipment_no ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Container No.</div><div class="val">${esc(inbound.container_no ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Armada No.</div><div class="val">${esc(inbound.armada_no ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Received By</div><div class="val">${esc(inbound.received_by_name ?? '—')}</div></div>
    <div class="info-cell span2"><div class="lbl">Received Date</div><div class="val">${inbound.received_date ? fmtLong(inbound.received_date) : '—'}</div></div>
    ${inbound.notes ? `<div class="info-cell span3"><div class="lbl">Notes</div><div class="val" style="font-weight:400">${esc(inbound.notes)}</div></div>` : ''}
  </div>
  <div class="summary-bar">
    <div class="sum-card sc-blue"><div class="num">${items.length}</div><div class="lbl">Total Lines</div></div>
    <div class="sum-card sc-green"><div class="num">${numFmt(totalQty)}</div><div class="lbl">Total Qty</div></div>
    <div class="sum-card sc-amber"><div class="num">${numFmt(totalPallet)}</div><div class="lbl">Total Pallets</div></div>
    <div class="sum-card sc-green"><div class="num">${accepted}</div><div class="lbl">Accepted</div></div>
    <div class="sum-card sc-red"><div class="num">${rejected}</div><div class="lbl">Rejected</div></div>
  </div>
  <div class="section-title">📦 Detail Barang</div>
  <table class="items-table">
    <thead><tr>
      <th style="width:4%">#</th><th style="width:11%">OD / SO</th><th style="width:20%">Product / SKU</th>
      <th style="width:9%">Batch</th><th style="width:6%" class="right">Qty</th><th style="width:5%" class="num">UOM</th>
      <th style="width:6%" class="right">Plt</th><th style="width:22%">Lokasi pallet</th>
      <th style="width:7%">Mfg</th><th style="width:7%">Exp</th><th style="width:5%" class="num">Sts</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr>
      <td colspan="4"><strong>TOTAL</strong></td>
      <td class="right">${numFmt(totalQty)}</td><td></td>
      <td class="right">${numFmt(totalPallet)}</td><td colspan="4"></td>
    </tr></tfoot>
  </table>
  <div class="sig-grid">
    <div class="sig-box"><div class="role">Dibuat Oleh</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">${esc(inbound.created_by_name ?? 'Warehouse Staff')}</div></div>
    <div class="sig-box"><div class="role">Diperiksa Oleh</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">Warehouse Supervisor</div></div>
    <div class="sig-box"><div class="role">Disetujui Oleh</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">Warehouse Manager</div></div>
  </div>
  <div class="doc-footer"><span>K-one</span><span>Dicetak: ${nowPrint()} WIB</span><span>${esc(orderNo)}</span></div>
</div>`;
        return pageShell(`Inbound Report - ${orderNo}`, body);
    }
    async putawaySheet(id) {
        const inbound = await this.inbound.getById(id);
        if (!inbound)
            throw api_exception_1.ApiException.badRequest('Inbound tidak ditemukan');
        const items = await this.inbound.getItems(id);
        const putawayRows = [];
        let totalQty = 0;
        let totalLines = 0;
        for (const item of items) {
            const locs = await this.inbound.getItemLocations(Number(item.id));
            const batch = item.batch_number ?? item.batch_no ?? '';
            const uom = item.uom ?? item.uom_type ?? 'Drum';
            const odNo = item.od_number ?? '';
            const soNo = item.so_number ?? '';
            if (locs.length > 0) {
                for (const loc of locs) {
                    const qty = Number(loc.display_quantity ?? loc.quantity ?? 0);
                    putawayRows.push({ item_code: item.product_code, item_desc: item.product_name, batch_no: batch, qty, uom, pallet_seq: loc.pallet_seq ?? '', location: loc.location_code ?? '', od_number: odNo, so_number: soNo });
                    totalQty += qty;
                    totalLines++;
                }
            }
            else {
                const qty = Number(item.actual_qty ?? item.quantity ?? 0);
                putawayRows.push({ item_code: item.product_code, item_desc: item.product_name, batch_no: batch, qty, uom, pallet_seq: '', location: item.location ?? '', od_number: odNo, so_number: soNo });
                totalQty += qty;
                totalLines++;
            }
        }
        const orderNo = inbound.order_number ?? inbound.inbound_number ?? '—';
        const customer = inbound.carrier_name ?? '—';
        const putawayDate = inbound.received_date ?? inbound.order_date ?? '';
        const userName = inbound.received_by_name ?? inbound.created_by_name ?? '—';
        const shipmentNo = inbound.shipment_no ?? '';
        const notes = inbound.notes ?? '';
        const rowsHtml = putawayRows
            .map((row, i) => `<tr>
        <td class="c" style="color:#90a4ae;font-size:7.5pt">${i + 1}</td>
        <td><span style="font-family:monospace;font-weight:700;font-size:8.5pt;color:#013d3c">${esc(row.item_code)}</span></td>
        <td style="font-size:8.5pt">${esc(row.item_desc)}</td>
        <td>${row.batch_no ? `<span class="chip chip-batch">${esc(row.batch_no)}</span>` : '<span style="color:#ccc;font-size:7pt">—</span>'}</td>
        <td class="c">${row.pallet_seq !== '' ? `<span class="palt-badge">P${esc(row.pallet_seq)}</span>` : '<span style="color:#ccc;font-size:7pt">—</span>'}</td>
        <td class="r">${numFmt(row.qty)}</td>
        <td class="c" style="font-size:8pt">${esc(row.uom)}</td>
        <td>${row.od_number ? `<span class="chip chip-od">OD: ${esc(row.od_number)}</span>` : ''}${row.od_number && row.so_number ? '<br>' : ''}${row.so_number ? `<span class="chip chip-so">SO: ${esc(row.so_number)}</span>` : ''}${!row.od_number && !row.so_number ? '<span style="color:#ccc;font-size:7pt">—</span>' : ''}</td>
        <td>${row.location ? `<span class="chip chip-loc">${esc(row.location)}</span>` : '<span style="display:inline-block;min-width:90px;border-bottom:1.5px dashed #90a4ae;height:16px"></span>'}</td>
        <td class="c"><span class="check-box"></span></td>
      </tr>`)
            .join('');
        const body = `<div class="print-bar no-print">
  <div class="print-bar-title">📋 Putaway Sheet — ${esc(orderNo)}</div>
  <div class="btns"><button class="btn-print" onclick="window.print()">🖨️ Print / PDF</button></div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="logo-area">
      <div class="logo-mark">K</div>
      <div><div class="company-name"><span class="nk">K</span><span class="none">-one</span></div></div>
    </div>
    <div class="doc-title-block">
      <div class="doc-title">PUT AWAY SHEET</div>
      <div class="doc-subtitle">Inbound Putaway Document</div>
      <div class="doc-orderno">${esc(orderNo)}</div>
    </div>
  </div>
  <div class="info-grid">
    <div class="info-cell"><div class="lbl">Order No.</div><div class="val" style="font-family:monospace">${esc(orderNo)}</div></div>
    <div class="info-cell"><div class="lbl">Putaway Date</div><div class="val">${putawayDate ? fmtDmy(putawayDate) : '—'}</div></div>
    <div class="info-cell"><div class="lbl">User / Petugas</div><div class="val">${esc(userName)}</div></div>
    <div class="info-cell span2"><div class="lbl">Carrier / Transporter</div><div class="val">${esc(customer)}</div></div>
    <div class="info-cell"><div class="lbl">Shipment No.</div><div class="val" style="font-family:monospace">${esc(shipmentNo || '—')}</div></div>
  </div>
  <div class="summary-bar">
    <div class="sum-card sc-teal"><div class="num">${items.length}</div><div class="lbl">Total Items</div></div>
    <div class="sum-card sc-green"><div class="num">${totalLines}</div><div class="lbl">Total Pallet</div></div>
    <div class="sum-card sc-amber"><div class="num">${numFmt(totalQty)}</div><div class="lbl">Total Qty</div></div>
  </div>
  <div class="section-title">📦 Detail Putaway</div>
  <table>
    <thead><tr>
      <th class="c" style="width:24px">No.</th><th>Item Code</th><th>Item Description</th><th>Batch No.</th>
      <th class="c" style="width:28px">Plt</th><th class="r">Qty</th><th class="c">UOM</th><th>OD No. / SO No.</th><th>Actual Location</th><th class="c" style="width:18px">✓</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr>
      <td colspan="4" style="text-align:right;padding-right:10px">TOTAL</td>
      <td class="c" style="font-weight:700">${totalLines} plt</td>
      <td class="r">${numFmt(totalQty)}</td><td colspan="4"></td>
    </tr></tfoot>
  </table>
  <div class="remarks-box"><div class="remarks-lbl">Remarks / Catatan</div><div style="font-size:8.5pt;color:#546e7a;min-height:16px">${esc(notes)}</div></div>
  <div class="sig-grid">
    <div class="sig-box"><div class="sig-role">Prepared By</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">${esc(userName)}</div></div>
    <div class="sig-box"><div class="sig-role">Checked By</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">( ......................... )</div></div>
    <div class="sig-box"><div class="sig-role">Approved By</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">( ......................... )</div></div>
  </div>
  <div class="doc-footer"><span>K-one</span><span>Dicetak: ${nowPrint()} WIB</span><span>${esc(orderNo)}</span></div>
</div>`;
        return pageShell(`Putaway Sheet — ${orderNo}`, body);
    }
    async outboundDo(id) {
        const outbound = await this.outbound.getById(id);
        if (!outbound)
            throw api_exception_1.ApiException.badRequest('Outbound tidak ditemukan');
        const items = await this.outbound.getItems(id);
        const destinations = await this.outbound.getDestinations(id);
        const displayOrderNo = outbound.shipment_number ?? outbound.order_number ?? '-';
        const calcItemPallet = (item) => Math.ceil(Number(item.actual_qty ?? item.quantity ?? 0) / Math.max(1, Number(item.uom_per_pallet ?? 4)));
        const itemPickLocations = {};
        for (const item of items) {
            const locs = await this.outbound.getItemPickedLocations(Number(item.id));
            if (locs.length > 0)
                itemPickLocations[String(item.id)] = locs;
        }
        const itemsByDest = {};
        for (const item of items) {
            const dId = item.destination_id ? Number(item.destination_id) : 0;
            if (!itemsByDest[dId])
                itemsByDest[dId] = [];
            itemsByDest[dId].push(item);
        }
        let totalQty = 0;
        let totalPallet = 0;
        for (const it of items) {
            totalQty += Number(it.actual_qty ?? it.quantity ?? 0);
            totalPallet += calcItemPallet(it);
        }
        const hasPrimaryDest = Boolean(itemsByDest[0]?.length);
        const destCount = destinations.length + (hasPrimaryDest ? 1 : 0);
        const customerNames = [];
        for (const it of items) {
            const cn = String(it.order_customer_name ?? it.customer_name ?? '').trim();
            if (cn !== '' && !customerNames.includes(cn))
                customerNames.push(cn);
        }
        const customerLabel = customerNames.length > 1 ? `Multi Customer (${customerNames.length})` : (customerNames[0] ?? (outbound.customer_name ?? '—'));
        const renderItemsTable = (destItems) => {
            let subQty = 0;
            let subPlt = 0;
            const rows = destItems
                .map((item, i) => {
                const dispBatch = item.batch_number ?? item.batch_no ?? '—';
                const dispExpiry = item.expiry_date ?? item.exp_date ?? null;
                const warnExp = monthsAgo3(dispExpiry);
                const dispPlt = calcItemPallet(item);
                const pickLocs = itemPickLocations[String(item.id)] ?? [];
                const qty = Number(item.actual_qty ?? item.quantity ?? 0);
                subQty += qty;
                subPlt += dispPlt;
                return `<tr>
            <td class="num" style="color:#90a4ae">${i + 1}</td>
            <td class="mono" style="font-size:7.5pt">${esc(item.od_number ?? '—')}</td>
            <td class="mono" style="font-size:7.5pt;color:#026766">${esc(item.so_number ?? '—')}</td>
            <td><div style="font-weight:600;color:#1a1a1a;font-size:8.5pt">${esc(item.product_name ?? '—')}</div><div class="sku">${esc(item.product_code ?? '')}</div></td>
            <td class="mono">${esc(dispBatch)}</td>
            <td>${esc(item.order_customer_name ?? item.customer_name ?? '—')}</td>
            <td class="right">${numFmt(qty)}</td>
            <td class="num">${esc(item.uom ?? '—')}</td>
            <td class="right">${dispPlt}</td>
            <td>${pickLocs.length > 0 ? `<div style="font-size:7pt;line-height:1.8">${pickLocs.map((pl) => `<span style="display:inline-block;background:#e8f5e9;color:#013d3c;border-radius:3px;padding:1px 5px;margin:1px 0;font-family:monospace;font-weight:600;font-size:6.5pt;white-space:nowrap">${esc(pl.location_code)}(${numFmt(pl.picked_qty)})</span> `).join('')}</div>` : `<span class="loc-badge">${esc(item.location ?? '—')}</span>`}</td>
            <td><span class="${warnExp ? 'exp-warn' : ''}">${dispExpiry ? fmtShort(dispExpiry) : '—'}</span></td>
          </tr>`;
            })
                .join('') || '<tr><td colspan="11" style="text-align:center;color:#90a4ae;padding:16px">Tidak ada item</td></tr>';
            return `<table class="dest-table">
        <thead><tr>
          <th style="width:24px">#</th><th style="width:90px">OD No.</th><th style="width:80px">SO No.</th><th>Product / SKU</th>
          <th>Batch No</th><th style="width:120px">Customer</th><th class="right" style="width:50px">Qty</th>
          <th class="num" style="width:38px">UOM</th><th class="right" style="width:38px">Plt</th><th style="width:100px">Lokasi</th><th style="width:80px">Expiry</th>
        </tr></thead><tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="6"><strong>SUBTOTAL</strong></td>
          <td class="right">${numFmt(subQty)}</td><td></td>
          <td class="right">${numFmt(subPlt)}</td>
          <td colspan="2"><span class="fefo-tag">FEFO</span></td>
        </tr></tfoot></table>`;
        };
        const status = String(outbound.status ?? 'Open');
        const badgeCls = String(status).toLowerCase();
        const primaryName = outbound.ship_to_name ? outbound.ship_to_name : (outbound.customer_name ?? 'Tujuan Utama');
        const primaryLoc = outbound.ship_to_location ?? outbound.kota ?? '';
        const primaryStreet = outbound.ship_to_street ?? '';
        const primaryItems = itemsByDest[0] ?? [];
        let destBlocks = '';
        if (hasPrimaryDest) {
            destBlocks += `<div class="dest-block">
        <div class="dest-header primary">
          <span class="dest-seq primary">1</span>
          <div><div class="dest-name primary">${esc(primaryName)}</div>${primaryLoc ? `<div class="dest-loc">📍 ${esc(primaryLoc + (primaryStreet ? ' — ' + primaryStreet : ''))}</div>` : ''}</div>
          <span class="dest-tag primary">Tujuan Utama</span>
        </div>
        <div style="padding:0">${renderItemsTable(primaryItems)}</div>
      </div>`;
        }
        destinations.forEach((dst, di) => {
            const dstItems = itemsByDest[Number(dst.id)] ?? [];
            const labelNo = (hasPrimaryDest ? 2 : 1) + di;
            const dstLocParts = [dst.ship_to_location ?? '', (dst.kota && dst.kota !== dst.ship_to_location ? dst.kota : ''), dst.ship_to_street ?? ''].filter(Boolean);
            destBlocks += `<div class="dest-block">
        <div class="dest-header secondary">
          <span class="dest-seq secondary">${labelNo}</span>
          <div><div class="dest-name secondary">${esc(dst.ship_to_name ?? '—')}</div>${dstLocParts.length > 0 ? `<div class="dest-loc">📍 ${esc(dstLocParts.join(' — '))}</div>` : ''}</div>
          <span class="dest-tag secondary">Tujuan ${labelNo}</span>
        </div>
        <div style="padding:0">${renderItemsTable(dstItems)}</div>
      </div>`;
        });
        const grandTotal = destinations.length > 0 ? `<table style="margin-top:4px">
      <tfoot><tr>
        <td colspan="5" style="padding:7px 8px;font-weight:700;font-size:9.5pt;border-top:2px solid #013d3c;background:#e0f7f7">GRAND TOTAL — ${destCount} Tujuan</td>
        <td class="right" style="padding:7px 8px;font-weight:700;font-size:9.5pt;border-top:2px solid #013d3c;background:#e0f7f7">${numFmt(totalQty)}</td>
        <td style="padding:7px 8px;border-top:2px solid #013d3c;background:#e0f7f7"></td>
        <td class="right" style="padding:7px 8px;font-weight:700;font-size:9.5pt;border-top:2px solid #013d3c;background:#e0f7f7">${numFmt(totalPallet)}</td>
        <td colspan="2" style="padding:7px 8px;border-top:2px solid #013d3c;background:#e0f7f7"></td>
      </tr></tfoot>
    </table>` : '';
        const body = `<div class="print-bar no-print">
  <span>🖨️ Outbound Report Preview</span>
  <div class="btns"><button class="btn-print" onclick="window.print()">🖨️ Print / Save PDF</button></div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="doc-logo">
      <div class="hdr-logo">K</div>
      <div class="doc-company"><div class="name"><span class="nk">K</span><span class="none">-one</span></div><div class="sub">secondary administration — Warehouse Management</div></div>
    </div>
    <div class="doc-title-block">
      <div class="title">OUTBOUND REPORT</div>
      <div class="sub">Delivery Order Document</div>
      <div class="number">${esc(displayOrderNo)}</div>
      <div style="margin-top:5px"><span class="badge badge-${esc(badgeCls)}">${esc(status)}</span></div>
    </div>
  </div>
  ${outbound.shipment_number ? `<div class="shipment-box">
    <div><div class="ship-lbl">Shipment Number</div><div class="ship-num">${esc(outbound.shipment_number)}</div></div>
    <div><div class="ship-lbl">Customer</div><div class="ship-val">${esc(outbound.ship_to_name || customerLabel)}</div>${destinations.length > 0 ? `<div style="font-size:8.5pt;color:#78909c;margin-top:2px">📍 Multi Tujuan (${destinations.length})</div>` : ''}</div>
    <div><div class="ship-lbl">Expected Date</div><div class="ship-val">${outbound.expected_date ? fmtLong(outbound.expected_date) : '—'}</div></div>
  </div>` : ''}
  <div class="section-title">📋 Detail Order</div>
  <div class="info-grid">
    <div class="info-cell"><div class="lbl">Customer</div><div class="val">${esc(outbound.customer_name ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Order Date</div><div class="val">${fmtLong(outbound.order_date)}</div></div>
    <div class="info-cell"><div class="lbl">Expected Date</div><div class="val">${outbound.expected_date ? fmtLong(outbound.expected_date) : '—'}</div></div>
    <div class="info-cell"><div class="lbl">Armada No</div><div class="val">${esc(outbound.armada_no ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Jenis Armada</div><div class="val">${esc(outbound.jenis_armada ?? '—')}</div></div>
    <div class="info-cell"><div class="lbl">Container No</div><div class="val">${esc(outbound.container_no ?? '—')}</div></div>
    ${outbound.notes ? `<div class="info-cell span3"><div class="lbl">Notes</div><div class="val" style="font-weight:400">${esc(outbound.notes)}</div></div>` : ''}
  </div>
  <div class="summary-bar">
    <div class="sum-card sc-purple"><div class="num">${items.length}</div><div class="lbl">Total Lines</div></div>
    <div class="sum-card sc-green"><div class="num">${numFmt(totalQty)}</div><div class="lbl">Total Qty</div></div>
    <div class="sum-card sc-amber"><div class="num">${numFmt(totalPallet)}</div><div class="lbl">Total Pallets</div></div>
    <div class="sum-card sc-teal"><div class="num">${destCount}</div><div class="lbl">Tujuan</div></div>
  </div>
  <div class="section-title">🚚 Tujuan Pengiriman &amp; Produk</div>
  ${destBlocks}
  ${grandTotal}
  <div class="sig-grid">
    <div class="sig-box"><div class="role">Dibuat Oleh</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">${esc(outbound.created_by_name ?? 'Warehouse Staff')}</div></div>
    <div class="sig-box"><div class="role">Driver / Kurir</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">${esc(outbound.armada_no ?? '( .............. )')}</div></div>
    <div class="sig-box"><div class="role">Penerima</div><div class="space"></div><div class="name-line"></div><div style="font-size:8pt;color:#546e7a">${esc(customerLabel)}</div></div>
  </div>
  <div class="doc-footer"><span>K-one — Warehouse Management System</span><span>Dicetak: ${nowPrint()} WIB</span><span>${esc(displayOrderNo)}</span></div>
</div>`;
        return pageShell(`Outbound Report - ${displayOrderNo}`, body);
    }
    async suratJalan(id) {
        const outbound = await this.outbound.getById(id);
        if (!outbound)
            throw api_exception_1.ApiException.badRequest('Outbound tidak ditemukan');
        const items = await this.outbound.getItems(id);
        const destinations = await this.outbound.getDestinations(id);
        const calcItemPallet = (item) => Math.ceil(Number(item.actual_qty ?? item.quantity ?? 0) / Math.max(1, Number(item.uom_per_pallet ?? 4)));
        const itemPickLocations = {};
        for (const item of items) {
            const locs = await this.outbound.getItemPickedLocations(Number(item.id));
            if (locs.length > 0)
                itemPickLocations[String(item.id)] = locs;
        }
        const itemsByDest = {};
        for (const item of items) {
            const dId = item.destination_id ? Number(item.destination_id) : 0;
            if (!itemsByDest[dId])
                itemsByDest[dId] = [];
            itemsByDest[dId].push(item);
        }
        let totalQty = 0;
        let totalPallet = 0;
        for (const item of items) {
            totalQty += Number(item.actual_qty ?? item.quantity ?? 0);
            totalPallet += calcItemPallet(item);
        }
        const hasPrimaryDest = Boolean(itemsByDest[0]?.length);
        const destCount = destinations.length + (hasPrimaryDest ? 1 : 0);
        const customerNames = [];
        for (const it of items) {
            const cn = String(it.order_customer_name ?? it.customer_name ?? '').trim();
            if (cn !== '' && !customerNames.includes(cn))
                customerNames.push(cn);
        }
        const customerLabel = customerNames.length > 1 ? `Multi Customer (${customerNames.length})` : (customerNames[0] ?? (outbound.customer_name ?? '—'));
        const dispatchDate = outbound.expected_date ?? outbound.order_date ?? '';
        const warehouseName = 'Surabaya Oso 5 Non BLC Covered';
        const shipToName = outbound.ship_to_name || customerLabel;
        const shipToAddr = outbound.ship_to_location ?? outbound.kota ?? outbound.destination ?? '—';
        const shipToCity = outbound.kota ?? outbound.ship_to_location ?? '—';
        const shipToStreet = outbound.ship_to_street ?? '';
        const orderNo = outbound.order_number ?? outbound.outbound_number ?? '—';
        const primaryDestName = outbound.ship_to_name || customerLabel;
        const primaryDestCity = outbound.ship_to_location ?? outbound.kota ?? '';
        const primaryDestAddr = outbound.ship_to_street ?? '';
        const status = String(outbound.status ?? 'Open');
        const badgeColors = { Completed: '#013d3c', Shipped: '#014f4e', Picked: '#026766', Open: '#e65100' };
        const bc = badgeColors[status] ?? '#546e7a';
        const rowsHtml = items
            .map((item, i) => {
            const dispBatch = item.batch_number ?? item.batch_no ?? '—';
            const dispQty = Number(item.actual_qty ?? item.quantity ?? 0);
            const dispPlt = calcItemPallet(item);
            const pickLocs = itemPickLocations[String(item.id)] ?? [];
            const uniqLocs = [];
            for (const pl of pickLocs)
                if (pl.location_code && !uniqLocs.includes(pl.location_code))
                    uniqLocs.push(pl.location_code);
            const locsHtml = uniqLocs.length > 0
                ? uniqLocs.map((ul) => `<span class="loc-tag">${esc(ul)}</span>`).join('')
                : (item.location ?? '') ? `<span class="loc-tag">${esc(item.location)}</span>` : '<span style="color:#cfd8dc;font-size:7.5pt">—</span>';
            return `<tr>
          <td class="c" style="color:#90a4ae;font-size:7.5pt">${i + 1}</td>
          <td><div style="font-family:monospace;font-weight:700;font-size:8pt">${esc(item.product_code ?? '')}</div></td>
          <td><div style="font-weight:600">${esc(item.product_name ?? '—')}</div></td>
          <td><span class="batch-tag">${esc(dispBatch)}</span></td>
          <td>${esc(item.order_customer_name ?? item.customer_name ?? '—')}</td>
          <td class="c">${esc(item.uom ?? '—')}</td>
          <td class="r">${numFmt(dispQty)}</td>
          <td class="r">${dispPlt}</td>
          <td>${locsHtml}</td>
          <td>${item.od_number ? `<span class="od-tag">OD: ${esc(item.od_number)}</span>` : ''}${item.od_number && item.so_number ? '<br>' : ''}${item.so_number ? `<span class="so-tag">SO: ${esc(item.so_number)}</span>` : ''}${!item.od_number && !item.so_number ? '<span style="color:#cfd8dc;font-size:7.5pt">—</span>' : ''}</td>
        </tr>`;
        })
            .join('');
        let destSections = '';
        if (destCount > 0) {
            destSections = `<div class="sec-title">📍 Tujuan Pengiriman</div>`;
            if (hasPrimaryDest) {
                destSections += `<div class="dest-section">
          <div class="dest-header">
            <div class="num-badge">1</div>
            <div><div class="dest-name">${esc(primaryDestName || 'Tujuan Utama')}</div>${primaryDestCity ? `<div style="font-size:8pt;color:#546e7a">${esc(primaryDestCity)}</div>` : ''}</div>
            ${primaryDestAddr ? `<div class="dest-addr">${esc(primaryDestAddr)}</div>` : (primaryDestCity ? `<div class="dest-addr">${esc(primaryDestCity)}</div>` : '')}
          </div>
        </div>`;
            }
            destinations.forEach((dst, di) => {
                const labelNo = (hasPrimaryDest ? 2 : 1) + di;
                destSections += `<div class="dest-section">
          <div class="dest-header">
            <div class="num-badge">${labelNo}</div>
            <div><div class="dest-name">${esc(dst.ship_to_name ?? '—')}</div>${dst.ship_to_location ? `<div style="font-size:8pt;color:#546e7a">${esc(dst.ship_to_location)}</div>` : ''}</div>
            ${dst.ship_to_street ? `<div class="dest-addr">${esc(dst.ship_to_street)}</div>` : (dst.kota ? `<div class="dest-addr">${esc(dst.kota)}</div>` : '')}
          </div>
          ${dst.notes ? `<div style="padding:6px 12px;font-size:8pt;color:#546e7a;font-style:italic">Catatan: ${esc(dst.notes)}</div>` : ''}
        </div>`;
            });
        }
        const body = `<div class="print-bar no-print">
  <span>🚚 Surat Jalan — ${esc(orderNo)}</span>
  <div class="btns"><button class="btn-print" onclick="window.print()">🖨️ Print / Save PDF</button></div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="doc-logo-area">
      <div class="logo-box">W</div>
      <div><div class="company-name">K-one</div><div class="company-sub">${esc(warehouseName)} — K-one</div></div>
    </div>
    <div>
      <div class="doc-title">SURAT JALAN</div>
      <div class="doc-number">${esc(orderNo)}</div>
      <div style="text-align:right;margin-top:4px"><span style="background:${bc};color:#fff;padding:2px 9px;border-radius:10px;font-size:8pt;font-weight:700">${esc(status)}</span></div>
    </div>
  </div>
  ${outbound.shipment_number ? `<div class="ref-box">
    <div><div class="ref-lbl">Shipment Number</div><div class="ref-num">${esc(outbound.shipment_number)}</div></div>
    <div><div class="ref-lbl">Ship-To Party</div><div class="ref-val">${esc(shipToName)}</div>${destinations.length > 0 ? `<div style="font-size:8pt;color:#546e7a">📍 Multi Tujuan (${destinations.length})</div>` : ''}</div>
    <div><div class="ref-lbl">Delivery Address</div><div class="ref-val" style="font-size:9pt">${esc(shipToStreet || (shipToAddr !== '—' ? shipToAddr : '—'))}</div>${shipToStreet && shipToAddr !== '—' ? `<div style="font-size:8pt;color:#546e7a">${esc(shipToAddr)}</div>` : ''}</div>
  </div>` : ''}
  <div class="info-grid">
    <div class="ic"><div class="lbl">Pengirim (Shipper)</div><div class="val">${esc(customerLabel)}</div></div>
    <div class="ic"><div class="lbl">Tanggal Kirim</div><div class="val">${dispatchDate ? fmtLong(dispatchDate) : '—'}</div></div>
    <div class="ic"><div class="lbl">Client DO No.</div><div class="val" style="font-family:monospace">${esc(outbound.do_number ?? '—')}</div></div>
    <div class="ic"><div class="lbl">SO Number</div><div class="val" style="font-family:monospace">${esc(outbound.so_number ?? '—')}</div></div>
    <div class="ic"><div class="lbl">Nomor Kendaraan</div><div class="val">${esc(outbound.armada_no ?? '—')}</div></div>
    <div class="ic"><div class="lbl">Jenis Kendaraan</div><div class="val">${esc(outbound.jenis_armada ?? '—')}</div></div>
    <div class="ic"><div class="lbl">Container No.</div><div class="val" style="font-family:monospace">${esc(outbound.container_no ?? '—')}</div></div>
    <div class="ic span2"><div class="lbl">Tujuan Pengiriman</div><div class="val">${esc(shipToName + (shipToCity && shipToCity !== '—' ? ' — ' + shipToCity : ''))}</div>${shipToAddr && shipToAddr !== '—' ? `<div class="dest-addr">${esc(shipToAddr)}</div>` : ''}</div>
  </div>
  <div class="summary-bar">
    <div class="sc sc-green"><div class="num">${items.length}</div><div class="lbl">Total Lines</div></div>
    <div class="sc sc-blue"><div class="num">${numFmt(totalQty)}</div><div class="lbl">Total Qty</div></div>
    <div class="sc sc-amber"><div class="num">${numFmt(totalPallet)}</div><div class="lbl">Total Pallets</div></div>
    <div class="sc sc-teal"><div class="num">${destCount}</div><div class="lbl">Tujuan</div></div>
  </div>
  <div class="sec-title">📦 Detail Barang</div>
  <table>
    <thead><tr>
      <th style="width:24px" class="c">S.No</th><th>Item Code</th><th>Item Description</th><th>Batch No.</th><th>Customer</th>
      <th class="c">UOM</th><th class="r">Qty</th><th class="r">Pallets</th><th>Lokasi Ambil</th><th>OD / SO No.</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr>
      <td colspan="6"><strong>Grand Total</strong></td>
      <td class="r">${numFmt(totalQty)}</td>
      <td class="r">${numFmt(totalPallet)}</td>
      <td colspan="2"><span style="font-size:7.5pt;font-weight:400">Total packages: ${items.length}</span></td>
    </tr></tfoot>
  </table>
  ${destSections}
  <div style="margin-top:14px;border:1px solid #dde3ea;border-radius:6px;padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <div style="font-size:7.5pt;color:#90a4ae;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Received in good condition by</div>
      <div style="border-bottom:1px dashed #bdbdbd;min-height:28px;margin-top:6px"></div>
      <div style="font-size:8pt;color:#546e7a;margin-top:3px">Tanda Tangan &amp; Tanggal Penerimaan</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:7.5pt;color:#90a4ae;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">For ${esc(warehouseName)}</div>
      <div style="border-bottom:1px dashed #bdbdbd;min-height:28px;margin-top:6px"></div>
      <div style="font-size:8pt;color:#546e7a;margin-top:3px">${esc(outbound.created_by_name ?? 'Warehouse Staff')}</div>
    </div>
  </div>
  <div class="sig-grid">
    <div class="sig-box"><div class="sig-role">Dibuat Oleh</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">${esc(outbound.created_by_name ?? 'Warehouse Staff')}</div></div>
    <div class="sig-box"><div class="sig-role">Driver / Kurir</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">${esc(outbound.armada_no ?? '( .................. )')}</div></div>
    <div class="sig-box"><div class="sig-role">Penerima</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">${esc(shipToName)}</div></div>
  </div>
  <div class="doc-footer"><span>K-one — K-one secondary administration</span><span>Dicetak: ${nowPrint()} WIB</span><span>${esc(orderNo)}</span></div>
</div>`;
        return pageShell(`Surat Jalan - ${orderNo}`, body);
    }
    async picklist(id) {
        const picklist = await this.picklistService.getById(id);
        if (!picklist)
            throw api_exception_1.ApiException.badRequest('Picklist tidak ditemukan');
        const items = await this.picklistService.getItems(id);
        const totalQty = items.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
        const totalPlt = Math.ceil(items.reduce((s, i) => s + Number(i.pallet ?? 0), 0));
        const totalLines = items.length;
        const picklistNo = picklist.picklist_number ?? '—';
        const pickDate = picklist.created_date ?? '';
        const outboundNo = picklist.outbound_number ?? '—';
        const notes = picklist.notes ?? '';
        const itemCustomers = Array.from(new Set(items.map((i) => i.item_customer_name).filter(Boolean)));
        const allCustomers = itemCustomers.length > 0 ? itemCustomers : (picklist.customer_name ? [picklist.customer_name] : []);
        const itemSoNums = Array.from(new Set(items.map((i) => i.item_so_number).filter(Boolean)));
        const allSo = itemSoNums.length > 0 ? itemSoNums : (picklist.so_number ? [picklist.so_number] : []);
        const allDo = picklist.do_number ? [picklist.do_number] : [];
        const rowsHtml = items
            .map((item, i) => {
            const pltDisp = String(Math.ceil(Number(item.pallet ?? 0)));
            const iCust = item.item_customer_name ?? null;
            const iSo = item.item_so_number ?? null;
            const iOd = item.item_od_number ?? null;
            const bn = item.batch_no ?? item.batch_number ?? null;
            return `<tr>
          <td class="c" style="color:#90a4ae;font-size:7.5pt">${i + 1}</td>
          <td><div style="font-weight:700;font-size:8.5pt;color:#013d3c">${esc(item.product_name ?? '—')}</div><div style="font-family:monospace;font-size:7.5pt;color:#607d8b">${esc(item.product_code ?? '')}</div></td>
          <td style="font-size:8pt">${iCust ? esc(iCust) : '<span style="color:#ccc">—</span>'}${item.item_ship_to ? `<div style="font-size:7pt;color:#90a4ae">${esc(item.item_ship_to)}</div>` : ''}</td>
          <td>${iSo ? `<span class="chip chip-so">SO: ${esc(iSo)}</span>` : ''}${iSo && iOd ? '<br>' : ''}${iOd ? `<span class="chip chip-od">OD: ${esc(iOd)}</span>` : ''}${!iSo && !iOd ? '<span style="color:#ccc;font-size:7pt">—</span>' : ''}</td>
          <td>${bn ? `<span class="chip chip-batch">${esc(bn)}</span>` : '<span style="color:#ccc;font-size:7pt">—</span>'}</td>
          <td>${item.location ? `<span class="chip chip-loc">${esc(item.location)}</span>` : '<span style="display:inline-block;min-width:70px;border-bottom:1.5px dashed #90a4ae;height:16px"></span>'}</td>
          <td class="r" style="font-weight:700">${numFmt(item.quantity ?? 0)}</td>
          <td class="r" style="color:#546e7a">${pltDisp}</td>
          <td class="r"><span style="display:inline-block;min-width:46px;border-bottom:1.5px solid #b2dfdb;height:16px"></span></td>
          <td class="c"><span class="check-box"></span></td>
        </tr>`;
        })
            .join('') || '<tr><td colspan="10" style="text-align:center;color:#90a4ae;padding:20px">Tidak ada item</td></tr>';
        const body = `<div class="print-bar no-print">
  <div class="print-bar-title">📋 Pick List — ${esc(picklistNo)}</div>
  <div class="btns"><button class="btn-print" onclick="window.print()">🖨️ Print / PDF</button></div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="logo-area">
      <div class="logo-mark">K</div>
      <div><div class="company-name"><span class="nk">K</span><span class="none">-one</span></div></div>
    </div>
    <div class="doc-title-block">
      <div class="doc-title">PICK LIST</div>
      <div class="doc-subtitle">Outbound Picking Document</div>
      <div class="doc-orderno">${esc(picklistNo)}</div>
    </div>
  </div>
  <div class="info-grid">
    <div class="info-cell"><div class="lbl">Pick List No.</div><div class="val" style="font-family:monospace">${esc(picklistNo)}</div></div>
    <div class="info-cell"><div class="lbl">Tanggal</div><div class="val">${pickDate ? fmtDmy(pickDate) : '—'}</div></div>
    <div class="info-cell"><div class="lbl">Outbound No.</div><div class="val" style="font-family:monospace">${esc(outboundNo)}</div></div>
    <div class="info-cell span2">
      <div class="lbl">Customer</div>
      <div class="val">${allCustomers.length > 0 ? esc(allCustomers.join(' / ')) : '—'}${picklist.city ? `<br><span class="sub">${esc(picklist.city)}</span>` : ''}</div>
    </div>
  </div>
  <div class="summary-bar">
    <div class="sum-card sc-teal"><div class="num">${totalLines}</div><div class="lbl">Total Lines</div></div>
    <div class="sum-card sc-blue"><div class="num">${numFmt(totalQty)}</div><div class="lbl">Total Qty</div></div>
    <div class="sum-card sc-gray"><div class="num">${numFmt(totalPlt)}</div><div class="lbl">Total Pallet</div></div>
  </div>
  <div class="section-title">📦 Items to Pick</div>
  <table>
    <thead><tr>
      <th class="c" style="width:24px">No.</th><th>Product</th><th>Customer</th><th>SO / OD No.</th><th>Batch</th><th>Lokasi</th>
      <th class="r" style="width:38px">Qty Order</th><th class="r" style="width:32px">Plt</th><th class="r" style="width:54px">Actual Qty</th><th class="c" style="width:28px">Pick ✓</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr>
      <td colspan="6" style="text-align:right;padding-right:10px">TOTAL</td>
      <td class="r">${numFmt(totalQty)}</td>
      <td class="r" style="color:#546e7a">${numFmt(totalPlt)}</td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>
  <div class="remarks-box"><div class="remarks-lbl">Catatan Picking</div><div style="font-size:8.5pt;color:#546e7a;min-height:16px">${esc(notes)}</div></div>
  <div class="sig-grid">
    <div class="sig-box"><div class="sig-role">Picker / Petugas</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">( ......................... )</div></div>
    <div class="sig-box"><div class="sig-role">Checker / Verifier</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">( ......................... )</div></div>
    <div class="sig-box"><div class="sig-role">Supervisor</div><div class="sig-space"></div><div class="sig-line"></div><div class="sig-name">( ......................... )</div></div>
  </div>
  <div class="doc-footer"><span>K-one</span><span>Dicetak: ${nowPrint()} WIB</span><span>${esc(picklistNo)}</span></div>
</div>`;
        return pageShell(`Pick List - ${picklistNo}`, body);
    }
    async reportPrint(type, date, dateTo) {
        const reportType = type === 'stock' || type === 'expiring' ? type : 'daily';
        const rDate = date || new Date().toISOString().slice(0, 10);
        const rDateTo = dateTo && dateTo >= rDate ? dateTo : rDate;
        const report = reportType === 'daily' ? await this.report.dailyReport(rDate, rDateTo) : null;
        const stock = reportType === 'stock' ? await this.stockAllInternal() : null;
        const expiring = reportType === 'expiring' ? await this.expiringInternal() : null;
        const reportTitles = {
            daily: `Daily Report — ${fmtLong(rDate)}`,
            stock: 'Stock Summary Report',
            expiring: 'Expiring Items Report (Next 365 Days)',
        };
        const reportTitle = reportTitles[reportType] ?? 'Report';
        const themeColors = {
            daily: ['#026766', '#e3f2fd', '#014f4e'],
            stock: ['#013d3c', '#e8f5e9', '#026766'],
            expiring: ['#014f4e', '#fce4ec', '#014f4e'],
        };
        const [accent, lightBg, darkAccent] = themeColors[reportType];
        let inner = '';
        if (reportType === 'daily' && report) {
            const ls = report.ledger_summary ?? {};
            inner = `<div class="summary-row">
        <div class="sum-card sc-in"><div class="num">${numFmt(ls.qty_in ?? ls.drums_in ?? 0)}</div><div class="lbl">Qty In</div></div>
        <div class="sum-card sc-out"><div class="num">${numFmt(ls.qty_out ?? ls.drums_out ?? 0)}</div><div class="lbl">Qty Out</div></div>
        <div class="sum-card sc-trx"><div class="num">${numFmt((ls.transactions_in ?? 0) + (ls.transactions_out ?? 0))}</div><div class="lbl">Transaksi</div></div>
        <div class="sum-card sc-exp"><div class="num">${(report.expiring_items ?? []).length}</div><div class="lbl">Near Expiry</div></div>
      </div>
      <div class="sec-title">📦 Stock Summary</div>
      <table>
        <thead><tr><th>Product Code</th><th>Product Name</th><th class="c">Batches</th><th class="c">UOM</th><th class="r">Qty</th><th class="r">Pallets</th><th>Nearest Expiry</th></tr></thead>
        <tbody>${(report.stock_summary ?? []).map((item) => `<tr>
          <td class="mono">${esc(item.product_code)}</td>
          <td style="font-weight:500">${esc(item.product_name)}</td>
          <td class="c">${item.batches}</td>
          <td class="c"><span class="uom-badge uom-${String(item.uom_type ?? 'Drum').toLowerCase()}">${esc(item.uom_type ?? 'Drum')}</span></td>
          <td class="r">${numFmt(item.total_drums ?? item.total_qty ?? 0)}</td>
          <td class="r">${Math.ceil(Number(item.total_pallets))}</td>
          <td>${item.nearest_expiry ? fmtLong(item.nearest_expiry) : '—'}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td colspan="4"><strong>TOTAL</strong></td>
          <td class="r">${numFmt((report.stock_summary ?? []).reduce((s, it) => s + Number(it.total_drums ?? it.total_qty ?? 0), 0))}</td>
          <td class="r">${Math.ceil((report.stock_summary ?? []).reduce((s, it) => s + Number(it.total_pallets ?? 0), 0))}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
            if (report.inbound_activity?.length) {
                inner += `<div class="sec-title">📥 Inbound Activity</div>
        <table>
          <thead><tr><th>Inbound #</th><th>Status</th><th class="r">Lines</th><th class="r">Total Qty</th></tr></thead>
          <tbody>${report.inbound_activity.map((item) => {
                    const st = String(item.status ?? '');
                    const sc = st.includes('Complet') ? 'act-completed' : st.includes('Dues') ? 'act-dues' : 'act-default';
                    return `<tr><td class="mono">${esc(item.order_number ?? item.inbound_number ?? '—')}</td><td><span class="act-badge ${sc}">${esc(item.status)}</span></td><td class="r">${item.item_count}</td><td class="r">${numFmt(item.total_drums ?? item.total_qty ?? 0)}</td></tr>`;
                }).join('')}</tbody>
        </table>`;
            }
            if (report.outbound_activity?.length) {
                inner += `<div class="sec-title">📤 Outbound Activity</div>
        <table>
          <thead><tr><th>Outbound #</th><th>Status</th><th class="r">Lines</th><th class="r">Total Qty</th></tr></thead>
          <tbody>${report.outbound_activity.map((item) => {
                    const st = String(item.status ?? '');
                    const sc = st.includes('Complet') || st.includes('Ship') ? 'act-completed' : 'act-default';
                    return `<tr><td class="mono">${esc(item.outbound_number ?? item.order_number ?? '—')}</td><td><span class="act-badge ${sc}">${esc(item.status)}</span></td><td class="r">${item.item_count}</td><td class="r">${numFmt(item.total_drums ?? item.total_qty ?? 0)}</td></tr>`;
                }).join('')}</tbody>
        </table>`;
            }
            if (report.expiring_items?.length) {
                inner += `<div class="sec-title">⚠️ Expiring Items (Within 90 Days)</div>
        <table>
          <thead><tr><th>Product</th><th>Batch</th><th>Expiry Date</th><th class="r">Days Left</th><th class="r">Qty</th></tr></thead>
          <tbody>${report.expiring_items.map((item) => {
                    const d = Number(item.days_until_expiry);
                    const cls = d < 30 ? 'exp-crit' : d < 90 ? 'exp-warn' : 'exp-ok';
                    return `<tr>
              <td><div style="font-weight:500">${esc(item.product_name)}</div><div class="mono">${esc(item.product_code)}</div></td>
              <td class="mono">${esc(item.batch_number)}</td>
              <td>${fmtLong(item.expiry_date)}</td>
              <td class="r"><span class="${cls}">${d} hari</span></td>
              <td class="r">${numFmt(item.quantity_in ?? item.quantity_drums ?? 0)}</td>
            </tr>`;
                }).join('')}</tbody>
        </table>`;
            }
        }
        else if (reportType === 'stock' && stock !== null) {
            inner = `<div class="sec-title">📦 Detail Stock per Batch</div>
      <table>
        <thead><tr><th>Product</th><th>Batch</th><th class="c">UOM</th><th class="r">Qty</th><th class="r">Pallets</th><th>Expiry</th><th>Lokasi</th><th class="c">Status</th></tr></thead>
        <tbody>${stock.map((item) => {
                const uom = item.uom_type ?? item.uom ?? 'Drum';
                const expDate = item.expiry_date ?? null;
                const isExpWarn = monthsAgo3(expDate);
                const ss = item.stock_status ?? '';
                return `<tr>
            <td><div style="font-weight:500;font-size:8.5pt">${esc(item.product_name)}</div><div class="mono">${esc(item.product_code)}</div></td>
            <td class="mono">${esc(item.batch_number ?? '—')}</td>
            <td class="c"><span class="uom-badge uom-${String(uom).toLowerCase()}">${esc(uom)}</span></td>
            <td class="r">${numFmt(item.quantity_in ?? item.quantity_drums ?? 0)}</td>
            <td class="r">${Math.ceil(Number(item.pallet ?? 0))}</td>
            <td class="${isExpWarn ? 'exp-crit' : ''}">${expDate ? fmtLong(expDate) : '—'}</td>
            <td class="mono" style="font-size:8pt">${esc(item.location ?? '—')}</td>
            <td class="c"><span class="act-badge ${ss === 'Accepted' || ss === '' ? 'act-completed' : 'act-dues'}">${ss ? esc(ss) : 'OK'}</span></td>
          </tr>`;
            }).join('')}</tbody>
        <tfoot><tr>
          <td colspan="3"><strong>TOTAL</strong></td>
          <td class="r">${numFmt(stock.reduce((s, it) => s + Number(it.quantity_in ?? it.quantity_drums ?? 0), 0))}</td>
          <td class="r">${Math.ceil(stock.reduce((s, it) => s + Number(it.pallet ?? 0), 0))}</td>
          <td colspan="3"></td>
        </tr></tfoot>
      </table>`;
        }
        else if (reportType === 'expiring' && expiring !== null) {
            const crit = expiring.filter((i) => Number(i.days_until_expiry) < 30);
            const warn = expiring.filter((i) => Number(i.days_until_expiry) >= 30 && Number(i.days_until_expiry) < 90);
            const later = expiring.filter((i) => Number(i.days_until_expiry) >= 90);
            inner = `<div class="summary-row">
        <div class="sum-card sc-out"><div class="num">${crit.length}</div><div class="lbl">Critical &lt;30 days</div></div>
        <div class="sum-card sc-exp"><div class="num">${warn.length}</div><div class="lbl">Warning 30-90 days</div></div>
        <div class="sum-card sc-in"><div class="num">${later.length}</div><div class="lbl">OK &gt;90 days</div></div>
        <div class="sum-card sc-trx"><div class="num">${expiring.length}</div><div class="lbl">Total Batches</div></div>
      </div>
      <div class="sec-title">⚠️ Daftar Item Mendekati Kadaluarsa</div>
      <table>
        <thead><tr><th>Product</th><th>Batch</th><th>Expiry Date</th><th class="r">Sisa Hari</th><th class="r">Qty</th><th>Lokasi</th></tr></thead>
        <tbody>${expiring.map((item) => {
                const d = Number(item.days_until_expiry);
                const cls = d < 30 ? 'exp-crit' : d < 90 ? 'exp-warn' : 'exp-ok';
                return `<tr>
            <td><div style="font-weight:500">${esc(item.product_name)}</div><div class="mono">${esc(item.product_code)}</div></td>
            <td class="mono">${esc(item.batch_number)}</td>
            <td>${fmtLong(item.expiry_date)}</td>
            <td class="r"><span class="${cls}">${d} hari</span></td>
            <td class="r">${numFmt(item.quantity_in ?? item.quantity_drums ?? 0)}</td>
            <td class="mono">${esc(item.location ?? '—')}</td>
          </tr>`;
            }).join('')}</tbody>
      </table>`;
        }
        const body = `<div class="print-bar no-print">
  <div class="left"><span class="title">📊 Report Preview</span><span class="badge">${reportType.toUpperCase()}</span></div>
  <div class="btns"><button class="btn-print" onclick="window.print()">🖨️ Print / Simpan PDF</button></div>
</div>
<div class="document">
  <div class="doc-header">
    <div class="hdr-left">
      <div class="hdr-logo">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="12" width="4" height="9" rx="1" fill="rgba(255,255,255,0.55)"/>
          <rect x="10" y="7"  width="4" height="14" rx="1" fill="rgba(255,255,255,0.8)"/>
          <rect x="17" y="3"  width="4" height="18" rx="1" fill="white"/>
          <line x1="3" y1="22" x2="21" y2="22" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="hdr-company"><div class="name"><span class="nk">K</span><span class="none">-one</span></div></div>
    </div>
    <div class="hdr-right">
      <div class="report-type">${reportType === 'daily' ? 'DAILY REPORT' : reportType === 'stock' ? 'STOCK SUMMARY' : 'EXPIRY REPORT'}</div>
      <div class="report-sub">K-one Management</div>
      <div class="report-date">📅 ${esc(reportTitle)}</div>
    </div>
  </div>
  ${inner}
  <div class="doc-footer">
    <div class="watermark-row"><div class="watermark-dot"></div><span>K-one</span></div>
    <span>Dicetak: ${nowPrint()} WIB</span>
    <span>${esc(reportTitle)}</span>
  </div>
</div>`;
        return pageShell(`${reportTitle} — Shell CKB WMS`, body);
    }
    async stockAllInternal() {
        return this.report.reportStock();
    }
    async expiringInternal() {
        const r = await this.db.query(`SELECT s.*, p.product_code, p.product_name,
              (s.expiry_date - CURRENT_DATE)::int as days_until_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '365 days'
       AND s.quantity > 0 AND s.stock_status = 'Available'
       ORDER BY s.expiry_date ASC`);
        return r.rows;
    }
};
exports.PrintService = PrintService;
exports.PrintService = PrintService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        inbound_service_1.InboundService,
        outbound_service_1.OutboundService,
        picklist_service_1.PicklistService,
        report_service_1.ReportService])
], PrintService);
//# sourceMappingURL=print.service.js.map