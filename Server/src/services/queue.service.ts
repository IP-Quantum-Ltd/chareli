import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { redisService } from './redis.service';
import logger from '../utils/logger';

const WORKER_CONCURRENCY = 5;

// Job types
export enum JobType {
  GAME_ZIP_PROCESSING = 'game-zip-processing',
  THUMBNAIL_PROCESSING = 'thumbnail-processing',
  ANALYTICS_PROCESSING = 'analytics-processing',
  LIKE_PROCESSING = 'like-processing',
  JSON_CDN_GENERATION = 'json-cdn-generation',
  IMAGE_PROCESSING = 'image-processing',
  CLICK_TRACKING = 'click-tracking',
  HOMEPAGE_VISIT = 'homepage-visit',
  CACHE_REFRESH = 'cache-refresh',
}

// Job data interfaces
export interface GameZipProcessingJobData {
  gameId: string;
  gameFileKey: string; // temp storage key for ZIP file
  userId?: string;
}

export interface ThumbnailProcessingJobData {
  gameId: string;
  tempKey: string;
  permanentFolder: string;
}

export interface AnalyticsProcessingJobData {
  userId: string | null;
  sessionId: string | null;
  gameId?: string | null;
  activityType: string;
  startTime: Date;
  endTime?: Date;
  sessionCount?: number;
}

export interface LikeProcessingJobData {
  userId: string;
  gameId: string;
  action: 'like' | 'unlike';
}

export interface JsonCdnJobData {
  type: 'full' | 'invalidate';
  paths?: string[]; // For invalidation
}

export interface ImageProcessingJobData {
  fileId: string;
  s3Key: string;
}

export interface ClickTrackingJobData {
  gameId: string;
  position: number;
}

export interface HomepageVisitJobData {
  userId: string | null;
  sessionId: string | null;
}

export interface CacheRefreshJobData {
  cacheKey: string; // e.g., 'filter:popular'
  cacheType: 'games' | 'categories' | 'analytics';
}

class QueueService {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  public queueEvents!: QueueEvents; // For waiting on job completion

  constructor() {
    this.initializeQueues();
  }

