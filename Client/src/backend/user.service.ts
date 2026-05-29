import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendService } from './api.service';
import { BackendRoute } from './constants';
import type { User } from './types';

/**
 * Hook to fetch user data
 * @returns Query result with user data
 */
export const useUserData = () => {
  return useQuery<User>({
    queryKey: [BackendRoute.AUTH_ME],
    queryFn: async () => {
      const response = await backendService.get(BackendRoute.AUTH_ME);
      return response.data as unknown as User;
    },
    refetchOnWindowFocus: false,
  });
};

/**
 * Hook to fetch a specific user by ID
 * @param id - User ID
 * @returns Query result with user data
 */
export const useUserById = (id: string) => {
  const url = BackendRoute.USER_BY_ID.replace(':id', id);
  return useQuery<User>({
    queryKey: [BackendRoute.USER, id],
    queryFn: async () => {
      const response = await backendService.get(url);
      return response.data as unknown as User;
    },
    refetchOnWindowFocus: false,
  });
};

/**
 * Hook to update user data
 * @returns Mutation function to update user data
 */
export const useUpdateUserData = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<User> & { id: string }) => {
      const url = BackendRoute.USER_BY_ID.replace(':id', id);
      const response = await backendService.put(url, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.AUTH_ME] });
    },
  });
};

/**
 * Hook to create a new user
 * @returns Mutation function to create a user
 */
export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      phoneNumber?: string;
      isAdult: boolean;
      hasAcceptedTerms: boolean;
    }) => backendService.post(BackendRoute.USER, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER] });
    },
  });
};

/**
 * Hook to delete a user
 * @returns Mutation function to delete a user
 */
export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const url = BackendRoute.USER_BY_ID.replace(':id', id);
      return backendService.delete(url);
    },
    onSuccess: () => {
      // Invalidate all user-related queries to refresh data across the app
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.AUTH_ME] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ANALYTICS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER_STATS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_DASHBOARD] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_USERS_ANALYTICS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_USER_ACTIVITY] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_USER_ANALYTICS], exact: false });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAME_ANALYTICS], exact: false });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS_POPULARITY] });
      queryClient.invalidateQueries({ queryKey: ["allTeamMembers"] });
    },
  });
};

/**
 * Hook to change user password
 * @returns Mutation function to change password
 */
export const useChangePassword = () => {
  return useMutation({
    mutationFn: async ({ oldPassword, password }: { oldPassword: string; password: string }) => {
      const url = BackendRoute.AUTH_CHANGE_PASSWORD;
      const response = await backendService.post(url, { oldPassword, newPassword: password });
      return response.data;
    }
  });
};

/**
 * Hook to send heartbeat to maintain online status
 * @returns Mutation function to send heartbeat
 */
export const useSendHeartbeat = () => {
  return useMutation({
    mutationFn: async () => {
      const response = await backendService.post(BackendRoute.USER_HEARTBEAT);
      return response.data;
    }
  });
};

/**
 * Hook to get current user's online status
 * @returns Query result with online status data
 */
export const useOnlineStatus = () => {
  return useQuery({
    queryKey: [BackendRoute.USER_ONLINE_STATUS],
    queryFn: async () => {
      const response = await backendService.get(BackendRoute.USER_ONLINE_STATUS);
      return response.data;
    },
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
};

/**
 * Function to send heartbeat (non-hook version for use in intervals)
 * @returns Promise with response
 */
export const sendHeartbeat = async () => {
  try {
    const response = await backendService.post(BackendRoute.USER_HEARTBEAT);
    return response.data;
  } catch (error) {
    console.error('Failed to send heartbeat:', error);
    throw error;
  }
};
