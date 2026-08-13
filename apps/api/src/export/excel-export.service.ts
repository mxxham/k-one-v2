/**
 * Excel (.xlsx) report exports mirroring the legacy PHP pages:
 *  - inbound.php?export=1            -> ExcelExport::exportInbound
 *  - outbound.php?export=1           -> ExcelExport::exportOutbound
 *  - customers.php?export=excel      -> ExcelExport::exportCustomers
 *  - products.php?export=excel       -> ExcelExport::exportProducts
 *  - ledger.php?export=excel         -> inline PhpSpreadsheet ledger export
 *  - reports.php?export=excel        -> exportDailyReport / exportExpiringItems / exportStock
 * Uses ExcelJS (same as import templates).
 */
import * as ExcelJS from 'exceljs';
import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { InboundService } from '../inbound/inbound.service';
import { OutboundService } from '../outbound/outbound.service';
import { ReportService } from '../report/report.service';
import { StockTakeService } from '../stocktake/stocktake.service';
import { ApiException } from '../common/api-exception';
import { todayStr } from '../common/date-util';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** PHP number_format($v, 0) */
function nf(v: unknown): string {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(d: unknown): string {
  if (!d) return '';
  const s = String(d);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtDateLong(d: unknown): string {
  if (!d) return '';
  const s = String(d);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function nowStamp(): string {
  return todayStr().replace(/-/g, '') + '_' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
}

function daysLeft(expDate: unknown): number | '' {
  if (!expDate) return '';
  const s = String(expDate);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return '';
  const expiryUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((expiryUtc - todayUtc) / 86400000);
}

/** stock.php calcExpiry() parity (expiry status + human-readable label). */
function calcExpiry(expiryDate: unknown): { days_left: number | null; is_expired: boolean; is_critical: boolean; is_warning: boolean; is_safe: boolean; display_text: string } {
  if (!expiryDate) {
    return { days_left: null, is_expired: false, is_critical: false, is_warning: false, is_safe: true, display_text: 'No Expiry' };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expiryDate));
  if (!m) return { days_left: null, is_expired: false, is_critical: false, is_warning: false, is_safe: true, display_text: 'No Expiry' };

  const expiryUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeftV = Math.floor((expiryUtc - todayUtc) / 86400000);

  const isExpired = daysLeftV < 0;
  const isCritical = !isExpired && daysLeftV <= 120;
  const isWarning = !isExpired && !isCritical && daysLeftV <= 365;
  const isSafe = !isExpired && !isCritical && !isWarning;

  let displayText: string;
  if (isExpired) {
    displayText = 'EXPIRED';
  } else if (daysLeftV === 0) {
    displayText = 'Expires Today!';
  } else if (daysLeftV <= 30) {
    displayText = `${daysLeftV} day${daysLeftV > 1 ? 's' : ''} left`;
  } else {
    const e = new Date(expiryUtc);
    const t = new Date(todayUtc);
    let months = (e.getUTCFullYear() - t.getUTCFullYear()) * 12 + (e.getUTCMonth() - t.getUTCMonth());
    let days = e.getUTCDate() - t.getUTCDate();
    if (days < 0) {
      months--;
      const prevMonthEnd = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate();
      days += prevMonthEnd;
    }
    if (months > 0 && days > 0) displayText = `${months} mo ${days} d left`;
    else if (months > 0) displayText = `${months} month${months > 1 ? 's' : ''} left`;
    else displayText = `${days} day${days > 1 ? 's' : ''} left`;
  }

  return { days_left: daysLeftV, is_expired: isExpired, is_critical: isCritical, is_warning: isWarning, is_safe: isSafe, display_text: displayText };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const },
  };
}

