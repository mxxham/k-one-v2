import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';
import {
  importParseDate, importNormalizeUom, importUomPerPallet,
  importHeaderIndex, importResolveCol, importDetectHeader, importGetter, importIsMetaRow,
  SHIP_TO_NAME_KEYS, SHIP_TO_LOC_KEYS, MASTER_PRODUCT_CODE_KEYS,
} from './import.helpers';
import { readSheetBuffer, readWorkbookSheets } from './sheet.reader';
import { todayStr, todayCompact, nowCompactTime, addYears } from '../common/date-util';

type Q = Record<string, any>;
type Rows = any[][];

const VALID_STOCK_STATUSES = ['Available', 'Reserved', 'Dues In', 'Expired'];

/** A query runner bound either to a transaction client or the pool. */
type QFn = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

@Injectable()
export class ImportService {
  constructor(private readonly db: DbService) {}

  // ---------------------------------------------------------------------------
  // Sheet reading (multipart uploaded file → grid)
  // ---------------------------------------------------------------------------

  fileFromReq(req: any): { buffer: Buffer; name: string } {
    const files = req?.files ?? (req?.file ? [req.file] : []);
    const f = Array.isArray(files) ? files[0] : null;
    if (!f || !f.buffer) throw ApiException.badRequest('No file uploaded or upload error');
    return { buffer: f.buffer, name: f.originalname || 'upload.xlsx' };
  }

  // ---------------------------------------------------------------------------
  // STOCK — parse / validate / commit
  // ---------------------------------------------------------------------------

  private stockParse(allRows: Rows): Q[] {
    const detect = importDetectHeader(allRows);
    const headers = detect.row.map((h) => String(h ?? '').trim());

    const fields: Record<string, string[]> = {
      product_code: ['item', 'item code', 'material no', 'material', 'sku', 'product code', 'kode produk', 'product', 'product_code'],
      sku_code: ['sku', 'sku code', 'sku_number', 'sku no'],
      batch_number: ['batch number', 'batch no', 'batch', 'lot', 'no batch', 'batch_number', 'lot number'],
      location: ['lokasi', 'location', 'bin', 'warehouse location', 'storage bin', 'zone'],
      quantity: ['on hand', 'on-hand', 'onhand', 'remain qty', 'remaining qty', 'available qty', 'quantity', 'actual qty', 'stock qty', 'qty', 'jumlah'],
      uom: ['uom', 'unit', 'satuan', 'unit of measure', 'sales unit', 'uom code'],
      manufacture_date: ['gr date', 'goods receipt date', 'receipt date', 'mfg date', 'manufacture date', 'production date', 'tgl produksi', 'manufacturing date', 'production_date'],
      expiry_date: ['expired date', 'expiry date', 'exp date', 'expiration date', 'best before', 'tgl exp', 'expiry', 'exp_date'],
      stock_status: ['stock status', 'status', 'stock_status', 'state', 'quality'],
      notes: ['notes', 'catatan', 'keterangan', 'remarks', 'remark'],
      description: ['description', 'product description', 'item description', 'deskripsi', 'material description'],
    };
    const resolved: Record<string, number | null> = {};
    for (const [key, patterns] of Object.entries(fields)) {
      resolved[key] = importResolveCol(headers, patterns);
    }
    if (resolved.product_code === null && resolved.sku_code !== null) resolved.product_code = resolved.sku_code;
    if (resolved.product_code === null) throw ApiException.badRequest('Kolom produk (Item / SKU / product code) tidak ditemukan.');
    if (resolved.quantity === null) throw ApiException.badRequest("Kolom qty ('on hand' / 'Qty') tidak ditemukan.");

    const rows: Q[] = [];
    for (let i = detect.index + 1; i < allRows.length; i++) {
      const row = allRows[i];
      const productCode = String(row[resolved.product_code!] ?? '').trim();
      if (!productCode || productCode.toLowerCase() === 'kode produk (wajib)') continue;
      const qty = Number(row[resolved.quantity!] ?? 0);
      if (qty <= 0) continue;
      const uomRaw = String(row[resolved.uom ?? -1] ?? '').trim() || 'Drum';
      rows.push({
        product_code: productCode,
        sku_code: resolved.sku_code !== null ? String(row[resolved.sku_code] ?? '').trim() : '',
        batch_number: String(row[resolved.batch_number ?? -1] ?? '').trim(),
        location: String(row[resolved.location ?? -1] ?? '').trim(),
        quantity: qty,
        uom: importNormalizeUom(uomRaw),
        manufacture_date: importParseDate(row[resolved.manufacture_date ?? -1] ?? null),
        expiry_date: importParseDate(row[resolved.expiry_date ?? -1] ?? null),
        stock_status: String(row[resolved.stock_status ?? -1] ?? 'Available').trim() || 'Available',
        notes: String(row[resolved.notes ?? -1] ?? '').trim(),
        description: String(row[resolved.description ?? -1] ?? '').trim(),
        _row_num: i + 1,
      });
    }
    if (rows.length === 0) throw ApiException.badRequest('Tidak ada data valid yang ditemukan di file.');
    return rows;
  }

  private async stockValidate(q: QFn, rows: Q[]): Promise<Q[]> {
    const productCache: Record<string, any> = {};
    for (const row of rows) {
      row._errors = [];
      row._warnings = [];

      const candidates = [...new Set([row.product_code, row.sku_code ?? ''].filter(Boolean))];
      let product = null;
      let usedCode = null;
      for (const code of candidates) {
        if (!(code in productCache)) {
          const r = await q('SELECT id, product_name, uom_type, uom_per_pallet FROM products WHERE product_code = $1 AND is_active = 1 LIMIT 1', [code]);
          productCache[code] = r.rows[0] ?? null;
        }
        if (productCache[code]) {
          product = productCache[code];
          usedCode = code;
          break;
        }
      }

      if (!product) {
        row._auto_create = true;
        row.product_id = null;
        row.product_name = row.description || row.product_code;
        const autoCode = row.sku_code || row.product_code;
        row._warnings.push(`Produk '${row.product_code}' tidak ditemukan — akan dibuat otomatis sebagai '${autoCode}'`);
      } else {
        if (usedCode !== row.product_code) {
          row._warnings.push(`Produk dicocokkan lewat SKU '${usedCode}' (Item '${row.product_code}' tidak ditemukan)`);
          row.product_code = usedCode;
        }
        row.product_id = Number(product.id);
        row.product_name = product.product_name;
        if (!row.uom) row.uom = product.uom_type ?? 'Drum';
        row.uom_per_pallet = importUomPerPallet(row.uom, Number(product.uom_per_pallet ?? 4), product.product_name);
        row.pallet = Math.ceil(row.quantity / row.uom_per_pallet);
      }

      if (!VALID_STOCK_STATUSES.includes(row.stock_status)) {
        row._warnings.push(`Status '${row.stock_status}' tidak dikenal, akan diset ke 'Available'`);
        row.stock_status = 'Available';
      }
      if (row.expiry_date && row.expiry_date < todayStr()) {
        row._warnings.push(`Produk sudah expired (${row.expiry_date})`);
      }
    }
    return rows;
  }

  async stockPreview(req: any): Promise<Q> {
    const { buffer, name } = this.fileFromReq(req);
    const allRows = readSheetBuffer(buffer, name);
    if (allRows.length === 0) throw ApiException.badRequest('File kosong atau tidak bisa dibaca');
    const rows = await this.stockValidate((t, p) => this.db.query(t, p ?? []), this.stockParse(allRows));
    return {
      message: `${rows.length} baris dibaca dari file.`,
      stats: {
        total_rows: rows.length,
        has_errors: rows.filter((r) => (r._errors?.length ?? 0) > 0).length,
      },
      rows,
    };
  }

