/**
 * Debug Controller — config dump + upload pipeline introspection.
 * Routes are admin-gated in routes/index.ts for the upload endpoints;
 * `/debug/config` remains open per existing deployment assumption.
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Game } from '../entities/Games';
import { File } from '../entities/Files';
import config from '../config/config';
import { queueService, JobType } from '../services/queue.service';
import { redisService } from '../services/redis.service';
import { storageService } from '../services/storage.service';
import { getZipMode } from '../utils/uploadEvents';
import logger from '../utils/logger';

/**
 * Mask sensitive values - show only last 4 characters
 */
function maskValue(value: string | undefined): string {
  if (!value || value === '') {
    return '[NOT SET]';
  }
  if (value.length <= 4) {
    return '***';
  }
  return '...' + value.slice(-4);
}

/**
 * Debug endpoint to check config values
 */
export const debugConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,

      // ZIP Processing Config
      zipProcessing: {
        exists: !!config.zipProcessing,
        mode: config.zipProcessing?.mode || '[UNDEFINED]',
        envVar: process.env.ZIP_PROCESSING_MODE || '[NOT SET IN ENV]',
      },

      // Cloudflare Config
      cloudflare: {
        webhookSecretExists: !!config.cloudflare?.webhookSecret,
        webhookSecretMasked: maskValue(config.cloudflare?.webhookSecret),
        webhookSecretEnv: maskValue(process.env.CLOUDFLARE_WEBHOOK_SECRET),
        apiTokenExists: !!config.cloudflare?.apiToken,
        apiTokenMasked: maskValue(config.cloudflare?.apiToken),
        cdnZoneIdMasked: maskValue(config.cloudflare?.cdnZoneId),
      },

      // Storage Config
      storage: {
        provider: config.storageProvider,
        providerEnv: process.env.STORAGE_PROVIDER || '[NOT SET]',
      },

      // Redis Config
      redis: {
        host: config.redis?.host,
        port: config.redis?.port,
        passwordExists: !!config.redis?.password,
      },

      // R2 Config (masked)
      r2: {
        accountIdMasked: maskValue(config.r2?.accountId),
        bucketExists: !!config.r2?.bucket,
        publicUrlMasked: maskValue(config.r2?.publicUrl),
      },

      // Config object structure check
      configStructure: {
        hasZipProcessing: 'zipProcessing' in config,
        hasCloudflare: 'cloudflare' in config,
        configKeys: Object.keys(config),
      },
    };

    res.status(200).json({
      success: true,
      debug: debugInfo,
      warning: 'This endpoint should be disabled in production!',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Aggregated view of a single upload attempt. Joins the Game row, its linked
 * File rows, and the live BullMQ job (if any) so operators don't have to
 * cross-reference three systems when debugging a stuck upload.
 */
export const debugUpload = async (req: Request, res: Response): Promise<void> => {
  const { gameId } = req.params;
  try {
    const game = await AppDataSource.getRepository(Game).findOne({
      where: { id: gameId },
      relations: ['thumbnailFile', 'gameFile'],
    });

    if (!game) {
      res.status(404).json({ success: false, error: { message: 'Game not found' } });
      return;
    }

    const summariseFile = (f: File | null | undefined) =>
      f
        ? {
            id: f.id,
            s3Key: f.s3Key,
            type: f.type,
            isProcessed: f.isProcessed,
            variants: f.variants,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          }
        : null;

    // Pull live BullMQ state (local-mode only; cloudflare mode has no job row)
    let job: Record<string, unknown> | null = null;
    if (game.jobId) {
      try {
        const queue = queueService.getQueue(JobType.GAME_ZIP_PROCESSING);
        const bullJob = queue ? await queue.getJob(game.jobId) : undefined;
        if (bullJob) {
          const state = await bullJob.getState();
          job = {
            id: bullJob.id,
            name: bullJob.name,
            state,
            attemptsMade: bullJob.attemptsMade,
            maxAttempts: bullJob.opts?.attempts,
            failedReason: bullJob.failedReason,
            stacktrace: bullJob.stacktrace?.[0],
            timestamp: bullJob.timestamp,
            processedOn: bullJob.processedOn,
            finishedOn: bullJob.finishedOn,
            data: bullJob.data,
            returnvalue: bullJob.returnvalue,
          };
        } else {
          job = { id: game.jobId, state: 'not_found_in_queue' };
        }
      } catch (jobErr) {
        job = {
          id: game.jobId,
          state: 'lookup_failed',
          error: jobErr instanceof Error ? jobErr.message : String(jobErr),
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        gameId,
        mode: getZipMode(),
        game: {
          id: game.id,
          title: game.title,
          slug: game.slug,
          status: game.status,
          processingStatus: game.processingStatus,
          processingError: game.processingError,
          jobId: game.jobId,
          thumbnailFileId: game.thumbnailFileId,
          gameFileId: game.gameFileId,
          categoryId: game.categoryId,
          createdAt: game.createdAt,
          publishedAt: game.publishedAt,
          metadata: game.metadata,
          createdById: game.createdById,
        },
        files: {
          thumbnail: summariseFile(game.thumbnailFile as File | null | undefined),
          gameFile: summariseFile(game.gameFile as File | null | undefined),
        },
        job,
      },
    });
  } catch (error: any) {
    logger.error('debug.upload.failed', {
      event: 'debug.upload.failed',
      gameId,
      errorMessage: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'Unknown error' },
    });
  }
};

/**
 * Health probe for the upload pipeline — one curl tells you which component
 * is down (storage creds, redis, queue workers) before you dive into logs.
 */
export const debugUploadHealth = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const out: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    mode: getZipMode(),
    storageProvider: config.storageProvider,
  };
  let allOk = true;

  // Storage: cheap probe — presign a dummy key. Validates SDK + credentials
  // load without putting data in the bucket.
  try {
    const started = Date.now();
    await storageService.generatePresignedUrl('__upload_health__.txt', 'text/plain');
    out.storage = { status: 'ok', durationMs: Date.now() - started };
  } catch (err) {
    allOk = false;
    out.storage = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Redis ping
  try {
    const started = Date.now();
    await redisService.ping();
    out.redis = { status: 'ok', durationMs: Date.now() - started };
  } catch (err) {
    allOk = false;
    out.redis = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Queue depths for the two upload-relevant queues
  try {
    const queueNames = [JobType.GAME_ZIP_PROCESSING, JobType.IMAGE_PROCESSING];
    const queues: Record<string, unknown> = {};
    for (const name of queueNames) {
      const q = queueService.getQueue(name);
      if (!q) {
        queues[name] = { status: 'missing' };
        allOk = false;
        continue;
      }
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getCompletedCount(),
        q.getFailedCount(),
        q.getDelayedCount(),
      ]);
      queues[name] = { waiting, active, completed, failed, delayed };
    }
    out.queues = queues;
  } catch (err) {
    allOk = false;
    out.queues = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  res.status(allOk ? 200 : 503).json({ success: allOk, data: out });
};