@Injectable()
export class ExcelExportService {
  constructor(
    private readonly db: DbService,
    private readonly inbound: InboundService,
    private readonly outbound: OutboundService,
    private readonly report: ReportService,
    private readonly stocktake: StockTakeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Inbound report (inbound.php?export=1)
  // ---------------------------------------------------------------------------
  async inboundReport(status: string | null): Promise<ExportFile> {
    const orders = await this.inbound.getAll(status, 2000, 0, null);
    if (orders.length === 0) throw ApiException.badRequest('Tidak ada data inbound untuk di-export.');

    const orderIds = orders.map((o) => Number(o.id));
    const r = await this.db.query(
      `SELECT ii.*,
              COALESCE(ii.batch_number, ii.batch_no) AS resolved_batch,
              p.product_code, p.product_name,
              io.shipment_no, io.order_number, io.po_number, io.do_number,
              io.container_no, io.armada_no, io.received_date,
              io.status AS order_status,
              io.carrier_name
       FROM inbound_items ii
       JOIN products p ON ii.product_id = p.id
       JOIN inbound_orders io ON ii.inbound_order_id = io.id
       WHERE ii.inbound_order_id = ANY($1)
       ORDER BY io.id, ii.id`,
      [orderIds],
    );
    const items = r.rows;
    const totalOrders = orders.length;
    const totalItems = items.length;

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Inbound Report');
    const headerColor = '013D3C';
    const subColor = '026766';

    const headers = [
      'No', 'Shipment No', 'OD Number', 'Received Date', 'Carrier', 'Container No', 'Armada No',
      'Product Code', 'Product Name', 'Batch No', 'Qty', 'UOM', 'Pallet', 'Mfg. Date', 'Exp. Date',
      'Sisa Hari', 'In Process Status', 'Stock Status', 'Location', 'Order Status', 'Notes',
    ];
    const totalCols = headers.length;
    const lastCol = colLetter(totalCols);

    sheet.mergeCells(`A1:${lastCol}1`);
    sheet.getCell('A1').value = `K-one — Inbound Report   |   Dicetak: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} WIB   |   ${totalOrders} order, ${totalItems} item`;
    sheet.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerColor}` } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 24;

    headers.forEach((h, c) => {
      const cell = sheet.getCell(2, c + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${subColor}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
    });
    sheet.getRow(2).height = 20;
    sheet.views = [{ state: 'frozen', ySplit: 2 }];

    let row = 3;
    let shipmentNo = 0;
    let lastShipment: string | null = null;
    for (const item of items) {
      const qty = Number(item.actual_qty ?? item.quantity ?? 0);
      const pallet = Number(item.pallet ?? 0);
      const expDate = item.exp_date ?? null;
      const mfgDate = item.manufacture_date ?? null;
      const dl = daysLeft(expDate);

      const currentShipment = item.shipment_no ?? '';
      const isNewShipment = currentShipment !== lastShipment;
      if (isNewShipment) {
        shipmentNo++;
        lastShipment = currentShipment;
      }

      const rowData = [
        isNewShipment ? shipmentNo : '',
        item.shipment_no ?? '',
        item.od_number ?? '',
        item.received_date ? String(item.received_date).slice(0, 10).split('-').reverse().join('/') : '',
        item.carrier_name ?? '',
        item.container_no ?? '',
        item.armada_no ?? '',
        item.product_code ?? '',
        item.product_name ?? '',
        item.resolved_batch ?? '',
        qty,
        item.uom ?? '',
        pallet > 0 ? pallet : '',
        mfgDate ? String(mfgDate).slice(0, 10).split('-').reverse().join('/') : '',
        expDate ? String(expDate).slice(0, 10).split('-').reverse().join('/') : '',
        dl,
        item.in_process_status ?? '',
        item.stock_status ?? '',
        item.location ?? '',
        item.order_status ?? '',
        item.notes ?? '',
      ];
      rowData.forEach((v, c) => {
        const cell = sheet.getCell(row, c + 1);
        cell.value = v as any;
        cell.border = thinBorder();
        cell.font = { size: 9 };
        if (c === 2) cell.alignment = { horizontal: 'center' };
      });

      // In Process Status color
      const inpCell = sheet.getCell(row, 18);
      const inpValue = String(item.in_process_status ?? '');
      if (inpValue === 'ATP') inpCell.font = { ...(inpCell.font as any), color: { argb: 'FF166534' } };
      else if (inpValue === 'Dues In') inpCell.font = { ...(inpCell.font as any), color: { argb: 'FF1E40AF' } };
      else if (inpValue === 'Unserviceable') inpCell.font = { ...(inpCell.font as any), color: { argb: 'FF991B1B' } };

      if (dl !== '') {
        const dayCell = sheet.getCell(row, 17);
        if (dl < 0) dayCell.font = { ...(dayCell.font as any), color: { argb: 'FF991B1B' } };
        else if (dl <= 90) dayCell.font = { ...(dayCell.font as any), color: { argb: 'FF92400E' } };
      }

      row++;
    }

    sheet.getCell(`A${row}`).value = 'TOTAL';
    sheet.getCell(colLetter(12) + row).value = items.reduce((s, it) => s + Number(it.actual_qty ?? it.quantity ?? 0), 0);
    const totalRange = `A${row}:${lastCol}${row}`;
    for (let c = 1; c <= totalCols; c++) {
      sheet.getCell(row, c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerColor}` } };
    }
    void totalRange;

    for (let c = 1; c <= totalCols; c++) sheet.getColumn(c).width = c === 9 ? 26 : 14;

    return { buffer: await toBuffer(wb), filename: `Inbound_Report_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Outbound export (outbound.php?export=1)
  // ---------------------------------------------------------------------------
  async outboundReport(status: string | null): Promise<ExportFile> {
    const orders = await this.outbound.getAll(status, 2000, 0, null);
    if (orders.length === 0) throw ApiException.badRequest('Tidak ada data outbound untuk di-export.');

    const orderIds = orders.map((o) => Number(o.id));
    const r = await this.db.query(
      `SELECT oi.*,
              COALESCE(oi.batch_number, oi.batch_no) AS resolved_batch,
              p.product_code, p.product_name,
              COALESCE(p.liters_per_unit, 0) AS liters_per_unit,
              o.order_number, o.shipment_number,
              o.so_number AS order_so,
              o.order_date, o.expected_date, o.shipped_date,
              o.armada_no, o.container_no, o.jenis_armada,
              o.status AS order_status,
              COALESCE(ci.customer_name, co.customer_name) AS customer_name,
              COALESCE(ci.customer_code, co.customer_code) AS customer_code,
              COALESCE(ci.city, co.city) AS customer_city,
              COALESCE(NULLIF(od.ship_to_name,''), NULLIF(ci.customer_name,''), NULLIF(co.customer_name,'')) AS dest_name,
              COALESCE(NULLIF(od.ship_to_location,''), NULLIF(od.kota,''), NULLIF(ci.city,''), NULLIF(co.city,'')) AS dest_location,
              NULLIF(od.ship_to_street,'') AS dest_street,
              COALESCE(od.seq, 0) AS dest_seq
       FROM outbound_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN outbound_orders o ON oi.outbound_order_id = o.id
       LEFT JOIN customers co ON o.customer_id = co.id
       LEFT JOIN customers ci ON oi.customer_id = ci.id
       LEFT JOIN outbound_destinations od ON oi.destination_id = od.id
       WHERE oi.outbound_order_id = ANY($1)
       ORDER BY o.order_date ASC, o.id ASC, COALESCE(od.seq,0) ASC, oi.id ASC`,
      [orderIds],
    );
    const allItems = r.rows;

    const groups: Record<string, any[]> = {};
    for (const item of allItems) {
      const k = String(item.outbound_order_id);
      if (!groups[k]) groups[k] = [];
      groups[k].push(item);
    }

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Outbound Report');
    const colDark = '013D3C';
    const colMid = '026766';
    const colTotal = '014F4E';
    const colLight = 'E6F4F4';

    const headers = [
      'NO', 'Shipment Number', 'Order No (OD)', 'Ship-to Party', 'Material', 'Description',
      'Delivery Quantity', 'Sales Unit', 'Name of Ship-To Party', 'Customer',
      'Location of Ship-To Party', 'Street / Address', 'Goods Issue Date', 'SO Number',
      'TRANSPORT', 'Volume (L)', 'Batch No', 'Exp. Date', 'Sisa Hari', 'Pallet',
      'Type Truck', 'Container No', 'Warehouse Location', 'Status', 'KET',
    ];
    const totalCols = headers.length;
    const lastCol = colLetter(totalCols);

    sheet.mergeCells(`A1:${lastCol}1`);
    sheet.getCell('A1').value = `K-one — Outbound Export   |   Dicetak: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} WIB`;
    sheet.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colDark}` } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 26;
    sheet.getRow(2).height = 4;

    sheet.mergeCells(`A3:${lastCol}3`);
    sheet.getCell('A3').value = `${Object.keys(groups).length} shipment   |   ${allItems.length} item   |   Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    sheet.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF555555' } };
    sheet.getCell('A3').alignment = { horizontal: 'right' };

    headers.forEach((h, c) => {
      const cell = sheet.getCell(4, c + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colMid}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder();
    });
    sheet.getRow(4).height = 28;
    sheet.views = [{ state: 'frozen', ySplit: 4 }];

    let row = 5;
    let shipmentNo = 0;
    for (const orderId of Object.keys(groups)) {
      const items = groups[orderId];
      shipmentNo++;
      const first = items[0];
      let groupQty = 0;
      let groupVolume = 0;

      items.forEach((item, idx) => {
        const qty = Number(item.actual_qty ?? item.quantity ?? 0);
        const litres = Number(item.liters_per_unit ?? 0);
        const volume = qty * litres;
        const expDate = item.exp_date ?? null;
        const dl = daysLeft(expDate);
        groupQty += qty;
        groupVolume += volume;

        const giDate = item.shipped_date ? item.shipped_date : (item.expected_date ?? null);
        const rowData: Record<number, any> = {
          1: idx === 0 ? shipmentNo : '',
          2: item.shipment_number ?? item.order_number ?? '',
          3: item.od_number ?? '',
          4: item.dest_name ?? item.customer_name ?? '',
          5: item.product_code ?? '',
          6: item.product_name ?? '',
          7: qty,
          8: item.uom ?? '',
          9: item.dest_name ?? '',
          10: String(
            ((item.customer_id ?? '') !== '' ? `ID ${item.customer_id} | ` : '') +
            String(item.customer_name ?? '') +
            ((item.customer_code ?? '') !== '' ? ` (${item.customer_code})` : ''),
          ),
          11: item.dest_location ?? '',
          12: item.dest_street ?? '',
          13: giDate ? String(giDate).slice(0, 10) : '',
          14: item.so_number ?? item.order_so ?? '',
          15: item.armada_no ?? '',
          16: volume > 0 ? Math.round(volume * 100) / 100 : '',
          17: item.resolved_batch ?? '',
          18: expDate ? String(expDate).slice(0, 10).split('-').reverse().join('/') : '',
          19: dl,
          20: Number(item.pallet ?? 0) > 0 ? Number(item.pallet) : '',
          21: item.jenis_armada ?? '',
          22: item.container_no ?? '',
          23: item.location ?? '',
          24: item.order_status ?? '',
          25: item.notes ?? '',
        };
        for (let c = 1; c <= totalCols; c++) {
          const cell = sheet.getCell(row, c);
          cell.value = rowData[c] ?? '';
          cell.border = thinBorder();
          cell.font = { size: 9 };
        }

        if (dl !== '') {
          const dayCell = sheet.getCell(row, 19);
          if (dl < 0) dayCell.font = { ...(dayCell.font as any), color: { argb: 'FF991B1B' } };
          else if (dl <= 90) dayCell.font = { ...(dayCell.font as any), color: { argb: 'FF92400E' } };
          else dayCell.font = { ...(dayCell.font as any), color: { argb: 'FF166534' } };
        }

        row++;
      });

      sheet.getCell(`A${row}`).value = 'TOTAL';
      sheet.getCell(colLetter(7) + row).value = groupQty;
      if (groupVolume > 0) sheet.getCell(colLetter(16) + row).value = Math.round(groupVolume * 100) / 100;
      for (let c = 1; c <= totalCols; c++) {
        const cell = sheet.getCell(row, c);
        cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colTotal}` } };
        cell.border = thinBorder();
      }
      sheet.getCell(`A${row}`).alignment = { horizontal: 'left' };
      row++;
      row++;
    }

    const colWidths: Record<number, number> = {
      1: 5, 2: 18, 3: 14, 4: 14, 5: 16, 6: 36, 7: 12, 8: 10, 9: 28, 10: 22,
      11: 22, 12: 30, 13: 14, 14: 22, 15: 12, 16: 12, 17: 16, 18: 12, 19: 10,
      20: 8, 21: 12, 22: 16, 23: 14, 24: 14, 25: 28,
    };
    for (const [c, w] of Object.entries(colWidths)) {
      sheet.getColumn(Number(c)).width = w;
    }
    for (const c of [1, 7, 8, 16, 19, 20]) {
      for (let rr = 5; rr <= row; rr++) {
        const cell = sheet.getCell(rr, c);
        cell.alignment = { horizontal: 'center' };
      }
    }

    return { buffer: await toBuffer(wb), filename: `Outbound_Export_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Customers (customers.php?export=excel)
  // ---------------------------------------------------------------------------
  async customersReport(): Promise<ExportFile> {
    const r = await this.db.query('SELECT * FROM customers ORDER BY customer_name');
    const data = r.rows;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Customers');
    ws.getCell('A1').value = 'K-one - Customers - Shell CKB';
    ws.getCell('A1').font = { bold: true, size: 16 };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells('A1:F1');
    ws.getCell('A2').value = 'Generated on: ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ws.getCell('A2').font = { italic: true, size: 10 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    const headers = ['Customer Code', 'Customer Name', 'Contact Person', 'Phone', 'Email', 'Address'];
    headers.forEach((h, c) => {
      const cell = ws.getCell(3, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = thinBorder();
    });
    data.forEach((item, i) => {
      const row = 4 + i;
      const vals = [item.customer_code, item.customer_name, item.contact_person ?? '-', item.phone ?? '-', item.email ?? '-', item.address ?? '-'];
      vals.forEach((v, c) => {
        const cell = ws.getCell(row, c + 1);
        cell.value = v;
        cell.border = thinBorder();
      });
      if (i % 2 === 0) {
        for (let c = 1; c <= 6; c++) ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      }
    });
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = 22;

    return { buffer: await toBuffer(wb), filename: `Customers_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Products (products.php?export=excel)
  // ---------------------------------------------------------------------------
  async productsReport(): Promise<ExportFile> {
    const data = await this.report.reportProducts();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.getCell('A1').value = 'K-one - Products - Shell CKB';
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells('A1:G1');
    ws.getCell('A2').value = 'Generated on: ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ws.getCell('A2').font = { italic: true, size: 10 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    const headers = ['Product Code', 'Product Name', 'Category', 'Description', 'Drums/Pallet', 'Current Stock (Drums)', 'Current Stock (Pallets)'];
    headers.forEach((h, c) => {
      const cell = ws.getCell(3, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = thinBorder();
    });
    data.forEach((item, i) => {
      const row = 4 + i;
      const vals = [item.product_code, item.product_name, item.category ?? '-', item.description ?? '-', item.uom_per_pallet, Number(item.total_drums ?? 0), Number(Number(item.total_pallets ?? 0).toFixed(1))];
      vals.forEach((v, c) => {
        const cell = ws.getCell(row, c + 1);
        cell.value = v;
        cell.border = thinBorder();
      });
      if (i % 2 === 0) {
        for (let c = 1; c <= 7; c++) ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      }
    });
    for (let c = 1; c <= 7; c++) ws.getColumn(c).width = 24;

    return { buffer: await toBuffer(wb), filename: `Products_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Ledger (ledger.php?export=excel) — inline PhpSpreadsheet ledger export
  // ---------------------------------------------------------------------------
  async ledgerReport(): Promise<ExportFile> {
    const startDate = '2000-01-01';
    const endDate = '2099-12-31';
    const r = await this.db.query(
      `SELECT sl.*,
              p.product_code, p.product_name, p.uom_type,
              COALESCE(
                (SELECT ii_in.od_number FROM inbound_items ii_in
                  WHERE ii_in.inbound_order_id = sl.reference_id
                    AND ii_in.product_id = sl.product_id
                    AND sl.reference_type = 'Inbound'
                  ORDER BY ii_in.id LIMIT 1),
                (SELECT oi_out.od_number FROM outbound_items oi_out
                  WHERE oi_out.outbound_order_id = sl.reference_id
                    AND oi_out.product_id = sl.product_id
                    AND sl.reference_type = 'Outbound'
                  ORDER BY oi_out.id LIMIT 1),
                (SELECT ii_bt.od_number FROM inbound_items ii_bt
                  WHERE ii_bt.product_id = sl.product_id
                    AND ii_bt.batch_number IS NOT DISTINCT FROM sl.batch_number
                    AND sl.reference_type = 'BinTransfer'
                  ORDER BY ii_bt.id LIMIT 1)
              ) AS od_number,
              (SELECT ii_so.so_number FROM inbound_items ii_so
                WHERE ii_so.inbound_order_id = sl.reference_id
                  AND ii_so.product_id = sl.product_id
                  AND sl.reference_type = 'Inbound'
                ORDER BY ii_so.id LIMIT 1) AS so_number,
              io.shipment_no AS io_shipment_no,
              oo.shipment_number AS oo_shipment_no,
              (SELECT io_bt.shipment_no FROM inbound_orders io_bt
                JOIN inbound_items ii_bt2 ON ii_bt2.inbound_order_id = io_bt.id
                WHERE ii_bt2.product_id = sl.product_id
                  AND ii_bt2.batch_number IS NOT DISTINCT FROM sl.batch_number
                  AND sl.reference_type = 'BinTransfer'
                ORDER BY ii_bt2.id LIMIT 1) AS bt_shipment_no
       FROM stock_ledger sl
       JOIN products p ON sl.product_id = p.id
       LEFT JOIN inbound_orders io ON io.id = sl.reference_id AND sl.reference_type = 'Inbound'
       LEFT JOIN outbound_orders oo ON oo.id = sl.reference_id AND sl.reference_type = 'Outbound'
       WHERE sl.transaction_date >= $1 AND sl.transaction_date <= $2
       ORDER BY sl.transaction_date ASC, sl.created_at ASC`,
      [startDate, endDate],
    );
    const movements = r.rows;

    const TX_LABEL: Record<string, string> = {
      IN: 'Penerimaan',
      OUT: 'Pengiriman',
      ADJUSTMENT: 'Penyesuaian',
      TRANSFER_IN: 'Pindah Masuk',
      TRANSFER_OUT: 'Pindah Keluar',
    };

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Stock Ledger');
    const headers = ['No', 'Tanggal', 'Kode Produk', 'Nama Produk', 'Tipe', 'Label', 'Ref No', 'Ref Type', 'OD No', 'Shipment No', 'Batch', 'UOM', 'Qty Masuk', 'Qty Keluar', 'Pallet', 'Balance', 'Lokasi', 'Keterangan'];
    headers.forEach((h, c) => {
      const cell = sheet.getCell(1, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF013d3c' } };
    });

    movements.forEach((m, i) => {
      const shipNo = m.io_shipment_no ?? m.oo_shipment_no ?? m.bt_shipment_no ?? '';
      const rowData = [
        i + 1, m.transaction_date, m.product_code, m.product_name,
        m.transaction_type, TX_LABEL[m.transaction_type] ?? m.transaction_type, m.reference_number ?? '', m.reference_type ?? '',
        m.od_number ?? '', shipNo, m.batch_number ?? '', m.uom ?? '',
        m.quantity_in ?? 0, m.quantity_out ?? 0, m.pallet ?? 0, m.balance ?? 0,
        m.location ?? '', m.notes ?? '',
      ];
      const row = i + 2;
      rowData.forEach((v, c) => {
        sheet.getCell(row, c + 1).value = v as any;
      });
      const bg = m.transaction_type === 'IN' ? 'FFE8F5E9' : m.transaction_type === 'OUT' ? 'FFFCE4EC' : 'FFFFF9C4';
      for (let c = 1; c <= 18; c++) {
        sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      }
    });
    for (let c = 1; c <= 18; c++) sheet.getColumn(c).width = 18;

    return { buffer: await toBuffer(wb), filename: `Ledger_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Reports (reports.php?export=excel): type=daily|stock|expiring
  // ---------------------------------------------------------------------------
  async reportsExcel(type: string, date: string | null, dateTo: string | null): Promise<ExportFile> {
    if (type === 'stock') {
      const data = await this.report.reportStock();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Stock');
      ws.getCell('A1').value = 'K-one - Stock Report - Shell CKB';
      ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
      ws.getCell('A1').alignment = { horizontal: 'center' };
      ws.mergeCells('A1:I1');
      ws.getCell('A2').value = 'Generated on: ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      ws.getCell('A2').font = { italic: true, size: 10 };
      ws.getCell('A2').alignment = { horizontal: 'center' };
      const headers = ['Product Code', 'Product Name', 'Batch', 'Qty', 'Pallets', 'Expiry Date', 'Days Until Expiry', 'Location', 'Status'];
      headers.forEach((h, c) => {
        const cell = ws.getCell(3, c + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = thinBorder();
      });
      data.forEach((item, i) => {
        const row = 4 + i;
        const dl = daysLeft(item.expiry_date);
        const vals = [item.product_code, item.product_name, item.batch_number ?? '-', item.quantity, Number(Number(item.pallet ?? 0).toFixed(2)), item.expiry_date ? fmtDateLong(item.expiry_date) : '-', dl === '' ? '-' : dl, item.location ?? '-', item.stock_status ?? ''];
        vals.forEach((v, c) => {
          const cell = ws.getCell(row, c + 1);
          cell.value = v;
          cell.border = thinBorder();
        });
      });
      for (let c = 1; c <= 9; c++) ws.getColumn(c).width = 20;
      return { buffer: await toBuffer(wb), filename: `Stock_Report_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
    }

    if (type === 'expiring') {
      const data = await this.expiring365();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Expiring');
      ws.getCell('A1').value = 'K-one - Expiring Items Alert - Shell CKB';
      ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
      ws.getCell('A1').alignment = { horizontal: 'center' };
      ws.mergeCells('A1:G1');
      ws.getCell('A2').value = 'Generated on: ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      ws.getCell('A2').font = { italic: true, size: 10 };
      ws.getCell('A2').alignment = { horizontal: 'center' };
      const headers = ['Product', 'Batch', 'Expiry Date', 'Days Left', 'Qty', 'Pallets', 'Location'];
      headers.forEach((h, c) => {
        const cell = ws.getCell(3, c + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = thinBorder();
      });
      data.forEach((item, i) => {
        const row = 4 + i;
        const vals = [`${item.product_code} - ${item.product_name}`, item.batch_number, fmtDateLong(item.expiry_date), item.days_until_expiry, item.quantity, Number(Number(item.pallet ?? 0).toFixed(2)), item.location ?? '-'];
        vals.forEach((v, c) => {
          const cell = ws.getCell(row, c + 1);
          cell.value = v;
          cell.border = thinBorder();
        });
      });
      for (let c = 1; c <= 7; c++) ws.getColumn(c).width = 22;
      return { buffer: await toBuffer(wb), filename: `Expiring_Items_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
    }

    // daily
    const report = await this.report.dailyReport(date, dateTo);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Daily Report');
    ws.getCell('A1').value = 'K-one - Daily Report - Shell CKB';
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells('A1:F1');
    ws.getCell('A2').value = 'Report Date: ' + fmtDateLong(report.date);
    ws.getCell('A2').font = { italic: true, size: 10 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    const headers = ['Product Code', 'Product Name', 'Batches', 'Qty', 'Pallets', 'Nearest Expiry'];
    headers.forEach((h, c) => {
      const cell = ws.getCell(3, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = thinBorder();
    });
    (report.stock_summary ?? []).forEach((item: any, i: number) => {
      const row = 4 + i;
      const vals = [item.product_code, item.product_name, item.batches, Number(item.total_drums ?? item.total_qty ?? 0), Number(Number(item.total_pallets ?? 0).toFixed(1)), item.nearest_expiry ? fmtDateLong(item.nearest_expiry) : '-'];
      vals.forEach((v, c) => {
        const cell = ws.getCell(row, c + 1);
        cell.value = v;
        cell.border = thinBorder();
      });
    });
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = 22;

    return { buffer: await toBuffer(wb), filename: `Daily_Report_${String(report.date).replace(/-/g, '')}.xlsx`, contentType: XLSX_TYPE };
  }

  /** Stock::getExpiringSoon(365) parity. */
  async expiring365(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT s.*, p.product_code, p.product_name, p.uom_per_pallet,
              (s.expiry_date - CURRENT_DATE)::int as days_until_expiry
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '365 days'
       AND s.quantity > 0 AND s.stock_status = 'Available'
       ORDER BY s.expiry_date ASC`,
    );
    return r.rows;
  }

  /** Stock::getAll parity. */
  async stockAll(): Promise<any[]> {
    return this.report.reportStock();
  }

  // ---------------------------------------------------------------------------
  // Stock per location (stock.php?export=excel)
  // ---------------------------------------------------------------------------
  async stockReport(): Promise<ExportFile> {
    const r = await this.db.query(
      `SELECT p.id AS product_id, p.product_code, p.product_name, p.category,
              p.uom_type, p.uom_per_pallet, p.liters_per_unit,
              s.id AS stock_id, s.batch_number,
              COALESCE(
                (SELECT ii_exp.exp_date
                 FROM stock_locations sl_exp
                 JOIN inbound_items ii_exp ON ii_exp.id = sl_exp.inbound_item_id
                 WHERE sl_exp.stock_id = s.id
                 ORDER BY ii_exp.id DESC
                 LIMIT 1),
                s.expiry_date
              ) AS expiry_date,
              s.stock_status, s.uom,
              COALESCE(s.location,'') AS location,
              s.quantity,
              CEIL(s.quantity / GREATEST(COALESCE(p.uom_per_pallet, 1), 1)) AS pallet,
              (SELECT string_agg(DISTINCT ii_s.od_number, ', ' ORDER BY ii_s.od_number)
               FROM stock_locations sl_s
               JOIN inbound_items ii_s ON ii_s.id = sl_s.inbound_item_id
               WHERE sl_s.stock_id = s.id) AS od_numbers,
              (SELECT string_agg(DISTINCT io_s.shipment_no, ', ' ORDER BY io_s.shipment_no)
               FROM stock_locations sl_s2
               JOIN inbound_items ii_s2 ON ii_s2.id = sl_s2.inbound_item_id
               JOIN inbound_orders io_s ON io_s.id = ii_s2.inbound_order_id
               WHERE sl_s2.stock_id = s.id) AS shipment_nos
       FROM stock s
       JOIN products p ON s.product_id = p.id
       WHERE s.quantity > 0
       ORDER BY p.product_name, s.batch_number, s.location`,
    );
    const rows = r.rows;

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Stock Per Lokasi');
    const headers = ['No', 'Product Code', 'Product Name', 'Category', 'UOM', 'Batch', 'OD No', 'Shipment No', 'Location', 'Quantity', 'Pallet', 'Liters (L)', 'Expiry Date', 'Days Left', 'Sisa Waktu', 'Status'];
    headers.forEach((h, c) => {
      const cell = sheet.getCell(1, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11998E' } };
    });

    let row = 2;
    let productNo = 0;
    let lastProductCode: string | null = null;
    let totalQtyExp = 0;
    let totalPalletExp = 0;
    for (const item of rows) {
      const info = calcExpiry(item.expiry_date);
      const qty = Number(item.quantity ?? 0);
      const liters = qty * Number(item.liters_per_unit ?? 209);
      let expPlt = Number(item.pallet ?? 0);
      if (expPlt <= 0) expPlt = Math.ceil(qty / Math.max(1, Number(item.uom_per_pallet ?? 4)));
      const locDisplay = String(item.location ?? '') !== '' ? item.location : 'UNALLOCATED';

      const isNewProduct = String(item.product_code ?? '') !== lastProductCode;
      if (isNewProduct) {
        productNo++;
        lastProductCode = String(item.product_code ?? '');
      }

      const pallet = Math.ceil(expPlt);
      totalQtyExp += qty;
      totalPalletExp += pallet;

      const rowData = [
        isNewProduct ? productNo : '', item.product_code, item.product_name, item.category ?? '', item.uom_type ?? item.uom ?? '',
        item.batch_number ?? '', item.od_numbers ?? '', item.shipment_nos ?? '',
        locDisplay, qty, pallet,
        Math.round(liters), item.expiry_date ?? '', info.days_left ?? '', info.display_text, item.stock_status,
      ];
      rowData.forEach((v, c) => {
        sheet.getCell(row, c + 1).value = v as any;
      });
      if (info.is_expired) {
        for (let c = 1; c <= 16; c++) sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD7D7' } };
      } else if (info.is_critical) {
        for (let c = 1; c <= 16; c++) sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      }
      row++;
    }

    sheet.getCell(`A${row}`).value = 'TOTAL';
    sheet.getCell(`J${row}`).value = totalQtyExp;
    sheet.getCell(`K${row}`).value = totalPalletExp;
    for (let c = 1; c <= 16; c++) {
      sheet.getCell(row, c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11998E' } };
    }
    for (let c = 1; c <= 16; c++) sheet.getColumn(c).width = 16;

    return { buffer: await toBuffer(wb), filename: `Stock_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }

  // ---------------------------------------------------------------------------
  // Stock take detail (stocktake.php?action=export)
  // ---------------------------------------------------------------------------
  async stocktakeReport(id: number): Promise<ExportFile> {
    const stockTake = await this.stocktake.getById(id);
    if (!stockTake) throw ApiException.badRequest('Stock take tidak ditemukan.');
    const items = await this.stocktake.getItems(id);
    const accuracy = await this.stocktake.calculateAccuracy(id);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stock Take');

    const takeDate = stockTake.take_date ? fmtDateLong(stockTake.take_date) : '';

    const headers = ['Lokasi', 'SKU', 'Nama Produk', 'Batch', 'UOM', 'Qty System', 'Counter 1', 'Counter 2', 'Counter 3', 'Different', 'Status', 'Remarks'];
    headers.forEach((h, c) => {
      const cell = ws.getCell(1, c + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF026766' } };
    });

    let clear = 0;
    let plus = 0;
    let minus = 0;
    items.forEach((item, i) => {
      const row = i + 2;
      const diff = Number(item.difference ?? 0);
      if (diff !== 0) {
        if (diff > 0) plus += Math.abs(diff);
        else minus += Math.abs(diff);
      } else {
        clear += Number(item.qty_physical ?? 0);
      }
      const rowData = [
        item.location, item.product_code, item.product_name, item.batch_number ?? '-',
        item.uom, item.qty_system, item.counter_1, item.counter_2, item.counter_3,
        diff > 0 ? `+${diff}` : diff, item.status, item.notes ?? item.remarks ?? '',
      ];
      rowData.forEach((v, c) => {
        const cell = ws.getCell(row, c + 1);
        cell.value = v as any;
        cell.border = thinBorder();
      });
      if (diff !== 0) {
        for (let c = 1; c <= 12; c++) ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
      }
    });

    const totalRow = items.length + 2;
    const accPct = Number(accuracy.accuracy ?? 100);
    ws.getCell(`A${totalRow}`).value = 'TOTAL';
    ws.getCell(`F${totalRow}`).value = accuracy.total_stock_take ?? 0;
    ws.getCell(`J${totalRow}`).value = accuracy.total_stock_take ?? 0;
    for (let c = 1; c <= 12; c++) {
      ws.getCell(totalRow, c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getCell(totalRow, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF026766' } };
    }
    const infoRow = totalRow + 1;
    ws.getCell(`A${infoRow}`).value = 'Ringkasan';
    ws.getCell(`D${infoRow}`).value = `Clear: ${accuracy.clear} | Plus: ${accuracy.plus} | Minus: ${accuracy.minus} | Accuracy: ${accPct}%`;
    ws.getCell(`A${infoRow}`).font = { bold: true };

    for (let c = 1; c <= 12; c++) ws.getColumn(c).width = 18;

    const fileName = `StockTake_${String(stockTake.take_number ?? '')}_${String(stockTake.take_date ?? '').slice(0, 10).replace(/-/g, '')}`;
    return { buffer: await toBuffer(wb), filename: `${fileName}_${nowStamp()}.xlsx`, contentType: XLSX_TYPE };
  }
}

// Re-export helpers for the print service
export { nf, fmtDate, fmtDateLong, daysLeft };