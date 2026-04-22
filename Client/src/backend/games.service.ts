import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendService } from './api.service';
import { BackendRoute } from './constants';
import type {
  GameResponse,
  GameStatus,
  PaginatedResponse,
  GameProcessingStatusResponse,
} from './types';
import { cdnFetch } from '../utils/cdnFetch';

export const useGames = (params?: {
  categoryId?: string;
  status?: GameStatus;
  filter?: 'popular' | 'recommended' | 'recently_added';
  search?: string;
  limit?: number;
  page?: number;
}) => {
  return useQuery<PaginatedResponse<GameResponse>>({
    queryKey: [BackendRoute.GAMES, params],
    queryFn: async () => {
      // Try CDN for popular filter
      // Strict check: Page 1 only, no search, no category (CDN JSON is a static top-list)
      if (
        cdnFetch.isEnabled() &&
        params?.filter === 'popular' &&
        !params.search &&
        !params.categoryId &&
        (!params.page || params.page === 1)
      ) {
        try {
          const result = await cdnFetch.fetch<GameResponse[]>({
            cdnPath: 'games_popular.json',
            apiPath: BackendRoute.GAMES,
          });

          if (result.source === 'cdn') {
            console.log('[Games] Using CDN for popular games');
            // CDN returns flat array, wrap in pagination structure
            // Apply limit if specified (e.g., PopularSection requests limit: 6)
            const limitedData = params?.limit
              ? result.data.slice(0, params.limit)
              : result.data;
            return {
              data: limitedData,
              total: result.data.length,
              page: 1,
              limit: limitedData.length,
            } as PaginatedResponse<GameResponse>;
          }
        } catch (error) {
          console.warn('[Games] CDN fetch failed for popular, using API:', error);
          // Fall through to API
        }
      }

      // Try CDN for recently_added filter
      // games_active.json is naturally sorted by createdAt DESC, so we can use it here
      if (
        cdnFetch.isEnabled() &&
        params?.filter === 'recently_added' &&
        !params.search &&
        !params.categoryId &&
        (!params.page || params.page === 1)
      ) {
        try {
          const result = await cdnFetch.fetch<GameResponse[]>({
            cdnPath: 'games_active.json',
            apiPath: BackendRoute.GAMES,
          });

          if (result.source === 'cdn') {
            console.log('[Games] Using CDN for recently_added');
            const limit = params?.limit || result.data.length;
            const limitedData = result.data.slice(0, limit);

            return {
              data: limitedData,
              total: result.data.length,
              page: 1,
              limit: limitedData.length,
            } as PaginatedResponse<GameResponse>;
          }
        } catch (error) {
          console.warn('[Games] CDN fetch failed for recently_added, using API:', error);
          // Fall through to API
        }
      }

      // Try CDN for active games without filters
      // Skip CDN when pagination is explicitly requested (page > 1 or limit set)
      // This enables true server-side pagination for better initial load performance
      const isPaginationRequested = (params?.page && params.page > 1) || params?.limit;



      if (
        cdnFetch.isEnabled() &&
        params?.status === 'active' &&
        !params.categoryId &&
        !params.filter &&
        !params.search &&
        !isPaginationRequested
      ) {

        try {
          const result = await cdnFetch.fetch<GameResponse[]>({
            cdnPath: 'games_active.json',
            apiPath: BackendRoute.GAMES,
          });

          if (result.source === 'cdn') {
            // CDN returns flat array, wrap in pagination structure
            return {
              data: result.data,
              total: result.data.length,
              page: 1,
              limit: result.data.length,
            } as PaginatedResponse<GameResponse>;
          }
        } catch (error) {
          console.warn('[Games] CDN fetch failed, using API:', error);
          // Fall through to API
        }
      }

      // API fallback for filtered queries or if CDN fails

      // Note: backendService uses axios interceptor that already unwraps response.data
      // So 'response' here IS the actual data, not the axios response wrapper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseData = await backendService.get(BackendRoute.GAMES, { params }) as any;


      // Handle both response formats:
      // 1. Full PaginatedResponse: { data, pagination: { page, limit, total, totalPages } }
      // 2. Simple filter response: { data }
      // 3. Legacy format: array of games

      if (responseData?.data && Array.isArray(responseData.data)) {
        // Backend returns { data, pagination: { total, page, limit, totalPages } }
        // Normalize to frontend PaginatedResponse format with total at root level
        const pagination = responseData.pagination || {};



        return {
          success: true,
          data: responseData.data,
          total: pagination.total ?? responseData.total ?? responseData.data.length,
          count: responseData.data.length,
          page: pagination.page ?? responseData.page ?? 1,
          limit: pagination.limit ?? responseData.limit ?? responseData.data.length,
          totalPages: pagination.totalPages ?? responseData.totalPages ?? 1,
        } as PaginatedResponse<GameResponse>;
      } else if (Array.isArray(responseData)) {
        // Legacy format - wrap in pagination structure
        return {
          success: true,
          data: responseData,
          total: responseData.length,
          count: responseData.length,
          page: 1,
          limit: responseData.length,
          totalPages: 1,
        } as PaginatedResponse<GameResponse>;
      }

      // Shouldn't reach here, but return safe default
      return {
        success: true,
        data: [],
        total: 0,
        count: 0,
        page: 1,
        limit: 0,
        totalPages: 0,
      } as PaginatedResponse<GameResponse>;
    },
  });
};

