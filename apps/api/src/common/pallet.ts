/**
 * Pallet math mirroring PalletHelper.php + Product.php helpers.
 * Two conventions coexist:
 *  - calculatePallet: floor + integer % (decomposed object)
 *  - ceil-based: used in stock build / inbound items / level-aware calc
 */
export function calculatePallet(qty: number, uom = 'Drum', custom: number | null = null): {
  units: number;
  pallets: number;
  pallet_decimal: number;
  remainder: number;
  pallet_capacity: number;
} {
  const DEFAULT_PALLET: Record<string, number> = { Drum: 4, Carton: 44, Pail: 24 };
  const capacity = custom ?? DEFAULT_PALLET[uom] ?? 4;
  const units = qty;
  const pallets = Math.floor(qty / capacity);
  const remainder = qty % capacity;
  return {
    units,
    pallets,
    pallet_decimal: Number((qty / capacity).toFixed(2)),
    remainder,
    pallet_capacity: capacity,
  };
}

/** PalletHelper DEFAULT_PALLET + UOM_PALLET map. */
export function getPalletCapacity(uom: string, custom: number | null = null): number {
  if (custom && custom > 0) return custom;
  const map: Record<string, number> = { Drum: 4, Carton: 44, Pail: 24 };
  return map[uom] ?? 4;
}

/** Product::getUomOptions */
export function getUomOptions(uomType: string): number[] {
  const options: Record<string, number[]> = {
    Drum: [4],
    Carton: [36, 44, 48],
    Pail: [24],
    EA: [4],
    Bags: [1],
  };
  return options[uomType] ?? [4];
}

/** Product::calculatePalletDistribution — full pallets + remainder (floor/intdiv). */
export function calculatePalletDistribution(totalQty: number, uomPerPallet: number): Array<{
  pallet_number: number;
  quantity: number;
  is_full: boolean;
}> {
  const upp = Math.max(1, Math.floor(uomPerPallet));
  const fullPallets = Math.floor(totalQty / upp);
  const remainder = totalQty % upp;
  const distribution: Array<{ pallet_number: number; quantity: number; is_full: boolean }> = [];
  let palletNumber = 1;
  for (let i = 0; i < fullPallets; i++) {
    distribution.push({ pallet_number: palletNumber++, quantity: upp, is_full: true });
  }
  if (remainder > 0) {
    distribution.push({ pallet_number: palletNumber, quantity: remainder, is_full: false });
  }
  return distribution;
}

/** Level = 5th char of location code (loc[4], uppercase). Used by calcPalletByLocation. */
export function levelOf(locationCode: string | null | undefined): string {
  if (!locationCode) return 'B';
  return (locationCode[4] ?? 'B').toUpperCase();
}

/**
 * calcPalletByLocation: level 'A' -> round(qty/upp,2) fractional,
 * other levels -> (int) ceil.
 */
export function calcPalletByLocation(qty: number, upp: number, loc: string | null | undefined): number {
  if (upp <= 0) return 0;
  const level = levelOf(loc);
  if (level === 'A') {
    return Number((qty / upp).toFixed(2));
  }
  return Math.ceil(qty / upp);
}

/** PalletHelper::calculateExpiryDate (uses server Y-m-d string arithmetic via addYears). */
export function calculateExpiryDate(productionDate: string | null | undefined, years = 4): string | null {
  if (!productionDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(productionDate).trim());
  if (!m) return null;
  const y = Number(m[1]) + years;
  const month = Number(m[2]);
  const maxDay = new Date(y, month, 0).getDate();
  const day = Math.min(Number(m[3]), maxDay);
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface ExpiryInfo {
  days: number | null;
  months: number | null;
  remaining_days: number | null;
  text: string;
  is_critical: boolean;
  is_expired: boolean;
}

/** PalletHelper::getExpiryInfo — days/months until expiry. */
export function getExpiryInfo(expiryDate: string | null | undefined): ExpiryInfo {
  if (!expiryDate) {
    return { days: null, months: null, remaining_days: null, text: 'No expiry', is_critical: false, is_expired: false };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiryDate));
  if (!m) {
    return { days: null, months: null, remaining_days: null, text: 'No expiry', is_critical: false, is_expired: false };
  }
  const expMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((expMs - nowMs) / 86_400_000);
  const inverted = diffDays < 0;
  const absDays = Math.abs(diffDays);
  const months = Math.floor(absDays / 30);
  const remainingDays = absDays % 30;
  const text = inverted
    ? `Expired ${absDays} days ago`
    : `${months}m ${remainingDays}d left`;
  return {
    days: diffDays,
    months: months,
    remaining_days: inverted ? -absDays : absDays,
    text,
    is_critical: inverted || diffDays <= 120,
    is_expired: inverted,
  };
}

/** Product::validateQuantity messages (exact). */
export function validateQuantity(
  qty: number,
  product: { max_sku_qty?: number | null; max_trans_qty?: number | null },
  currentStock = 0,
): { valid: boolean; message?: string } {
  const maxSku = product.max_sku_qty ?? 44;
  const maxTrans = product.max_trans_qty ?? 80;
  if (qty > maxTrans) {
    return { valid: false, message: `Quantity cannot exceed ${maxTrans} per transaction` };
  }
  if (qty > maxSku) {
    return { valid: false, message: `Quantity cannot exceed ${maxSku} per SKU` };
  }
  if (currentStock + qty > maxSku) {
    return {
      valid: false,
      message: `Total stock would exceed maximum SKU limit (${maxSku}). Current: ${currentStock}, Adding: ${qty}, Max allowed: ${maxSku}`,
    };
  }
  return { valid: true };
}
