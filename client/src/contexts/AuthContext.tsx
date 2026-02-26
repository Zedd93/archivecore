import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, getAccessToken } from '@/services/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
  tenant?: { id: string; name: string; shortCode: string } | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ requiresMfa: boolean; mfaSessionToken?: string }>;
  verifyMfa: (token: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get('/users/me');
      const userData = data.data;
      const roles = userData.userRoles?.map((ur: any) => ur.role.code) || [];
      const permissions = userData.userRoles?.flatMap((ur: any) => {
        const perms = ur.role.permissions;
        return Array.isArray(perms) ? perms : [];
      }) || [];

      setUser({
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        tenantId: userData.tenantId,
        roles,
        permissions: [...new Set(permissions)] as string[],
        tenant: userData.tenant,
      });

      if (userData.tenantId) {
        localStorage.setItem('tenantId', userData.tenantId);
      }
    } catch {
      setUser(null);
      setAccessToken(null);
    }
  }, []);

  // Try to restore session on mount (only once)
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        if (cancelled) return;
        setAccessToken(data.data.accessToken);
        await fetchMe();
      } catch {
        if (!cancelled) {
          setUser(null);
          setAccessToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    init();
    return () => { cancelled = true; };
  }, [fetchMe]);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    const result = data.data;

    if (result.requiresMfa) {
      return { requiresMfa: true, mfaSessionToken: result.mfaSessionToken };
    }

    setAccessToken(result.accessToken);
    await fetchMe();
    return { requiresMfa: false };
  };

  const verifyMfa = async (mfaSessionToken: string, code: string) => {
    const { data } = await api.post('/auth/2fa/validate', { mfaSessionToken, code });
    setAccessToken(data.data.accessToken);
    await fetchMe();
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('tenantId');
  };

  const hasPermission = (permission: string) => {
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return user.permissions.includes(permission);
  };

  const hasRole = (role: string) => {
    if (!user) return false;
    return user.roles.includes(role);
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, login, verifyMfa, logout, hasPermission, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
