export type SheetGrid = any[][];
export declare function readSheetBuffer(buffer: Buffer, name: string): SheetGrid;
export declare function readWorkbookSheets(buffer: Buffer, name: string): {
    name: string;
    rows: SheetGrid;
}[];
