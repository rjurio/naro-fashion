'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import adminApi, {
  ApiError,
  clearAuthTokens,
  getAuthToken,
  getRefreshToken,
  storeAuthTokens,
} from '@/lib/api';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  phone?: string;
  avatarUrl?: string;
  tenantId?: string;
  isPlatformAdmin?: boolean;
  enabledModules?: string[];
  /** Effective RBAC permission codes — only present if /auth/me returns them. */
  permissions?: string[];
}

type ProfileLoadResult = 'ok' | 'unauthorized' | 'transient';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  /**
   * Set when the session could not be validated because the API was
   * unreachable / returned 5xx. Tokens are kept; layouts show a retry
   * screen instead of bouncing the operator to the login page.
   */
  connectionError: string | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  platformLogin: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  retrySession: () => Promise<void>;
  isPlatformAdmin: boolean;
  enabledModules: string[];
  isModuleEnabled: (moduleCode: string) => boolean;
  /**
   * Client-side RBAC hint for hiding nav items / buttons. Returns true when
   * the profile does not expose permissions (the API enforces regardless).
   */
  hasPermission: (...codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** A 4xx (other than timeout / rate-limit) is the server definitively refusing the session. */
function isDefinitiveAuthFailure(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const loadProfile = useCallback(async (): Promise<ProfileLoadResult> => {
    try {
      // adminApi refreshes the access token transparently on 401 and only
      // purges stored tokens when the refresh token is definitively rejected.
      const profile = await adminApi.getProfile();
      setUser(profile);
      setConnectionError(null);
      return 'ok';
    } catch (err) {
      if (isDefinitiveAuthFailure(err)) {
        clearAuthTokens();
        adminApi.clearToken();
        setUser(null);
        setConnectionError(null);
        return 'unauthorized';
      }
      // Network failure / 5xx — keep tokens (and any loaded user) intact.
      setConnectionError(
        err instanceof Error && err.message && !/failed to fetch/i.test(err.message)
          ? err.message
          : "Couldn't reach the server. Check your connection and try again.",
      );
      return 'transient';
    }
  }, []);

  const refreshUser = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (getAuthToken() || getRefreshToken()) {
      loadProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [loadProfile]);

  const retrySession = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadProfile();
    } finally {
      setIsLoading(false);
    }
  }, [loadProfile]);

  const finishLogin = async (token: string | undefined, refreshToken: string | undefined, rememberMe: boolean) => {
    if (!token) throw new Error('No token received');
    storeAuthTokens(token, refreshToken, rememberMe);
    adminApi.setToken(token);
    const result = await loadProfile();
    if (result === 'unauthorized') throw new Error('Your session could not be verified. Please sign in again.');
    if (result === 'transient') throw new Error("Signed in, but couldn't load your profile. Please try again.");
  };

  const login = async (email: string, password: string, rememberMe = false) => {
    const res = await adminApi.login(email, password);
    await finishLogin(
      res.access_token || res.accessToken || res.token,
      res.refresh_token || res.refreshToken,
      rememberMe,
    );
  };

  const platformLogin = async (email: string, password: string, rememberMe = false) => {
    const res = await adminApi.post<{ accessToken: string; refreshToken?: string; user: any }>('/auth/platform-login', {
      email,
      password,
    });
    await finishLogin(res.accessToken, res.refreshToken, rememberMe);
  };

  const logout = () => {
    const wasPlatformAdmin = !!user?.isPlatformAdmin;
    const finish = () => {
      clearAuthTokens();
      adminApi.clearToken();
      setUser(null);
      window.location.href = wasPlatformAdmin ? '/platform-login' : '/login';
    };
    // Best-effort server-side revocation; never block logout on it for long.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    Promise.race([adminApi.logout().then(() => undefined), timeout])
      .catch(() => undefined)
      .finally(finish);
  };

  const isPlatformAdmin = !!user?.isPlatformAdmin;
  const enabledModules = user?.enabledModules || [];

  const isModuleEnabled = useCallback(
    (moduleCode: string) => {
      if (isPlatformAdmin) return true; // Platform admins see everything
      return enabledModules.includes(moduleCode);
    },
    [isPlatformAdmin, enabledModules],
  );

  const hasPermission = useCallback(
    (...codes: string[]) => {
      if (!user) return false;
      if (user.isPlatformAdmin || user.role === 'SUPER_ADMIN') return true;
      if (!Array.isArray(user.permissions)) return true; // unknown → let the API decide
      if (codes.length === 0) return true;
      return codes.some((c) => user.permissions!.includes(c));
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        connectionError,
        login,
        platformLogin,
        logout,
        refreshUser,
        retrySession,
        isPlatformAdmin,
        enabledModules,
        isModuleEnabled,
        hasPermission,
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
