/**
 * ============================================================================
 * Webhook Controller
 * ============================================================================
 * 
 * Handles webhooks from Cloudflare Worker when game processing completes.
 * This replaces the BullMQ job completion handler.
 * 
 * SECURITY:
 * - Validates webhook secret
 * - Idempotency protection (prevents duplicate processing)
 * - Rate limiting via middleware
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Game, GameProcessingStatus, GameStatus } from '../entities/Games';
import { File } from '../entities/Files';
import { websocketService } from '../services/websocket.service';
import { redisService } from '../services/redis.service';
import { logUploadEvent, toErrorFields } from '../utils/uploadEvents';

const gameRepository = AppDataSource.getRepository(Game);
const fileRepository = AppDataSource.getRepository(File);

// Idempotency TTL in seconds (1 hour)
const IDEMPOTENCY_TTL = 3600;

interface WebhookPayload {
  gameId: string;
  status: 'completed' | 'failed' | 'progress';
  entryPoint?: string;
  s3Key?: string;
  fileCount?: number;
  totalSize?: number;
  processedAt: string;
  error?: string;
  progress?: number;
  currentFile?: string;
  filesUploaded?: number;
}

/**
 * Handle game processing webhook from Cloudflare Worker
 */
export async function handleGameProcessed(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  // Correlation back to the original CreateGame request if the CF Worker
  // echoes it; otherwise fall back to gameId once we parse the body.
  const uploadRef = (req.headers['x-upload-ref'] as string) || undefined;
  const providedSecret = req.headers['x-webhook-secret'] as string;
  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  const payload: WebhookPayload = req.body || ({} as WebhookPayload);

  logUploadEvent('cfworker.webhook.received', {
    uploadRef,
    gameId: payload.gameId,
    status: payload.status,
    entryPoint: payload.entryPoint,
    fileCount: payload.fileCount,
    totalSize: payload.totalSize,
    hasSecret: !!providedSecret,
    hasIdempotencyKey: !!idempotencyKey,
    ip: req.ip,
    headerNames: Object.keys(req.headers),
  });

  try {
    const expectedSecret = process.env.CLOUDFLARE_WEBHOOK_SECRET;

    if (!expectedSecret) {
      logUploadEvent(
        'cfworker.webhook.rejected',
        { reason: 'secret_not_configured', gameId: payload.gameId, uploadRef },
        'error'
      );
      res.status(500).json({ error: 'Webhook not configured' });
      return;
    }

    if (providedSecret !== expectedSecret) {
      logUploadEvent(
        'cfworker.webhook.rejected',
        {
          reason: 'bad_secret',
          gameId: payload.gameId,
          uploadRef,
          providedLength: providedSecret?.length,
          expectedLength: expectedSecret.length,
        },
        'warn'
      );
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }

    if (!idempotencyKey) {
      logUploadEvent(
        'cfworker.webhook.rejected',
        { reason: 'missing_idempotency_key', gameId: payload.gameId, uploadRef },
        'warn'
      );
      res.status(400).json({ error: 'Missing idempotency key' });
      return;
    }

    const { gameId } = payload;
    if (!gameId) {
      logUploadEvent(
        'cfworker.webhook.rejected',
        { reason: 'missing_game_id', uploadRef },
        'warn'
      );
      res.status(400).json({ error: 'Missing gameId' });
      return;
    }

    // Atomic idempotency check (distributed-safe across server instances)
    const redisKey = `webhook:idempotency:${idempotencyKey}`;
    const isNew = await redisService.setIfNotExists(
      redisKey,
      { gameId, timestamp: new Date().toISOString() },
      IDEMPOTENCY_TTL
    );

    if (!isNew) {
      const cached = await redisService.getIdempotencyKey<{ gameId: string; timestamp: string }>(redisKey);
      logUploadEvent('cfworker.webhook.duplicate', {
        gameId,
        uploadRef,
        idempotencyKey,
        originalTimestamp: cached?.timestamp,
      });
      res.status(200).json({ message: 'Already processed', gameId });
      return;
    }

    const { status, entryPoint, s3Key, fileCount, totalSize, processedAt, error, progress, currentFile, filesUploaded } = payload;
    const refOrGameId = uploadRef || gameId;

    logUploadEvent('cfworker.webhook.validated', {
      gameId,
      uploadRef: refOrGameId,
      status,
      entryPoint,
      fileCount,
      totalSize,
      progress,
      filesUploaded,
    });

    // Find game — fall back to metadata search when worker uses folder UUID
    let game = await gameRepository.findOne({ where: { id: gameId } });
    if (!game) {
      logUploadEvent('cfworker.webhook.fallback_search', {
        gameId,
        uploadRef: refOrGameId,
        step: 'metadata_lookup',
      });

      const games = await gameRepository.find({
        where: [
          { processingStatus: GameProcessingStatus.PENDING },
          { processingStatus: GameProcessingStatus.PROCESSING },
        ],
      });

      for (const g of games) {
        const tempKey = (g.metadata as any)?._tempGameFileKey;
        if (tempKey && typeof tempKey === 'string' && tempKey.includes(gameId)) {
          game = g;
          logUploadEvent('cfworker.webhook.fallback_matched', {
            gameId: g.id,
            uploadRef: refOrGameId,
            folderUUID: gameId,
            tempPath: tempKey,
          });
          break;
        }
      }
    }

    if (!game) {
      logUploadEvent(
        'cfworker.webhook.rejected',
        { reason: 'game_not_found', gameId, uploadRef: refOrGameId, fileKey: s3Key },
        'error'
      );
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (status === 'completed') {
      await handleSuccessfulProcessing(game, { entryPoint, s3Key, fileCount, totalSize, processedAt }, refOrGameId);
    } else if (status === 'failed') {
      await handleFailedProcessing(game, error || 'Unknown error', refOrGameId);
    } else if (status === 'progress') {
      await handleProgressUpdate(game, { progress, currentFile, filesUploaded, fileCount }, refOrGameId);
    } else {
      logUploadEvent(
        'cfworker.webhook.rejected',
        { reason: 'invalid_status', gameId, uploadRef: refOrGameId, status },
        'warn'
      );
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    logUploadEvent('cfworker.webhook.applied', {
      gameId,
      uploadRef: refOrGameId,
      status,
      durationMs: Date.now() - started,
    });
    res.status(200).json({ message: 'Webhook processed', gameId, status });
  } catch (error: unknown) {
    logUploadEvent(
      'cfworker.webhook.failed',
      {
        gameId: payload.gameId,
        uploadRef,
        durationMs: Date.now() - started,
        ...toErrorFields(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'error'
    );
    const details = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details });
  }
}

/**
 * Handle successful game processing
 */
async function handleSuccessfulProcessing(
  game: Game,
  data: {
    entryPoint?: string;
    s3Key?: string;
    fileCount?: number;
    totalSize?: number;
    processedAt: string;
  },
  uploadRef: string
): Promise<void> {
  const gameId = game.id;

  try {
    if (!data.s3Key) {
      throw new Error('Missing s3Key in webhook payload');
    }

    // Decode HTML entities in s3Key (&#x2F; -> /)
    const decodedS3Key = data.s3Key.replace(/&#x2F;/g, '/');

    const gameFileRecord = fileRepository.create({
      s3Key: decodedS3Key,
      type: 'game_file',
    });
    await fileRepository.save(gameFileRecord);

    logUploadEvent('cfworker.webhook.file_record_created', {
      gameId,
      uploadRef,
      fileId: gameFileRecord.id,
      fileKey: decodedS3Key,
    });

    // Mark as completed; auto-publish only if the upload flow opted in.
    // Matches gameZipProcessor.ts.
    const existingGame = await gameRepository.findOne({ where: { id: gameId } });
    const publishOnReady =
      (existingGame?.metadata as any)?._publishOnReady === true;

    const completionUpdate: Partial<Game> = {
      gameFileId: gameFileRecord.id,
      processingStatus: GameProcessingStatus.COMPLETED,
      processingError: undefined,
      jobId: undefined,
    };
    if (publishOnReady) {
      completionUpdate.status = GameStatus.ACTIVE;
      completionUpdate.publishedAt = new Date();
      completionUpdate.lastLikeIncrement = new Date();
    }
    if (existingGame?.metadata && (existingGame.metadata as any)._publishOnReady !== undefined) {
      const cleaned = { ...(existingGame.metadata as any) };
      delete cleaned._publishOnReady;
      completionUpdate.metadata = cleaned;
    }

    await gameRepository.update(gameId, completionUpdate);

    if (publishOnReady) {
      try {
        const { GamePublishHistory, GamePublishAction } = await import(
          '../entities/GamePublishHistory'
        );
        const repo = AppDataSource.getRepository(GamePublishHistory);
        await repo.save(
          repo.create({
            gameId,
            action: GamePublishAction.PUBLISHED,
            actorId: existingGame?.createdById ?? null,
            actorRole: null,
          })
        );
      } catch (historyErr) {
        logUploadEvent(
          'cfworker.webhook.publish_history_failed',
          { gameId, uploadRef, ...toErrorFields(historyErr) },
          'warn'
        );
      }
    }

    websocketService.emitGameStatusUpdate(gameId, {
      processingStatus: GameProcessingStatus.COMPLETED,
      status: publishOnReady ? GameStatus.ACTIVE : GameStatus.DISABLED,
    });
    websocketService.emitGameProcessingProgress(gameId, 100);

    try {
      const { cacheInvalidationService } = await import('../services/cache-invalidation.service');
      await cacheInvalidationService.invalidateGameCreation(gameId);
      logUploadEvent('cfworker.webhook.cdn_invalidated', { gameId, uploadRef });
    } catch (cdnError) {
      logUploadEvent(
        'cfworker.webhook.cdn_invalidation_failed',
        { gameId, uploadRef, ...toErrorFields(cdnError) },
        'warn'
      );
      // Don't fail the webhook for CDN errors
    }
  } catch (error: unknown) {
    logUploadEvent(
      'cfworker.webhook.apply_failed',
      {
        gameId,
        uploadRef,
        step: 'handleSuccessfulProcessing',
        ...toErrorFields(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'error'
    );
    throw error;
  }
}

/**
 * Handle progress updates during game processing
 */
async function handleProgressUpdate(
  game: Game,
  data: {
    progress?: number;
    currentFile?: string;
    filesUploaded?: number;
    fileCount?: number;
  },
  uploadRef: string
): Promise<void> {
  const gameId = game.id;

  try {
    logUploadEvent('cfworker.webhook.progress', {
      gameId,
      uploadRef,
      progress: data.progress,
      filesUploaded: data.filesUploaded,
      fileCount: data.fileCount,
      currentFile: data.currentFile,
    });

    if (data.progress !== undefined) {
      websocketService.emitGameProcessingProgress(gameId, data.progress);
    }

    if (game.processingStatus === GameProcessingStatus.PENDING) {
      await gameRepository.update(gameId, {
        processingStatus: GameProcessingStatus.PROCESSING,
      });
      websocketService.emitGameStatusUpdate(gameId, {
        processingStatus: GameProcessingStatus.PROCESSING,
      });
    }
  } catch (error: unknown) {
    logUploadEvent(
      'cfworker.webhook.progress_failed',
      {
        gameId,
        uploadRef,
        ...toErrorFields(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'error'
    );
    // Don't throw — progress updates are non-critical.
  }
}

/**
 * Handle failed game processing
 */
async function handleFailedProcessing(
  game: Game,
  errorMessage: string,
  uploadRef: string
): Promise<void> {
  const gameId = game.id;

  try {
    await gameRepository.update(gameId, {
      processingStatus: GameProcessingStatus.FAILED,
      processingError: errorMessage,
      jobId: undefined,
    });

    logUploadEvent(
      'cfworker.webhook.game_failed',
      { gameId, uploadRef, errorMessage },
      'error'
    );

    websocketService.emitGameStatusUpdate(gameId, {
      processingStatus: GameProcessingStatus.FAILED,
      processingError: errorMessage,
    });
  } catch (error: unknown) {
    logUploadEvent(
      'cfworker.webhook.apply_failed',
      {
        gameId,
        uploadRef,
        step: 'handleFailedProcessing',
        ...toErrorFields(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'error'
    );
    throw error;
  }
}

/**
 * Health check endpoint for Cloudflare Worker
 */
export async function handleWebhookHealth(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ 
    status: 'ok',
    service: 'webhook-receiver',
    timestamp: new Date().toISOString(),
  });
}
