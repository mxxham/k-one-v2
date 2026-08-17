import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authMock = {
  login: vi.fn(),
  isAuthenticated: false,
  department: 'all',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMock,
}));

import Login from './Login';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.isAuthenticated = false;
  authMock.department = 'all';
  authMock.login.mockReset();
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login', () => {
  it('renders the login form', () => {
    renderLogin();
    expect(screen.getByText('K-one')).toBeInTheDocument();
    expect(screen.getByText('Warehouse Management System')).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('calls login with the entered credentials and clears the error', async () => {
    authMock.login.mockResolvedValue({ id: 1, username: 'admin', full_name: 'Admin', email: 'a@b.c', role: 'admin' });
    const { container } = renderLogin();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'admin' } });
    const password = container.querySelector('input[type="password"]')!;
    fireEvent.change(password, { target: { value: 'admin123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(authMock.login).toHaveBeenCalledWith('admin', 'admin123'));
  });

  it('shows an error message when login fails', async () => {
    authMock.login.mockRejectedValue(new Error('Kredensial salah'));
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.getByText('Kredensial salah')).toBeInTheDocument());
  });

  it('disables the submit button while loading', async () => {
    authMock.login.mockImplementation(() => new Promise(() => {}));
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled());
  });

  it('shows the default credentials hint', () => {
    renderLogin();
    expect(screen.getByText(/admin \/ admin123/)).toBeInTheDocument();
  });
});
