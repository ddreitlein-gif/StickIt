import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('stickit_auth_token'));
  const [authEnabled, setAuthEnabled] = useState(false);
  const [envForced, setEnvForced] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/auth/status');
      const status = await statusRes.json();
      setAuthEnabled(status.enabled);
      setEnvForced(status.envForced || false);

      const storedToken = localStorage.getItem('stickit_auth_token');
      if (status.enabled && storedToken) {
        const meRes = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (meRes.ok) {
          setUser(await meRes.json());
          setToken(storedToken);
        } else {
          localStorage.removeItem('stickit_auth_token');
          setToken(null);
          setUser(null);
        }
      } else if (!status.enabled) {
        // Auth off — clear any stale state but keep token in storage (non-destructive)
        setUser(null);
      }
    } catch (_) {
      // Network error — leave state unchanged
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for 401 events from apiFetch
  useEffect(() => {
    const handler = () => {
      setUser(null);
      setToken(null);
    };
    window.addEventListener('stickit:auth-expired', handler);
    return () => window.removeEventListener('stickit:auth-expired', handler);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('stickit_auth_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { ...authHeaders() },
      });
    } catch (_) {}
    localStorage.removeItem('stickit_auth_token');
    setToken(null);
    setUser(null);
  }, []);

  const changePassword = useCallback(async ({ current_password, new_password }) => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ current_password, new_password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to change password' }));
      throw new Error(err.error || 'Failed to change password');
    }
    return res.json();
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, authEnabled, envForced, loading, login, logout, changePassword, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
