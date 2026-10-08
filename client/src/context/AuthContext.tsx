import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, hasSessionHint, refreshSession, setToken } from '../lib/api';
import type { Role, User } from '../lib/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = hasSessionHint() ? await refreshSession() : null;
      if (token && !cancelled) {
        try {
          const { user: me } = await api<{ user: User }>('/api/auth/me');
          if (!cancelled) setUser(me);
        } catch {
          setToken(null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Proactively refresh the 15-minute access token.
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => void refreshSession(), 12 * 60_000);
    return () => window.clearInterval(id);
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; accessToken: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.accessToken);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api<{ user: User; accessToken: string }>('/api/auth/register', { method: 'POST', body: { name, email, password } });
    setToken(res.accessToken);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ user, ready, login, register, logout, hasRole: (...roles) => Boolean(user && roles.includes(user.role)) }),
    [user, ready, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const isStaff = (u: User | null) => u?.role === 'agent' || u?.role === 'admin';
