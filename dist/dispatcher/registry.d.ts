import { CurrentUser } from '../auth/guards';
export interface RequestContext {
    user: CurrentUser;
    query: Record<string, any>;
    body: Record<string, any>;
    raw: any;
}
export type ActionHandler = (ctx: RequestContext) => Promise<Record<string, any> | void>;
export declare function registerActions(module: string, actions: Record<string, ActionHandler>): void;
export declare function getActionHandler(module: string, action: string): ActionHandler | undefined;
export declare function knownModule(module: string): boolean;
export declare function setPermission(module: string, action: string, level: 'write' | 'admin' | 'any'): void;
export declare function getPermission(module: string, action: string): 'write' | 'admin' | 'any';
