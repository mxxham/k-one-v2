import { palletFunctionFor } from './pallet';

/**
 * Single write path for a stock_locations row. Every caller (inbound auto
 * suggest, manual save, putaway task completion) derives pallet_function the
 * same way so the 3D rack map's BULK / PICK FACE badge is always correct.
 */
export interface StockLocationWrite {
  stock_id: number | null;
  location_code: string;
  pallet_seq: number;
  quantity: number;
  original_quantity: number;
  uom: string;
  is_full_pallet: number;
  batch_number: string | null;
  inbound_item_id: number | null;
  status?: string;
}

export async function insertStockLocation(dbc: any, w: StockLocationWrite): Promise<void> {
  await dbc.query(
    `INSERT INTO stock_locations
       (stock_id, location_code, pallet_seq, quantity, original_quantity, uom,
        is_full_pallet, batch_number, inbound_item_id, status, pallet_function)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      w.stock_id,
      w.location_code,
      w.pallet_seq,
      w.quantity,
      w.original_quantity,
      w.uom,
      w.is_full_pallet,
      w.batch_number,
      w.inbound_item_id,
      w.status ?? 'Available',
      palletFunctionFor(w.location_code),
    ],
  );
}