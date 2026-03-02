import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import { Game, GameStatus } from '../entities/Games';
import { Analytics } from '../entities/Analytics';
import { SignupAnalytics } from '../entities/SignupAnalytics';
import { GamePositionHistory } from '../entities/GamePositionHistory';
import { ApiError } from '../middlewares/errorHandler';
import { Between, FindOptionsWhere, In, LessThan, IsNull, Not } from 'typeorm';
import { checkInactiveUsers } from '../jobs/userInactivityCheck';
import { storageService } from '../services/storage.service';
import { cacheService } from '../services/cache.service';
import { PerformanceTimer } from '../utils/performance';
import logger from '../utils/logger';
import { toZonedTime } from 'date-fns-tz';
import { AdminExclusionService } from '../services/adminExclusion.service';

const userRepository = AppDataSource.getRepository(User);
const gameRepository = AppDataSource.getRepository(Game);
const analyticsRepository = AppDataSource.getRepository(Analytics);
const signupAnalyticsRepository = AppDataSource.getRepository(SignupAnalytics);
const gamePositionHistoryRepository =
  AppDataSource.getRepository(GamePositionHistory);

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get admin dashboard analytics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
export const getDashboardAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const overallTimer = new PerformanceTimer('getDashboardAnalytics', {
    period: req.query.period,
  });
  const excludedRoles = AdminExclusionService.getNonTrackedRoles();
  try {
    const { period, startDate, endDate, country, timezone } = req.query;
    const userTimezone = (timezone as string) || 'UTC';

    const countries = Array.isArray(country)
      ? (country as string[])
      : country
      ? [country as string]
      : [];

    // Check cache first (TTL: 3 minutes) - include timezone in cache key
    const cacheKey = `${period || 'last24hours'}:${countries.sort().join(',')}:${userTimezone}`;
    const cached = await cacheService.getAnalytics('dashboard', cacheKey);
    if (cached) {
      logger.debug(`[CACHE HIT] Dashboard analytics for ${cacheKey}`);
      res.status(200).json(cached);
      return;
    }

    // Get current time in the user's timezone for proper day boundaries
    // This ensures "today" means "today in the user's timezone" (like Google Analytics)
    const nowUtc = new Date();
    const nowInUserTz = toZonedTime(nowUtc, userTimezone);

    // Helper to calculate period boundaries in user's timezone
    const getTimezoneAwarePeriodBoundaries = (daysBack: number, prevDaysBack: number) => {
      // Calculate start of today in user's timezone
      const startOfTodayInUserTz = new Date(nowInUserTz);
      startOfTodayInUserTz.setHours(0, 0, 0, 0);

      // Current period: from X days ago at midnight (user's TZ) to now
      const currentStart = new Date(startOfTodayInUserTz);
      currentStart.setDate(currentStart.getDate() - daysBack + 1); // +1 because we include today

      // Previous period: from 2X days ago to X days ago
      const prevStart = new Date(startOfTodayInUserTz);
      prevStart.setDate(prevStart.getDate() - prevDaysBack + 1);

      const prevEnd = new Date(currentStart);

      return { currentStart, prevStart, prevEnd };
    };

    let now = nowUtc;
    let currentPeriodStart: Date;
    let previousPeriodStart: Date;
    let previousPeriodEnd: Date;

    // Determine time ranges based on the period parameter (timezone-aware)
    switch (period) {
      case 'last7days': {
        const boundaries = getTimezoneAwarePeriodBoundaries(7, 14);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
        break;
      }
      case 'last30days': {
        const boundaries = getTimezoneAwarePeriodBoundaries(30, 60);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
        break;
      }
      case 'custom':
        if (startDate && endDate) {
          currentPeriodStart = new Date(startDate as string);
          currentPeriodStart.setHours(0, 0, 0, 0); // Start of day

          const customEndDate = new Date(endDate as string);
          customEndDate.setHours(23, 59, 59, 999); // End of day

          const daysDiff = Math.ceil(
            (customEndDate.getTime() - currentPeriodStart.getTime()) /
              (1000 * 60 * 60 * 24)
          );
          previousPeriodStart = new Date(
            currentPeriodStart.getTime() - daysDiff * 24 * 60 * 60 * 1000
          );
          previousPeriodEnd = currentPeriodStart;

          // For custom range, we need to use the actual end date for current period queries
          now = customEndDate;
        } else {
          // Fallback to last 24 hours if custom dates are invalid
          const boundaries = getTimezoneAwarePeriodBoundaries(1, 2);
          currentPeriodStart = boundaries.currentStart;
          previousPeriodStart = boundaries.prevStart;
          previousPeriodEnd = boundaries.prevEnd;
        }
        break;
      default: { // 'last24hours' or no period specified
        const boundaries = getTimezoneAwarePeriodBoundaries(1, 2);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
        break;
      }
    }

    // For backward compatibility, keep the original variable names
    const twentyFourHoursAgo = currentPeriodStart;
    const fortyEightHoursAgo = previousPeriodStart;

    // Get users who played games yesterday (24-48 hours ago) for 30+ seconds
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics (only include players and anonymous users)
    let yesterdayUsersQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      yesterdayUsersQuery = yesterdayUsersQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const timer1 = new PerformanceTimer('yesterdayUsersQuery');
    const yesterdayUsersResult = await yesterdayUsersQuery.getRawOne();
    timer1.end();

    // Among those users, count how many also played games today (last 24 hours) for 30+ seconds
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Optimized: Using EXISTS subquery instead of self-join for better performance
    // Exclude admin users from analytics (only include players and anonymous users)
    let returningUsersQuery = analyticsRepository
      .createQueryBuilder('a1')
      .select('COUNT(DISTINCT COALESCE(CAST(a1.userId AS VARCHAR), a1.sessionId))', 'count')
      .leftJoin('a1.user', 'user1')
      .leftJoin('user1.role', 'role1')
      .where('a1.createdAt > :twentyFourHoursAgo', { twentyFourHoursAgo })
      .andWhere('a1.gameId IS NOT NULL')
      .andWhere('a1.startTime IS NOT NULL')
      .andWhere('a1.endTime IS NOT NULL')
      .andWhere('a1.duration >= :minDuration', { minDuration: 30 })
      .andWhere("(role1.name NOT IN (:...excludedRoles) OR a1.userId IS NULL)", { excludedRoles })
      .andWhere(`EXISTS (
        SELECT 1 FROM internal.analytics a2
        LEFT JOIN public.users user2 ON a2.user_id = user2.id
        LEFT JOIN public.roles role2 ON user2."roleId" = role2.id
        WHERE COALESCE(CAST(a2.user_id AS VARCHAR), a2.session_id) = COALESCE(CAST(a1.userId AS VARCHAR), a1.sessionId)
        AND a2."createdAt" BETWEEN :start AND :end
        AND a2.game_id IS NOT NULL
        AND a2."startTime" IS NOT NULL
        AND a2."endTime" IS NOT NULL
        AND a2.duration >= 30
        AND (role2.name NOT IN (:...excludedRoles) OR a2.user_id IS NULL)
        ${countries.length > 0 ? 'AND user2.country = ANY(:countries)' : ''}
      )`, {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
        excludedRoles,
        ...(countries.length > 0 ? { countries } : {}),
      });

    // Add country filter for the outer query if provided
    if (countries.length > 0) {
      returningUsersQuery = returningUsersQuery
        .andWhere('user1.country IN (:...countriesOuter)', { countriesOuter: countries });
    }

    const timer2 = new PerformanceTimer('returningUsersQuery (EXISTS subquery)');
    const returningUsersResult = await returningUsersQuery.getRawOne();
    timer2.end();

    const yesterdayUsers = parseInt(yesterdayUsersResult?.count) || 0;
    const returningUsers = parseInt(returningUsersResult?.count) || 0;
    const retentionRate =
      yesterdayUsers > 0
        ? Number(((returningUsers / yesterdayUsers) * 100).toFixed(2))
        : 0;

    // 1. Daily Active Users - Always 24 hours, users who played games for 30+ seconds
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics (only include players and anonymous users)
    const dailyActiveUsersNow = new Date();
    const dailyActiveUsers24HoursAgo = new Date(
      dailyActiveUsersNow.getTime() - 24 * 60 * 60 * 1000
    );

    let dailyActiveUsersQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      dailyActiveUsersQuery = dailyActiveUsersQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const dailyActiveUsersResult = await dailyActiveUsersQuery.getRawOne();

    const dailyActiveUsers = parseInt(dailyActiveUsersResult?.count) || 0;

    // 2. Total Registered Users with active/inactive breakdown
    let currentRegisteredWhere: any = {
      createdAt: Between(twentyFourHoursAgo, now),
      isDeleted: false,
      hasCompletedFirstLogin: true,
    };
    let previousRegisteredWhere: any = {
      createdAt: Between(fortyEightHoursAgo, twentyFourHoursAgo),
      isDeleted: false,
      hasCompletedFirstLogin: true,
    };
    let actualRegisteredWhere: any = {
      isDeleted: false,
      hasCompletedFirstLogin: true,
    };

    // Add country filter if provided
    if (countries.length > 0) {
      currentRegisteredWhere.country = In(countries);
      previousRegisteredWhere.country = In(countries);
      actualRegisteredWhere.country = In(countries);
    }

    const [
      currentTotalRegisteredUsers,
      previousTotalRegisteredUsers,
      actualRegisteredUsers,
    ] = await Promise.all([
      userRepository.count({ where: currentRegisteredWhere }),
      userRepository.count({ where: previousRegisteredWhere }),
      userRepository.count({ where: actualRegisteredWhere }),
    ]);

    const totalRegisteredUsersPercentageChange =
      previousTotalRegisteredUsers > 0
        ? Math.max(
            Math.min(
              ((currentTotalRegisteredUsers - previousTotalRegisteredUsers) /
                previousTotalRegisteredUsers) *
                100,
              100
            ),
            -100
          )
        : 0;

    // Count active and inactive users based on business logic
    // Apply time period filtering to active/inactive user counts for registration insights
    // This ensures that the DonutChart shows users who REGISTERED in the selected time period
    // and their current active/inactive status, not just total counts across all time

    // IMPORTANT: We need to ensure that activeUsers + inactiveUsers equals totalRegisteredUsers.current
    // This means we need to categorize ALL users who registered in the time period

    let activeUsersWhere: any = {
      isActive: true,
      isDeleted: false,
      lastLoggedIn: Not(IsNull()), // Users who have logged in at least once
      createdAt: Between(twentyFourHoursAgo, now), // Filter by registration time period
      hasCompletedFirstLogin: true,
    };
    let systemInactiveWhere: any = {
      isActive: false,
      isDeleted: false,
      createdAt: Between(twentyFourHoursAgo, now), // Filter by registration time period
      hasCompletedFirstLogin: true,
    };
    let neverLoggedInWhere: any = {
      isActive: true,
      isDeleted: false,
      lastLoggedIn: IsNull(),
      createdAt: Between(twentyFourHoursAgo, now),
      hasCompletedFirstLogin: true,
      // Filter by registration time period
    };

    // Add country filter if provided
    if (countries.length > 0) {
      activeUsersWhere.country = In(countries);
      systemInactiveWhere.country = In(countries);
      neverLoggedInWhere.country = In(countries);
    }

    // Active users: users who registered in the selected period, have logged in at least once and are still active
    const activeUsers = await userRepository.count({ where: activeUsersWhere });

    const [systemInactiveUsers, neverLoggedInUsers] = await Promise.all([
      userRepository.count({ where: systemInactiveWhere }),
      userRepository.count({ where: neverLoggedInWhere }),
    ]);

    let inactiveUsers = systemInactiveUsers + neverLoggedInUsers;
    const registeredButNeverLoggedIn = neverLoggedInUsers;

    // 3. Game Coverage - Percentage of total games that have been played
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics (only include players and anonymous users)
    const totalGames = await gameRepository.count();

    // Get games played in current period
    let currentPlayedGamesQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT analytics.gameId)', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Get games played in previous period
    let previousPlayedGamesQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT analytics.gameId)', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      currentPlayedGamesQuery = currentPlayedGamesQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      previousPlayedGamesQuery = previousPlayedGamesQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const currentPlayedGamesResult = await currentPlayedGamesQuery.getRawOne();
    const previousPlayedGamesResult =
      await previousPlayedGamesQuery.getRawOne();

    const currentPlayedGames = parseInt(currentPlayedGamesResult?.count) || 0;
    const previousPlayedGames = parseInt(previousPlayedGamesResult?.count) || 0;

    const currentGameCoverage =
      totalGames > 0
        ? Number(((currentPlayedGames / totalGames) * 100).toFixed(2))
        : 0;
    const previousGameCoverage =
      totalGames > 0
        ? Number(((previousPlayedGames / totalGames) * 100).toFixed(2))
        : 0;

    const gameCoveragePercentageChange =
      previousGameCoverage > 0
        ? Math.max(
            Math.min(
              ((currentGameCoverage - previousGameCoverage) /
                previousGameCoverage) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 4. Total Active Users - Users who have analytics records within the selected period
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics (only include players and anonymous users)
    let currentTotalActiveUsersQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let previousTotalActiveUsersQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))', 'count')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      currentTotalActiveUsersQuery = currentTotalActiveUsersQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      previousTotalActiveUsersQuery = previousTotalActiveUsersQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const [currentTotalActiveUsers, previousTotalActiveUsers] =
      await Promise.all([
        currentTotalActiveUsersQuery.getRawOne(),
        previousTotalActiveUsersQuery.getRawOne(),
      ]);

    const currentActiveUsers = parseInt(currentTotalActiveUsers?.count) || 0;
    const previousActiveUsers = parseInt(previousTotalActiveUsers?.count) || 0;
    const totalActiveUsersPercentageChange =
      previousActiveUsers > 0
        ? Math.max(
            Math.min(
              ((currentActiveUsers - previousActiveUsers) /
                previousActiveUsers) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 4. Total Game Sessions (all users - authenticated + guest, duration >= 30 seconds)
    // Exclude admin users from analytics (only include players and anonymous users)
    let currentTotalSessionsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let previousTotalSessionsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let actualSessionsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      currentTotalSessionsQuery = currentTotalSessionsQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      previousTotalSessionsQuery = previousTotalSessionsQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      actualSessionsQuery = actualSessionsQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const [currentTotalSessions, previousTotalSessions, actualSessions] =
      await Promise.all([
        currentTotalSessionsQuery.getCount(),
        previousTotalSessionsQuery.getCount(),
        actualSessionsQuery.getCount(),
      ]);

    const totalSessionsPercentageChange =
      previousTotalSessions > 0
        ? Math.max(
            Math.min(
              ((currentTotalSessions - previousTotalSessions) /
                previousTotalSessions) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 5. Total Time Played (all users - authenticated + guest, duration >= 30 seconds)
    // Exclude admin users from analytics (only include players and anonymous users)
    let currentTotalTimePlayedQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('SUM(analytics.duration)', 'totalPlayTime')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.startTime BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let previousTotalTimePlayedQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('SUM(analytics.duration)', 'totalPlayTime')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.startTime BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let actualTimePlayedQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('SUM(analytics.duration)', 'totalPlayTime')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      currentTotalTimePlayedQuery = currentTotalTimePlayedQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      previousTotalTimePlayedQuery = previousTotalTimePlayedQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      actualTimePlayedQuery = actualTimePlayedQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const [
      currentTotalTimePlayedResult,
      previousTotalTimePlayedResult,
      actualTimePlayed,
    ] = await Promise.all([
      currentTotalTimePlayedQuery.getRawOne(),
      previousTotalTimePlayedQuery.getRawOne(),
      actualTimePlayedQuery.getRawOne(),
    ]);

    const totalPlayTime = Number(actualTimePlayed?.totalPlayTime) || 0;

    const currentTotalTimePlayed =
      Number(currentTotalTimePlayedResult?.totalPlayTime) || 0;
    const previousTotalTimePlayed =
      Number(previousTotalTimePlayedResult?.totalPlayTime) || 0;
    const totalTimePlayedPercentageChange =
      previousTotalTimePlayed > 0
        ? Math.max(
            Math.min(
              ((currentTotalTimePlayed - previousTotalTimePlayed) /
                previousTotalTimePlayed) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 6. Most Played Games (top 3) with percentage change (for the current period, duration >= 30 seconds)
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics
    let mostPlayedGamesQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.gameId', 'gameId')
      .addSelect('game.title', 'gameTitle')
      .addSelect('thumbnailFile.s3Key', 'thumbnailKey')
      .addSelect('COUNT(*)', 'sessionCount')
      .leftJoin('analytics.game', 'game')
      .leftJoin('game.thumbnailFile', 'thumbnailFile')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      mostPlayedGamesQuery = mostPlayedGamesQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const mostPlayedGamesResults = await mostPlayedGamesQuery
      .groupBy('analytics.gameId')
      .addGroupBy('game.title')
      .addGroupBy('thumbnailFile.s3Key')
      .orderBy('COUNT(*)', 'DESC')
      .limit(3)
      .getRawMany();

    let mostPlayedGames: Array<{
      id: string;
      title: string;
      thumbnailUrl: string | null;
      sessionCount: number;
      percentageChange: number;
    }> = [];
    if (mostPlayedGamesResults && mostPlayedGamesResults.length > 0) {
      mostPlayedGames = await Promise.all(
        mostPlayedGamesResults.map(async (gameResult) => {
          // Get current period sessions for this game
          // Exclude admin users from analytics (only include players and anonymous users)
          let currentSessionsQuery = analyticsRepository
            .createQueryBuilder('analytics')
            .select('COUNT(*)', 'count')
            .leftJoin('analytics.user', 'user')
            .leftJoin('user.role', 'role')
            .where('analytics.gameId = :gameId', { gameId: gameResult.gameId })
            .andWhere('analytics.startTime IS NOT NULL')
            .andWhere('analytics.endTime IS NOT NULL')
            .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
            .andWhere('analytics.createdAt > :twentyFourHoursAgo', {
              twentyFourHoursAgo,
            })
            .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

          // Get previous period sessions for this game
          let previousSessionsQuery = analyticsRepository
            .createQueryBuilder('analytics')
            .select('COUNT(*)', 'count')
            .leftJoin('analytics.user', 'user')
            .leftJoin('user.role', 'role')
            .where('analytics.gameId = :gameId', { gameId: gameResult.gameId })
            .andWhere('analytics.startTime IS NOT NULL')
            .andWhere('analytics.endTime IS NOT NULL')
            .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
            .andWhere('analytics.createdAt BETWEEN :start AND :end', {
              start: fortyEightHoursAgo,
              end: twentyFourHoursAgo,
            })
            .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

          // Add country filter if provided
          if (countries.length > 0) {
            currentSessionsQuery = currentSessionsQuery.andWhere(
              'user.country IN (:...countries)',
              { countries }
            );

            previousSessionsQuery = previousSessionsQuery.andWhere(
              'user.country IN (:...countries)',
              { countries }
            );
          }

          const currentSessions = await currentSessionsQuery.getRawOne();
          const previousSessions = await previousSessionsQuery.getRawOne();

          const current = parseInt(currentSessions?.count) || 0;
          const previous = parseInt(previousSessions?.count) || 0;
          const percentageChange =
            previous > 0
              ? Math.max(
                  Math.min(((current - previous) / previous) * 100, 100),
                  -100
                )
              : 0;

          return {
            id: gameResult.gameId,
            title: gameResult.gameTitle,
            thumbnailUrl: gameResult.thumbnailKey
              ? storageService.getPublicUrl(gameResult.thumbnailKey)
              : null,
            sessionCount: parseInt(gameResult.sessionCount),
            percentageChange: Number(percentageChange.toFixed(2)),
          };
        })
      );
    }

    // Calculate overall percentage change for the top games (using the #1 game's change)
    const overallPercentageChange =
      mostPlayedGames.length > 0 ? mostPlayedGames[0].percentageChange : 0;

    // 7. Average Session Duration (in seconds, game-related only, duration >= 30 seconds)
    // Track all users: authenticated (userId) + anonymous (sessionId)
    // Exclude admin users from analytics (only include players and anonymous users)
    let currentAvgDurationQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select(
        'AVG(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration END)',
        'avgDuration'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let previousAvgDurationQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select(
        'AVG(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration END)',
        'avgDuration'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided
    if (countries.length > 0) {
      currentAvgDurationQuery = currentAvgDurationQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );

      previousAvgDurationQuery = previousAvgDurationQuery.andWhere(
        'user.country IN (:...countries)',
        { countries }
      );
    }

    const [currentAvgDurationResult, previousAvgDurationResult] =
      await Promise.all([
        currentAvgDurationQuery.getRawOne(),
        previousAvgDurationQuery.getRawOne(),
      ]);

    // Convert to minutes before calculating percentage change
    const currentAvgSessionDuration = Math.round(
      currentAvgDurationResult?.avgDuration || 0
    );
    const previousAvgSessionDuration = Math.round(
      previousAvgDurationResult?.avgDuration || 0
    );
    const avgSessionDurationPercentageChange =
      previousAvgSessionDuration > 0
        ? Math.max(
            Math.min(
              ((currentAvgSessionDuration - previousAvgSessionDuration) /
                previousAvgSessionDuration) *
                100,
              100
            ),
            -100
          )
        : 0;

    // Count adults and minors with country filter
    let adultsWhere: any = { isAdult: true, isDeleted: false };
    let minorsWhere: any = { isAdult: false, isDeleted: false };

    // Add country filter if provided
    if (countries.length > 0) {
      adultsWhere.country = In(countries);
      minorsWhere.country = In(countries);
    }

    const [adultsCount, minorsCount] = await Promise.all([
      userRepository.count({ where: adultsWhere }),
      userRepository.count({ where: minorsWhere }),
    ]);

    // ==================== ANONYMOUS USER ANALYTICS ====================

    // 1. Daily Anonymous Visitors (DAV) - Always 24 hours, unique sessionIds with 30+ second sessions
    const dailyAnonymousVisitorsNow = new Date();
    const dailyAnonymousVisitors24HoursAgo = new Date(
      dailyAnonymousVisitorsNow.getTime() - 24 * 60 * 60 * 1000
    );

    const dailyAnonymousVisitorsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT analytics.sessionId)', 'count')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.userId IS NULL')
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: dailyAnonymousVisitors24HoursAgo,
        end: dailyAnonymousVisitorsNow,
      });

    const dailyAnonymousVisitorsResult =
      await dailyAnonymousVisitorsQuery.getRawOne();
    const dailyAnonymousVisitors =
      parseInt(dailyAnonymousVisitorsResult?.count) || 0;

    // 2. Total Visitors (Authenticated + Anonymous) for current and previous periods
    // Now includes both game sessions AND page visits to align with GA4
    // Exclude admin users from analytics (only include players and anonymous users)
    let currentTotalVisitorsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select(
        'COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))',
        'count'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where(
        '(analytics.gameId IS NOT NULL OR analytics.activityType = :pageVisit)',
        { pageVisit: 'homepage_visit' }
      )
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      })
      .andWhere(
        '(user.hasCompletedFirstLogin = :hasCompleted OR analytics.userId IS NULL)',
        { hasCompleted: true }
      )
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    let previousTotalVisitorsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select(
        'COUNT(DISTINCT COALESCE(CAST(analytics.userId AS VARCHAR), analytics.sessionId))',
        'count'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where(
        '(analytics.gameId IS NOT NULL OR analytics.activityType = :pageVisit)',
        { pageVisit: 'homepage_visit' }
      )
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      })
      .andWhere(
        '(user.hasCompletedFirstLogin = :hasCompleted OR analytics.userId IS NULL)',
        { hasCompleted: true }
      )
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles });

    // Add country filter if provided (only applies to authenticated users with country data)
    if (countries.length > 0) {
      currentTotalVisitorsQuery = currentTotalVisitorsQuery.andWhere(
        '(user.country IN (:...countries) OR analytics.userId IS NULL)',
        { countries }
      );

      previousTotalVisitorsQuery = previousTotalVisitorsQuery.andWhere(
        '(user.country IN (:...countries) OR analytics.userId IS NULL)',
        { countries }
      );
    }

    const [currentTotalVisitorsResult, previousTotalVisitorsResult] =
      await Promise.all([
        currentTotalVisitorsQuery.getRawOne(),
        previousTotalVisitorsQuery.getRawOne(),
      ]);

    const currentTotalVisitors =
      parseInt(currentTotalVisitorsResult?.count) || 0;
    const previousTotalVisitors =
      parseInt(previousTotalVisitorsResult?.count) || 0;
    const totalVisitorsPercentageChange =
      previousTotalVisitors > 0
        ? Math.max(
            Math.min(
              ((currentTotalVisitors - previousTotalVisitors) /
                previousTotalVisitors) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 3. Anonymous Sessions (current and previous periods)
    let currentAnonymousSessionsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.userId IS NULL')
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      });

    let previousAnonymousSessionsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.userId IS NULL')
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.createdAt BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      });

    const [currentAnonymousSessions, previousAnonymousSessions] =
      await Promise.all([
        currentAnonymousSessionsQuery.getCount(),
        previousAnonymousSessionsQuery.getCount(),
      ]);

    const anonymousSessionsPercentageChange =
      previousAnonymousSessions > 0
        ? Math.max(
            Math.min(
              ((currentAnonymousSessions - previousAnonymousSessions) /
                previousAnonymousSessions) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 4. Anonymous Time Played (in seconds)
    let currentAnonymousTimePlayedQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('SUM(analytics.duration)', 'totalPlayTime')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.userId IS NULL')
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.startTime BETWEEN :start AND :end', {
        start: twentyFourHoursAgo,
        end: now,
      });

    let previousAnonymousTimePlayedQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .select('SUM(analytics.duration)', 'totalPlayTime')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.userId IS NULL')
      .andWhere('analytics.gameId IS NOT NULL')
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere('analytics.startTime BETWEEN :start AND :end', {
        start: fortyEightHoursAgo,
        end: twentyFourHoursAgo,
      });

    const [
      currentAnonymousTimePlayedResult,
      previousAnonymousTimePlayedResult,
    ] = await Promise.all([
      currentAnonymousTimePlayedQuery.getRawOne(),
      previousAnonymousTimePlayedQuery.getRawOne(),
    ]);

    const currentAnonymousTimePlayed =
      Number(currentAnonymousTimePlayedResult?.totalPlayTime) || 0;
    const previousAnonymousTimePlayed =
      Number(previousAnonymousTimePlayedResult?.totalPlayTime) || 0;
    const anonymousTimePlayedPercentageChange =
      previousAnonymousTimePlayed > 0
        ? Math.max(
            Math.min(
              ((currentAnonymousTimePlayed - previousAnonymousTimePlayed) /
                previousAnonymousTimePlayed) *
                100,
              100
            ),
            -100
          )
        : 0;

    // 5. User Type Breakdown (Authenticated vs Anonymous)
    // 5. User Type Breakdown (Authenticated vs Anonymous)
    // Note: currentTotalSessions and currentTotalTimePlayed include BOTH authenticated and anonymous users
    // So we need to subtract anonymous counts to get authenticated counts

    // Sessions breakdown
    const totalSessions = currentTotalSessions; // This is already the total
    const anonymousSessions = currentAnonymousSessions;
    const authenticatedSessions = Math.max(0, totalSessions - anonymousSessions);

    // Time breakdown
    const totalTime = currentTotalTimePlayed; // This is already the total
    const anonymousTime = currentAnonymousTimePlayed;
    const authenticatedTime = Math.max(0, totalTime - anonymousTime);

    const authenticatedSessionsPercentage =
      totalSessions > 0
        ? Number(((authenticatedSessions / totalSessions) * 100).toFixed(2))
        : 0;

    const anonymousSessionsPercentage =
      totalSessions > 0
        ? Number(((anonymousSessions / totalSessions) * 100).toFixed(2))
        : 0;

    const authenticatedTimePercentage =
      totalTime > 0
        ? Number(((authenticatedTime / totalTime) * 100).toFixed(2))
        : 0;

    const anonymousTimePercentage =
      totalTime > 0
        ? Number(((anonymousTime / totalTime) * 100).toFixed(2))
        : 0;

    // Build response object
    const responseData = {
      success: true,
      data: {
        dailyActiveUsers: {
          current: dailyActiveUsers,
          // No percentage change since it's always 24 hours
        },
        dailyAnonymousVisitors: {
          current: dailyAnonymousVisitors,
          // No percentage change since it's always 24 hours
        },
        totalVisitors: {
          current: currentTotalVisitors,
          percentageChange: Number(totalVisitorsPercentageChange.toFixed(2)),
        },
        totalRegisteredUsers: {
          current: currentTotalRegisteredUsers,
          percentageChange: Number(
            totalRegisteredUsersPercentageChange.toFixed(2)
          ),
          registered: actualRegisteredUsers,
        },
        activeUsers,
        inactiveUsers,
        registeredButNeverLoggedIn,
        adultsCount,
        minorsCount,
        gameCoverage: {
          current: currentGameCoverage,
          percentageChange: Number(gameCoveragePercentageChange.toFixed(2)),
        },
        totalActiveUsers: {
          current: currentActiveUsers,
          percentageChange: Number(totalActiveUsersPercentageChange.toFixed(2)),
        },
        totalSessions: {
          current: currentTotalSessions,
          percentageChange: Number(totalSessionsPercentageChange.toFixed(2)),
        },
        anonymousSessions: {
          current: currentAnonymousSessions,
          percentageChange: Number(
            anonymousSessionsPercentageChange.toFixed(2)
          ),
        },
        totalTimePlayed: {
          current: currentTotalTimePlayed, // Use time played in the selected period
          percentageChange: Number(totalTimePlayedPercentageChange.toFixed(2)),
        },
        anonymousTimePlayed: {
          current: currentAnonymousTimePlayed,
          percentageChange: Number(
            anonymousTimePlayedPercentageChange.toFixed(2)
          ),
        },
        userTypeBreakdown: {
          authenticatedSessions,
          anonymousSessions,
          authenticatedSessionsPercentage,
          anonymousSessionsPercentage,
          authenticatedTimePlayed: authenticatedTime,
          anonymousTimePlayed: anonymousTime,
          authenticatedTimePercentage,
          anonymousTimePercentage,
        },
        mostPlayedGames: {
          games: mostPlayedGames,
          percentageChange: overallPercentageChange,
        },
        avgSessionDuration: {
          current: currentAvgSessionDuration,
          percentageChange: Number(
            avgSessionDurationPercentageChange.toFixed(2)
          ),
        },
        retentionRate,
      },
    };

    // Cache the response (TTL: 3 minutes = 180 seconds)
    await cacheService.setAnalytics('dashboard', cacheKey, responseData, undefined, 180);
    logger.debug(`[CACHE SET] Dashboard analytics for ${cacheKey}`);

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/check-inactive-users:
 *   post:
 *     summary: Manually trigger the check for inactive users
 *     description: Checks for users who haven't logged in for 14+ days and sets them to inactive
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inactive users check completed successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
export const runInactiveUsersCheck = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await checkInactiveUsers();

    res.status(200).json({
      success: true,
      message: 'Inactive users check completed successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/user-activity-log:
 *   get:
 *     summary: Get user activity log
 *     description: Retrieves a log of user activities including logins, signups, and game sessions
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by user ID
 *     responses:
 *       200:
 *         description: User activity log retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
/**
 * Get user activity log - shows one entry per user with their latest activity and last game played
 */
export const getUserActivityLog = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      page,
      limit,
      userId,
      startDate,
      endDate,
      userStatus,
      userName,
      gameTitle,
      activityType,
      sortBy,
      sortOrder,
    } = req.query;

    // Handle multi-select parameters
    const gameTitles = Array.isArray(gameTitle)
      ? (gameTitle as string[])
      : gameTitle
      ? [gameTitle as string]
      : [];

    // Only apply pagination if page or limit parameters are explicitly provided
    const shouldPaginate = page || limit;
    const pageNumber = shouldPaginate ? parseInt(page as string, 10) || 1 : 1;
    const limitNumber = shouldPaginate
      ? parseInt(limit as string, 10) || 10
      : undefined;

    // First, get the list of users with filters
    const userQueryBuilder = userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.isActive',
        'user.lastSeen',
      ])
      .where('user.isDeleted = :isDeleted', { isDeleted: false });

    // Apply user filter if provided
    if (userId) {
      userQueryBuilder.andWhere('user.id = :userId', { userId });
    }

    // Apply user name filter if provided
    if (userName) {
      userQueryBuilder.andWhere(
        "(user.firstName ILIKE :userName OR user.lastName ILIKE :userName OR CONCAT(user.firstName, ' ', user.lastName) ILIKE :userName)",
        { userName: `%${userName}%` }
      );
    }

    // Get total count for pagination info
    const total = await userQueryBuilder.getCount();

    // Apply pagination only if explicitly requested
    if (shouldPaginate && limitNumber) {
      userQueryBuilder.skip((pageNumber - 1) * limitNumber).take(limitNumber);
    }

    // Apply sorting
    const order = sortOrder === 'desc' ? 'DESC' : 'ASC';
    switch (sortBy) {
      case 'name':
        userQueryBuilder
          .orderBy('user.firstName', order)
          .addOrderBy('user.lastName', order);
        break;
      case 'email':
        userQueryBuilder.orderBy('user.email', order);
        break;
      case 'createdAt':
        userQueryBuilder.orderBy('user.createdAt', order);
        break;
      default:
        userQueryBuilder.orderBy('user.createdAt', 'DESC');
        break;
    }

    const users = await userQueryBuilder.getMany();

    // If no users found, return early
    if (users.length === 0) {
      const response: any = {
        success: true,
        count: 0,
        total: 0,
        data: [],
      };
      if (shouldPaginate && limitNumber) {
        response.page = pageNumber;
        response.limit = limitNumber;
        response.totalPages = 0;
      }
      res.status(200).json(response);
    }

    // OPTIMIZATION: Batch fetch all analytics data in a single query using window functions
    const timer = new PerformanceTimer(
      'getUserActivityLog - batch analytics query',
      {
        userCount: users.length,
      }
    );

    const userIds = users.map((u) => u.id);

    // Build the batched analytics query with window functions
    let batchAnalyticsQuery = `
      WITH latest_activities AS (
        SELECT
          a.user_id,
          a."activityType",
          a."createdAt",
          ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a."createdAt" DESC) as activity_rank
        FROM internal.analytics a
        WHERE a.user_id = ANY($1)
    `;

    const queryParams: any[] = [userIds];
    let paramIndex = 2;

    // Add date filter if provided
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      batchAnalyticsQuery += ` AND a."createdAt" BETWEEN $${paramIndex} AND $${
        paramIndex + 1
      }`;
      queryParams.push(start, end);
      paramIndex += 2;
    }

    batchAnalyticsQuery += `
      ),
      latest_games AS (
        SELECT
          a.user_id,
          a.game_id,
          g.title as game_title,
          a."startTime",
          a."endTime",
          ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a."startTime" DESC) as game_rank
        FROM internal.analytics a
        LEFT JOIN public.games g ON a.game_id = g.id
        WHERE a.user_id = ANY($1)
          AND a.game_id IS NOT NULL
    `;

    // Add date filter for games if provided
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      // Use previously added params
      batchAnalyticsQuery += ` AND a."startTime" BETWEEN $2 AND $3`;
    }

    batchAnalyticsQuery += `
      )
      SELECT
        la.user_id,
        la."activityType",
        lg.game_title,
        lg."startTime" as game_start_time,
        lg."endTime" as game_end_time
      FROM latest_activities la
      LEFT JOIN latest_games lg ON la.user_id = lg.user_id AND lg.game_rank = 1
      WHERE la.activity_rank = 1
    `;

    // Execute the batched query
    const analyticsResults = await analyticsRepository.query(
      batchAnalyticsQuery,
      queryParams
    );

    timer.end();

    // Create a map for fast lookup
    const analyticsMap = new Map();
    analyticsResults.forEach((result: any) => {
      analyticsMap.set(result.user_id, {
        activityType: result.activityType,
        gameTitle: result.game_title,
        gameStartTime: result.game_start_time,
        gameEndTime: result.game_end_time,
      });
    });

    // Format the data - one entry per user
    let formattedActivities = users.map((user) => {
      const analytics = analyticsMap.get(user.id);

      // Default values
      const activity = analytics?.activityType || '';
      const gameTitle = analytics?.gameTitle || '';
      const gameStartTime = analytics?.gameStartTime || null;
      const gameEndTime = analytics?.gameEndTime || null;

      // Determine if user is online based on lastSeen timestamp and heartbeat system
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isOnline =
        user.lastSeen && user.lastSeen > fiveMinutesAgo && user.isActive;

      return {
        userId: user.id,
        name: `${user.firstName || ''} ${user.lastName || ''}`,
        userStatus: isOnline ? 'Online' : 'Offline',
        activity: activity,
        lastGamePlayed: gameTitle,
        startTime: gameStartTime,
        endTime: gameEndTime,
        lastSessionDuration:
          gameStartTime && gameEndTime
            ? Math.floor(
                (gameEndTime.getTime() - gameStartTime.getTime()) / 1000
              )
            : null,
      };
    });

    // Apply additional filters to the formatted activities

    // Filter by user status if provided
    if (userStatus) {
      if (userStatus === 'Online') {
        formattedActivities = formattedActivities.filter(
          (activity) => activity.userStatus === 'Online'
        );
      } else if (userStatus === 'Offline') {
        formattedActivities = formattedActivities.filter(
          (activity) => activity.userStatus === 'Offline'
        );
      }
    }

    // Filter by activity type if provided
    if (activityType) {
      const activityTypeStr = Array.isArray(activityType)
        ? (activityType[0] as string)
        : (activityType as string);
      formattedActivities = formattedActivities.filter(
        (activity) =>
          activity.activity &&
          activity.activity
            .toLowerCase()
            .includes(activityTypeStr.toLowerCase())
      );
    }

    // Filter by game titles if provided
    if (gameTitles.length > 0) {
      formattedActivities = formattedActivities.filter(
        (activity) =>
          activity.lastGamePlayed &&
          gameTitles.some((title) =>
            activity.lastGamePlayed
              .toLowerCase()
              .includes((title as string).toLowerCase())
          )
      );
    }

    // Prepare response with conditional pagination info
    const response: any = {
      success: true,
      count: formattedActivities.length,
      total,
      data: formattedActivities,
    };

    // Only include pagination info if pagination was applied
    if (shouldPaginate && limitNumber) {
      response.page = pageNumber;
      response.limit = limitNumber;
      response.totalPages = Math.ceil(total / limitNumber);
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/games-analytics:
 *   get:
 *     summary: Get all games with their analytics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of items per page
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by category ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, disabled]
 *         description: Filter by game status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for game title or description
 *     responses:
 *       200:
 *         description: Games with analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
