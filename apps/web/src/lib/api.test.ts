import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getToken,
  setSession,
  getStoredUser,
  clearSession,
  api,
  uploadApi,
  apiHref,
  webBase,
  loginApi,
  logoutApi,
  departmentHome,
} from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('session helpers', () => {
  it('round-trips a token and user through localStorage', () => {
    const user = { id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin' };
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();

    setSession('abc123', user);
    expect(getToken()).toBe('abc123');
    expect(getStoredUser()).toEqual(user);
  });

  it('clearSession removes both keys', () => {
    setSession('abc123', { id: 1, username: 'u', full_name: 'U', email: 'x', role: 'viewer' });
    clearSession();
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('getStoredUser tolerates corrupt JSON', () => {
    localStorage.setItem('kone_user', '{not json');
    expect(getStoredUser()).toBeNull();
  });
});

describe('departmentHome', () => {
  it('maps each department to its home route', () => {
    expect(departmentHome('inbound')).toBe('/dashboard/inbound');
    expect(departmentHome('outbound')).toBe('/dashboard/outbound');
    expect(departmentHome('inventory')).toBe('/dashboard/inventory');
    expect(departmentHome('ops')).toBe('/putaway-tasks');
  });

  it('defaults to the combined dashboard for all/unknown', () => {
    expect(departmentHome('all')).toBe('/dashboard');
    expect(departmentHome(undefined)).toBe('/dashboard');
    expect(departmentHome('weird' as any)).toBe('/dashboard');
  });
});

describe('api', () => {
  it('sends module/action params and returns the payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { rows: [] } }));

    const res = await api('products', 'list', { params: { page: 2, q: 'oil' } });

    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('module=products');
    expect(String(url)).toContain('action=list');
    expect(String(url)).toContain('page=2');
    expect(String(url)).toContain('q=oil');
    expect(init.method).toBe('GET');
  });

  it('omits empty/undefined params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await api('stock', 'list', { params: { q: '', n: null, keep: '1' } });
    const q = new URLSearchParams(String(fetchMock.mock.calls[0][0]).split('?')[1]);
    expect(q.has('q')).toBe(false);
    expect(q.has('n')).toBe(false);
    expect(q.get('keep')).toBe('1');
  });

  it('adds the Authorization header from the stored token', async () => {
    setSession('tok', { id: 1, username: 'u', full_name: 'U', email: 'x', role: 'viewer' });
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await api('auth', 'me');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('auto-upgrades GET-with-body to POST and sends JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await api('stock', 'hold', { body: { id: 1, reason: 'qc' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ id: 1, reason: 'qc' });
  });

  it('throws the server message when success is false', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, message: 'Stok tidak cukup' }, true, 409));
    await expect(api('outbound', 'pick_items')).rejects.toThrow('Stok tidak cukup');
  });

  it('throws on non-OK responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }, false, 500));
    await expect(api('x', 'y')).rejects.toThrow('nope');
  });

  it('throws when the server returns invalid JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('boom')) } as unknown as Response);
    await expect(api('x', 'y')).rejects.toThrow('invalid JSON');
  });

  it('sends FormData as a POST without a JSON content-type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'a.xlsx');
    await api('import', 'inbound', { body: fd });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('module=import');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.body).toBe(fd);
  });

  it('passes through an abort signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const controller = new AbortController();
    await api('x', 'y', { signal: controller.signal });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('uploadApi', () => {
  it('delegates to api with a FormData body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, message: 'ok' }));
    const fd = new FormData();
    const res = await uploadApi('import', 'stock_preview', fd);
    expect(res.message).toBe('ok');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(fd);
  });
});

describe('apiHref / webBase', () => {
  it('builds an absolute URL with token query param', () => {
    setSession('tok', { id: 1, username: 'u', full_name: 'U', email: 'x', role: 'viewer' });
    const href = apiHref('export', 'stock', { year: 2026 });
    expect(href).toContain('module=export');
    expect(href).toContain('action=stock');
    expect(href).toContain('year=2026');
    expect(href).toContain('token=tok');
  });

  it('omits empty params and token when absent', () => {
    const href = apiHref('print', 'picklist', { id: '', outbound_id: 4 });
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.has('id')).toBe(false);
    expect(q.get('outbound_id')).toBe('4');
    expect(q.has('token')).toBe(false);
  });

  it('webBase strips a trailing /api path', () => {
    expect(webBase()).not.toMatch(/\/api\/?$/);
  });
});

describe('loginApi / logoutApi', () => {
  it('stores the session and returns the user on success', async () => {
    const user = { id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin' };
    fetchMock.mockResolvedValue(jsonResponse({ success: true, token: 'tok', user }));
    const result = await loginApi('admin', 'secret');
    expect(result).toEqual(user);
    expect(getToken()).toBe('tok');

    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain('admin');
  });

  it('throws when the response has no token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await expect(loginApi('admin', 'bad')).rejects.toThrow('Login gagal');
  });

  it('logout clears the session and does not throw on network errors', async () => {
    setSession('tok', { id: 1, username: 'u', full_name: 'U', email: 'x', role: 'viewer' });
    fetchMock.mockRejectedValue(new Error('offline'));
    await logoutApi();
    expect(getToken()).toBeNull();
  });

  it('logout is a no-op without a token', async () => {
    await logoutApi();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