  async stockCommit(body: Q): Promise<Q> {
    const rows = body.rows ?? [];
    const mode = ['add', 'replace', 'skip'].includes(body.mode) ? body.mode : 'add';
    if (!Array.isArray(rows) || rows.length === 0) throw ApiException.badRequest('Tidak ada data untuk di-commit');
    const result = await this.db.transaction((client) => this.stockCommitTx(client, rows, mode));
    const autoTxt = result.auto_created ? `, ${result.auto_created} produk baru dibuat otomatis.` : '.';
    return {
      message: `Import selesai: ${result.imported} diimport, ${result.skipped} dilewati${autoTxt}`,
      stats: result,
    };
  }

  private async stockCommitTx(client: PoolClient, rows: Q[], mode: string): Promise<Q> {
    const q = (t: string, p?: any[]) => client.query(t, p ?? []);
    let imported = 0;
    let skipped = 0;
    let autoCreated = 0;
    let autoLocations = 0;
    const refPrefix = 'IST-' + todayCompact() + '-';
    const productCache: Record<string, any> = {};
    const locationCache: Record<string, boolean> = {};

    const findProduct = async (code: string): Promise<any> => {
      if (code in productCache) return productCache[code];
      const r = await q('SELECT id, product_name, uom_type, uom_per_pallet FROM products WHERE product_code = $1 AND is_active = 1 LIMIT 1', [code]);
      productCache[code] = r.rows[0] ?? null;
      return productCache[code];
    };
    const ensureLocation = async (loc: string): Promise<void> => {
      const l = loc.trim();
      if (l === '' || locationCache[l]) return;
      const r = await q('SELECT id FROM location_master WHERE location_code = $1 LIMIT 1', [l]);
      if (r.rows.length > 0) {
        locationCache[l] = true;
        return;
      }
      const m = /^([A-Z]{2})(\d{2})([A-E])(\d{2})$/.exec(l);
      await q(
        "INSERT INTO location_master (location_code, aisle, rack, row_name, position, zone, is_active) VALUES ($1,$2,$3,$4,$5,'Bulk',1)",
        [l, m ? m[1] : null, m ? m[1] + m[2] : null, m ? m[3] : null, m ? m[4] : null],
      );
      locationCache[l] = true;
      autoLocations++;
    };

    // Keep stock_locations in sync with the stock rows written below so the
    // 3D rack map (putaway::bins) shows occupancy. If bin rows already exist
    // for this stock (e.g. created by inbound), scale them to the new qty so
    // pallet structure is preserved; otherwise create a single bin row.
    const syncLocations = async (stockId: number, loc: string, qty: number, row: Q): Promise<void> => {
      const l = loc.trim().toUpperCase();
      if (l === '') return;
      const isPickFace = l.length > 4 && l[4].toUpperCase() === 'A';
      const isFull = Number(qty) >= Number(row.uom_per_pallet ?? 4) ? 1 : 0;
      const status = row.stock_status === 'Reserved' ? 'Reserved' : 'Available';
      const existingRows = await q(
        `SELECT id, quantity FROM stock_locations WHERE stock_id=$1 ORDER BY pallet_seq, id`,
        [stockId],
      );
      if (existingRows.rows.length > 0) {
        const total = existingRows.rows.reduce((a: number, r: any) => a + Number(r.quantity), 0);
        if (total > 0.001 && Math.abs(total - qty) > 0.001) {
          const scale = qty / total;
          for (const r of existingRows.rows) {
            await q(
              `UPDATE stock_locations SET quantity=$1, original_quantity=$1, is_full_pallet=$2, status=$3, updated_at=NOW() WHERE id=$4`,
              [Number((Number(r.quantity) * scale).toFixed(4)), isFull, status, r.id],
            );
          }
        }
        await q(
          `UPDATE stock_locations SET location_code=$1, batch_number=$2, updated_at=NOW() WHERE stock_id=$3`,
          [l, row.batch_number || null, stockId],
        );
      } else {
        await q(
          `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom,
             is_full_pallet, batch_number, status, pallet_function)
           VALUES ($1,$2,1,$3,$3,$4,$5,$6,$7,$8)`,
          [stockId, l, qty, row.uom, isFull, row.batch_number || null, status, isPickFace ? 'PICK_FACE' : 'RESERVE'],
        );
      }
    };

    for (const row of rows) {
      if ((row._errors?.length ?? 0) > 0) {
        skipped++;
        continue;
      }
      row.product_id = Number(row.product_id ?? 0);

      if (row.product_id <= 0 && row._auto_create) {
        const code = row.sku_code || row.product_code;
        const name = row.description || row.product_name;
        const uomType = row.uom ?? 'Drum';
        const ins = await q(
          `INSERT INTO products (product_code, product_name, description, uom_type, uom_per_pallet,
             liters_per_unit, max_sku_qty, max_trans_qty, reorder_level, is_active)
           VALUES ($1,$2,$3,$4,$5,209.00,44,80,0,1) RETURNING id`,
          [code, name, row.description || null, uomType, importUomPerPallet(uomType, 4, name)],
        );
        row.product_id = Number(ins.rows[0].id);
        row.uom_per_pallet = importUomPerPallet(uomType, 4, name);
        row.pallet = Math.ceil(row.quantity / row.uom_per_pallet);
        autoCreated++;
      }
      if (row.product_id <= 0) {
        skipped++;
        continue;
      }
      if (row.location) await ensureLocation(String(row.location));

      const chk = await q(
        `SELECT id, quantity FROM stock
         WHERE product_id=$1 AND batch_number IS NOT DISTINCT FROM $2
           AND location IS NOT DISTINCT FROM $3 AND stock_status=$4 LIMIT 1`,
        [row.product_id, row.batch_number || null, row.location || null, row.stock_status],
      );
      const existing = chk.rows[0];

      if (mode === 'replace' && existing) {
        const oldQty = Number(existing.quantity ?? 0);
        const diff = Number(row.quantity ?? 0) - oldQty;
        await q('UPDATE stock SET quantity=$1, pallet=$2, manufacture_date=$3, expiry_date=$4, uom=$5, updated_at=NOW() WHERE id=$6', [
          row.quantity, row.pallet ?? Math.ceil(row.quantity / 4), row.manufacture_date, row.expiry_date, row.uom, existing.id,
        ]);
        await syncLocations(existing.id, row.location ?? '', Number(row.quantity ?? 0), row);
        const refNo = refPrefix + String(imported + 1).padStart(4, '0');
        await this.addImportLedger(q, row, diff, refNo);
        imported++;
        continue;
      }
      if (mode === 'add' && existing) {
        const newQty = Number(existing.quantity ?? 0) + row.quantity;
        const newPlt = Math.ceil(newQty / (row.uom_per_pallet ?? 4));
        await q('UPDATE stock SET quantity=$1, pallet=$2, updated_at=NOW() WHERE id=$3', [newQty, newPlt, existing.id]);
        await syncLocations(existing.id, row.location ?? '', newQty, row);
        const refNo = refPrefix + String(imported + 1).padStart(4, '0');
        await this.addImportLedger(q, row, Number(row.quantity ?? 0), refNo);
        imported++;
        continue;
      }
      if (mode === 'skip' && existing) {
        await syncLocations(existing.id, row.location ?? '', Number(existing.quantity ?? 0), row);
        skipped++;
        continue;
      }

      const ins = await q(
        `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet,
           manufacture_date, expiry_date, stock_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING id`,
        [
          row.product_id, row.batch_number || null, row.location || null, row.quantity, row.uom,
          row.pallet ?? Math.ceil(row.quantity / 4), row.manufacture_date || null, row.expiry_date || null, row.stock_status,
        ],
      );
      await syncLocations(Number(ins.rows[0].id), row.location ?? '', Number(row.quantity ?? 0), row);

      const refNo = refPrefix + String(imported + 1).padStart(4, '0');
      const bal = await q(`SELECT COALESCE(SUM(quantity),0) as bal FROM stock WHERE product_id=$1 AND stock_status='Available'`, [row.product_id]);
      const balance = bal.rows[0].bal;

      await q(
        `INSERT INTO stock_ledger (transaction_date, product_id, batch_number, transaction_type,
           quantity_in, quantity_out, uom, pallet, reference_number, reference_type, balance, location, notes)
         VALUES (CURRENT_DATE,$1,$2,'IN',$3,0,$4,$5,$6,'Stock Import',$7,$8,$9)`,
        [
          row.product_id, row.batch_number || null, row.quantity, row.uom,
          row.pallet ?? Math.ceil(row.quantity / 4), refNo, balance, row.location || null,
          row.notes || 'Direct stock import',
        ],
      );
      imported++;
    }
    return { imported, skipped, auto_created: autoCreated, auto_locations: autoLocations };
  }

