import { createContext, useContext, useCallback, useMemo, useState, ReactNode } from 'react';
import { User, getStoredUser, setSession, clearSession, loginApi, logoutApi, api, getToken } from '@/lib/api';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());

  const login = useCallback(async (username: string, password: string) => {
    const u = await loginApi(username, password);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    clearSession();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api('auth', 'me');
      const u = res.user as User;
      setUser(u);
      const token = getToken();
      if (token) setSession(token, u);
    } catch {
      // ignore — auth guard will handle
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      canWrite: !!user && ['admin', 'operator', 'warehouse', 'supervisor', 'staff'].includes(user.role),
      canAdmin: !!user && user.role === 'admin',
      login,
      logout,
      refreshUser,
    }),
    [user, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
