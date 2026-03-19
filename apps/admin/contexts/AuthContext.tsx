'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import adminApi from '@/lib/api';

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
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  platformLogin: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isPlatformAdmin: boolean;
  enabledModules: string[];
  isModuleEnabled: (moduleCode: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const profile = await adminApi.get<User>('/auth/me');
      setUser(profile);
    } catch {
      localStorage.removeItem('token');
      adminApi.clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      adminApi.setToken(token);
      fetchProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [fetchProfile]);

  const login = async (email: string, password: string) => {
    const res = await adminApi.login(email, password);
    const token = res.access_token || res.accessToken || res.token;
    if (!token) throw new Error('No token received');
    localStorage.setItem('token', token);
    adminApi.setToken(token);
    await fetchProfile();
  };

  const platformLogin = async (email: string, password: string) => {
    const res = await adminApi.post<{ accessToken: string; user: any }>('/auth/platform-login', {
      email,
      password,
    });
    const token = res.accessToken;
    if (!token) throw new Error('No token received');
    localStorage.setItem('token', token);
    adminApi.setToken(token);
    await fetchProfile();
  };

  const logout = () => {
    localStorage.removeItem('token');
    adminApi.clearToken();
    setUser(null);
    if (user?.isPlatformAdmin) {
      window.location.href = '/platform-login';
    } else {
      window.location.href = '/login';
    }
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

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        platformLogin,
        logout,
        refreshUser: fetchProfile,
        isPlatformAdmin,
        enabledModules,
        isModuleEnabled,
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
