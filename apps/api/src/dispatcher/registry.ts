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

/**
 * Department requirements per action. A module-level default applies to every
 * action in the module; a per-action override wins. When set, only users whose
 * department is in the list (or department === 'all', which always passes) may
 * run the action. Unset (or an explicit EMPTY override array) means no
 * department restriction — an empty array lets an action opt out of its
 * module's default (e.g. putaway::my_tasks is open to any department because
 * the checklist partner may be from any active department).
 */
const departmentDefaults = new Map<string, string[]>();
const departmentOverrides = new Map<string, string[]>();

export function setModuleDepartments(module: string, departments: string[]): void {
  departmentDefaults.set(module, departments);
}

export function setActionDepartments(module: string, action: string, departments: string[]): void {
  departmentOverrides.set(`${module}::${action}`, departments);
}

export function getDepartments(module: string, action: string): string[] | undefined {
  const key = `${module}::${action}`;
  if (departmentOverrides.has(key)) {
    const o = departmentOverrides.get(key);
    return o && o.length > 0 ? o : undefined;
  }
  return departmentDefaults.get(module);
}