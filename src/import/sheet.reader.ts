/**
 * Read an uploaded Excel/CSV buffer into a 2D grid, mirroring PHP's
 * `toArray(null, true, false, false)` (nullValue=null, raw values — dates come
 * back as Excel serials) and `fgetcsv` for .csv.
 */
import * as XLSX from 'xlsx';

export type SheetGrid = any[][];

function normalizeExt(name: string): string {
  const m = /\.([^.]+)$/.exec(name || '');
  return (m ? m[1] : '').toLowerCase();
}

/** Grid from the first worksheet (stock preview / inbound). */
export function readSheetBuffer(buffer: Buffer, name: string): SheetGrid {
  const ext = normalizeExt(name);
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw new Error('Format file harus .xlsx, .xls, atau .csv');
  }
  if (ext === 'csv') {
    const text = buffer.toString('utf8');
    // Strip BOM that fopen/fgetcsv would otherwise expose.
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return parseCsv(clean);
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
}

/** All worksheets as {name, rows} (auto import). */
export function readWorkbookSheets(buffer: Buffer, name: string): { name: string; rows: SheetGrid }[] {
  const ext = normalizeExt(name);
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

function parseCsv(text: string): SheetGrid {
  const rows: SheetGrid = [];
  let row: any[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushField();
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  pushField();
  if (row.length > 0 || rows.length === 0) rows.push(row);
  return rows;
}
