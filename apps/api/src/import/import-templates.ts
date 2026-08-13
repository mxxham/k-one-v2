/**
 * Excel template generation mirroring api/handlers/import_templates.php.
 * Returns { buffer, filename, contentType } for each template.
 */
import * as ExcelJS from 'exceljs';

interface TplResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface HeaderCfg {
  required?: boolean;
  width?: number;
}

async function tplHeader(ws: ExcelJS.Worksheet, headers: [string, HeaderCfg][]): Promise<void> {
  for (let i = 0; i < headers.length; i++) {
    const [label, cfg] = headers[i];
    const cell = ws.getCell(1, i + 1);
    cell.value = cfg.required ? `* ${label}` : label;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: { style: 'thin', color: { argb: 'FF9E9E9E' } }, left: { style: 'thin', color: { argb: 'FF9E9E9E' } }, bottom: { style: 'thin', color: { argb: 'FF9E9E9E' } }, right: { style: 'thin', color: { argb: 'FF9E9E9E' } } };
    ws.getColumn(i + 1).width = cfg.width ?? 18;
  }
  ws.getRow(1).height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function tplSampleRow(ws: ExcelJS.Worksheet, values: any[]): void {
  const rowNum = ws.rowCount + 1;
  for (let ci = 0; ci < values.length; ci++) {
    ws.getCell(rowNum, ci + 1).value = values[ci];
    ws.getCell(rowNum, ci + 1).border = { top: { style: 'thin', color: { argb: 'FFE0E0E0' } }, left: { style: 'thin', color: { argb: 'FFE0E0E0' } }, bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }, right: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
  }
}

