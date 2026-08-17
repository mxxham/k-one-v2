import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({
  getStoredUser: vi.fn(),
  setSession: vi.fn(),
  clearSession: vi.fn(),
  loginApi: vi.fn(),
  logoutApi: vi.fn(),
  api: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('@/lib/api', () => mockApi);

import { AuthProvider, useAuth } from './AuthContext';

function Harness() {
  const { user, isAuthenticated, canWrite, canAdmin, department, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <div data-testid="dept">{department}</div>
      <div data-testid="authed">{String(isAuthenticated)}</div>
      <div data-testid="canWrite">{String(canWrite)}</div>
      <div data-testid="canAdmin">{String(canAdmin)}</div>
      <div data-testid="name">{user?.full_name || 'none'}</div>
      <button onClick={() => login('u', 'p')}>login</button>
      <button onClick={logout}>logout</button>
      <button onClick={refreshUser}>refresh</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

const adminUser = { id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin', department: 'all' };

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getStoredUser.mockReturnValue(null);
});

describe('AuthProvider', () => {
  it('starts unauthenticated with department all when no stored user', () => {
    renderProvider();
    expect(screen.getByTestId('authed').textContent).toBe('false');
    expect(screen.getByTestId('dept').textContent).toBe('all');
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('restores the stored user and derives flags', () => {
    mockApi.getStoredUser.mockReturnValue(adminUser);
    renderProvider();
    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(screen.getByTestId('canWrite').textContent).toBe('true');
    expect(screen.getByTestId('canAdmin').textContent).toBe('true');
    expect(screen.getByTestId('name').textContent).toBe('Admin');
  });

  it('normalizes an invalid stored department to all', () => {
    mockApi.getStoredUser.mockReturnValue({ ...adminUser, department: 'evil' });
    renderProvider();
    expect(screen.getByTestId('dept').textContent).toBe('all');
  });

  it('keeps valid departments intact', () => {
    mockApi.getStoredUser.mockReturnValue({ ...adminUser, department: 'inbound' });
    renderProvider();
    expect(screen.getByTestId('dept').textContent).toBe('inbound');
  });

  it('login stores the user', async () => {
    mockApi.loginApi.mockResolvedValue(adminUser);
    renderProvider();
    act(() => {
      screen.getByRole('button', { name: 'login' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('true'));
    expect(screen.getByTestId('name').textContent).toBe('Admin');
    expect(mockApi.loginApi).toHaveBeenCalledWith('u', 'p');
  });

  it('logout clears the user', async () => {
    mockApi.getStoredUser.mockReturnValue(adminUser);
    renderProvider();
    act(() => {
      screen.getByRole('button', { name: 'logout' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('false'));
    expect(mockApi.logoutApi).toHaveBeenCalled();
    expect(mockApi.clearSession).toHaveBeenCalled();
  });

  it('refreshUser syncs the user and re-persists the session', async () => {
    mockApi.getStoredUser.mockReturnValue(adminUser);
    mockApi.api.mockResolvedValue({ success: true, user: { ...adminUser, full_name: 'Renamed' } });
    mockApi.getToken.mockReturnValue('tok');
    renderProvider();
    act(() => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Renamed'));
    expect(mockApi.setSession).toHaveBeenCalledWith('tok', expect.objectContaining({ full_name: 'Renamed' }));
  });

  it('refreshUser ignores errors', async () => {
    mockApi.getStoredUser.mockReturnValue(adminUser);
    mockApi.api.mockRejectedValue(new Error('down'));
    renderProvider();
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });
    expect(screen.getByTestId('name').textContent).toBe('Admin');
  });

  it('viewer role cannot write or admin', () => {
    mockApi.getStoredUser.mockReturnValue({ ...adminUser, role: 'viewer' });
    renderProvider();
    expect(screen.getByTestId('canWrite').textContent).toBe('false');
    expect(screen.getByTestId('canAdmin').textContent).toBe('false');
  });

  it('useAuth throws outside of an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() {
      useAuth();
      return null;
    }
    expect(() => render(<Bad />)).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });
});
