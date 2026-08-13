/**
 * Read uploaded workbook buffers into grids. Mirrors the API's sheet reader
 * (PhpSpreadsheet toArray(null,true,false,false) → raw values / Excel serials).
 */
import * as XLSX from 'xlsx';

export type SheetGrid = any[][];

export function readWorkbookSheets(buffer: Buffer, name: string): { name: string; rows: SheetGrid }[] {
  const ext = /\.([^.]+)$/.exec(name || '')?.[1]?.toLowerCase() ?? '';
  if (!['xlsx', 'xls'].includes(ext)) {
    throw new Error('Format file harus .xlsx atau .xls');
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const out: { name: string; rows: SheetGrid }[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
    out.push({ name: sheetName, rows });
  }
  return out;
}