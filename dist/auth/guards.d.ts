import { CanActivate, ExecutionContext } from '@nestjs/common';
import { DbService } from '../database/db.service';
export interface CurrentUser {
    id: number;
    username: string;
    full_name: string;
    email: string;
    role: string;
    department: string;
}
export declare const DEPARTMENTS: readonly ["inbound", "outbound", "inventory", "all"];
export type Department = (typeof DEPARTMENTS)[number];
export declare function isDepartment(v: unknown): v is Department;
export declare function resolveUser(db: DbService, req: any): Promise<CurrentUser | null>;
export declare class AuthGuard implements CanActivate {
    private readonly db;
    constructor(db: DbService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class WriteGuard implements CanActivate {
    private readonly db;
    constructor(db: DbService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class AdminGuard implements CanActivate {
    private readonly db;
    constructor(db: DbService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
