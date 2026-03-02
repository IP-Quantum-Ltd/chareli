/**
 * CDN Fetch Utility with ETag-Based Caching and API Fallback
 *
 * Implements smart caching using ETags for conditional requests.
 * When data hasn't changed, receives tiny 304 responses instead of full data.
 * Includes timeout, error handling, metrics tracking, and cache-busting via version parameter.
 */

interface CDNConfig {
  enabled: boolean;
  baseUrl: string;
  timeout: number;
  version: number | null;
  etags: Record<string, string>;
}

interface FetchOptions {
  cdnPath: string;
  apiPath: string;
  timeout?: number;
}

interface CDNMetadata {
  generatedAt: string;
  count: number;
  version: string;
}

export interface CDNResponse<T> {
  data: T;
  metadata?: CDNMetadata;
  source: 'cdn' | 'api';
  duration: number;
}

interface CDNVersionResponse {
  success: boolean;
  data: {
    version: number;
    updatedAt: string;
    enabled: boolean;
  };
}

class CDNFetchService {
  private config: CDNConfig;
  private versionFetchPromise: Promise<void> | null = null;
  private etagCache: Record<string, string> = {}; // In-memory ETag cache
  private cachedData: Record<string, any> = {}; // Cache for 304 responses
  private metrics = {
    cdnHits: 0,
    cdnHits304: 0, // 304 Not Modified responses
    apiHits: 0,
    errors: 0,
  };

  constructor() {
    this.config = {
      enabled: import.meta.env.VITE_CDN_ENABLED === 'true',
      baseUrl: import.meta.env.VITE_CDN_BASE_URL || '',
      timeout: parseInt(import.meta.env.VITE_CDN_TIMEOUT || '3000', 10),
      version: null,
      etags: {},
    };

    // Load ETags from localStorage
    this.loadETagsFromStorage();

    if (this.config.enabled) {
      console.log('[CDN] Initialized:', {
        enabled: this.config.enabled,
        baseUrl: this.config.baseUrl,
        timeout: this.config.timeout,
      });

      // Fetch initial version and ETags (deferred, non-blocking)
      this.versionFetchPromise = this.fetchVersionAndETags();
    }
  }


  /**
   * Load ETags from localStorage
   */
  private loadETagsFromStorage(): void {
    try {
      const stored = localStorage.getItem('cdn_etags');
      if (stored) {
        this.etagCache = JSON.parse(stored);
        console.log('[CDN] Loaded ETags from localStorage:', Object.keys(this.etagCache).length);
      }
    } catch (error) {
      console.warn('[CDN] Failed to load ETags from localStorage:', error);
    }
  }

  /**
   * Save ETags to localStorage
   */
  private saveETagsToStorage(): void {
    try {
      localStorage.setItem('cdn_etags', JSON.stringify(this.etagCache));
    } catch (error) {
      console.warn('[CDN] Failed to save ETags to localStorage:', error);
    }
  }

  /**
   * Fetch the current CDN version and ETags from the backend
   */
  private async fetchVersionAndETags(): Promise<void> {
    await Promise.all([
      this.fetchVersion(),
      this.fetchETags(),
    ]);
  }

