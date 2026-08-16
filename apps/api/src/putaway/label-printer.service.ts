import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';

/**
 * Everything the browser needs to render a printable LPN label. The frontend
 * draws the barcode (JsBarcode) + text and triggers window.print() — nothing
 * is rendered server-side in this phase.
 */
export interface LpnLabelData {
  lpn_code: string;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  uom: string | null;
  quantity: number;
  pallet_seq: number;
  suggested_location: string | null;
  expiry_date: string | null;
  task_number: string | null;
  order_number: string | null;
}

export interface PrintResult {
  success: boolean;
  message: string;
}

/**
 * The print step lives behind a small abstraction so the browser rendering
 * (and the action handlers) stay stable when real thermal-printer hardware
 * arrives. HtmlLabelPrinterService — the implementation this phase — does NOT
 * print anything server-side; it just confirms the LPN exists and hands back
 * the data needed to render a printable label in the browser.
 */
export interface LabelPrinterService {
  printLpnLabel(data: LpnLabelData): Promise<PrintResult>;
}

@Injectable()
export class HtmlLabelPrinterService implements LabelPrinterService {
  constructor(private readonly db: DbService) {}

  async printLpnLabel(data: LpnLabelData): Promise<PrintResult> {
    const r = await this.db.query('SELECT 1 FROM putaway_task_items WHERE lpn_code = $1 LIMIT 1', [data.lpn_code]);
    if (r.rows.length === 0) {
      throw ApiException.notFound(`LPN ${data.lpn_code} tidak ditemukan.`);
    }
    return { success: true, message: 'LPN valid — label siap dicetak di browser.' };
  }
}