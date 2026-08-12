import { CurrentUser } from '../auth/guards';

export interface RequestContext {
  user: CurrentUser;
  query: Record<string, any>;
  body: Record<string, any>;
  raw: any;
}

/**
 * A domain action handler. Receives parsed query + body and current user,
 * returns the payload to merge into {success:true, ...payload}.
 */
export type ActionHandler = (ctx: RequestContext) => Promise<Record<string, any> | void>;

const registry = new Map<string, Map<string, ActionHandler>>();

export function registerActions(module: string, actions: Record<string, ActionHandler>): void {
  let m = registry.get(module);
  if (!m) {
    m = new Map();
    registry.set(module, m);
  }
  for (const [action, fn] of Object.entries(actions)) {
    m.set(action, fn);
  }
}

export function getActionHandler(module: string, action: string): ActionHandler | undefined {
  return registry.get(module)?.get(action);
}

export function knownModule(module: string): boolean {
  return registry.has(module);
}

/** Role requirements per action: 'write' (default) or 'admin'. */
const permissions = new Map<string, 'write' | 'admin' | 'any'>();

export function setPermission(module: string, action: string, level: 'write' | 'admin' | 'any'): void {
  permissions.set(`${module}::${action}`, level);
}

export function getPermission(module: string, action: string): 'write' | 'admin' | 'any' {
  return permissions.get(`${module}::${action}`) ?? 'any';
}