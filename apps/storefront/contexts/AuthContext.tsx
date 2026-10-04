'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ApiError, authApi, tokenStore } from '@/lib/api';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  /** Clear local auth state without calling the API (e.g. after account deletion). */
  clearSession: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      // lib/api transparently refreshes the access token on 401 using the
      // stored refresh token; only a failed refresh lands here.
      const profile = await authApi.getProfile();
      setUser(profile);
    } catch (err) {
      // Only an auth rejection ends the session; a network blip / 5xx keeps
      // the tokens so the next page load can recover.
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401 || status === 403) tokenStore.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (tokenStore.getAccess() || tokenStore.getRefresh()) {
      fetchProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [fetchProfile]);

  // lib/api fires this when a refresh fails (revoked / expired session).
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = async (email: string, password: string, rememberMe = false) => {
    const res = await authApi.login({ email, password });
    const token = res.access_token || res.accessToken || res.token;
    if (!token) throw new Error('No token received');
    const refresh = res.refreshToken || res.refresh_token || null;
    // "Remember me" → localStorage; otherwise sessionStorage.
    tokenStore.set(token, refresh, rememberMe);
    await fetchProfile();
  };

  const register = async (data: RegisterData) => {
    await authApi.register(data);
    // Auto-login after registration (session-only storage by default)
    await login(data.email, data.password, false);
  };

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const logout = async () => {
    // Revoke server-side first (needs the still-valid token), then clear
    // BOTH storages regardless of the outcome.
    try {
      await authApi.logout(tokenStore.getRefresh());
    } catch {
      /* already expired / network — clear locally anyway */
    }
    clearSession();
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        clearSession,
        refreshUser: fetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