  private async addImportLedger(q: QFn, row: Q, delta: number, refNo: string): Promise<void> {
    if (Math.abs(delta) < 0.001) return;
    const bal = await q(
      `SELECT COALESCE(SUM(quantity),0) as bal FROM stock WHERE product_id=$1 AND stock_status='Available'`,
      [row.product_id],
    );
    const balance = bal.rows[0].bal;
    const isIn = delta > 0;
    await q(
      `INSERT INTO stock_ledger (transaction_date, product_id, batch_number, transaction_type,
         quantity_in, quantity_out, uom, pallet, reference_number, reference_type, balance, location, notes)
       VALUES (CURRENT_DATE,$1,$2,${isIn ? "'IN'" : "'OUT'"},$3,$4,$5,$6,$7,'Stock Import',$8,$9,$10)`,
      [
        row.product_id,
        row.batch_number || null,
        isIn ? delta : 0,
        isIn ? 0 : Math.abs(delta),
        row.uom,
        row.pallet ?? Math.ceil(Math.abs(delta) / 4),
        refNo,
        balance,
        row.location || null,
        row.notes || 'Direct stock import',
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // INBOUND import
  // ---------------------------------------------------------------------------

  async runInbound(req: any): Promise<Q> {
    const carrierName = String((req.body ?? {}).carrier_name ?? '').trim() || null;
    const { buffer, name } = this.fileFromReq(req);
    const allRows = readSheetBuffer(buffer, name);
    if (allRows.length === 0) throw ApiException.badRequest('File kosong atau tidak bisa dibaca');

    const detect = importDetectHeader(allRows);
    const headerIdx = detect.index;
    const rawHeaders = detect.row.map((h) => String(h ?? '').trim());
    const col = importHeaderIndex(rawHeaders);

    const itemCol = importResolveCol(rawHeaders, ['item code', 'item', 'material no', 'material', 'sku', 'product code', 'product']);
    const qtyCol = importResolveCol(rawHeaders, ['actual qty', 'actual_qty', 'received qty', 'quantity', 'qty', 'on hand', 'remain qty']);
    const qtyOrderCol = importResolveCol(rawHeaders, ['qty order', 'order qty', 'quantity ordered', 'so qty']);
    const uomCol = importResolveCol(rawHeaders, ['uom', 'unit', 'sales unit', 'unit of measure']);
    if (itemCol === null) throw ApiException.badRequest('Invalid format. Kolom item (Item Code / Material / SKU / Item) tidak ditemukan.');
    if (qtyCol === null) throw ApiException.badRequest('Invalid format. Kolom qty (Actual Qty / Quantity / Qty / on hand) tidak ditemukan.');

    const result = await this.db.transaction(async (client) => {
      const q = (t: string, p?: any[]) => client.query(t, p ?? []);
      const successCount = 0;
      const errorMessages: string[] = [];
      const orderCache: Record<string, string> = {};
      let rowNumber = headerIdx;
      let processed = 0;

      const getCol = (row: any[], ci: number | null) => (ci !== null && row[ci] !== undefined && row[ci] !== null ? String(row[ci]).trim() : '');

      for (const data of allRows) {
        rowNumber++;
        if (rowNumber <= headerIdx + 1) continue;
        if (!data.some((v) => v !== null && v !== undefined && v !== '')) continue;
        if (importIsMetaRow(data)) continue;

        const get = (key: string, aliases: string[]): string => {
          if (key in col) {
            const v = getCol(data, col[key]);
            if (v !== '' && v !== '0') return v;
          }
          for (const a of aliases) {
            if (a in col) {
              const v = getCol(data, col[a]);
              if (v !== '' && v !== '0') return v;
            }
          }
          return '';
        };

        const odNumber = get('od no', ['od number', 'od_number', 'outbound delivery']);
        const soNumber = get('so no', ['so number', 'so_no', 'sales order']);
        const poNumber = get('gr number', ['po no', 'po number', 'po_no', 'purchase order']);
        const shipmentNo = get('shipment no', ['shipment number', 'shipment_no', 'shipment']);
        const inboundOrderNo = get('inbound order no', ['inbound order number', 'inbound_order_no', 'io number']);

        const itemCode = getCol(data, itemCol);
        const skuCol = importResolveCol(rawHeaders, ['sku', 'sku code', 'sku_number']);
        const skuCode = skuCol !== null ? getCol(data, skuCol) : '';

        const actualQty = Number(getCol(data, qtyCol) || 0);
        const qtyOrder = qtyOrderCol !== null ? Number(getCol(data, qtyOrderCol) || 0) : actualQty;
        const uom = importNormalizeUom(getCol(data, uomCol) || 'Drum');
        const palletCol = importResolveCol(rawHeaders, ['pallet', 'pallet qty']);
        const pallet = palletCol !== null ? Number(getCol(data, palletCol)) : 0;

        const batchNo = get('batch no', ['batch number', 'batch', 'lot', 'no batch']);
        const grDate = get('gr date', ['goods receipt date', 'receipt date']);
        const manufactureDate = get('manufacture date', ['mfg date', 'production date', 'tgl produksi', 'manufacturing date']) || grDate;
        const expDate = get('exp date', ['expiry date', 'expired date', 'expiration date', 'best before', 'tgl exp', 'expiry']);
        const location = get('location', ['lokasi', 'bin']);
        const remarks = get('remarks', ['notes', 'keterangan', 'description']);

        if (!itemCode) continue;
        if (actualQty <= 0) {
          errorMessages.push(`Row ${rowNumber}: Dilewati — qty kosong atau 0`);
          continue;
        }

        let product = await this.lookupProduct(q, itemCode);
        if (!product && skuCode !== '') {
          const bySku = await this.lookupProduct(q, skuCode);
          if (bySku) {
            product = bySku;
            errorMessages.push(`Row ${rowNumber}: Item '${itemCode}' cocok lewat SKU '${skuCode}'`);
          }
        }
        let autoCreatedProduct = false;
        if (!product) {
          const newCode = skuCode !== '' ? skuCode : itemCode;
          const newName = remarks !== '' ? remarks : itemCode;
          const ins = await q(
            `INSERT INTO products (product_code, product_name, description, uom_type, uom_per_pallet,
               liters_per_unit, max_sku_qty, max_trans_qty, reorder_level, is_active)
             VALUES ($1,$2,$3,$4,$5,209.00,44,80,0,1) RETURNING id`,
            [newCode, newName, newName, uom, importUomPerPallet(uom, 4, newName)],
          );
          product = { id: Number(ins.rows[0].id), product_name: newName, uom_type: uom, uom_per_pallet: importUomPerPallet(uom, 4, newName) };
          autoCreatedProduct = true;
          errorMessages.push(`Row ${rowNumber}: Product '${newCode}' dibuat otomatis`);
        }

        let orderNumber: string;
        if (shipmentNo !== '') orderNumber = shipmentNo;
        else if (inboundOrderNo !== '') orderNumber = inboundOrderNo;
        else if (grDate !== '') {
          if (!(grDate in orderCache)) orderCache[grDate] = await this.inboundNumber(client);
          orderNumber = orderCache[grDate];
        } else {
          orderNumber = await this.inboundNumber(client);
        }

        const existing = await q(
          `SELECT id FROM inbound_orders WHERE order_number = $1 OR (shipment_no IS NOT NULL AND shipment_no <> '' AND shipment_no = $2) LIMIT 1`,
          [orderNumber, shipmentNo !== '' ? shipmentNo : orderNumber],
        );

        let inboundId: number;
        if (existing.rows.length === 0) {
          const shipVal = shipmentNo !== '' ? shipmentNo : null;
          const ins = await q(
            `INSERT INTO inbound_orders (order_number, order_date, carrier_name, status, shipment_no, notes, created_by)
             VALUES ($1,$2,$3,'Completed',$4,'Imported from Excel',$5) RETURNING id`,
            [orderNumber, grDate !== '' ? grDate : todayStr(), carrierName, shipVal, this.userId(req)],
          );
          inboundId = Number(ins.rows[0].id);
        } else {
          inboundId = Number(existing.rows[0].id);
        }

        const uomPerPallet = importUomPerPallet(uom, Number(product.uom_per_pallet ?? 4), product.product_name);
        const calculatedPallet = actualQty > 0 ? Math.ceil(actualQty / uomPerPallet) : 0;
        const finalPallet = pallet > 0 ? Math.floor(pallet) : calculatedPallet;

        if (pallet > 0 && Math.abs(pallet - calculatedPallet) > 1) {
          errorMessages.push(`Row ${rowNumber}: Pallet mismatch (calc: ${calculatedPallet}, given: ${pallet})`);
        }

        const parsedMfgDate = importParseDate(manufactureDate);
        let parsedExpDate = importParseDate(expDate);
        if (!parsedExpDate && parsedMfgDate) {
          parsedExpDate = addYears(parsedMfgDate, 4);
        }

        await q(
          `INSERT INTO inbound_items (inbound_order_id, product_id, od_number, so_number, batch_number,
             location, quantity, uom, actual_qty, pallet, manufacture_date, exp_date,
             stock_status, in_process_status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Accepted','ATP',$13)`,
          [
            inboundId, product.id, odNumber || null, soNumber || null, batchNo || null,
            location || null, qtyOrder > 0 ? qtyOrder : actualQty, uom, actualQty, finalPallet,
            parsedMfgDate, parsedExpDate, remarks || null,
          ],
        );
        processed++;
      }
      return { successCount: processed, errorMessages };
    });

    return {
      success: true,
      message: `Import completed! ${result.successCount} items imported successfully.`,
      processed: result.successCount,
      stats: { items_imported: result.successCount, rows_skipped: result.errorMessages.length, errors: result.errorMessages.length },
      errors: result.errorMessages,
      has_errors: result.errorMessages.length > 0,
    };
  }

  private async lookupProduct(q: QFn, code: string): Promise<any> {
    const r = await q(
      'SELECT id, product_name, uom_type, uom_per_pallet, max_sku_qty, max_trans_qty, liters_per_unit FROM products WHERE product_code = $1',
      [code],
    );
    return r.rows[0] ?? null;
  }

  private async inboundNumber(client: PoolClient): Promise<string> {
    return generateInboundNumber((t, p) => client.query(t, p ?? []));
  }

  private userId(req: any): number {
    return Number((req as any).kone_user_id ?? 1);
  }

  // ---------------------------------------------------------------------------
  // OUTBOUND import
  // ---------------------------------------------------------------------------

  async runOutbound(req: any): Promise<Q> {
    const skipUnknown = !!(req.body ?? {}).skip_unknown;
    const groupByShipment = !!(req.body ?? {}).group_by_shipment;
    const { buffer, name } = this.fileFromReq(req);
    const allRows = readSheetBuffer(buffer, name);
    if (allRows.length === 0) throw ApiException.badRequest('File kosong atau tidak bisa dibaca');
    return this.outboundProcessSheet(allRows, skipUnknown, groupByShipment, this.userId(req));
  }

  /**
   * Port of PHP import_outbound_process_sheet(). Honors an already-open
   * transaction (parity with $db->inTransaction()); otherwise wraps in its own.
   */
  private async outboundProcessSheet(allRows: Rows, skipUnknown: boolean, _groupByShipment: boolean, userId: number, client?: PoolClient): Promise<Q> {
    const headerKeywords = ['shipment', 'material', 'delivery quantity', 'ship-to', 'order no', 'plan date', 'destination', 'location of the ship', 'name of ship', 'street'];

    let headerRowIndex: number | null = null;
    let headers: string[] = [];
    for (let idx = 0; idx < allRows.length; idx++) {
      const rowStr = allRows[idx].map((v) => String(v ?? '')).join(' ').toLowerCase();
      let matches = 0;
      for (const kw of headerKeywords) if (rowStr.includes(kw)) matches++;
      if (matches >= 2) {
        headerRowIndex = idx;
        headers = allRows[idx].map((h) => String(h ?? '').trim().replace(/^\*\s*/, '').toLowerCase());
        break;
      }
    }
    if (headerRowIndex === null) {
      throw ApiException.badRequest('Header row tidak ditemukan. Pastikan file menggunakan format Planning Outbound.');
    }
    const col = importHeaderIndex(headers);

    const execute = async (q: QFn): Promise<Q> => {
      const productCache: Record<string, any> = {};
      const prodR = await q('SELECT id, product_code, product_name, uom_type, uom_per_pallet FROM products WHERE is_active=1');
      for (const p of prodR.rows) {
        productCache[String(p.product_code).toLowerCase()] = p;
        const m = /(\d{7,})/.exec(String(p.product_code));
        if (m) productCache[m[1]] = p;
      }

      const customerCache: Record<string, any> = {};
      const custR = await q('SELECT id, customer_code, customer_name FROM customers');
      for (const c of custR.rows) {
        customerCache[String(c.customer_code).trim().toLowerCase()] = c;
        customerCache[String(c.customer_name).trim().toLowerCase()] = c;
      }

      const shipmentData: Record<string, { rows: any[][]; plan_date: string | null; customer_id: number | null }> = {};
      const dataRows = allRows.slice(headerRowIndex! + 1);
      for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
        const row = dataRows[rIdx];
        if (!row.some((v) => v !== null && v !== undefined && v !== '')) continue;
        const getAlt = importGetter(col, row);
        let shipmentNum = getAlt('shipment number', 'shipment no', 'shipment');
        const materialRaw = getAlt('material');
        const deliveryQty = Number(getAlt('delivery quantity'));
        if (!materialRaw || deliveryQty <= 0) continue;
        if (!shipmentNum) shipmentNum = 'NO_SHIPMENT_' + (rIdx + 1);
        if (!(shipmentNum in shipmentData)) {
          shipmentData[shipmentNum] = { rows: [], plan_date: null, customer_id: null };
        }
        const planDate = importParseDate(getAlt('plan date', 'first delivery date', 'goods issue date'));
        if (planDate && !shipmentData[shipmentNum].plan_date) shipmentData[shipmentNum].plan_date = planDate;
        shipmentData[shipmentNum].rows.push(row);
      }

      let ordersCreated = 0;
      let ordersReused = 0;
      let ordersSkipped = 0;
      let ordersShipped = 0;
      let itemsImported = 0;
      let rowsSkipped = 0;
      const log: string[] = [];

      for (const [shipmentNum, sData] of Object.entries(shipmentData)) {
        const rows = sData.rows;
        const planDate = sData.plan_date ?? todayStr();

        const firstRow = rows[0];
        const getAlt = importGetter(col, firstRow);
        const shipToName = getAlt(...SHIP_TO_NAME_KEYS);
        const shipToLoc = getAlt(...SHIP_TO_LOC_KEYS);
        let customerId: number | null = null;

        if (!customerId && shipToName) {
          const code = 'OUT-' + shipToName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
          const custIns = await q(
            `INSERT INTO customers (customer_code, customer_name, city) VALUES ($1,$2,$3)
             ON CONFLICT (customer_code) DO UPDATE SET customer_name = EXCLUDED.customer_name RETURNING id`,
            [code, shipToName, shipToLoc || null],
          );
          customerId = Number(custIns.rows[0].id);
          log.push(`Customer: ${shipToName}`);
        }
        if (!customerId) {
          const defCust = await q('SELECT id FROM customers LIMIT 1');
          customerId = defCust.rows.length > 0 ? Number(defCust.rows[0].id) : null;
          if (!customerId) throw ApiException.badRequest('Tidak ada customer di database. Tambahkan customer terlebih dahulu.');
        }

        const realShipment = shipmentNum.startsWith('NO_SHIPMENT') ? null : shipmentNum;

        // Dedup: reuse an existing outbound for this RAMCO shipment number.
        let existing: any = null;
        if (realShipment) {
          const exRes = await q(
            'SELECT id, status, order_number FROM outbound_orders WHERE shipment_number=$1 ORDER BY id DESC LIMIT 1',
            [realShipment],
          );
          existing = exRes.rows[0] ?? null;
        }
        if (existing && ['Shipped', 'Completed', 'Delivered'].includes(existing.status)) {
          ordersSkipped++;
          log.push(`Shipment ${shipmentNum} sudah dikirim (${existing.order_number}, status ${existing.status}) — dilewati`);
          continue;
        }

        let outboundId: number;
        let orderNumber: string | null = null;
        if (existing) {
          outboundId = Number(existing.id);
          orderNumber = existing.order_number;
          ordersReused++;
          await q(
            `DELETE FROM outbound_item_locations WHERE outbound_item_id IN (SELECT id FROM outbound_items WHERE outbound_order_id=$1)`,
            [outboundId],
          );
          await q('DELETE FROM outbound_items WHERE outbound_order_id=$1', [outboundId]);
          await q('DELETE FROM outbound_destinations WHERE outbound_id=$1', [outboundId]);
          log.push(`Shipment ${shipmentNum} sudah ada (${orderNumber}, status ${existing.status}) — di-reimport lalu dikirim`);
        } else {
          const outboundData = {
            order_date: planDate,
            customer_id: customerId,
            shipment_number: realShipment,
            ship_to_name: shipToName || null,
            ship_to_location: shipToLoc || null,
            kota: shipToLoc || null,
            expected_date: planDate,
            status: 'Open',
            notes: 'Imported from Excel | Shipment: ' + (realShipment || '—'),
          };
          const ins = await this.createOutbound(q, outboundData, userId);
          outboundId = Number(ins.rows[0].id);
          ordersCreated++;
          log.push(`Order #${outboundId} — Shipment: ${shipmentNum} (${shipToName}, ${rows.length} items)`);
        }

        const primaryDestKey = String(shipToName || '') + '|' + String(shipToLoc || '');
        const destMap: Record<string, number> = {};
        let destSeq = 2;

        for (const row of rows) {
          const ga = importGetter(col, row);
          const dName = ga(...SHIP_TO_NAME_KEYS);
          const dLoc = ga(...SHIP_TO_LOC_KEYS);
          const dStreet = ga('street / address', 'street', 'address');
          const dKey = String(dName || '') + '|' + String(dLoc || '');
          if (!dName || dKey.toLowerCase() === primaryDestKey.toLowerCase()) continue;
          if (!(dKey in destMap)) {
            await q(
              `INSERT INTO outbound_destinations (outbound_id, seq, ship_to_name, ship_to_location, kota, ship_to_street, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [outboundId, destSeq++, dName, dLoc, dLoc, dStreet || null, null],
            );
            const r = await q('SELECT id FROM outbound_destinations WHERE outbound_id = $1 ORDER BY id DESC LIMIT 1', [outboundId]);
            if (r.rows.length > 0) destMap[dKey] = Number(r.rows[0].id);
          }
        }

        for (const row of rows) {
          const ga = importGetter(col, row);
          const odNo = ga('order no (od)', 'order no', 'od no', 'od number');
          const soNo = ga('purchase order number', 'so no', 'so number');
          const destName = ga(...SHIP_TO_NAME_KEYS);
          const destLoc = ga(...SHIP_TO_LOC_KEYS);
          const materialRaw = ga('material');
          const description = ga('description');
          const deliveryQty = Number(ga('delivery quantity'));
          const salesUnit = ga('sales unit', 'uom', 'type');
          const expDate = importParseDate(ga('exp date', 'expiry date', 'best before'));

          if (!materialRaw || deliveryQty <= 0) {
            rowsSkipped++;
            continue;
          }

          const matKey = String(materialRaw).toLowerCase();
          const matNum = String(materialRaw).replace(/[^0-9]/g, '');
          let product = productCache[matKey] ?? productCache[matNum] ?? productCache[String(Number(materialRaw))] ?? null;

          if (!product && description) {
            for (const p of Object.values(productCache)) {
              if (!p) continue;
              if (String(p.product_name).toLowerCase().includes(String(description).slice(0, 15).toLowerCase())) {
                product = p;
                break;
              }
            }
          }

          if (!product) {
            if (skipUnknown) {
              log.push(`Material '${materialRaw}' tidak ditemukan di database → dilewati`);
              rowsSkipped++;
              continue;
            }
            throw ApiException.badRequest(`Material '${materialRaw}' tidak ditemukan di database.`);
          }

          const uom = importNormalizeUom(salesUnit, product.uom_type);
          const uomPerPallet = importUomPerPallet(uom, Number(product.uom_per_pallet), product.product_name);
          const pallet = Math.ceil(deliveryQty / uomPerPallet);

          const dKey = String(destName || '') + '|' + String(destLoc || '');
          const destId = dKey.toLowerCase() === primaryDestKey.toLowerCase() ? null : (destMap[dKey] ?? null);

          const fefo = await this.fefoAllocation(q, Number(product.id), deliveryQty);
          if (fefo.total_available <= 0) {
            log.push(`SKIP (stok 0): ${product.product_name} [${materialRaw}] — ${deliveryQty} ${uom}`);
            rowsSkipped++;
            continue;
          }
          if (!fefo.sufficient) {
            log.push(`SKIP (stok kurang): ${product.product_name} [${materialRaw}] — butuh ${deliveryQty} ${uom}, tersedia ${fefo.total_available}`);
            rowsSkipped++;
            continue;
          }

          let firstBatch: string | null = null;
          let firstLoc: string | null = null;
          let firstExpDate = expDate;
          if (fefo.allocation.length > 0) {
            firstBatch = fefo.allocation[0].batch_number ?? null;
            firstLoc = fefo.allocation[0].location ?? null;
            firstExpDate = fefo.allocation[0].expiry_date ?? expDate;
          }

          const item = await q(
            `INSERT INTO outbound_items (outbound_order_id, product_id, quantity, actual_qty, uom, pallet,
               batch_no, exp_date, location, notes, od_number, so_number, destination_id, customer_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [outboundId, product.id, deliveryQty, deliveryQty, uom, pallet, firstBatch, firstExpDate, firstLoc,
             description || product.product_name, odNo || null, soNo || null, destId, customerId],
          );
          const outboundItemId = Number(item.rows[0].id);

          await this.reduceStockForOutboundItem(q, Number(product.id), uom, outboundItemId, fefo.allocation);

          const destDisplay = destName ? ` → ${destName}` : '';
          log.push(`OD:${odNo} | ${product.product_name} | ${deliveryQty} ${uom}${destDisplay} | FEFO OK (${firstBatch}@${firstLoc}) | SHIPPED`);
          itemsImported++;
        }

        const orderItemCount = await q('SELECT COUNT(*)::int as c FROM outbound_items WHERE outbound_order_id=$1', [outboundId]);
        if (Number(orderItemCount.rows[0].c) === 0) {
          await q('DELETE FROM outbound_orders WHERE id=$1', [outboundId]);
          if (!existing) ordersCreated--;
          log.push(`Order #${outboundId} (${shipmentNum}) dihapus — semua item tidak ada di stok`);
          continue;
        }

        // RAMCO schedule = reality: mark the outbound Shipped + write OUT ledger.
        let shippedNumber: string;
        if (orderNumber === null) {
          const onRes = await q('SELECT order_number FROM outbound_orders WHERE id=$1', [outboundId]);
          shippedNumber = onRes.rows[0]?.order_number ?? String(outboundId);
        } else {
          shippedNumber = orderNumber;
        }
        await q(
          `UPDATE outbound_orders SET status='Shipped', shipped_date=$1, shipped_by=$2, updated_at=NOW() WHERE id=$3`,
          [planDate, userId, outboundId],
        );
        ordersShipped++;
        const itemRows = (await q('SELECT * FROM outbound_items WHERE outbound_order_id=$1', [outboundId])).rows;
        for (const item of itemRows) {
          await this.addOutboundLedger(q, item, { id: outboundId, order_number: shippedNumber });
        }
        log.push(`Shipment ${shipmentNum} → SHIPPED (${shippedNumber}) — stok berkurang`);
      }

      return {
        success: true,
        message: `Import selesai: ${ordersCreated} orders baru, ${ordersReused} di-update, ${ordersShipped} dikirim, ${itemsImported} items dari ${Object.keys(shipmentData).length} shipments`,
        stats: {
          orders_created: ordersCreated,
          orders_reused: ordersReused,
          orders_skipped: ordersSkipped,
          orders_shipped: ordersShipped,
          items_imported: itemsImported,
          rows_skipped: rowsSkipped,
          errors: 0,
        },
        log,
      };
    };

    if (client) {
      return execute((t, p) => client.query(t, p ?? []));
    }
    return this.db.transaction(async (c) => {
      return execute((t, p) => c.query(t, p ?? []));
    });
  }

  private async createOutbound(q: QFn, data: Q, userId: number) {
    const outboundNumber = await this.outboundNumber(q);
    return q(
      `INSERT INTO outbound_orders
         (order_number, order_date, customer_id, so_number, do_number,
          shipment_number, ship_to_name, ship_to_location, ship_to_street,
          destination, kota, armada_no, container_no, jenis_armada,
          expected_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        outboundNumber, data.order_date, data.customer_id, data.so_number ?? null, data.do_number ?? null,
        data.shipment_number ?? null, data.ship_to_name ?? null, data.ship_to_location ?? null, data.ship_to_street ?? null,
        data.destination ?? null, data.kota ?? null, data.armada_no ?? null, data.container_no ?? null, data.jenis_armada ?? null,
        data.expected_date ?? null, data.status ?? 'Open', data.notes ?? null, userId,
      ],
    );
  }

  private async outboundNumber(q: QFn): Promise<string> {
    return generateOutboundNumber(q);
  }

  private async fefoAllocation(q: QFn, productId: number, requiredQty: number): Promise<any> {
    const stockRows = (await q(
      `SELECT st.id, st.product_id, st.batch_number, st.location,
              st.quantity, st.uom, st.pallet,
              COALESCE(
                (SELECT ii_exp.exp_date
                 FROM stock_locations sl_exp JOIN inbound_items ii_exp ON ii_exp.id = sl_exp.inbound_item_id
                 WHERE sl_exp.stock_id = st.id ORDER BY ii_exp.id DESC LIMIT 1),
                st.expiry_date
              ) AS expiry_date,
              st.stock_status
       FROM stock st
       WHERE st.product_id = $1
         AND (st.stock_status IN ('Available','Dues In') OR st.stock_status IS NULL OR st.stock_status = '')
         AND (st.hold_status = 'available' OR st.hold_status IS NULL)
         AND st.quantity > 0
         AND (st.location IS NULL OR st.location NOT IN ('QUA_SHELL','STAGING'))
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END ASC, expiry_date ASC, st.id ASC`,
      [productId],
    )).rows;

    const allocation: any[] = [];
    let remainingQty = Number(Number(requiredQty).toFixed(6));
    for (const stock of stockRows) {
      if (remainingQty <= 1e-9) break;
      const availableQty = Number(stock.quantity);
      const take = Math.min(remainingQty, availableQty);
      allocation.push({
        stock_id: Number(stock.id),
        batch_number: stock.batch_number,
        location: stock.location,
        expiry_date: stock.expiry_date,
        required_qty: take,
        available_qty: availableQty,
        is_partial: take < availableQty,
      });
      remainingQty = Number((remainingQty - take).toFixed(6));
    }
    let totalAvailable = 0;
    for (const row of stockRows) totalAvailable += Number(row.quantity ?? 0);
    return {
      allocation,
      sufficient: remainingQty <= 1e-5,
      shortage: Math.max(0, remainingQty),
      total_available: totalAvailable,
    };
  }

  /**
   * Decrements stock for the FEFO allocation of a shipped outbound item and
   * records the exact batch+location picks in outbound_item_locations.
   * Mirrors outbound.service pickItems (stock + stock_locations handling).
   */
  private async reduceStockForOutboundItem(
    q: QFn,
    productId: number,
    uom: string,
    outboundItemId: number,
    allocation: any[],
  ): Promise<void> {
    let usedBatch: string | null = null;
    let usedLocation: string | null = null;
    let firstExpiry: any = null;
    const pickedRows: any[] = [];

    for (const alloc of allocation) {
      if (!alloc.stock_id) continue;
      const take = Number(alloc.required_qty ?? 0);
      if (take <= 0.001) continue;
      const sRes = await q('SELECT id, quantity, pallet, batch_number, location, expiry_date FROM stock WHERE id=$1', [alloc.stock_id]);
      const stock = sRes.rows[0];
      if (!stock) continue;
      const deduct = Math.min(take, Number(stock.quantity));
      if (deduct <= 0.001) continue;

      const newQty = Number(stock.quantity) - deduct;
      if (newQty <= 0.001) {
        await q(`UPDATE stock SET quantity=0, pallet=0, stock_status='Available', updated_at=NOW() WHERE id=$1`, [stock.id]);
      } else {
        const ratio = Number(stock.quantity) > 0 ? deduct / Number(stock.quantity) : 0;
        const newPlt = Math.max(0, Number(stock.pallet ?? 0) * (1 - ratio));
        await q(
          `UPDATE stock SET quantity=$1, pallet=$2, stock_status='Available', updated_at=NOW() WHERE id=$3`,
          [Number(newQty.toFixed(4)), Number(newPlt.toFixed(4)), stock.id],
        );
      }

      // stock_locations handling (mirror pickItems)
      const slRes = await q(`SELECT id, quantity FROM stock_locations WHERE stock_id=$1 AND status='Available' ORDER BY pallet_seq ASC LIMIT 1`, [stock.id]);
      let sl = slRes.rows[0];
      let slId: number | null = null;
      if (sl) {
        slId = Number(sl.id);
        const slNewQty = Math.max(0, Number(sl.quantity) - deduct);
        await q(`UPDATE stock_locations SET quantity=$1, status=$2 WHERE id=$3`, [slNewQty, slNewQty <= 0 ? 'Picked' : 'Available', slId]);
      } else {
        const slFind = await q(
          `SELECT sl.id, sl.quantity
           FROM stock_locations sl JOIN stock sx ON sx.id = sl.stock_id
           WHERE sx.product_id=$1 AND sx.batch_number IS NOT DISTINCT FROM $2 AND sx.location IS NOT DISTINCT FROM $3
             AND sl.status IN ('Available','Picked')
           ORDER BY (sl.status='Available') DESC, sl.pallet_seq ASC LIMIT 1`,
          [productId, stock.batch_number ?? null, stock.location ?? null],
        );
        sl = slFind.rows[0];
        if (sl) {
          slId = Number(sl.id);
          const slNewQty = Math.max(0, Number(sl.quantity) - deduct);
          await q(`UPDATE stock_locations SET quantity=$1, status=$2 WHERE id=$3`, [slNewQty, slNewQty <= 0 ? 'Picked' : 'Available', slId]);
        } else {
          const insSl = await q(
            `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, inbound_item_id, status)
             VALUES (NULL,$1,999,0,$2,$3,0,$4,NULL,'Picked') RETURNING id`,
            [stock.location ?? 'UNALLOCATED', deduct, uom, stock.batch_number ?? null],
          );
          slId = Number(insSl.rows[0].id);
        }
      }

      pickedRows.push({
        stock_location_id: slId,
        location: stock.location,
        batch: stock.batch_number,
        quantity: deduct,
        expiry_date: stock.expiry_date,
      });
      if (!usedBatch) usedBatch = stock.batch_number;
      if (!usedLocation) usedLocation = stock.location;
      if (firstExpiry === null) firstExpiry = stock.expiry_date ?? null;
    }

    await q('DELETE FROM outbound_item_locations WHERE outbound_item_id=$1', [outboundItemId]);
    for (const pr of pickedRows) {
      if (pr.stock_location_id) {
        await q(
          `INSERT INTO outbound_item_locations (outbound_item_id, stock_location_id, quantity) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [outboundItemId, pr.stock_location_id, pr.quantity],
        );
      }
    }

    await q(
      `UPDATE outbound_items SET batch_no=$1, batch_number=$1, location=COALESCE($2, location), exp_date=$3 WHERE id=$4`,
      [usedBatch, usedLocation, firstExpiry, outboundItemId],
    );
  }

  /** Writes a stock_ledger OUT row for a shipped outbound item (mirror outbound.service ship). */
  private async addOutboundLedger(q: QFn, item: any, outbound: { id: number; order_number: string }): Promise<void> {
    const balR = await q(
      `SELECT COALESCE(SUM(quantity_in),0) - COALESCE(SUM(quantity_out),0) AS running_balance
       FROM stock_ledger WHERE product_id = $1`,
      [Number(item.product_id)],
    );
    const balance = Number(balR.rows[0].running_balance ?? 0) - Number(item.actual_qty ?? 0);

    await q(
      `INSERT INTO stock_ledger
         (transaction_date, product_id, transaction_type, reference_type,
          reference_id, reference_number, batch_number, quantity_in,
          quantity_out, uom, pallet, balance, location, notes)
       VALUES ($1,$2,'OUT','Outbound',$3,$4,$5,0,$6,$7,$8,$9,$10,$11)`,
      [
        todayStr(),
        item.product_id,
        outbound.id,
        outbound.order_number,
        item.batch_no ?? null,
        item.actual_qty ?? 0,
        item.uom,
        item.pallet,
        balance,
        item.location,
        '[Outbound] Shipped | Status: Shipped | ' + outbound.order_number,
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // AUTO import — multi-sheet pipeline in one transaction
  // ---------------------------------------------------------------------------

  async runAuto(req: any): Promise<Q> {
    const userId = this.userId(req);
    const { buffer, name } = this.fileFromReq(req);
    const sheets = readWorkbookSheets(buffer, name);
    if (sheets.length === 0) throw ApiException.badRequest('File kosong atau tidak bisa dibaca');

    return this.db.transaction(async (client) => {
      const q = (t: string, p?: any[]) => client.query(t, p ?? []);
      await q('SELECT pg_advisory_xact_lock($1)', [824961]);

      const report: Q = {
        products_created: 0, products_updated: 0,
        stock_imported: 0, stock_skipped: 0, stock_auto_created: 0,
        inbound_orders: 0, inbound_items: 0,
        outbound_orders: 0, outbound_items: 0, outbound_skipped: 0,
        skipped_sheets: [],
      };
      const log: string[] = [];

      // Pass 1 — master data → products
      for (const sheet of sheets) {
        if (classifySheet(sheet.name) !== 'master') continue;
        const r = await this.autoProcessMaster(q, sheet.rows, log);
        report.products_created += r.created;
        report.products_updated += r.updated;
      }

      // Pass 2 — WMS + putaway → stock; WMS → inbound (GR date groups)
      for (const sheet of sheets) {
        const type = classifySheet(sheet.name);
        if (type !== 'wms' && type !== 'putaway') continue;

        let rows = this.stockParse(sheet.rows);
        if (type === 'wms') for (const r of rows) r.stock_status = 'Available';
        rows = await this.stockValidate(q, rows);
        report.stock_auto_created += await this.autoEnsureProducts(q, rows);

        const commit = await this.stockCommitTx(client, rows, 'skip');
        report.stock_imported += commit.imported;
        report.stock_skipped += commit.skipped;

        if (type === 'wms') {
          const inb = await this.autoCreateInbound(q, rows, log, userId);
          report.inbound_orders += inb.orders;
          report.inbound_items += inb.items;
        }
        log.push(`Sheet '${sheet.name}' — stok ${commit.imported} diimport, ${commit.skipped} dilewati`);
      }

      // Pass 3 — schedule → outbound
      for (const sheet of sheets) {
        if (classifySheet(sheet.name) !== 'schedule') continue;
        const result = await this.outboundProcessSheet(sheet.rows, true, true, userId, client);
        report.outbound_orders += result.stats.orders_created;
        report.outbound_items += result.stats.items_imported;
        report.outbound_skipped += result.stats.rows_skipped;
        log.push(`Sheet '${sheet.name}' — outbound ${result.stats.orders_created} orders, ${result.stats.items_imported} items`);
        log.push(...result.log);
      }

      // Pass 4 — collect skipped sheets
      for (const sheet of sheets) {
        if (classifySheet(sheet.name) === 'skip') report.skipped_sheets.push(sheet.name);
      }

      return {
        success: true,
        message: 'Auto import selesai. Semua sheet diproses dalam satu aksi.',
        stats: report,
        log,
      };
    });
  }

  private async autoProcessMaster(q: QFn, allRows: Rows, log: string[]): Promise<{ created: number; updated: number }> {
    const detect = importDetectHeader(allRows);
    const headers = detect.row.map((h) => String(h ?? '').trim());
    const col = {
      code: importResolveCol(headers, [...MASTER_PRODUCT_CODE_KEYS]),
      name: importResolveCol(headers, ['material description', 'description', 'product name']),
      loc: importResolveCol(headers, ['storage location', 'location', 'lokasi', 'bin']),
      upp: importResolveCol(headers, ['upp', 'uom per pallet', 'units per pallet']),
      vol: importResolveCol(headers, ['volume', 'vol', 'liters per unit']),
    };
    if (col.code === null) {
      log.push('Master data: kolom Material tidak ditemukan → sheet dilewati');
      return { created: 0, updated: 0 };
    }
    let created = 0;
    let updated = 0;
    for (let i = detect.index + 1; i < allRows.length; i++) {
      const row = allRows[i];
      const code = String(row[col.code] ?? '').trim();
      if (code === '') continue;
      const name = col.name !== null ? String(row[col.name] ?? '').trim() : '';
      const loc = col.loc !== null ? String(row[col.loc] ?? '').trim() : '';
      const upp = col.upp !== null ? Number(row[col.upp] ?? 0) || 0 : 0;
      const vol = col.vol !== null ? Number(row[col.vol] ?? 0) || 0 : 0;
      const uomType = inferUom(upp);
      const finalName = name || code;

      const existing = await q('SELECT id FROM products WHERE product_code = $1 LIMIT 1', [code]);
      if (existing.rows.length > 0) {
        await q(
          `UPDATE products SET product_name=$1, uom_type=$2, uom_per_pallet=$3, liters_per_unit=$4,
             default_location=COALESCE($5, default_location), description=$6, updated_at=NOW()
           WHERE id=$7`,
          [finalName, uomType, upp || 4, vol || 209, loc || null, finalName, existing.rows[0].id],
        );
        updated++;
      } else {
        await q(
          `INSERT INTO products (product_code, product_name, description, uom_type, uom_per_pallet,
             liters_per_unit, default_location, max_sku_qty, max_trans_qty, reorder_level, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,1)`,
          [code, finalName, finalName, uomType, upp || 4, vol || 209, loc || null, Math.max(1, upp || 4), Math.max(2, (upp || 4) * 2)],
        );
        created++;
      }
    }
    log.push(`Master data: ${created} produk baru, ${updated} diperbarui`);
    return { created, updated };
  }

  private async autoEnsureProducts(q: QFn, rows: Q[]): Promise<number> {
    let created = 0;
    for (const row of rows) {
      if (!row._auto_create || row.product_id) continue;
      const code = row.sku_code || row.product_code;
      const name = row.description || row.product_name || row.product_code;
      const uomType = row.uom ?? 'Drum';
      const ins = await q(
        `INSERT INTO products (product_code, product_name, description, uom_type, uom_per_pallet,
           liters_per_unit, max_sku_qty, max_trans_qty, reorder_level, is_active)
         VALUES ($1,$2,$3,$4,$5,209.00,44,80,0,1) RETURNING id`,
        [code, name, row.description || null, uomType, importUomPerPallet(uomType, 4, name)],
      );
      row.product_id = Number(ins.rows[0].id);
      row.uom_per_pallet = importUomPerPallet(uomType, 4, name);
      row.pallet = Math.ceil(row.quantity / Math.max(1, row.uom_per_pallet));
      row._auto_create = false;
      created++;
    }
    return created;
  }

  private async autoCreateInbound(q: QFn, rows: Q[], log: string[], userId: number): Promise<{ orders: number; items: number }> {
    const groups: Record<string, Q[]> = {};
    for (const row of rows) {
      if ((row._errors?.length ?? 0) > 0 || !row.product_id) continue;
      const gr = row.manufacture_date || 'NO_GR_DATE';
      (groups[gr] ??= []).push(row);
    }
    let orders = 0;
    let items = 0;
    for (const [gr, groupRows] of Object.entries(groups)) {
      const orderDate = gr === 'NO_GR_DATE' ? todayStr() : gr;
      const note = 'Auto import (WMS) — GR: ' + gr;
      const existingInb = await q(
        `SELECT id, order_number FROM inbound_orders WHERE order_date=$1 AND status='Completed' AND notes=$2 LIMIT 1`,
        [orderDate, note],
      );
      if (existingInb.rows.length > 0) {
        log.push(`Inbound (GR: ${gr}) sudah ada — ${existingInb.rows[0].order_number}, dilewati`);
        continue;
      }
      const orderNumber = await this.inboundNumberFromQ(q);
      const ins = await q(
        `INSERT INTO inbound_orders (order_number, order_date, carrier_name, status, notes, created_by)
         VALUES ($1,$2,NULL,'Completed',$3,$4) RETURNING id`,
        [orderNumber, orderDate, note, userId],
      );
      const inboundId = Number(ins.rows[0].id);
      let i = 0;
      for (const row of groupRows) {
        const uomPerPallet = row.uom_per_pallet ?? importUomPerPallet(row.uom, 4);
        const pallet = Math.ceil(row.quantity / Math.max(1, uomPerPallet));
        await q(
          `INSERT INTO inbound_items (inbound_order_id, product_id, batch_number, location, quantity, uom,
             actual_qty, pallet, manufacture_date, exp_date, stock_status, in_process_status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Accepted','ATP','Auto import')`,
          [inboundId, row.product_id, row.batch_number || null, row.location || null, row.quantity, row.uom,
           row.quantity, pallet, row.manufacture_date || null, row.expiry_date || null],
        );
        i++;
      }
      orders++;
      items += i;
      log.push(`Inbound #${orderNumber} (GR: ${gr}) — ${i} item`);
    }
    return { orders, items };
  }

  private async inboundNumberFromQ(q: QFn): Promise<string> {
    const prefix = `IN-${todayStr().slice(0, 7).replace('-', '')}-`;
    const last = await q('SELECT order_number FROM inbound_orders WHERE order_number LIKE $1 ORDER BY order_number DESC LIMIT 1', [prefix + '%']);
    let seq = 1;
    if (last.rows.length > 0) {
      const idx = last.rows[0].order_number.lastIndexOf('-');
      seq = Number.parseInt(last.rows[0].order_number.slice(idx + 1), 10) + 1;
    }
    for (let i = 0; i < 20; i++) {
      const candidate = prefix + String(seq).padStart(4, '0');
      const chk = await q('SELECT id FROM inbound_orders WHERE order_number = $1 LIMIT 1', [candidate]);
      if (chk.rows.length === 0) return candidate;
      seq++;
    }
    return prefix + nowCompactTime() + Math.floor(Math.random() * 90 + 10);
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

async function generateInboundNumber(q: QFn): Promise<string> {
  const prefix = `IN-${todayStr().slice(0, 7).replace('-', '')}-`;
  const last = await q('SELECT order_number FROM inbound_orders WHERE order_number LIKE $1 ORDER BY order_number DESC LIMIT 1', [prefix + '%']);
  let seq = 1;
  if (last.rows.length > 0) {
    const idx = last.rows[0].order_number.lastIndexOf('-');
    seq = Number.parseInt(last.rows[0].order_number.slice(idx + 1), 10) + 1;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = prefix + String(seq).padStart(4, '0');
    const chk = await q('SELECT id FROM inbound_orders WHERE order_number = $1 LIMIT 1', [candidate]);
    if (chk.rows.length === 0) return candidate;
    seq++;
  }
  return prefix + nowCompactTime() + Math.floor(Math.random() * 90 + 10);
}

async function generateOutboundNumber(q: QFn): Promise<string> {
  const prefix = `OUT-${todayStr().slice(0, 7).replace('-', '')}-`;
  const last = await q('SELECT order_number FROM outbound_orders WHERE order_number LIKE $1 ORDER BY order_number DESC LIMIT 1', [prefix + '%']);
  let seq = 1;
  if (last.rows.length > 0) {
    const idx = last.rows[0].order_number.lastIndexOf('-');
    seq = Number.parseInt(last.rows[0].order_number.slice(idx + 1), 10) + 1;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = prefix + String(seq).padStart(4, '0');
    const chk = await q('SELECT id FROM outbound_orders WHERE order_number = $1 LIMIT 1', [candidate]);
    if (chk.rows.length === 0) return candidate;
    seq++;
  }
  return prefix + nowCompactTime() + Math.floor(Math.random() * 90 + 10);
}

function classifySheet(name: string): string {
  const n = String(name).toLowerCase();
  if (n.includes('master')) return 'master';
  if (n.includes('wms')) return 'wms';
  if (n.includes('putaway')) return 'putaway';
  if (n.includes('schedule')) return 'schedule';
  return 'skip';
}

function inferUom(upp: number): string {
  if (upp <= 1) return 'Bags';
  if (upp <= 8) return 'Drum';
  if (upp <= 28) return 'Pail';
  return 'Carton';
}
