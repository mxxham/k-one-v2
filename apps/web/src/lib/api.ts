export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  department?: string;
}

export type Department = 'inbound' | 'outbound' | 'inventory' | 'all';

export const DEPARTMENTS: Array<{ key: Department; label: string }> = [
  { key: 'inbound', label: 'Inbound' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'all', label: 'Semua Departemen (Supervisor)' },
];

/** Home route per department; 'all' (supervisor/admin) gets the combined dashboard. */
export function departmentHome(department?: string): string {
  switch (department) {
    case 'inbound':
      return '/dashboard/inbound';
    case 'outbound':
      return '/dashboard/outbound';
    case 'inventory':
      return '/dashboard/inventory';
    default:
      return '/dashboard';
  }
}

export interface ApiResult<T = any> {
  success: boolean;
  message?: string;
  [key: string]: any;
}

const TOKEN_KEY = 'kone_token';
const USER_KEY = 'kone_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// New K-one v2 backend (NestJS). Dev: VITE_API_BASE=http://localhost:3000
// (the gateway route is /index.php). Prod: served by nginx as /k-one/api.
const DEFAULT_BASE = 'http://localhost:3000';
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || DEFAULT_BASE;

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, any>;
  body?: any;
  signal?: AbortSignal;
}

async function handleResponse(res: Response): Promise<any> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned invalid JSON (HTTP ${res.status})`);
  }
  if (!res.ok || (data && data.success === false)) {
    const msg = data?.message || `Request failed (HTTP ${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function api<T = any>(module: string, action: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  if (opts.body instanceof FormData) {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/index.php?module=${module}&action=${action}`, {
      method: 'POST',
      headers,
      body: opts.body,
    });
    return handleResponse(res);
  }
  const { method = 'GET', params = {}, body } = opts;
  const token = getToken();

  const query = new URLSearchParams();
  query.set('module', module);
  query.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // A body implies a mutation — fetch rejects GET/HEAD with a body, so any
  // call site that passes body without an explicit method is treated as POST.
  const useMethod = body !== undefined && method === 'GET' ? 'POST' : method;

  const res = await fetch(`${BASE}/index.php?${query.toString()}`, {
    method: useMethod,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  return handleResponse(res);
}

/** Upload a file (multipart FormData) to a JSON API endpoint. */
export async function uploadApi<T = any>(module: string, action: string, formData: FormData): Promise<ApiResult<T>> {
  return api<T>(module, action, { method: 'POST', body: formData });
}

/**
 * Build an absolute URL to a JSON API endpoint for token-based navigation
 * (downloads / print). The token is appended as a query param, which the
 * PHP API accepts as a fallback to the Authorization header.
 */
export function apiHref(module: string, action: string, params?: Record<string, any>): string {
  const q = new URLSearchParams({ module, action });
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const token = getToken();
  if (token) q.set('token', token);
  return `${BASE}/index.php?${q.toString()}`;
}

/** Web root of the PHP server (base URL without the `/api` suffix). */
export function webBase(): string {
  return BASE.replace(/\/api\/?$/, '');
}

/** Open a legacy server-rendered PHP page (print/export) in a new tab. */
export function openWebPage(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Login special-cased so it works before a token exists. */
export async function loginApi(username: string, password: string) {
  const res = await fetch(`${BASE}/index.php?module=auth&action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await handleResponse(res);
  if (!data.token) throw new Error('Login gagal');
  setSession(data.token, data.user);
  return data.user as User;
}

export async function logoutApi() {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${BASE}/index.php?module=auth&action=logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignore network errors on logout
  }
  clearSession();
}