  /**
   * Fetch the current CDN version from the backend
   * Used for cache-busting via ?v=<version> query parameter
   */
  private async fetchVersion(): Promise<void> {
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBase}/api/cdn/version`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.warn('[CDN] Failed to fetch version:', response.status);
        return;
      }

      const data: CDNVersionResponse = await response.json();
      if (data.success && data.data.version) {
        this.config.version = data.data.version;
        console.log('[CDN] Version fetched:', this.config.version);
      }
    } catch (error) {
      console.warn('[CDN] Failed to fetch version:', error);
      // Continue without version - URLs will work but may serve cached content
    }
  }

  /**
   * Fetch ETags for all CDN files from the backend
   */
  private async fetchETags(): Promise<void> {
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBase}/api/cdn/etags`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.warn('[CDN] Failed to fetch ETags:', response.status);
        return;
      }

      const result = await response.json();
      if (result.success && result.data) {
        this.etagCache = result.data;
        this.config.etags = result.data;
        this.saveETagsToStorage();
        console.log('[CDN] ETags fetched:', Object.keys(this.etagCache).length);
      }
    } catch (error) {
      console.warn('[CDN] Failed to fetch ETags:', error);
    }
  }

  /**
   * Refresh the CDN version (useful after content updates)
   */
  async refreshVersion(): Promise<void> {
    await this.fetchVersion();
  }

  /**
   * Fetch with CDN-first strategy
   */
  async fetch<T>(options: FetchOptions): Promise<CDNResponse<T>> {
    const startTime = performance.now();

    // Try CDN first if enabled
    if (this.config.enabled && this.config.baseUrl) {
      // Wait for initial version fetch if still in progress
      if (this.versionFetchPromise) {
        await this.versionFetchPromise;
        this.versionFetchPromise = null;
      }

      try {
        const data = await this.fetchFromCDN<T>(options);
        const duration = performance.now() - startTime;

        this.metrics.cdnHits++;
        console.log(
          '[CDN] Fetch successful:',
          options.cdnPath,
          `${duration.toFixed(0)}ms`
        );

        return {
          data,
          metadata: (data as { metadata?: CDNMetadata }).metadata,
          source: 'cdn',
          duration,
        };
      } catch (error) {
        console.warn('[CDN] Fetch failed, falling back to API:', error);
        // Continue to API fallback
      }
    }

    // Fallback to API
    const duration = performance.now() - startTime;
    this.metrics.apiHits++;

    // Return a response structure that indicates API source
    // The actual API call will be made by the existing service
    return {
      data: null as T, // Will be filled by the caller
      source: 'api',
      duration,
    };
  }

  /**
   * Fetch from CDN with ETag-based conditional requests
   * Supports 304 Not Modified for bandwidth savings
   */
  private async fetchFromCDN<T>(options: FetchOptions): Promise<T> {
    const versionParam = this.config.version ? `?v=${this.config.version}` : '';
    const url = `${this.config.baseUrl}/${options.cdnPath}${versionParam}`;
    const timeout = options.timeout || this.config.timeout;

    // Get stored ETag for this file
    const etag = this.etagCache[options.cdnPath];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      // Add If-None-Match header if we have an ETag
      if (etag) {
        headers['If-None-Match'] = etag;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      // Handle 304 Not Modified - use cached data
      if (response.status === 304) {
        this.metrics.cdnHits304++;
        console.log('[CDN] 304 Not Modified:', options.cdnPath);
        
        // Return cached data
        const cached = this.cachedData[options.cdnPath];
        if (cached) {
          return cached;
        }
        // If no cached data, fall through to error (shouldn't happen)
        throw new Error('304 received but no cached data available');
      }

      if (!response.ok) {
        throw new Error(
          `CDN returned ${response.status}: ${response.statusText}`
        );
      }

      const json = await response.json();

      // Update ETag if present in response
      const newETag = response.headers.get('ETag');
      if (newETag) {
        this.etagCache[options.cdnPath] = newETag.replace(/"/g, ''); // Remove quotes
        this.saveETagsToStorage();
      }

      // Cache the data for future 304 responses
      this.cachedData[options.cdnPath] = json;

      // Extract data from CDN response structure
      return this.extractData<T>(json);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`CDN timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Extract data from CDN response
   */
  private extractData<T>(json: Record<string, unknown>): T {
    // CDN responses wrap data in specific keys
    if (json.categories) return json.categories as T;
    if (json.games) return json.games as T;
    if (json.game) return json.game as T;

    // If no wrapper, return as-is (API response)
    return json as T;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const total = this.metrics.cdnHits + this.metrics.apiHits;
    return {
      ...this.metrics,
      total,
      hitRate: total > 0 ? this.metrics.cdnHits / total : 0,
    };
  }

  /**
   * Check if CDN is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this.metrics = {
      cdnHits: 0,
      cdnHits304: 0,
      apiHits: 0,
      errors: 0,
    };
  }
}

export const cdnFetch = new CDNFetchService();
export type { FetchOptions };

// Make it available globally for debugging
if (typeof window !== 'undefined') {
  (window as typeof window & { cdnFetch: CDNFetchService }).cdnFetch = cdnFetch;
}