export const useGameById = (id: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAMES, id],
    queryFn: async () => {
      console.log('[Game Detail] Fetching game:', id);

      // Try CDN first if we have a slug (not a UUID)
      const isSlug = !id.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      console.log(
        '[Game Detail] Is slug?',
        isSlug,
        'CDN enabled?',
        cdnFetch.isEnabled()
      );

      if (cdnFetch.isEnabled() && isSlug) {
        console.log(
          '[Game Detail] Attempting CDN fetch for:',
          `games/${id}.json`
        );
        try {
          const result = await cdnFetch.fetch<GameResponse>({
            cdnPath: `games/${id}.json`,
            apiPath: BackendRoute.GAME_BY_ID.replace(':id', id),
          });

          console.log(
            '[Game Detail] CDN fetch result:',
            result.source,
            result.data
          );

          if (result.source === 'cdn') {
            console.log('[Game Detail] Using CDN data');
            return result.data;
          }
        } catch (error) {
          console.warn('[Game Detail] CDN fetch failed, using API:', error);
          // Fall through to API
        }
      }

      // API fallback
      console.log(
        '[Game Detail] Fetching from API:',
        BackendRoute.GAME_BY_ID.replace(':id', id)
      );
      const response = await backendService.get(
        BackendRoute.GAME_BY_ID.replace(':id', id)
      );
      console.log('[Game Detail] Game API Response:', response.data);

      // API returns { success: true, data: {game object} }
      // Extract the actual game data
      if (response.data?.data) {
        console.log('[Game Detail] Returning game data from API');
        return response.data.data as GameResponse;
      }

      // Fallback if response structure is different
      console.log('[Game Detail] Returning response.data directly');
      return response.data as GameResponse;
    },
  });
};

export const useCreateGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: (data: any) =>
      backendService.post(BackendRoute.GAMES, data, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 1200000, // 20 minutes timeout for game creation/upload
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      // Invalidate category queries to update category pages when new game is added
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      // Invalidate my proposals in case this was an editor proposal
      queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });
    },
  });
};

export const useUpdateGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ id, data }: { id: string; data: FormData | any }) => {
      // Check if data is FormData (old approach) or plain object (new approach)
      const isFormData = data instanceof FormData;

      return backendService.put(
        BackendRoute.GAME_BY_ID.replace(':id', id),
        data,
        {
          headers: {
            'Content-Type': isFormData
              ? 'multipart/form-data'
              : 'application/json',
          },
        }
      );
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES, id] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAME_ANALYTICS, id],
      });
      // Invalidate category queries to update category pages when game category changes
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      // Invalidate my proposals in case this was an editor proposal
      queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });
    },
  });
};

