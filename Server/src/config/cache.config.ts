/**
 * Cache Configuration
 * Centralized configuration for Redis caching strategy
 */

export const cacheConfig = {
  // Cache version for schema migrations
  version: 'v1',

  // TTL values in seconds (optimized for gaming platforms)
  ttl: {
    games_list: 150, // 2.5 minutes - frequent updates for gaming
    game_detail: 300, // 5 minutes - balance between freshness and performance
    categories: 1800, // 30 minutes - categories change less frequently
    search: 120, // 2 minutes - search results can be slightly stale
    analytics: 3600, // 1 hour - analytics don't need real-time updates
    user_profile: 900, // 15 minutes
  },

  // Compression settings
  compression: {
    enabled: true,
    threshold: 51200, // 50KB - compress objects larger than this
    algorithm: 'gzip' as const,
  },

  // Circuit breaker settings
  circuitBreaker: {
    enabled: true,
    timeout: 100, // 100ms timeout for Redis operations
    errorThreshold: 5, // Open circuit after 5 consecutive failures
    resetTimeout: 30000, // Try again after 30 seconds
  },

  // Memory cache (L1) settings
  memory: {
    enabled: true,
    maxSize: 1000, // Maximum number of items in memory cache
    ttl: 60, // 60 seconds TTL for memory cache
    monitorEvictions: true, // Track L1 effectiveness
  },

  // Cache warming settings
  warming: {
    enabled: true,
    onStartup: true,
    schedule: '0 * * * *', // Every hour (cron format)
    adaptive: false, // Enable later: warm based on access patterns
    topGamesCount: 100, // Number of top games to warm
  },

  // Monitoring settings
  monitoring: {
    enabled: true,
    logHitRate: true,
    trackL1Effectiveness: true,
    logSlowOperations: true,
    slowOperationThreshold: 50, // Log operations slower than 50ms
  },

  // CloudFront API caching (optional, for future use)
  cloudfront: {
    enabled: false, // Enable for public endpoints
    endpoints: ['/api/games', '/api/categories'],
    ttl: 60, // 1 minute edge cache
  },

  // Feature flags
  features: {
    cacheEnabled: process.env.REDIS_CACHE_ENABLED !== 'false',
    compressionEnabled: process.env.REDIS_COMPRESSION_ENABLED !== 'false',
    circuitBreakerEnabled:
      process.env.REDIS_CIRCUIT_BREAKER_ENABLED !== 'false',
  },
};

// Cache key prefixes (with versioning)
export const cacheKeys = {
  game: (id: string) => `cache:${cacheConfig.version}:game:${id}`,
  gamesList: (page: number, limit: number, filters?: string) =>
    `cache:${cacheConfig.version}:games:list:${page}:${limit}${
      filters ? `:${filters}` : ''
    }`,
  category: (id: string) => `cache:${cacheConfig.version}:category:${id}`,
  categoriesList: (page?: number, limit?: number, search?: string) => {
    if (page && limit) {
      return `cache:${cacheConfig.version}:categories:list:${page}:${limit}${
        search ? `:${search}` : ''
      }`;
    }
    return `cache:${cacheConfig.version}:categories:all`;
  },
  categoryGames: (id: string, page: number, limit: number) =>
    `cache:${cacheConfig.version}:category:${id}:games:${page}:${limit}`,
  search: (query: string, filters?: string, page?: number) =>
    `cache:${cacheConfig.version}:search:${query}${
      filters ? `:${filters}` : ''
    }${page ? `:${page}` : ''}`,
  analytics: (type: string, period: string, date?: string) =>
    `cache:${cacheConfig.version}:analytics:${type}:${period}${
      date ? `:${date}` : ''
    }`,
  userProfile: (id: string) => `cache:${cacheConfig.version}:user:${id}`,
  gameLikes: (id: string) => `cache:${cacheConfig.version}:game:${id}:likes`,
};

// Cache invalidation patterns
export const cachePatterns = {
  allGames: () => `cache:${cacheConfig.version}:game:*`,
  allGamesList: () => `cache:${cacheConfig.version}:games:list:*`,
  allCategories: () => `cache:${cacheConfig.version}:categories:*`,
  categoryGames: (categoryId: string) =>
    `cache:${cacheConfig.version}:category:${categoryId}:games:*`,
  allSearch: () => `cache:${cacheConfig.version}:search:*`,
  allAnalytics: () => `cache:${cacheConfig.version}:analytics:*`,
  everything: () => `cache:${cacheConfig.version}:*`,
};

export type CacheConfig = typeof cacheConfig;
export type CacheKeys = typeof cacheKeys;
export type CachePatterns = typeof cachePatterns;
