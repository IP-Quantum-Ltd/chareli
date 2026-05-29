import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { backendService } from '../backend/api.service';
import type { User, LoginCredentials } from '../backend/types';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { BackendRoute } from '../backend/constants';
import { sendHeartbeat } from '../backend/user.service';

interface LoginResponse {
  userId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  email?: string;
  phoneNumber?: string;
  requiresOtp: boolean;
  role: string;
  otpType?: 'EMAIL' | 'SMS' | 'NONE';
  message: string;
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  keepPlayingRedirect: boolean;
  setKeepPlayingRedirect: (value: boolean) => void;
  login: (credentials: LoginCredentials) => Promise<LoginResponse>;
  verifyOtp: (userId: string, otp: string) => Promise<User>;
  logout: (silent?: boolean) => void;
  refreshUser: () => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [keepPlayingRedirect, setKeepPlayingRedirect] = useState(false);
  const queryClient = useQueryClient();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser().catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  // Heartbeat effect - runs when user authentication status changes
  useEffect(() => {
    if (user && !isLoading) {
      // Start heartbeat interval when user is authenticated
      const startHeartbeat = () => {
        // Send initial heartbeat
        sendHeartbeat().catch(console.error);
        
        // Set up interval to send heartbeat every 60 seconds
        heartbeatIntervalRef.current = setInterval(() => {
          sendHeartbeat().catch(console.error);
        }, 60 * 1000); // 60 seconds
      };

      startHeartbeat();

      // Also send heartbeat on page visibility change (when user comes back to tab)
      const handleVisibilityChange = () => {
        if (!document.hidden && user) {
          sendHeartbeat().catch(console.error);
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        // Cleanup interval and event listener
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      // Clear heartbeat when user is not authenticated
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    }
  }, [user, isLoading]);

  const refreshUser = async (): Promise<User> => {
    try {
      setIsLoading(true);
      const response = await backendService.get<User>('/api/auth/me');
      setUser(response.data);
      setIsLoading(false);
      return response.data;
    } catch (error) {
      // Token might be invalid, clear tokens
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      setUser(null);
      setIsLoading(false);
      throw error;
    }
  };

  const login = async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await backendService.post<LoginResponse>('/api/auth/login', credentials);
    const { 
      userId, 
      email, 
      phoneNumber, 
      requiresOtp, 
      otpType, 
      tokens, 
      role
    } = response.data;

    const message = (response as any)?.message

    if (tokens) {
      localStorage.setItem('token', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER_STATS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_USERS_ANALYTICS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
    }
    
    return { 
      userId,
      hasEmail: !!email,
      hasPhone: !!phoneNumber,
      email,
      role,
      phoneNumber,
      requiresOtp,
      otpType,
      tokens,
      message
    };
  };

  const verifyOtp = async (userId: string, otp: string): Promise<User> => {
    const response = await backendService.post<{ accessToken: string; refreshToken: string }>('/api/auth/verify-otp', { userId, otp });
    const { accessToken, refreshToken } = response.data;
    localStorage.setItem('token', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    const userData = await refreshUser();
    // Invalidate stats and games queries to trigger a refetch
    queryClient.invalidateQueries({ queryKey: [BackendRoute.USER_STATS] });
    queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
    return userData;
  };

  const logout = (silent?: boolean) => {
    // Clear heartbeat interval on logout
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    setUser(null);
    
    // Invalidate games queries to refresh data without authentication context
    queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
    
    // Only show toast if not silent
    if (!silent) {
      toast.success('Logged out successfully');
    }
  };

  const isRoleIncluded = ['admin', 'superadmin'].includes(user?.role?.name || '') || false;

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: isRoleIncluded,
        isLoading,
        keepPlayingRedirect,
        setKeepPlayingRedirect,
        login,
        verifyOtp,
        logout,
        refreshUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
