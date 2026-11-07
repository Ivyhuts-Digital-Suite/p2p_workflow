import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TOKEN_KEY } from '../api/client';
import { authApi } from '../api/services';
import type { InternalRegistration, Role, User, VendorRegistration } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, roles?: Role[]) => Promise<void>;
  registerVendor: (body: VendorRegistration) => Promise<void>;
  /** Resolves with signedIn: false when the account still needs an administrator's activation. */
  registerInternal: (body: InternalRegistration) => Promise<{ message: string; signedIn: boolean }>;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      // The API client clears the token on a 401. Anything else, like a database outage, must not end the session.
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, roles?: Role[]) => {
    const { token, user: profile } = await authApi.login(email, password, roles);
    localStorage.setItem(TOKEN_KEY, token);
    setUser(profile);
  }, []);

  const registerInternal = useCallback(async (body: InternalRegistration) => {
    const { message, token, user: profile } = await authApi.registerInternal(body);
    if (token && profile) {
      localStorage.setItem(TOKEN_KEY, token);
      setUser(profile);
    }
    return { message, signedIn: !!token };
  }, []);

  const registerVendor = useCallback(async (body: VendorRegistration) => {
    const { token, user: profile } = await authApi.registerVendor(body);
    localStorage.setItem(TOKEN_KEY, token);
    setUser(profile);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  // Mirrors the backend: ADMIN passes every role check.
  const hasRole = useCallback(
    (...roles: Role[]) => !!user && (user.role === 'ADMIN' || roles.includes(user.role)),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, registerVendor, registerInternal, logout, hasRole }),
    [user, loading, login, registerVendor, registerInternal, logout, hasRole],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
