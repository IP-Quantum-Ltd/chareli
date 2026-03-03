import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Request, Response } from 'express';
import { ApiError } from './errorHandler';
import { redisService } from '../services/redis.service';

/**
 * Rate limiter for authentication endpoints
 * Limits login, registration, and OTP verification attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:auth:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(
      429,
      'Too many authentication attempts, please try again later'
    );
  },
  skip: (req) => {
    // Skip rate limiting if Redis is down (graceful degradation)
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});

/**
 * Rate limiter for general API endpoints
 * Prevents abuse of the API
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:api:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(429, 'Too many requests, please try again later');
  },
  skip: (req) => {
    // Skip rate limiting if Redis is down (graceful degradation)
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});

/**
 * Rate limiter for user creation endpoints
 * Prevents mass account creation
 */
export const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 user creations per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:create-user:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(
      429,
      'Too many user creation requests, please try again later'
    );
  },
  skip: (req) => {
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});

/**
 * Upload limiter - prevent file upload abuse
 */
export const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:upload:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(
      429,
      'Too many upload requests, please try again in 5 minutes'
    );
  },
  skip: (req) => {
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});

/**
 * Like limiter - prevent like/unlike spam
 */
export const likeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:like:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(
      429,
      'Too many like requests, please try again in a minute'
    );
  },
  skip: (req) => {
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});

/**
 * Analytics limiter - per-session/per-user rate limiting
 *
 * Environment behavior:
 * - Development/Test: Rate limiting DISABLED for load testing
 * - Production: Per-session limiting (500 events/session/minute)
 *
 * This prevents individual session abuse while allowing high aggregate traffic
 */
export const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 events per session/user per minute (up from 100 per IP)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Priority: userId (authenticated) > sessionId (anonymous) > record id (from params) > IP (fallback)
    const userId = (req as any).user?.id;
    const sessionId = req.body?.sessionId;
    const recordId = req.params?.id;
    return userId || sessionId || recordId || req.ip || 'unknown';
  },
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:analytics:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(
      429,
      'Analytics rate limit exceeded for this session, please try again shortly'
    );
  },
  skip: (req) => {
    // Skip rate limiting if:
    // 1. Redis is down (graceful degradation)
    // 2. Running in development or test environment (for load testing)
    const isDev =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const redisDown =
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready';
    return redisDown || isDev;
  },
});

/**
 * Admin limiter - higher limits for admin operations
 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // @ts-expect-error - Known issue with ioredis types
    sendCommand: (...args: string[]) => redisService.getClient().call(...args),
    prefix: 'rl:admin:',
  }),
  handler: (_req: Request, _res: Response) => {
    throw new ApiError(429, 'Admin rate limit exceeded, please slow down');
  },
  skip: (req) => {
    return (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    );
  },
});