function tplNote(ws: ExcelJS.Worksheet, label: string, value = ''): void {
  const rowNum = ws.rowCount + 1;
  const c = ws.getCell(rowNum, 1);
  c.value = label;
  c.font = { italic: true, color: { argb: 'FF6B7280' } };
  if (value !== '') {
    const b = ws.getCell(rowNum, 2);
    b.value = value;
    b.font = { italic: true, color: { argb: 'FF1565C0' } };
  }
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function tplInbound(): Promise<TplResult> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inbound Data');
  ws.getCell(1, 4).value = '';

  const headers: [string, HeaderCfg][] = [
    ['Shipment No', { width: 20, required: false }],
    ['OD No', { width: 18, required: false }],
    ['SO No', { width: 18, required: false }],
    ['Item Code', { width: 22, required: true }],
    ['Uom', { width: 10, required: true }],
    ['ACTUAL QTY', { width: 12, required: true }],
    ['QTY ORDER', { width: 12, required: false }],
    ['Pallet', { width: 10, required: false }],
    ['Batch No', { width: 18, required: false }],
    ['Manufacture date', { width: 16, required: true }],
    ['Exp Date', { width: 14, required: true }],
    ['Location', { width: 14, required: false }],
    ['Remarks', { width: 20, required: false }],
  ];
  await tplHeader(ws, headers);
  // Color is cosmetic; kept for parity readability.
  for (const [label] of headers) {
    const cell = ws.getCell(1, headers.findIndex(([l]) => l === label) + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  }
  tplSampleRow(ws, ['SHP-2026-001', '530870001', '4549106001', 'ADVANCE-AX7', 'Carton', 12, 12, '', 'LOT/2026/001', '2024-06-01', '2028-06-01', 'CA05B01', '']);
  tplSampleRow(ws, ['SHP-2026-001', '530870002', '4549106002', 'HELIX-HX7', 'Drum', 4, 4, 1, 'LOT/2026/002', '2024-07-01', '2028-07-01', 'CB03A01', '']);
  tplSampleRow(ws, ['SHP-2026-002', '530870003', '4549106003', 'GADUS-S2', 'Pail', 1, 1, '', 'LOT/2026/003', '2025-01-01', '2029-01-01', 'CC08E01', 'Fragile']);
  tplNote(ws, '* = Kolom wajib diisi', 'Drum | Carton | Pail | EA | Bags');
  tplNote(ws, 'Uom values:', 'Drum | Carton | Pail | EA | Bags');
  tplNote(ws, 'Date format:', 'YYYY-MM-DD atau DD/MM/YYYY');
  tplNote(ws, 'Item Code:', 'Harus sesuai Product Code di database K-one');
  tplNote(ws, 'Shipment No:', 'WAJIB untuk grouping — baris dengan Shipment No sama = satu inbound order');

  return { buffer: await toBuffer(wb), filename: 'Inbound_Import_Template_K-one.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

export async function tplOutbound(): Promise<TplResult> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Outbound Data');

  const headers: [string, HeaderCfg][] = [
    ['Plan Date', { width: 14, required: false }],
    ['Shipment Number', { width: 18, required: true }],
    ['Order No (OD)', { width: 16, required: false }],
    ['Purchasing Document', { width: 18, required: false }],
    ['Ship-to Party Code', { width: 14, required: false }],
    ['Material', { width: 16, required: true }],
    ['Description', { width: 32, required: false }],
    ['Delivery quantity', { width: 12, required: true }],
    ['Sales Unit', { width: 10, required: true }],
    ['Name of Ship-To Party', { width: 28, required: false }],
    ['Location of Ship-To Party', { width: 22, required: false }],
    ['Street / Address', { width: 30, required: false }],
    ['Goods Issue Date', { width: 16, required: false }],
    ['SO Number', { width: 22, required: false }],
    ['TRANSPORT', { width: 12, required: false }],
  ];
  await tplHeader(ws, headers);
  for (const [label] of headers) {
    const cell = ws.getCell(1, headers.findIndex(([l]) => l === label) + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A148C' } };
  }
  tplSampleRow(ws, ['2026-03-31', '109294012', '531746742', '13004218', 'PO/001', 'ADVANCE-AX7', 'Shell Advance 4T AX7', 100, 'CAR', 'CV MULTI SARANA BAN', 'SURABAYA', 'Jl. Raya Darmo No. 1', '2026-03-31', '', 'LF']);
  tplSampleRow(ws, ['2026-03-31', '109294012', '531746741', '12529551', 'PO/002', 'HELIX-HX7', 'Shell Helix HX7', 100, 'CAR', 'CV MULTI SARANA BAN', 'SURABAYA', 'Jl. Raya Darmo No. 1', '2026-03-31', '', 'LF']);
  tplSampleRow(ws, ['2026-03-31', '109294013', '531746801', '10000001', 'PO/003', 'ADVANCE-AX7', 'Shell Advance 4T AX7', 50, 'CAR', 'PT SUMBER BARU BAN', 'MALANG', 'Jl. Soekarno Hatta 88', '2026-03-31', '', 'LF']);
  tplNote(ws, 'PENTING — Struktur Order:', '1 Shipment Number = 1 Order Outbound di sistem WMS');
  tplNote(ws, 'Name/Location/Street per item:', 'Boleh berbeda tiap baris dalam 1 shipment (multi-tujuan)');
  tplNote(ws, 'UOM values:', 'Drum (DRM) | Carton (CAR) | Pail (PAL/PAIL) | Bags | EA');
  tplNote(ws, 'Material:', 'Gunakan Product Code dari database K-one');

  return { buffer: await toBuffer(wb), filename: 'Outbound_Import_Template_K-one.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

export async function tplStock(): Promise<TplResult> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock Import');

  const headers: string[] = ['product_code*', 'batch_number', 'location', 'quantity*', 'uom', 'manufacture_date', 'expiry_date', 'stock_status', 'notes'];
  for (let i = 0; i < headers.length; i++) {
    const cell = ws.getCell(1, i + 1);
    cell.value = headers[i];
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    cell.alignment = { horizontal: 'center' };
    cell.border = { top: { style: 'thin', color: { argb: 'FFFFFFFF' } }, left: { style: 'thin', color: { argb: 'FFFFFFFF' } }, bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  }
  const descriptions: string[] = ['Kode produk (wajib)', 'No batch / lot', 'Lokasi bin (mis: A-01-01)', 'Jumlah qty (wajib)', 'Drum/Carton/Pail/Bags/EA (default: Drum)', 'Tgl produksi', 'Tgl exp', 'Available/Dues In/Reserved', 'Catatan opsional'];
  for (let i = 0; i < descriptions.length; i++) ws.getCell(2, i + 1).value = descriptions[i];

  const examples: any[] = ['SHE-001', 'BT2024001', 'A-01-01', 20, 'Drum', '01/01/2024', '01/01/2026', 'Available', 'Opening stock'];
  for (let i = 0; i < examples.length; i++) ws.getCell(3, i + 1).value = examples[i];

  for (let i = 1; i <= headers.length; i++) ws.getColumn(i).width = 18;
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  return { buffer: await toBuffer(wb), filename: 'template_import_stock.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
