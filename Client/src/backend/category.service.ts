import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendService } from './api.service';
import { BackendRoute } from './constants';
import type { Category } from './types';
import { cdnFetch } from '../utils/cdnFetch';

/**
 * Hook to fetch all categories
 * Attempts to fetch from CDN first, falls back to API
 * @returns Query result with categories data
 */
export const useCategories = (options?: { sortBy?: string; skipCdn?: boolean }) => {
  return useQuery<Category[]>({
    queryKey: [BackendRoute.CATEGORIES, options],
    queryFn: async () => {
      // If custom sort or skip CDN requested, use API directly
      if (options?.skipCdn || options?.sortBy) {
        const response = await backendService.get(BackendRoute.CATEGORIES, {
          params: { sortBy: options?.sortBy },
        });
        return response.data as Category[];
      }

      // Try CDN first for default view
      if (cdnFetch.isEnabled()) {
        try {
          const result = await cdnFetch.fetch<Category[]>({
            cdnPath: 'categories.json',
            apiPath: BackendRoute.CATEGORIES,
          });

          if (result.source === 'cdn') {
            return result.data;
          }
        } catch (error) {
          console.warn('[Categories] CDN fetch failed, using API:', error);
          // Fall through to API
        }
      }

      // API fallback
      const response = await backendService.get(BackendRoute.CATEGORIES);
      return response.data as Category[];
    },
  });
};

/**
 * Hook to fetch a specific category by ID
 * @param id - Category ID
 * @param params - Optional pagination parameters
 * @returns Query result with category data
 */
export const useCategoryById = (
  id: string,
  params?: { page?: number; limit?: number }
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.CATEGORIES, id, params],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.CATEGORY_BY_ID.replace(':id', id),
        {
          params,
          suppressErrorToast: true,
        }
      );
      return response.data;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 404) {
        return false;
      }
      return failureCount < 3;
    },
  });
};

/**
 * Hook to create a new category
 * @returns Mutation function to create a category
 */
export const useCreateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) =>
      backendService.post(BackendRoute.CATEGORIES, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES] });
    },
  });
};

/**
 * Hook to update a category
 * @returns Mutation function to update a category
 */
export const useUpdateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Category> }) =>
      backendService.put(BackendRoute.CATEGORY_BY_ID.replace(':id', id), data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.CATEGORIES, id],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES] });
    },
  });
};

/**
 * Hook to delete a category
 * @returns Mutation function to delete a category
 */
export const useDeleteCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      backendService.delete(BackendRoute.CATEGORY_BY_ID.replace(':id', id)),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      // Remove the specific category query to prevent refetching
      queryClient.removeQueries({ queryKey: [BackendRoute.CATEGORIES, id] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES] });
    },
  });
};
