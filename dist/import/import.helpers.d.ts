export declare function importParseDate(val: any): string | null;
export declare function importNormalizeUom(raw: any, fallback?: string): string;
export declare function importUomPerPallet(uom: string, productUpp?: number): number;
export declare function importHeaderIndex(row: any[]): Record<string, number>;
export declare function importResolveCol(headers: any[], patterns: string[]): number | null;
export declare function importDetectHeader(allRows: any[][]): {
    index: number;
    row: any[];
};
export declare const SHIP_TO_NAME_KEYS: readonly ["name of ship-to party", "name of the ship-to party", "ship-to party", "ship to name", "ship-to name", "destination"];
export declare const SHIP_TO_LOC_KEYS: readonly ["location of ship-to party", "location of the ship-to party", "ship to location", "ship-to location", "destination"];
export declare const MASTER_PRODUCT_CODE_KEYS: readonly ["material", "item", "item code", "product code", "sku", "code"];
export declare function importGetter(colMap: Record<string, number>, row: any[]): (...keys: string[]) => string;
export declare function importIsMetaRow(row: any[]): boolean;