export const useToggleGameStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      gameId,
      currentStatus,
    }: {
      gameId: string;
      currentStatus: string;
    }) => {
      const shouldUnpublish = currentStatus === 'active';
      const route = shouldUnpublish
        ? BackendRoute.GAME_UNPUBLISH
        : BackendRoute.GAME_PUBLISH;
      const response = await backendService.post(
        route.replace(':id', gameId),
        {}
      );
      return response.data;
    },
    onSuccess: (_, { gameId }) => {
      // Invalidate all games queries (this will update Home and Categories pages)
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES, gameId] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAME_ANALYTICS, gameId],
      });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.ADMIN_GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
    },
  });
};

export const useDeleteGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      backendService.delete(BackendRoute.GAME_BY_ID.replace(':id', id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      // Invalidate category queries to update category pages when game is deleted
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
    },
  });
};

// ============================================================================
// POSITION MANAGEMENT HOOKS
// ============================================================================

export const useGameByPosition = (position: number) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAME_BY_POSITION, position],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.GAME_BY_POSITION.replace(':position', position.toString())
      );
      return response.data;
    },
    enabled: !!position && position > 0,
  });
};

export const useUpdateGamePosition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) => {
      const formData = new FormData();
      formData.append('position', position.toString());
      return backendService.put(
        BackendRoute.GAME_BY_ID.replace(':id', id),
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES, id] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.GAME_BY_POSITION],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
    },
  });
};

// ============================================================================
// POSITION HISTORY HOOKS
// ============================================================================

export const useGamePositionHistory = (
  gameId: string,
  params?: { page?: number; limit?: number }
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAME_POSITION_HISTORY_BY_GAME, gameId, params],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.GAME_POSITION_HISTORY_BY_GAME.replace(':gameId', gameId),
        { params }
      );
      return response.data;
    },
    enabled: !!gameId,
  });
};

export const useRecordGameClick = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) =>
      backendService.post(
        BackendRoute.GAME_POSITION_HISTORY_CLICK.replace(':gameId', gameId)
      ),
    onSuccess: (_, gameId) => {
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.GAME_POSITION_HISTORY_BY_GAME, gameId],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.GAME_POSITION_HISTORY_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.GAME_POSITION_HISTORY_PERFORMANCE],
      });
    },
  });
};

export const usePositionHistoryAnalytics = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAME_POSITION_HISTORY_ANALYTICS],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.GAME_POSITION_HISTORY_ANALYTICS
      );
      return response.data;
    },
  });
};

export const useAllPositionHistory = (params?: {
  page?: number;
  limit?: number;
  position?: number;
  positionMin?: number;
  positionMax?: number;
  clickCountMin?: number;
  clickCountMax?: number;
  gameTitle?: string;
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAME_POSITION_HISTORY, params],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.GAME_POSITION_HISTORY,
        { params }
      );
      return response.data;
    },
  });
};

export const usePositionPerformance = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery<any>({
    queryKey: [BackendRoute.GAME_POSITION_HISTORY_PERFORMANCE],
    queryFn: async () => {
      const response = await backendService.get(
        BackendRoute.GAME_POSITION_HISTORY_PERFORMANCE
      );
      return response.data;
    },
  });
};

// ============================================================================
// GAME PROCESSING STATUS HOOKS
// ============================================================================

export const useGameProcessingStatus = (gameId: string) => {
  return useQuery<GameProcessingStatusResponse>({
    queryKey: ['game-processing-status', gameId],
    queryFn: async () => {
      const response = await backendService.get(
        `/api/games/${gameId}/processing-status`
      );
      return response.data as GameProcessingStatusResponse;
    },
    enabled: !!gameId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refetchInterval: (data: any) => {
      // Poll every 2 seconds if game is still processing
      const processingStatus = data?.data?.processingStatus;
      return processingStatus === 'pending' || processingStatus === 'processing'
        ? 2000
        : false;
    },
    refetchOnWindowFocus: true,
  });
};

export const useRetryGameProcessing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) =>
      backendService.post(`/api/games/${gameId}/retry-processing`),
    onSuccess: (_, gameId) => {
      // Invalidate processing status queries
      queryClient.invalidateQueries({
        queryKey: ['game-processing-status', gameId],
      });
      // Also invalidate games queries to refresh the list
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
    },
  });
};
