import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authMock: any = {
  user: { id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin' },
  canWrite: true,
  canAdmin: true,
  department: 'all',
  logout: vi.fn(),
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMock,
}));

import Layout from './Layout';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.user = { id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin' };
  authMock.canWrite = true;
  authMock.canAdmin = true;
  authMock.department = 'all';
  authMock.logout = vi.fn();
});

function renderLayout(path = '/stock') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  it('renders the page title from the route', () => {
    renderLayout('/stock');
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0);
  });

  it('renders the user name and role badge', () => {
    renderLayout();
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
  });

  it('shows an ops user the putaway tasks menu instead of dashboards', () => {
    authMock.department = 'ops';
    renderLayout('/putaway-tasks');
    expect(screen.getByText('Putaway Tasks')).toBeInTheDocument();
    expect(screen.queryByText('Inbound')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
  });

  it('hides write-only sections from non-write users', () => {
    authMock.canWrite = false;
    authMock.role = 'viewer';
    renderLayout('/stock');
    expect(screen.queryByText('Excel Import')).toBeNull();
    expect(screen.queryByText('Master Data')).toBeNull();
  });

  it('hides the admin section from non-admin users', () => {
    authMock.user = { ...authMock.user, full_name: 'Super User' };
    authMock.canAdmin = false;
    renderLayout('/stock');
    expect(screen.queryByText('Users')).toBeNull();
    expect(screen.queryByText('Activity Log')).toBeNull();
    expect(screen.queryByText('Reset Data')).toBeNull();
  });

  it('shows the viewer-only banner for viewers', () => {
    authMock.user = { ...authMock.user, role: 'viewer' };
    renderLayout();
    expect(screen.getByText('Mode View Only')).toBeInTheDocument();
  });

  it('shows a department badge in the header for non-all departments', () => {
    authMock.department = 'inbound';
    renderLayout('/inbound');
    expect(screen.getByText('inbound')).toBeInTheDocument();
  });

  it('logs out and navigates to login', () => {
    authMock.logout.mockResolvedValue(undefined);
    renderLayout();
    const logoutButtons = screen.getAllByTitle('Logout');
    fireEvent.click(logoutButtons[0]);
    expect(authMock.logout).toHaveBeenCalled();
  });
});