  private initializeQueues(): void {
    // Create Redis connection config optimized for BullMQ
    const redisConfig = {
      host: redisService.getClient().options.host,
      port: redisService.getClient().options.port,
      password: redisService.getClient().options.password,
      db: redisService.getClient().options.db,
      maxRetriesPerRequest: null,
      retryDelayOnFailover: 100,
    };

    // Create game processing queue
    const gameProcessingQueue = new Queue(JobType.GAME_ZIP_PROCESSING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.queues.set(JobType.GAME_ZIP_PROCESSING, gameProcessingQueue);

    // Create thumbnail processing queue
    const thumbnailProcessingQueue = new Queue(JobType.THUMBNAIL_PROCESSING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    this.queues.set(JobType.THUMBNAIL_PROCESSING, thumbnailProcessingQueue);

    // Create analytics processing queue
    const analyticsProcessingQueue = new Queue(JobType.ANALYTICS_PROCESSING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 200, // Keep last 200 failed jobs for debugging
        attempts: 3, // Retry failed analytics writes
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    this.queues.set(JobType.ANALYTICS_PROCESSING, analyticsProcessingQueue);

    // Create like processing queue
    const likeProcessingQueue = new Queue(JobType.LIKE_PROCESSING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    this.queues.set(JobType.LIKE_PROCESSING, likeProcessingQueue);

    // Create JSON CDN generation queue
    const jsonCdnQueue = new Queue(JobType.JSON_CDN_GENERATION, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    this.queues.set(JobType.JSON_CDN_GENERATION, jsonCdnQueue);

    // Create image processing queue
    const imageProcessingQueue = new Queue(JobType.IMAGE_PROCESSING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.queues.set(JobType.IMAGE_PROCESSING, imageProcessingQueue);

    // Create click tracking queue
    const clickTrackingQueue = new Queue(JobType.CLICK_TRACKING, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500,
        },
      },
    });

    this.queues.set(JobType.CLICK_TRACKING, clickTrackingQueue);

    // Create homepage visit tracking queue
    const homepageVisitQueue = new Queue(JobType.HOMEPAGE_VISIT, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500,
        },
      },
    });

    this.queues.set(JobType.HOMEPAGE_VISIT, homepageVisitQueue);

    // Create cache refresh queue
    const cacheRefreshQueue = new Queue(JobType.CACHE_REFRESH, {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    this.queues.set(JobType.CACHE_REFRESH, cacheRefreshQueue);

    // Create QueueEvents for analytics queue to listen for job completion
    this.queueEvents = new QueueEvents(JobType.ANALYTICS_PROCESSING, {
      connection: redisConfig,
    });

    logger.info('Job queues initialized');
  }

  async addGameZipProcessingJob(
    data: GameZipProcessingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<GameZipProcessingJobData>> {
    const queue = this.queues.get(JobType.GAME_ZIP_PROCESSING);
    if (!queue) {
      throw new Error('Game ZIP processing queue not found');
    }

    const job = await queue.add('process-game-zip', data, {
      ...options,
      jobId: `game-${data.gameId}-${Date.now()}`,
    });

    logger.info(
      `Added game ZIP processing job for game ${data.gameId} with job ID: ${job.id}`
    );
    return job;
  }

  async addThumbnailProcessingJob(
    data: ThumbnailProcessingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<ThumbnailProcessingJobData>> {
    const queue = this.queues.get(JobType.THUMBNAIL_PROCESSING);
    if (!queue) {
      throw new Error('Thumbnail processing queue not found');
    }

    const job = await queue.add('process-thumbnail', data, {
      ...options,
      jobId: `thumbnail-${data.gameId}-${Date.now()}`,
    });

    logger.info(
      `Added thumbnail processing job for game ${data.gameId} with job ID: ${job.id}`
    );
    return job;
  }

  async addAnalyticsProcessingJob(
    data: AnalyticsProcessingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<AnalyticsProcessingJobData>> {
    const queue = this.queues.get(JobType.ANALYTICS_PROCESSING);
    if (!queue) {
      throw new Error('Analytics processing queue not found');
    }

    const job = await queue.add('process-analytics', data, {
      ...options,
      jobId: `analytics-${data.userId}-${Date.now()}`,
    });

    logger.debug(
      `Added analytics processing job for user ${data.userId} with job ID: ${job.id}`
    );
    return job;
  }

  async addLikeProcessingJob(
    data: LikeProcessingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<LikeProcessingJobData>> {
    const queue = this.queues.get(JobType.LIKE_PROCESSING);
    if (!queue) {
      throw new Error('Like processing queue not found');
    }

    const job = await queue.add('process-like', data, {
      ...options,
      jobId: `like-${data.gameId}-${data.userId}-${Date.now()}`,
    });

    logger.debug(
      `Added like processing job for game ${data.gameId} with job ID: ${job.id}`
    );
    return job;
  }

  async addJsonCdnJob(
    data: JsonCdnJobData,
    options?: {
      delay?: number;
    }
  ): Promise<Job<JsonCdnJobData>> {
    const queue = this.queues.get(JobType.JSON_CDN_GENERATION);
    if (!queue) {
      throw new Error('JSON CDN processing queue not found');
    }

    const job = await queue.add('generate-json-cdn', data, {
      ...options,
      jobId: data.type === 'full' ? 'json-cdn-full' : `json-cdn-${Date.now()}`,
    });

    logger.info(`Added JSON CDN job: ${data.type} with job ID: ${job.id}`);
    return job;
  }

  async addImageProcessingJob(
    data: ImageProcessingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<ImageProcessingJobData>> {
    const queue = this.queues.get(JobType.IMAGE_PROCESSING);
    if (!queue) {
      throw new Error('Image processing queue not found');
    }

    const job = await queue.add('process-image', data, {
      ...options,
      jobId: `image-${data.fileId}-${Date.now()}`,
    });

    logger.info(
      `Added image processing job for file ${data.fileId} with job ID: ${job.id}`
    );
    return job;
  }

  async addClickTrackingJob(
    data: ClickTrackingJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<ClickTrackingJobData>> {
    const queue = this.queues.get(JobType.CLICK_TRACKING);
    if (!queue) {
      throw new Error('Click tracking queue not found');
    }

    const job = await queue.add('track-click', data, {
      ...options,
      jobId: `click-${data.gameId}-${Date.now()}`,
    });

    logger.debug(
      `Added click tracking job for game ${data.gameId} with job ID: ${job.id}`
    );
    return job;
  }

  async addHomepageVisitJob(
    data: HomepageVisitJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<HomepageVisitJobData>> {
    const queue = this.queues.get(JobType.HOMEPAGE_VISIT);
    if (!queue) {
      throw new Error('Homepage visit tracking queue not found');
    }

    const job = await queue.add('track-homepage-visit', data, {
      ...options,
      jobId: `homepage-${data.userId || data.sessionId}-${Date.now()}`,
    });

    logger.debug(
      `Added homepage visit tracking job with job ID: ${job.id}`
    );
    return job;
  }

  async addCacheRefreshJob(
    data: CacheRefreshJobData,
    options?: {
      delay?: number;
      priority?: number;
    }
  ): Promise<Job<CacheRefreshJobData>> {
    const queue = this.queues.get(JobType.CACHE_REFRESH);
    if (!queue) {
      throw new Error('Cache refresh queue not found');
    }

    const job = await queue.add('refresh-cache', data, {
      ...options,
      jobId: `cache-refresh-${data.cacheKey}-${Date.now()}`,
    });

    logger.info(
      `Added cache refresh job for ${data.cacheKey} with job ID: ${job.id}`
    );
    return job;
  }

  createWorker<T = any>(
    queueName: string,
    processor: (job: Job<T>) => Promise<any>
  ): Worker<T> {
    // Use the same Redis config as queues
    const redisConfig = {
      host: redisService.getClient().options.host,
      port: redisService.getClient().options.port,
      password: redisService.getClient().options.password,
      db: redisService.getClient().options.db,
      maxRetriesPerRequest: null,
      retryDelayOnFailover: 100,
    };

    const worker = new Worker(queueName, processor, {
      connection: redisConfig,
      concurrency: WORKER_CONCURRENCY, // Reduced to match DB pool size
    });

    // Track active jobs for monitoring
    let activeJobs = 0;
    let totalProcessed = 0;
    let totalFailed = 0;

    // Set up event handlers
    worker.on('active', (job: any) => {
      activeJobs++;
      totalProcessed++;

        if (
        totalProcessed % 100 === 0 ||
        (totalProcessed <= 100 && totalProcessed % 10 === 0)
      ) {
        logger.info(
          `[WORKER:${queueName}] Active jobs: ${activeJobs}/${WORKER_CONCURRENCY} | Total processed: ${totalProcessed} | Failed: ${totalFailed}`
        );
      }
    });

    worker.on('completed', (job: any) => {
      activeJobs--;
      const duration = job.finishedOn ? job.finishedOn - job.processedOn : 0;

      // Log slow jobs (>1s) or periodically (every 500 jobs)
      if (duration > 1000 || totalProcessed % 500 === 0) {
        logger.info(
          `[PERF:${queueName}] Job ${job.id} completed in ${duration}ms | Active: ${activeJobs}/${WORKER_CONCURRENCY}`
        );
      }
    });

    worker.on('failed', (job: any, error: any) => {
      activeJobs--;
      totalFailed++;
      const duration = job.finishedOn ? job.finishedOn - job.processedOn : 0;
      logger.error(
        `[PERF:${queueName}] Job ${job?.id} failed after ${duration}ms | Active: ${activeJobs}/${WORKER_CONCURRENCY} | Total failed: ${totalFailed}`,
        error
      );
    });

    worker.on('progress', (job: any, progress: any) => {
      logger.info(`Job ${job.id} progress: ${progress}%`);
    });

    worker.on('stalled', (jobId: any) => {
      logger.warn(`[WORKER:${queueName}] Job ${jobId} stalled`);
    });

    worker.on('error', (error: any) => {
      logger.error(`[WORKER:${queueName}] Worker error:`, error);
    });

    // Log queue statistics every 30 seconds
    const statsInterval = setInterval(async () => {
      try {
        const queue = this.queues.get(queueName);
        if (queue) {
          const waiting = await queue.getWaitingCount();
          const active = await queue.getActiveCount();
          const completed = await queue.getCompletedCount();
          const failed = await queue.getFailedCount();

          logger.info(
            `[QUEUE:${queueName}] Waiting: ${waiting} | Active: ${active} | Completed: ${completed} | Failed: ${failed} | Worker concurrency: ${activeJobs}/${WORKER_CONCURRENCY}`
          );
        }
      } catch (error) {
        logger.debug(`Failed to get queue stats for ${queueName}:`, error);
      }
    }, 30000);

    // Cleanup interval on worker close
    worker.on('closing', () => {
      clearInterval(statsInterval);
      logger.info(
        `[WORKER:${queueName}] Closing worker | Final stats - Processed: ${totalProcessed} | Failed: ${totalFailed}`
      );
    });

    this.workers.set(queueName, worker);
    logger.info(
      `[WORKER:${queueName}] Created with concurrency: 50 | Ready to process jobs`
    );

    return worker;
  }

  async getJobStatus(
    jobId: string,
    queueName: string
  ): Promise<{
    status: string;
    progress?: number;
    error?: string;
    result?: any;
  } | null> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return null;
    }

    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        return null;
      }

      const isCompleted = await job.isCompleted();
      const isFailed = await job.isFailed();
      const isActive = await job.isActive();
      const isWaiting = await job.isWaiting();

      let status = 'unknown';
      if (isCompleted) status = 'completed';
      else if (isFailed) status = 'failed';
      else if (isActive) status = 'processing';
      else if (isWaiting) status = 'pending';

      return {
        status,
        progress: job.progress as number,
        error: job.failedReason,
        result: job.returnvalue,
      };
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      return null;
    }
  }

  async closeAllQueues(): Promise<void> {
    logger.info('Closing all queues and workers...');

    const closePromises: Promise<void>[] = [];

    // Close all workers
    for (const worker of this.workers.values()) {
      closePromises.push(worker.close());
    }

    // Close all queues
    for (const queue of this.queues.values()) {
      closePromises.push(queue.close());
    }

    await Promise.all(closePromises);
    logger.info('All queues and workers closed');
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  getWorker(name: string): Worker | undefined {
    return this.workers.get(name);
  }
}

export const queueService = new QueueService();
