import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backendService } from "./api.service";
import { BackendRoute } from "./constants";
import type { DashboardFilters } from "./analytics.service";

interface SignupAnalyticsData {
  totalClicks: number;
  periodClicks: number;
  uniqueSessions: number;
  clicksByCountry: Array<{
    country: string;
    count: string;
  }>;
  clicksByDevice: Array<{
    deviceType: string;
    count: string;
  }>;
  clicksByDay: Array<{
    date: string;
    count: string;
  }>;
  clicksByType: Array<{
    type: string;
    count: string;
  }>;
}

/**
 * Hook to track signup button clicks
 * @returns Mutation function to track signup clicks
 */
export const useTrackSignupClick = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { sessionId?: string; type: string }) => {
      const response = await backendService.post(
        BackendRoute.SIGNUP_ANALYTICS_CLICK,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER] });
      queryClient.invalidateQueries({ queryKey: ["allTeamMembers"] });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_DASHBOARD],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_USERS_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_USER_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAME_ANALYTICS],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_USER_ACTIVITY],
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.SIGNUP_ANALYTICS_DATA],
      });
    },
  });
};


export const useSignupAnalyticsData = (filters?: DashboardFilters | { days?: number } | number) => {
  return useQuery<SignupAnalyticsData>({
    queryKey: [BackendRoute.SIGNUP_ANALYTICS_DATA, filters],
    queryFn: async () => {
      const params = new URLSearchParams();

      // Handle direct days parameter for backward compatibility
      if (typeof filters === 'number') {
        params.append('days', filters.toString());
      }
      // Handle new filter format (DashboardFilters)
      else if (filters && typeof filters === 'object' && 'timeRange' in filters) {
        if (filters.timeRange?.period) params.append('period', filters.timeRange.period);
        if (filters.timeRange?.startDate) params.append('startDate', filters.timeRange.startDate);
        if (filters.timeRange?.endDate) params.append('endDate', filters.timeRange.endDate);
        if (filters.countries && filters.countries.length > 0) {
          filters.countries.forEach(country => params.append('country', country));
        }
      }
      // Handle legacy format (days parameter) for backward compatibility
      else if (filters && typeof filters === 'object' && 'days' in filters && filters.days) {
        params.append('days', filters.days.toString());
      }

      const url = `${BackendRoute.SIGNUP_ANALYTICS_DATA}${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await backendService.get<SignupAnalyticsData>(url);

      return response.data;
    },
    refetchOnWindowFocus: false,
    retry: 3,
  });
};
