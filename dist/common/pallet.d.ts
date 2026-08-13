export declare function calculatePallet(qty: number, uom?: string, custom?: number | null): {
    units: number;
    pallets: number;
    pallet_decimal: number;
    remainder: number;
    pallet_capacity: number;
};
export declare function getPalletCapacity(uom: string, custom?: number | null): number;
export declare function getUomOptions(uomType: string): number[];
export declare function calculatePalletDistribution(totalQty: number, uomPerPallet: number): Array<{
    pallet_number: number;
    quantity: number;
    is_full: boolean;
}>;
export declare function levelOf(locationCode: string | null | undefined): string;
export declare function calcPalletByLocation(qty: number, upp: number, loc: string | null | undefined): number;
export declare function calculateExpiryDate(productionDate: string | null | undefined, years?: number): string | null;
export interface ExpiryInfo {
    days: number | null;
    months: number | null;
    remaining_days: number | null;
    text: string;
    is_critical: boolean;
    is_expired: boolean;
}
export declare function getExpiryInfo(expiryDate: string | null | undefined): ExpiryInfo;
export declare function validateQuantity(qty: number, product: {
    max_sku_qty?: number | null;
    max_trans_qty?: number | null;
}, currentStock?: number): {
    valid: boolean;
    message?: string;
};
