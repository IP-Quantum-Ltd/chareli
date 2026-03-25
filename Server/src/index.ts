import { loadConfiguration } from './services/secrets.service';
import app from './app';
import config from './config/config';
import { initializeDatabase } from './config/database';
import logger from './utils/logger';
import fs from 'fs';
import path from 'path';
import { authService } from './services/auth.service';
import { initializeScheduledJobs, startJsonCdnRefreshJob } from './jobs';
import { redisService } from './services/redis.service';
import { initializeGameZipWorker } from './workers/gameZipProcessor';
import { initializeThumbnailWorker } from './workers/thumbnailProcessor';
import { initializeAnalyticsWorker } from './workers/analyticsProcessor';
import { initializeLikeWorker } from './workers/likeProcessor';
import { initializeJsonCdnWorker } from './workers/jsonCdnProcessor';
import { initializeImageWorker } from './workers/imageProcessor';
import { initializeClickTrackingWorker } from './workers/clickTrackingProcessor';
import { initializeHomepageVisitWorker } from './workers/homepageVisitProcessor';
import { createServer } from 'http';
import { websocketService } from './services/websocket.service';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
  logger.info(`Created logs directory at ${logDir}`);
}

// Initialize background services (Redis + Workers)
async function initializeBackgroundServices(isPrimaryWorker: boolean): Promise<void> {
  try {
    // Connect to Redis
    logger.info('Connecting to Redis...');
    await redisService.connect();
    logger.info('Redis connected successfully');

    // Wait a moment to ensure Redis is fully ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (isPrimaryWorker) {
      // Initialize background workers
      logger.info('Initializing background workers...');
      initializeGameZipWorker();
      initializeThumbnailWorker();
      initializeAnalyticsWorker(); // NEW: Process analytics asynchronously
      initializeLikeWorker(); // NEW: Process likes asynchronously
      initializeJsonCdnWorker(); // NEW: Process JSON CDN generation asynchronously
      initializeImageWorker(); // NEW: Process image variants asynchronously
      initializeClickTrackingWorker(); // NEW: Process click tracking asynchronously
      initializeHomepageVisitWorker(); // NEW: Process homepage visits asynchronously
      logger.info('Background workers initialized successfully');
    } else {
      logger.info('Secondary worker - skipping background queue processing initialization');
    }

    // Verify worker is properly connected
    const isRedisConnected = await redisService.isConnected();
    if (!isRedisConnected) {
      throw new Error('Redis connection verification failed');
    }

    logger.info('Background services are fully operational');
  } catch (error) {
    logger.error('Failed to initialize background services:', error);
    logger.warn('Background job processing will be disabled');
    // Don't throw error - allow server to continue without background processing
  }
}

const startServer = async () => {
  try {
    await loadConfiguration();

    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
      logger.info(`Created logs directory at ${logDir}`);
    }

    logger.info('Initializing database connection...');
    try {
      // Temporarily skip database initialization for CORS testing
      if (process.env.SKIP_DB === 'true') {
        logger.warn('Skipping database initialization (SKIP_DB=true)');
      } else {
        await initializeDatabase();
      }

      const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

      if (isPrimaryWorker) {
        // Initialize superadmin account
        logger.info('Initializing superadmin account...');
        await authService.initializeSuperadmin();
      }

      // Initialize background services (Redis required for all, Workers for primary only)
      await initializeBackgroundServices(isPrimaryWorker);

      if (isPrimaryWorker) {
        // Initialize scheduled jobs
        initializeScheduledJobs();

        // Initialize JSON CDN refresh job
        startJsonCdnRefreshJob();
      }
    } catch (dbError) {
      if (config.env === 'development') {
        logger.warn(
          'Failed to connect to database in development mode, continuing without database connection'
        );
        logger.warn(
          'You can still access the Swagger documentation at http://localhost:5000/api-docs'
        );
      } else {
        throw dbError;
      }
    }

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize WebSocket service
    websocketService.initialize(httpServer);
    logger.info('WebSocket service initialized');

    const server = httpServer.listen(config.port, '0.0.0.0', () => {
      logger.info(
        `Server running in ${config.env} mode on port ${config.port}`
      );
      logger.info(`API available at http://localhost:${config.port}/api`);
      logger.info(
        `API documentation available at http://localhost:${config.port}/api-docs`
      );
      logger.info(`WebSocket server ready for connections`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err: Error) => {
      logger.error('UNHANDLED REJECTION! Shutting down...');
      logger.error(`${err.name}: ${err.message}`);
      logger.error(err.stack || 'No stack trace available');

      server.close(() => {
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err: Error) => {
      logger.error('UNCAUGHT EXCEPTION! Shutting down...');
      logger.error(`${err.name}: ${err.message}`);
      logger.error(err.stack || 'No stack trace available');

      process.exit(1);
    });

    // Handle SIGTERM signal
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        logger.info('Process terminated!');
      });
    });
  } catch (error) {
    logger.error('Failed to start server:');
    logger.error(
      error instanceof Error ? error.stack || error.message : String(error)
    );

    process.exit(1);
  }
};

startServer();