export const getGamesWithAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const excludedRoles = AdminExclusionService.getNonTrackedRoles();
  try {
    const { page, limit, categoryId, status, search } = req.query;

    // Only apply pagination if page or limit parameters are explicitly provided
    const shouldPaginate = page || limit;
    const pageNumber = shouldPaginate ? parseInt(page as string, 10) || 1 : 1;
    const limitNumber = shouldPaginate
      ? parseInt(limit as string, 10) || 10
      : undefined;

    // Build query for games
    const queryBuilder = gameRepository
      .createQueryBuilder('game')
      .leftJoinAndSelect('game.category', 'category')
      .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
      .leftJoinAndSelect('game.createdBy', 'createdBy');

    // Apply category filter if provided
    if (categoryId) {
      queryBuilder.andWhere('game.categoryId = :categoryId', { categoryId });
    }

    // Apply status filter if provided
    if (status) {
      queryBuilder.andWhere('game.status = :status', { status });
    }

    // Apply search filter if provided
    if (search) {
      queryBuilder.andWhere(
        '(game.title ILIKE :search OR game.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get total count for pagination info
    const total = await queryBuilder.getCount();

    // Apply pagination only if explicitly requested
    if (shouldPaginate && limitNumber) {
      queryBuilder.skip((pageNumber - 1) * limitNumber).take(limitNumber);
    }

    queryBuilder.orderBy('game.position', 'ASC');
    queryBuilder.addOrderBy('game.createdAt', 'DESC');

    const games = await queryBuilder.getMany();

    // Get game IDs for analytics query
    const gameIds = games.map((game) => game.id);

    // Get analytics data for these games
    let gamesAnalytics = [];

    if (gameIds.length > 0) {
      // Exclude admin users from analytics (only include players and anonymous users)
      gamesAnalytics = await analyticsRepository
        .createQueryBuilder('analytics')
        .select('analytics.gameId', 'gameId')
        .addSelect('COUNT(*)', 'uniquePlayers')
        .addSelect('COUNT(*)', 'totalSessions')
        .addSelect('SUM(analytics.duration)', 'totalPlayTime')
        .leftJoin('analytics.user', 'user')
        .leftJoin('user.role', 'role')
        .where('analytics.gameId IN (:...gameIds)', { gameIds })
        .andWhere('analytics.startTime IS NOT NULL')
        .andWhere('analytics.endTime IS NOT NULL')
        .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
        .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
        .groupBy('analytics.gameId')
        .getRawMany();
    }

    // Create a map of game IDs to their analytics data
    const analyticsMap = new Map();

    gamesAnalytics.forEach((item) => {
      analyticsMap.set(item.gameId, {
        uniquePlayers: parseInt(item.uniquePlayers) || 0,
        totalSessions: parseInt(item.totalSessions) || 0,
        totalPlayTime: item.totalPlayTime || 0,
      });
    });

    // Combine game data with analytics data and transform URLs
    const gamesWithAnalytics = games.map((game) => {
      const analytics = analyticsMap.get(game.id) || {
        uniquePlayers: 0,
        totalSessions: 0,
        totalPlayTime: 0,
      };

      // Transform game data to include CloudFront URLs and processing status
      const transformedGame = {
        ...game,
        thumbnailFile: game.thumbnailFile
          ? {
              ...game.thumbnailFile,
              url: game.thumbnailFile.s3Key
                ? storageService.getPublicUrl(game.thumbnailFile.s3Key)
                : null,
            }
          : null,
        // Explicitly include processing status fields
        processingStatus: game.processingStatus,
        processingError: game.processingError,
        jobId: game.jobId,
        analytics,
      };

      return transformedGame;
    });

    // Prepare response with conditional pagination info
    const response: any = {
      success: true,
      count: games.length,
      total,
      data: gamesWithAnalytics,
    };

    // Only include pagination info if pagination was applied
    if (shouldPaginate && limitNumber) {
      response.page = pageNumber;
      response.limit = limitNumber;
      response.totalPages = Math.ceil(total / limitNumber);
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/games/{id}/analytics:
 *   get:
 *     summary: Get analytics for a specific game
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Game ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for analytics (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for analytics (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Game analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const getGameAnalyticsById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const excludedRoles = AdminExclusionService.getNonTrackedRoles();
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Check if game exists
    const game = await gameRepository.findOne({
      where: { id },
      relations: ['category', 'thumbnailFile', 'createdBy', 'gameFile'],
    });

    if (!game) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    // Build where conditions for analytics queries
    const whereConditions: FindOptionsWhere<Analytics> = {
      gameId: id,
    };

    // Add date range if provided
    if (startDate && endDate) {
      whereConditions.startTime = Between(
        new Date(startDate as string),
        new Date(endDate as string)
      );
    } else if (startDate) {
      whereConditions.startTime = Between(
        new Date(startDate as string),
        new Date()
      );
    }

    // Get game's analytics summary
    // Exclude admin users from analytics (only include players and anonymous users)
    const analyticsSummary = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(*)', 'uniquePlayers')
      .addSelect('COUNT(*)', 'totalSessions')
      .addSelect('SUM(analytics.duration)', 'totalPlayTime')
      .addSelect('AVG(analytics.duration)', 'avgSessionDuration')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where(whereConditions)
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
      .getRawOne();

    // Get top players for this game
    // Exclude admin users from analytics (only include players)
    const topPlayers = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.userId', 'userId')
      .addSelect('user.email', 'userEmail')
      .addSelect('user.firstName', 'firstName')
      .addSelect('user.lastName', 'lastName')
      .addSelect(
        'COUNT(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.id END)',
        'sessionCount'
      )
      .addSelect(
        'SUM(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration ELSE 0 END)',
        'totalPlayTime'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where(whereConditions)
      .andWhere("role.name NOT IN (:...excludedRoles)", { excludedRoles })
      .groupBy('analytics.userId')
      .addGroupBy('user.email')
      .addGroupBy('user.firstName')
      .addGroupBy('user.lastName')
      .orderBy(
        'SUM(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration ELSE 0 END)',
        'DESC'
      )
      .limit(10)
      .getRawMany();

    // Format the top players data
    const formattedTopPlayers = topPlayers.map((player) => ({
      userId: player.userId,
      email: player.userEmail,
      name: `${player.firstName} ${player.lastName}`,
      sessionCount: parseInt(player.sessionCount) || 0,
      totalPlayTime: Math.round((player.totalPlayTime || 0) / 60), // Convert to minutes
    }));

    // Get daily play time for trend analysis
    // Exclude admin users from analytics (only include players and anonymous users)
    const dailyPlayTime = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('DATE(analytics.startTime)', 'date')
      .addSelect(
        'COUNT(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.id END)',
        'sessions'
      )
      .addSelect(
        'COUNT(DISTINCT CASE WHEN analytics.gameId IS NOT NULL THEN analytics.userId END)',
        'players'
      )
      .addSelect(
        'SUM(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration ELSE 0 END)',
        'totalPlayTime'
      )
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where(whereConditions)
      .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
      .groupBy('DATE(analytics.startTime)')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Format the daily play time data
    const formattedDailyPlayTime = dailyPlayTime.map((day) => ({
      date: day.date,
      sessions: parseInt(day.sessions) || 0,
      players: parseInt(day.players) || 0,
      playTime: parseInt(day.totalPlayTime || 0),
    }));

    const transformedGame = {
      ...game,
      thumbnailFile: game.thumbnailFile
        ? {
            ...game.thumbnailFile,
            url: game.thumbnailFile.s3Key
              ? storageService.getPublicUrl(game.thumbnailFile.s3Key)
              : null,
          }
        : null,
      gameFile: game.gameFile
        ? {
            ...game.gameFile,
            url: game.gameFile.s3Key
              ? storageService.getPublicUrl(game.gameFile.s3Key)
              : null,
          }
        : null,
    };

    // Prepare the response
    const gameAnalytics = {
      game: transformedGame,
      analytics: {
        uniquePlayers: parseInt(analyticsSummary?.uniquePlayers) || 0,
        totalSessions: parseInt(analyticsSummary?.totalSessions) || 0,
        totalPlayTime: parseInt(analyticsSummary?.totalPlayTime || 0),
        avgSessionDuration: Math.round(
          (analyticsSummary?.avgSessionDuration || 0) / 60
        ), // Convert to minutes
        topPlayers: formattedTopPlayers,
        dailyPlayTime: formattedDailyPlayTime,
      },
    };

    res.status(200).json({
      success: true,
      data: gameAnalytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/users/{id}/analytics:
 *   get:
 *     summary: Get analytics for a specific user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
export const getUserAnalyticsById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await userRepository.findOne({
      where: { id },
      relations: ['role'],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        country: true,
        isActive: true,
        isVerified: true,
        lastLoggedIn: true,
        hasCompletedFirstLogin: true,
        createdAt: true,
        updatedAt: true,
        role: {
          id: true,
          name: true,
          description: true,
        },
      },
    });

    if (!user) {
      return next(ApiError.notFound(`User with id ${id} not found`));
    }

    // Get user's analytics summary
    const analyticsSummary = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT analytics.gameId)', 'totalGamesPlayed')
      .addSelect('COUNT(*)', 'totalSessionCount')
      .addSelect('SUM(analytics.duration)', 'totalTimePlayed')
      .where('analytics.userId = :userId', { userId: id })
      .andWhere('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
      .getRawOne();

    // Get user's game activity details
    const gameActivity = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.gameId', 'gameId')
      .addSelect('game.title', 'gameTitle')
      .addSelect('thumbnailFile.s3Key', 'thumbnailKey')
      .addSelect(
        'COUNT(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.id END)',
        'sessionCount'
      )
      .addSelect(
        'SUM(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.duration ELSE 0 END)',
        'totalPlayTime'
      )
      .addSelect('MAX(analytics.startTime)', 'lastPlayed')
      .leftJoin('analytics.game', 'game')
      .leftJoin('game.thumbnailFile', 'thumbnailFile')
      .where('analytics.userId = :userId', { userId: id })
      .andWhere('analytics.gameId IS NOT NULL')
      .groupBy('analytics.gameId')
      .addGroupBy('game.title')
      .addGroupBy('thumbnailFile.s3Key')
      .orderBy('MAX(analytics.startTime)', 'DESC')
      .getRawMany();

    // Format the game activity data
    const formattedGameActivity = gameActivity.map((game) => ({
      gameId: game.gameId,
      gameTitle: game.gameTitle,
      thumbnailUrl: game.thumbnailKey
        ? storageService.getPublicUrl(game.thumbnailKey)
        : null,
      sessionCount: parseInt(game.sessionCount) || 0,
      totalPlayTime: parseInt(game.totalPlayTime || 0), // Convert to minutes
      lastPlayed: game.lastPlayed,
    }));

    // Prepare the response
    const userAnalytics = {
      user,
      analytics: {
        totalGamesPlayed: parseInt(analyticsSummary?.totalGamesPlayed) || 0,
        totalSessionCount: parseInt(analyticsSummary?.totalSessionCount) || 0,
        totalTimePlayed: parseInt(analyticsSummary?.totalTimePlayed || 0), // Convert to minutes
        gameActivity: formattedGameActivity,
      },
    };

    res.status(200).json({
      success: true,
      data: userAnalytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /admin/users-analytics:
 *   get:
 *     summary: Get all users with their game analytics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users with analytics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
/**
 * @swagger
 * /admin/games-popularity:
 *   get:
 *     summary: Get popularity metrics for all games
 *     description: Returns total plays, average play time, and popularity trend for each game
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Games popularity metrics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
export const getGamesPopularityMetrics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const excludedRoles = AdminExclusionService.getNonTrackedRoles();
  try {
    const { period, startDate, endDate, timezone } = req.query;
    const userTimezone = (timezone as string) || 'UTC';

    // Get current time in the user's timezone for proper day boundaries
    const nowUtc = new Date();
    const nowInUserTz = toZonedTime(nowUtc, userTimezone);

    // Helper to calculate period boundaries in user's timezone
    const getTimezoneAwarePeriodBoundaries = (daysBack: number, prevDaysBack: number) => {
      const startOfTodayInUserTz = new Date(nowInUserTz);
      startOfTodayInUserTz.setHours(0, 0, 0, 0);

      const currentStart = new Date(startOfTodayInUserTz);
      currentStart.setDate(currentStart.getDate() - daysBack + 1);

      const prevStart = new Date(startOfTodayInUserTz);
      prevStart.setDate(prevStart.getDate() - prevDaysBack + 1);

      const prevEnd = new Date(currentStart);

      return { currentStart, prevStart, prevEnd };
    };

    let now = nowUtc;
    let currentPeriodStart: Date;
    let previousPeriodStart: Date;
    let previousPeriodEnd: Date;

    // Determine time ranges based on the period parameter (timezone-aware)
    switch (period) {
      case 'last7days': {
        const boundaries = getTimezoneAwarePeriodBoundaries(7, 14);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
        break;
      }
      case 'last30days': {
        const boundaries = getTimezoneAwarePeriodBoundaries(30, 60);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
        break;
      }
      case 'custom':
        if (startDate && endDate) {
          currentPeriodStart = new Date(startDate as string);
          currentPeriodStart.setHours(0, 0, 0, 0);
          const customEndDate = new Date(endDate as string);
          customEndDate.setHours(23, 59, 59, 999);
          const daysDiff = Math.ceil(
            (customEndDate.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
          );
          previousPeriodStart = new Date(currentPeriodStart.getTime() - daysDiff * 24 * 60 * 60 * 1000);
          previousPeriodEnd = currentPeriodStart;
          now = customEndDate;
        } else {
          const boundaries = getTimezoneAwarePeriodBoundaries(1, 2);
          currentPeriodStart = boundaries.currentStart;
          previousPeriodStart = boundaries.prevStart;
          previousPeriodEnd = boundaries.prevEnd;
        }
        break;
      default: { // last24hours
        const boundaries = getTimezoneAwarePeriodBoundaries(1, 2);
        currentPeriodStart = boundaries.currentStart;
        previousPeriodStart = boundaries.prevStart;
        previousPeriodEnd = boundaries.prevEnd;
      }
    }

    // Get all games with basic info
    const games = await gameRepository.find({
      relations: ['thumbnailFile'],
      select: {
        id: true,
        title: true,
        status: true,
        thumbnailFile: {
          s3Key: true,
        },
      },
    });

    // Get metrics for all games
    // Exclude admin users from analytics
    const gamesMetrics = await Promise.all(
      games.map(async (game) => {
        // Get total plays and average play time for the selected period (duration >= 30 seconds)
        const overallMetrics = await analyticsRepository
          .createQueryBuilder('analytics')
          .select('COUNT(*)', 'totalPlays')
          .addSelect('AVG(analytics.duration)', 'averagePlayTime')
          .addSelect('SUM(analytics.duration)', 'totalTime')
          .leftJoin('analytics.user', 'user')
          .leftJoin('user.role', 'role')
          .where('analytics.gameId = :gameId', { gameId: game.id })
          .andWhere('analytics.startTime IS NOT NULL')
          .andWhere('analytics.endTime IS NOT NULL')
          .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
          .andWhere('analytics.createdAt > :currentPeriodStart', { currentPeriodStart })
          .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
          .getRawOne();

        // Get plays in current period (duration >= 30 seconds)
        const currentPeriodPlays = await analyticsRepository
          .createQueryBuilder('analytics')
          .select('COUNT(*)', 'count')
          .leftJoin('analytics.user', 'user')
          .leftJoin('user.role', 'role')
          .where('analytics.gameId = :gameId', { gameId: game.id })
          .andWhere('analytics.startTime IS NOT NULL')
          .andWhere('analytics.endTime IS NOT NULL')
          .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
          .andWhere('analytics.createdAt > :currentPeriodStart', {
            currentPeriodStart,
          })
          .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
          .getRawOne();

        // Get plays in previous period (duration >= 30 seconds)
        const previousPeriodPlays = await analyticsRepository
          .createQueryBuilder('analytics')
          .select('COUNT(*)', 'count')
          .leftJoin('analytics.user', 'user')
          .leftJoin('user.role', 'role')
          .where('analytics.gameId = :gameId', { gameId: game.id })
          .andWhere('analytics.startTime IS NOT NULL')
          .andWhere('analytics.endTime IS NOT NULL')
          .andWhere('analytics.duration >= :minDuration', { minDuration: 30 })
          .andWhere('analytics.createdAt BETWEEN :start AND :end', {
            start: previousPeriodStart,
            end: previousPeriodEnd,
          })
          .andWhere("(role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)", { excludedRoles })
          .getRawOne();

        // Get position with highest click count for this game
        const mostPlayedAtPosition = await gamePositionHistoryRepository
          .createQueryBuilder('history')
          .select('history.position', 'position')
          .addSelect('history.clickCount', 'clickCount')
          .where('history.gameId = :gameId', { gameId: game.id })
          .orderBy('history.clickCount', 'DESC')
          .addOrderBy('history.position', 'ASC') // Tie-breaker: prefer lower position number
          .limit(1)
          .getRawOne();

        const currentPlays = parseInt(currentPeriodPlays?.count) || 0;
        const previousPlays = parseInt(previousPeriodPlays?.count) || 0;

        // Determine popularity trend
        let popularity: 'up' | 'down' = 'down';
        if (currentPlays > previousPlays) {
          popularity = 'up';
        }

        const totalPlays = parseInt(overallMetrics?.totalPlays) || 0;
        const avgPlayTime = parseFloat(overallMetrics?.averagePlayTime) || 0;
        const totalTime = parseInt(overallMetrics?.totalTime) || 0; // Total time from SUM(duration)

        return {
          id: game.id,
          title: game.title,
          thumbnailUrl: game.thumbnailFile?.s3Key
            ? storageService.getPublicUrl(game.thumbnailFile.s3Key)
            : null,
          status: game.status,
          metrics: {
            totalPlays,
            totalTime, // Total time in seconds
            averagePlayTime: Math.round(avgPlayTime / 60), // Convert to minutes
            popularity,
            mostPlayedAt: mostPlayedAtPosition
              ? {
                  position: parseInt(mostPlayedAtPosition.position),
                  clickCount: parseInt(mostPlayedAtPosition.clickCount),
                }
              : null,
          },
        };
      })
    );

    // Sort by total time first, then sessions as tiebreaker (highest first)
    gamesMetrics.sort((a, b) => {
      const timeDiff = b.metrics.totalTime - a.metrics.totalTime;
      if (timeDiff !== 0) return timeDiff;
      return b.metrics.totalPlays - a.metrics.totalPlays;
    });

    res.status(200).json({
      success: true,
      data: gamesMetrics,
    });
  } catch (error) {
    next(error);
  }
};

export const getUsersWithAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      lastLoginStartDate,
      lastLoginEndDate,
      userStatus,
      sortBy,
      sortOrder,
      sessionCount,
      minTimePlayed,
      maxTimePlayed,
      gameTitle,
      gameCategory,
      country,
      ageGroup,
      sortByMaxTimePlayed,
    } = req.query;

    // Handle multi-select parameters (they come as arrays)
    const gameTitles = Array.isArray(gameTitle)
      ? gameTitle
      : gameTitle
      ? [gameTitle]
      : [];
    const gameCategories = Array.isArray(gameCategory)
      ? gameCategory
      : gameCategory
      ? [gameCategory]
      : [];
    const countries = Array.isArray(country)
      ? country
      : country
      ? [country]
      : [];

    // Build base query for users
    let userQueryBuilder = userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.isDeleted = :isDeleted', { isDeleted: false })
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.country',
        'user.registrationIpAddress',
        'user.lastKnownDeviceType',
        'user.phoneNumber',
        'user.isActive',
        'user.isVerified',
        'user.isAdult',
        'user.lastLoggedIn',
        'user.hasCompletedFirstLogin',
        'user.createdAt',
        'user.updatedAt',
        'role.id',
        'role.name',
        'role.description',
      ]);

    // Apply date range filter if provided
    if (startDate && endDate) {
      // Create date objects and set time to cover the full day
      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0); // Start of day

      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999); // End of day

      userQueryBuilder = userQueryBuilder.andWhere(
        'user.createdAt >= :startDate AND user.createdAt <= :endDate',
        {
          startDate: start,
          endDate: end,
        }
      );
    } else if (startDate) {
      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0); // Start of day

      userQueryBuilder = userQueryBuilder.andWhere(
        'user.createdAt >= :startDate',
        {
          startDate: start,
        }
      );
    }

    // Apply last login date filter if provided
    if (lastLoginStartDate && lastLoginEndDate) {
      const start = new Date(lastLoginStartDate as string);
      start.setHours(0, 0, 0, 0); // Start of day

      const end = new Date(lastLoginEndDate as string);
      end.setHours(23, 59, 59, 999); // End of day

      userQueryBuilder = userQueryBuilder.andWhere(
        'user.lastLoggedIn >= :lastLoginStartDate AND user.lastLoggedIn <= :lastLoginEndDate',
        {
          lastLoginStartDate: start,
          lastLoginEndDate: end,
        }
      );
    } else if (lastLoginStartDate) {
      const start = new Date(lastLoginStartDate as string);
      start.setHours(0, 0, 0, 0); // Start of day

      userQueryBuilder = userQueryBuilder.andWhere(
        'user.lastLoggedIn >= :lastLoginStartDate',
        {
          lastLoginStartDate: start,
        }
      );
    } else if (lastLoginEndDate) {
      const end = new Date(lastLoginEndDate as string);
      end.setHours(23, 59, 59, 999); // End of day

      userQueryBuilder = userQueryBuilder.andWhere(
        'user.lastLoggedIn <= :lastLoginEndDate',
        {
          lastLoginEndDate: end,
        }
      );
    }

    // Apply user status filter if provided
    if (userStatus) {
      if (userStatus === 'active') {
        userQueryBuilder = userQueryBuilder.andWhere(
          'user.isActive = :isActive',
          { isActive: true }
        );
      } else if (userStatus === 'inactive') {
        userQueryBuilder = userQueryBuilder.andWhere(
          'user.isActive = :isActive',
          { isActive: false }
        );
      }
    }

    // Get all users first (we'll filter by analytics later)
    const users = await userQueryBuilder.getMany();

    // Get analytics data for all users
    const usersAnalytics = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.userId', 'userId')
      .addSelect('COUNT(DISTINCT analytics.gameId)', 'totalGamesPlayed')
      .addSelect('COUNT(*)', 'totalSessionCount')
      .addSelect('SUM(analytics.duration)', 'totalTimePlayed')
      .where('analytics.startTime IS NOT NULL')
      .andWhere('analytics.endTime IS NOT NULL')
      .groupBy('analytics.userId')
      .getRawMany();

    // Get most played game for each user
    const usersMostPlayedGames = await analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.userId', 'userId')
      .addSelect('analytics.gameId', 'gameId')
      .addSelect('game.title', 'gameTitle')
      .addSelect('thumbnailFile.s3Key', 'thumbnailKey')
      .addSelect(
        'COUNT(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.id END)',
        'sessionCount'
      )
      .leftJoin('analytics.game', 'game')
      .leftJoin('game.thumbnailFile', 'thumbnailFile')
      .where('analytics.gameId IS NOT NULL')
      .groupBy('analytics.userId')
      .addGroupBy('analytics.gameId')
      .addGroupBy('game.title')
      .addGroupBy('thumbnailFile.s3Key')
      .orderBy('analytics.userId')
      .addOrderBy(
        'COUNT(CASE WHEN analytics.gameId IS NOT NULL THEN analytics.id END)',
        'DESC'
      )
      .getRawMany();

    // Create a map of user IDs to their most played game
    const mostPlayedGameMap = new Map();
    usersMostPlayedGames.forEach((item) => {
      // Only add the first game for each user (the most played one)
      if (!mostPlayedGameMap.has(item.userId)) {
        mostPlayedGameMap.set(item.userId, {
          gameId: item.gameId,
          gameTitle: item.gameTitle,
          thumbnailUrl: item.thumbnailKey
            ? storageService.getPublicUrl(item.thumbnailKey)
            : null,
          sessionCount: parseInt(item.sessionCount) || 0,
        });
      }
    });

    // Create a map of user IDs to their analytics data
    const analyticsMap = new Map();
    usersAnalytics.forEach((item) => {
      analyticsMap.set(item.userId, {
        totalGamesPlayed: parseInt(item.totalGamesPlayed) || 0,
        totalSessionCount: parseInt(item.totalSessionCount) || 0,
        totalTimePlayed: item.totalTimePlayed || 0,
        mostPlayedGame: mostPlayedGameMap.get(item.userId) || null,
      });
    });

    // Apply additional filters based on analytics data
    let filteredUsers = users.map((user) => {
      const analytics = analyticsMap.get(user.id) || {
        totalGamesPlayed: 0,
        totalSessionCount: 0,
        totalTimePlayed: 0,
        mostPlayedGame: null,
      };

      return {
        ...user,
        analytics,
      };
    });

    // Filter by session count
    if (sessionCount) {
      const minSessions = parseInt(sessionCount as string);
      filteredUsers = filteredUsers.filter(
        (user) => user.analytics.totalSessionCount >= minSessions
      );
    }

    // Filter by time played (in seconds, converted from minutes)
    if (minTimePlayed) {
      const minSeconds = parseInt(minTimePlayed as string);
      filteredUsers = filteredUsers.filter(
        (user) => user.analytics.totalTimePlayed >= minSeconds
      );
    }

    if (maxTimePlayed) {
      const maxSeconds = parseInt(maxTimePlayed as string);
      filteredUsers = filteredUsers.filter(
        (user) => user.analytics.totalTimePlayed <= maxSeconds
      );
    }

    // Filter by game titles - check if user has played any of the specified games
    if (gameTitles.length > 0) {
      const usersWhoPlayedGames = await analyticsRepository
        .createQueryBuilder('analytics')
        .select('DISTINCT analytics.userId', 'userId')
        .leftJoin('analytics.game', 'game')
        .where('game.title IN (:...gameTitles)', { gameTitles })
        .andWhere('analytics.gameId IS NOT NULL')
        .getRawMany();

      const userIdsWhoPlayedGames = new Set(
        usersWhoPlayedGames.map((item) => item.userId)
      );

      filteredUsers = filteredUsers.filter((user) =>
        userIdsWhoPlayedGames.has(user.id)
      );
    }

    // Filter by game categories - check if user has played games from any of the specified categories
    if (gameCategories.length > 0) {
      const usersWhoPlayedCategories = await analyticsRepository
        .createQueryBuilder('analytics')
        .select('DISTINCT analytics.userId', 'userId')
        .leftJoin('analytics.game', 'game')
        .leftJoin('game.category', 'category')
        .where('category.name IN (:...gameCategories)', { gameCategories })
        .andWhere('analytics.gameId IS NOT NULL')
        .getRawMany();

      const userIdsWhoPlayedCategories = new Set(
        usersWhoPlayedCategories.map((item) => item.userId)
      );

      filteredUsers = filteredUsers.filter((user) =>
        userIdsWhoPlayedCategories.has(user.id)
      );
    }

    // Filter by countries
    if (countries.length > 0) {
      filteredUsers = filteredUsers.filter((user) =>
        countries.includes(user.country)
      );
    }

    // Filter by age group
    if (ageGroup) {
      if (ageGroup === 'adults') {
        filteredUsers = filteredUsers.filter((user) => user.isAdult === true);
      } else if (ageGroup === 'minors') {
        filteredUsers = filteredUsers.filter((user) => user.isAdult === false);
      }
    }

    // Apply sorting based on sortBy and sortOrder parameters
    const order = sortOrder === 'asc' ? 1 : -1;

    if (sortBy) {
      switch (sortBy) {
        case 'firstName':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order * (a.firstName || '').localeCompare(b.firstName || '')
          );
          break;
        case 'lastName':
          filteredUsers = filteredUsers.sort(
            (a, b) => order * (a.lastName || '').localeCompare(b.lastName || '')
          );
          break;
        case 'email':
          filteredUsers = filteredUsers.sort(
            (a, b) => order * (a.email || '').localeCompare(b.email || '')
          );
          break;
        case 'createdAt':
        case 'registrationDate':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order *
              (new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime())
          );
          break;
        case 'lastLoggedIn':
        case 'lastLogin':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order *
              (new Date(a.lastLoggedIn || 0).getTime() -
                new Date(b.lastLoggedIn || 0).getTime())
          );
          break;
        case 'lastSeen':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order *
              (new Date(a.lastSeen || 0).getTime() -
                new Date(b.lastSeen || 0).getTime())
          );
          break;
        case 'country':
          filteredUsers = filteredUsers.sort(
            (a, b) => order * (a.country || '').localeCompare(b.country || '')
          );
          break;
        case 'timePlayed':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order *
              ((a.analytics.totalTimePlayed || 0) -
                (b.analytics.totalTimePlayed || 0))
          );
          break;
        case 'sessionCount':
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              order *
              ((a.analytics.totalSessionCount || 0) -
                (b.analytics.totalSessionCount || 0))
          );
          break;
        default:
          // Default sorting by last login descending
          filteredUsers = filteredUsers.sort(
            (a, b) =>
              new Date(b.lastLoggedIn || 0).getTime() -
              new Date(a.lastLoggedIn || 0).getTime()
          );
          break;
      }
    } else if (sortByMaxTimePlayed === 'true') {
      // Keep backward compatibility for the old sorting parameter
      filteredUsers = filteredUsers.sort(
        (a, b) =>
          (b.analytics.totalTimePlayed || 0) -
          (a.analytics.totalTimePlayed || 0)
      );
    } else {
      // Default sorting by last login descending
      filteredUsers = filteredUsers.sort(
        (a, b) =>
          new Date(b.lastLoggedIn || 0).getTime() -
          new Date(a.lastLoggedIn || 0).getTime()
      );
    }

    res.status(200).json({
      success: true,
      count: filteredUsers.length,
      data: filteredUsers,
    });
  } catch (error) {
    next(error);
  }
};
