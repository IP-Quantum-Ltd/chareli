import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { CacheStatsCard } from './CacheStatsCard';
import {
  useCacheStats,
  useClearAllCache,
  useClearGamesCache,
  useClearCategoriesCache,
  useRegenerateJsonCdn,
} from '../../../backend/cache.service';
import { toast } from 'sonner';
import { AlertCircle, Database, RefreshCw, Server, Trash2 } from 'lucide-react';
import { usePermissions } from '../../../hooks/usePermissions';

// Check if cache dashboard is enabled (via environment variable)
const isCacheDashboardEnabled = () => {
  // Check if explicitly enabled via environment variable
  const enabledViaEnv = import.meta.env.VITE_ENABLE_CACHE_DASHBOARD === 'true';
  // Also enable for local development
  const mode = import.meta.env.MODE;
  const isLocalDev = mode === 'development' || mode === 'test';

  return enabledViaEnv || isLocalDev;
};

export default function CacheDashboard() {
  const permissions = usePermissions();
  const { data, isLoading, error, refetch, isFetching } = useCacheStats();
  const clearAllMutation = useClearAllCache();
  const clearGamesMutation = useClearGamesCache();
  const clearCategoriesMutation = useClearCategoriesCache();
  const regenerateJsonCdnMutation = useRegenerateJsonCdn();

  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  // Access control: superadmin only and cache dashboard must be enabled
  if (!permissions.isSuperAdmin || !isCacheDashboardEnabled()) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-100">
              Access Denied
            </h2>
            <p className="text-red-700 dark:text-red-300 max-w-md">
              {!permissions.isSuperAdmin
                ? 'This dashboard is only accessible to superadmin users.'
                : 'Cache dashboard is not enabled in this environment.'}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const stats = data?.data;

  // Calculate health color based on hit rate
  const getHitRateColor = (hitRate: number): 'green' | 'yellow' | 'red' => {
    if (hitRate >= 80) return 'green';
    if (hitRate >= 60) return 'yellow';
    return 'red';
  };

  const handleClearAll = async () => {
    try {
      const result = await clearAllMutation.mutateAsync();
      toast.success(result.message || 'All cache cleared successfully');
      setShowClearAllConfirm(false);
    } catch (err: unknown) {
      const errorMessage = (
        err as { response?: { data?: { message?: string } } }
      )?.response?.data?.message;
      toast.error(errorMessage || 'Failed to clear cache');
    }
  };

  const handleClearGames = async () => {
    try {
      const result = await clearGamesMutation.mutateAsync();
      toast.success(result.message || 'Games cache cleared successfully');
    } catch (err: unknown) {
      const errorMessage = (
        err as { response?: { data?: { message?: string } } }
      )?.response?.data?.message;
      toast.error(errorMessage || 'Failed to clear games cache');
    }
  };

  const handleClearCategories = async () => {
    try {
      const result = await clearCategoriesMutation.mutateAsync();
      toast.success(result.message || 'Categories cache cleared successfully');
    } catch (err: unknown) {
      const errorMessage = (
        err as { response?: { data?: { message?: string } } }
      )?.response?.data?.message;
      toast.error(errorMessage || 'Failed to clear categories cache');
    }
  };

  const handleRefresh = () => {
    refetch();
    toast.success('Cache stats refreshed');
  };

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-100">
              Failed to Load Cache Stats
            </h2>
            <p className="text-red-700 dark:text-red-300">
              {(error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message ||
                'An error occurred while loading cache statistics.'}
            </p>
            <Button onClick={handleRefresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-[#F1F5F9] dark:bg-[#121C2D] p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Redis Cache Dashboard
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Monitor and manage Redis cache performance
            <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-300">
              USE WITH CAUTION
            </span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Most times you do not need to clear the cache
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={isFetching}
          variant="outline"
          size="sm"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Stats Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card
              key={i}
              className="animate-pulse bg-gray-200 dark:bg-gray-800 h-32"
            />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <CacheStatsCard
              label="Hit Rate"
              value={`${stats.hitRate.toFixed(2)}%`}
              color={getHitRateColor(stats.hitRate)}
              subtitle={`${stats.hits} hits / ${stats.misses} misses`}
            />
            <CacheStatsCard
              label="Memory Used"
              value={stats.memoryUsed}
              color="blue"
              subtitle={`${stats.keys} keys cached`}
            />
            <CacheStatsCard
              label="Total Keys"
              value={stats.keys}
              color="blue"
              subtitle="Currently cached"
            />
            <CacheStatsCard
              label="Evictions"
              value={stats.evictions}
              color={stats.evictions > 0 ? 'yellow' : 'green'}
              subtitle={
                stats.evictions > 0
                  ? 'Cache pressure detected'
                  : 'No memory pressure'
              }
            />
          </div>

          {/* Detailed Stats Card */}
          <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] border-none shadow-none">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Cache Statistics
                </h2>
              </div>
              <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] border-none shadow-none p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Status
                    </p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {stats.enabled ? (
                        <span className="text-green-600 dark:text-green-400">
                          ✓ Enabled
                        </span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">
                          ✗ Disabled
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Total Requests
                    </p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {stats.hits + stats.misses}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Cache Hits
                    </p>
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {stats.hits}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Cache Misses
                    </p>
                    <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                      {stats.misses}
                    </p>
                  </div>
                </div>
                <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  Auto-refreshes every 30 seconds • Last updated:{' '}
                  {new Date().toLocaleTimeString()}
                </div>
              </Card>
            </div>
          </Card>

          {/* Cache Management Card */}
          <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] border-none shadow-none">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Database className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Cache Management
                </h2>
              </div>
              <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] border-none shadow-none p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        Clear Games Cache
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Clear all game-related cached data
                      </p>
                    </div>
                    <Button
                      onClick={handleClearGames}
                      disabled={clearGamesMutation.isPending}
                      variant="outline"
                      size="sm"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear
                    </Button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        Clear Categories Cache
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Clear all category-related cached data
                      </p>
                    </div>
                    <Button
                      onClick={handleClearCategories}
                      disabled={clearCategoriesMutation.isPending}
                      variant="outline"
                      size="sm"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        Regenerate JSON CDN
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Regenerate all static JSON files for CDN
                      </p>
                    </div>
                    <Button
                      onClick={async () => {
                        try {
                          const result =
                            await regenerateJsonCdnMutation.mutateAsync();
                          toast.success(
                            result.message || 'JSON CDN regeneration started'
                          );
                        } catch (err) {
                          const error = err as {
                            response?: { data?: { message?: string } };
                          };
                          toast.error(
                            error?.response?.data?.message ||
                              'Failed to regenerate JSON CDN'
                          );
                        }
                      }}
                      disabled={regenerateJsonCdnMutation.isPending}
                      variant="outline"
                      size="sm"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${
                          regenerateJsonCdnMutation.isPending
                            ? 'animate-spin'
                            : ''
                        }`}
                      />
                      Regenerate
                    </Button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                    <div>
                      <p className="font-medium text-red-900 dark:text-red-100">
                        Clear All Cache
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">
                        ⚠️ Dangerous: Clears all cached data
                      </p>
                    </div>
                    {!showClearAllConfirm ? (
                      <Button
                        onClick={() => setShowClearAllConfirm(true)}
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear All
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => setShowClearAllConfirm(false)}
                          variant="outline"
                          size="sm"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleClearAll}
                          disabled={clearAllMutation.isPending}
                          variant="destructive"
                          size="sm"
                        >
                          Confirm Clear All
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
