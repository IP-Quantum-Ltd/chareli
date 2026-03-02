import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { SignupAnalytics } from '../entities/SignupAnalytics';
import { User } from '../entities/User';
import { getCountryFromIP, extractClientIP, getIPCacheStats } from '../utils/ipUtils';
import { AdminExclusionService } from '../services/adminExclusion.service';

const signupAnalyticsRepository = AppDataSource.getRepository(SignupAnalytics);

function detectDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (
    ua.includes('ipad') ||
    ua.includes('tablet') ||
    (ua.includes('android') && !ua.includes('mobi'))
  ) {
    return 'tablet';
  }

  if (
    ua.includes('mobi') ||
    ua.includes('android') ||
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    ua.includes('blackberry') ||
    ua.includes('windows phone')
  ) {
    return 'mobile';
  }

  return 'desktop';
}



/**
 * Test endpoint to verify IP country detection
 */
export const testIPCountry = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { ip } = req.params;
    const country = await getCountryFromIP(ip);
    const cacheStats = getIPCacheStats();

    res.status(200).json({
      success: true,
      data: {
        ip,
        country,
        cached: cacheStats.keys > 0 // Simple check if cache has entries
      }
    });
  } catch (error) {
    next(error);
  }
};


/**
 * @swagger
 * /signup-analytics/click:
 *   post:
 *     summary: Track signup button click
 *     tags: [SignupAnalytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               sessionId:
 *                 type: string
 *               type:
 *                 type: string
 *                 description: Type of signup form that was clicked (e.g., 'homepage', 'navbar', 'popup')
 *     responses:
 *       201:
 *         description: Click tracked successfully
 *       400:
 *         description: Missing required fields
 *       200:
 *         description: Request processed
 */
export const trackSignupClick = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { sessionId, type } = req.body;

    // Check if authenticated user is admin
    // Check if authenticated user is admin
    if (req.user) {
      const shouldTrack = await AdminExclusionService.shouldTrack(req.user.userId);

      // Don't track signup clicks from admin users
      if (!shouldTrack) {
        res.status(200).json({
          success: true,
          message: 'Signup click not tracked (admin user)'
        });
        return;
      }
    }

    if (!type) {
      res.status(400).json({
        success: false,
        message: 'Signup form type is required'
      });
      return;
    }

    // Extract real IP address (behind proxy/CDN safe)
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = extractClientIP(forwarded, req.socket.remoteAddress || req.ip || '');

    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDeviceType(userAgent);

    const country = await getCountryFromIP(ipAddress);

    const analytics = signupAnalyticsRepository.create({
      sessionId: sessionId || undefined,
      ipAddress,
      country: country || undefined,
      deviceType,
      type,
    });

    await signupAnalyticsRepository.save(analytics);

    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Failed to track signup click:', error);
    res.status(200).json({ success: true }); // don't block user experience
  }
};


/**
 * @swagger
 * /signup-analytics/data:
 *   get:
 *     summary: Get signup analytics data
 *     tags: [SignupAnalytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of days to include (default 30)
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [last24hours, last7days, last30days, custom]
 *         description: Time period filter
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for custom period
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for custom period
 *       - in: query
 *         name: country
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filter by countries
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
export const getSignupAnalyticsData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { period, startDate: queryStartDate, endDate: queryEndDate, country, days } = req.query;

    // Handle country filter
    const countries = Array.isArray(country) ? country as string[] : country ? [country as string] : [];

    // Calculate date range based on period or days parameter
    let startDate: Date;
    let endDate: Date = new Date();

    if (period) {
      // Use period-based filtering (same as dashboard analytics)
      switch (period) {
        case 'last24hours':
          startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'last7days':
          startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'last30days':
          startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'custom':
          if (queryStartDate && queryEndDate) {
            startDate = new Date(queryStartDate as string);
            endDate = new Date(queryEndDate as string);
          } else {
            // Fallback to 30 days if custom dates not provided
            startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
          }
          break;
        default:
          startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
    } else {
      // Fallback to days parameter for backward compatibility
      const daysCount = days ? parseInt(days as string) : 30;
      startDate = new Date();
      startDate.setDate(startDate.getDate() - daysCount);
    }

    // Total clicks in the selected period (excluding signup-modal to avoid double counting)
    let totalClicksQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(*)', 'count')
      .where('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' });

    // Add country filter for total clicks if provided
    if (countries.length > 0) {
      totalClicksQuery = totalClicksQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const totalClicks = await totalClicksQuery
      .getRawOne()
      .then(result => parseInt(result?.count || '0'));

    // Clicks in the selected period (excluding signup-modal to avoid double counting)
    let periodClicksQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(*)', 'count')
      .where('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' });

    // Add country filter for period clicks if provided
    if (countries.length > 0) {
      periodClicksQuery = periodClicksQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const periodClicks = await periodClicksQuery
      .getRawOne()
      .then(result => parseInt(result?.count || '0'));

    // Unique sessions (excluding signup-modal to avoid double counting)
    let uniqueSessionsQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('COUNT(DISTINCT analytics.sessionId)', 'count')
      .where('analytics.sessionId IS NOT NULL')
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' })
      .andWhere('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    // Add country filter for unique sessions if provided
    if (countries.length > 0) {
      uniqueSessionsQuery = uniqueSessionsQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const uniqueSessions = await uniqueSessionsQuery.getRawOne();

    // Clicks by country (excluding signup-modal to avoid double counting)
    let clicksByCountryQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.country', 'country')
      .addSelect('COUNT(*)', 'count')
      .where('analytics.country IS NOT NULL')
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' })
      .andWhere('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    // Add country filter for clicks by country if provided
    if (countries.length > 0) {
      clicksByCountryQuery = clicksByCountryQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const clicksByCountry = await clicksByCountryQuery
      .groupBy('analytics.country')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    // Clicks by device type (excluding signup-modal to avoid double counting)
    let clicksByDeviceQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.deviceType', 'deviceType')
      .addSelect('COUNT(*)', 'count')
      .where('analytics.deviceType IS NOT NULL')
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' })
      .andWhere('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    // Add country filter for clicks by device if provided
    if (countries.length > 0) {
      clicksByDeviceQuery = clicksByDeviceQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const clicksByDevice = await clicksByDeviceQuery
      .groupBy('analytics.deviceType')
      .orderBy('count', 'DESC')
      .getRawMany();

    // Clicks by day (excluding signup-modal to avoid double counting)
    let clicksByDayQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('DATE(analytics.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .where('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('analytics.type != :excludeType', { excludeType: 'signup-modal' });

    // Add country filter for clicks by day if provided
    if (countries.length > 0) {
      clicksByDayQuery = clicksByDayQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const clicksByDay = await clicksByDayQuery
      .groupBy('DATE(analytics.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Clicks by type (excluding signup-modal to avoid double counting)
    let clicksByTypeQuery = signupAnalyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('analytics.type != :excludeType', { excludeType: 'signup-modal' })
      .andWhere('analytics.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    // Add country filter for clicks by type if provided
    if (countries.length > 0) {
      clicksByTypeQuery = clicksByTypeQuery.andWhere('analytics.country IN (:...countries)', { countries });
    }

    const clicksByType = await clicksByTypeQuery
      .groupBy('analytics.type')
      .orderBy('count', 'DESC')
      .getRawMany();

    res.status(200).json({
      success: true,
      data: {
        totalClicks,
        periodClicks,
        uniqueSessions: uniqueSessions?.count || 0,
        clicksByCountry,
        clicksByDevice,
        clicksByDay,
        clicksByType
      }
    });
  } catch (error) {
    next(error);
  }
};
