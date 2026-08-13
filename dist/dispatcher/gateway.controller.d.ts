import { StreamableFile } from '@nestjs/common';
import { Request, Response } from 'express';
import { DbService } from '../database/db.service';
export declare class GatewayController {
    private readonly db;
    private readonly logger;
    constructor(db: DbService);
    get(query: Record<string, any>, req: Request, res: Response): Promise<Record<string, any> | StreamableFile | string>;
    post(query: Record<string, any>, body: Record<string, any>, req: Request, res: Response): Promise<Record<string, any> | StreamableFile | string>;
    private handle;
}
