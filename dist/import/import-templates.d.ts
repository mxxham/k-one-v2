interface TplResult {
    buffer: Buffer;
    filename: string;
    contentType: string;
}
export declare function tplInbound(): Promise<TplResult>;
export declare function tplOutbound(): Promise<TplResult>;
export declare function tplStock(): Promise<TplResult>;
export {};
