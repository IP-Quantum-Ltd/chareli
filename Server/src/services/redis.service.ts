import Redis from 'ioredis';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import config from '../config/config';
import logger from '../utils/logger';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Cache statistics interface
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  keys: number;
  memoryUsed: string;
  evictions: number;
}

// Circuit breaker state
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

class RedisService {
  private redis: Redis;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private compressionThreshold: number = 51200; // 50KB
  private operationTimeout: number = 100; // 100ms
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'closed',
  };
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 30000; // 30 seconds

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: null, // BullMQ requires this to be null
      lazyConnect: true,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      connectTimeout: 10000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('Redis connection established');
      this.resetCircuitBreaker();
    });

    this.redis.on('ready', () => {
      logger.info('Redis ready to receive commands');
    });

    this.redis.on('error', (error: any) => {
      logger.error('Redis connection error:', error);
      this.recordFailure();
    });

    this.redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreaker.state = 'open';
      logger.warn('Circuit breaker opened due to Redis failures');
    }
  }

  private resetCircuitBreaker(): void {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'closed';
  }

  private checkCircuitBreaker(): boolean {
    if (this.circuitBreaker.state === 'closed') {
      return true;
    }

    const timeSinceLastFailure =
      Date.now() - this.circuitBreaker.lastFailureTime;
    if (timeSinceLastFailure > this.CIRCUIT_BREAKER_RESET_TIME) {
      this.circuitBreaker.state = 'half-open';
      logger.info('Circuit breaker entering half-open state');
      return true;
    }

    return false;
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T | null> {
    if (!this.checkCircuitBreaker()) {
      logger.warn(`Circuit breaker open, skipping ${operationName}`);
      return null;
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis operation timeout')),
          this.operationTimeout
        )
      );

      const result = await Promise.race([operation(), timeoutPromise]);

      // Reset failures on success in half-open state
      if (this.circuitBreaker.state === 'half-open') {
        this.resetCircuitBreaker();
      }

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error(`Redis ${operationName} error:`, error);
      return null;
    }
  }

  private async compress(data: string): Promise<Buffer> {
    return await gzipAsync(Buffer.from(data));
  }

  private async decompress(data: Buffer): Promise<string> {
    const decompressed = await gunzipAsync(data);
    return decompressed.toString();
  }

  private shouldCompress(data: string): boolean {
    return Buffer.byteLength(data, 'utf8') > this.compressionThreshold;
  }

  async connect(): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connecting') {
        logger.info('Redis already connected or connecting');
        return;
      }

      await this.redis.connect();
      logger.info('Successfully connected to Redis');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      logger.info('Disconnected from Redis');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  getClient(): Redis {
    return this.redis;
  }

  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  async isConnected(): Promise<boolean> {
    try {
      const result = await this.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  // ============= CACHING METHODS =============

  /**
   * Get a value from cache
   * Automatically handles decompression if needed
   */
  async get<T>(key: string): Promise<T | null> {
    const result = await this.executeWithTimeout(async () => {
      const value = await this.redis.get(key);

      if (!value) {
        this.cacheMisses++;
        return null;
      }

      this.cacheHits++;

      // Check if value is compressed (starts with gzip magic number)
      const buffer = Buffer.from(value, 'base64');
      if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        const decompressed = await this.decompress(buffer);
        return JSON.parse(decompressed) as T;
      }

      return JSON.parse(value) as T;
    }, 'get');

    if (result === null) {
      this.cacheMisses++;
    }

    return result;
  }

  /**
   * Set a value in cache with optional TTL
   * Automatically compresses large objects
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.executeWithTimeout(async () => {
      const serialized = JSON.stringify(value);

      let finalValue: string;
      if (this.shouldCompress(serialized)) {
        const compressed = await this.compress(serialized);
        finalValue = compressed.toString('base64');
        logger.debug(
          `Compressed cache key ${key} (${Buffer.byteLength(serialized)} -> ${
            compressed.length
          } bytes)`
        );
      } else {
        finalValue = serialized;
      }

      if (ttl) {
        await this.redis.setex(key, ttl, finalValue);
      } else {
        await this.redis.set(key, finalValue);
      }
    }, 'set');
  }

  /**
   * Set a value with TTL (explicit method)
   */
  async setex(key: string, ttl: number, value: any): Promise<void> {
    return this.set(key, value, ttl);
  }

  /**
   * Delete one or more keys
   */
  async del(keys: string | string[]): Promise<void> {
    await this.executeWithTimeout(async () => {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      if (keyArray.length > 0) {
        await this.redis.del(...keyArray);
      }
    }, 'del');
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.executeWithTimeout(async () => {
      const exists = await this.redis.exists(key);
      return exists === 1;
    }, 'exists');

    return result ?? false;
  }

  /**
   * Delete keys matching a pattern using SCAN (non-blocking)
   * Returns the number of keys deleted
   */
  async deletePattern(pattern: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      let cursor = '0';
      let deletedCount = 0;
      const pipeline = this.redis.pipeline();

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );

        cursor = nextCursor;

        if (keys.length > 0) {
          keys.forEach((key) => pipeline.del(key));
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      if (deletedCount > 0) {
        await pipeline.exec();
      }

      return deletedCount;
    }, 'deletePattern');

    return result ?? 0;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.info('stats');
      const memory = await this.redis.info('memory');
      const dbsize = await this.redis.dbsize();

      // Parse evicted_keys from stats
      const evictedMatch = info.match(/evicted_keys:(\d+)/);
      const evictions = evictedMatch ? parseInt(evictedMatch[1]) : 0;

      // Parse used_memory_human from memory
      const memoryMatch = memory.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsed = memoryMatch ? memoryMatch[1] : 'Unknown';

      const totalRequests = this.cacheHits + this.cacheMisses;
      const hitRate =
        totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;

      return {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: Math.round(hitRate * 100) / 100,
        keys: dbsize,
        memoryUsed,
        evictions,
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: 0,
        keys: 0,
        memoryUsed: 'Unknown',
        evictions: 0,
      };
    }
  }

  /**
   * Increment a counter (for like counts, etc.)
   */
  async incr(key: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.incr(key);
    }, 'incr');

    return result ?? 0;
  }

  /**
   * Decrement a counter
   */
  async decr(key: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.decr(key);
    }, 'decr');

    return result ?? 0;
  }

  /**
   * Get TTL of a key
   */
  async ttl(key: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.ttl(key);
    }, 'ttl');

    return result ?? -1;
  }

  // ============= SET OPERATIONS =============

  /**
   * Add a member to a set
   */
  async sadd(key: string, member: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.sadd(key, member);
    }, 'sadd');

    return result ?? 0;
  }

  /**
   * Check if a member exists in a set
   * Returns 1 if member exists, 0 otherwise
   */
  async sismember(key: string, member: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.sismember(key, member);
    }, 'sismember');

    return result ?? 0;
  }

  /**
   * Remove a member from a set
   */
  async srem(key: string, member: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      return await this.redis.srem(key, member);
    }, 'srem');

    return result ?? 0;
  }

  // ============= LIKE TRACKING METHODS =============

  /**
   * Add a like for a user on a game (store in Redis set)
   */
  async setGameLike(userId: string, gameId: string): Promise<void> {
    await this.executeWithTimeout(async () => {
      const key = `game:${gameId}:likes`;
      await this.redis.sadd(key, userId);
    }, 'setGameLike');
  }

  /**
   * Remove a like for a user on a game
   */
  async removeGameLike(userId: string, gameId: string): Promise<void> {
    await this.executeWithTimeout(async () => {
      const key = `game:${gameId}:likes`;
      await this.redis.srem(key, userId);
    }, 'removeGameLike');
  }

  /**
   * Check if a user has liked a game
   */
  async hasUserLikedGame(userId: string, gameId: string): Promise<boolean> {
    const result = await this.executeWithTimeout(async () => {
      const key = `game:${gameId}:likes`;
      return await this.redis.sismember(key, userId);
    }, 'hasUserLikedGame');

    return result === 1;
  }

  /**
   * Get all game IDs a user has liked
   */
  async getUserLikes(userId: string): Promise<string[]> {
    const result = await this.executeWithTimeout(async () => {
      const keys = await this.redis.keys(`game:*:likes`);
      const likedGames: string[] = [];

      for (const key of keys) {
        const isMember = await this.redis.sismember(key, userId);
        if (isMember) {
          // Extract gameId from key format: game:gameId:likes
          const gameId = key.split(':')[1];
          likedGames.push(gameId);
        }
      }

      return likedGames;
    }, 'getUserLikes');

    return result ?? [];
  }

  /**
   * Get the count of likes for a game
   */
  async getGameLikeCount(gameId: string): Promise<number> {
    const result = await this.executeWithTimeout(async () => {
      const key = `game:${gameId}:likes`;
      return await this.redis.scard(key);
    }, 'getGameLikeCount');

    return result ?? 0;
  }

  // ============= ETAG MANAGEMENT METHODS =============

  /**
   * Store ETag for a CDN file
   * @param filename - The CDN file name (e.g., 'categories.json', 'games_active.json')
   * @param etag - The ETag value from R2
   * @param ttl - TTL in seconds (default: 3600 = 1 hour)
   */
  async setCdnETag(filename: string, etag: string, ttl: number = 3600): Promise<void> {
    await this.executeWithTimeout(async () => {
      const key = `cdn:etag:${filename}`;
      await this.redis.setex(key, ttl, etag);
      logger.debug(`Stored ETag for ${filename}: ${etag}`);
    }, 'setCdnETag');
  }

  /**
   * Get ETag for a specific CDN file
   * @param filename - The CDN file name
   * @returns The ETag value or null if not found
   */
  async getCdnETag(filename: string): Promise<string | null> {
    const result = await this.executeWithTimeout(async () => {
      const key = `cdn:etag:${filename}`;
      return await this.redis.get(key);
    }, 'getCdnETag');

    return result;
  }

  /**
   * Get all CDN ETags at once
   * @returns Map of filename -> etag
   */
  async getAllCdnETags(): Promise<Record<string, string>> {
    const result = await this.executeWithTimeout(async () => {
      const pattern = 'cdn:etag:*';
      let cursor = '0';
      const etags: Record<string, string> = {};

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );

        cursor = nextCursor;

        if (keys.length > 0) {
          const values = await this.redis.mget(...keys);
          keys.forEach((key, index) => {
            // Extract filename from key format: cdn:etag:filename
            const filename = key.replace('cdn:etag:', '');
            const etag = values[index];
            if (etag) {
              etags[filename] = etag;
            }
          });
        }
      } while (cursor !== '0');

      return etags;
    }, 'getAllCdnETags');

    return result ?? {};
  }

  /**
   * Delete ETag for a specific CDN file
   * @param filename - The CDN file name
   */
  async deleteCdnETag(filename: string): Promise<void> {
    await this.executeWithTimeout(async () => {
      const key = `cdn:etag:${filename}`;
      await this.redis.del(key);
    }, 'deleteCdnETag');
  }

  /**
   * Delete all CDN ETags
   */
  async deleteAllCdnETags(): Promise<number> {
    return await this.deletePattern('cdn:etag:*');
  }
}

export const redisService = new RedisService();

