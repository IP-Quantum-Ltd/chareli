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
import logger from '../utils/logger';

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
  try {
    // DEBUG: Log incoming request
    logger.info('[WEBHOOK] Incoming request', {
      headers: Object.keys(req.headers),
      hasBody: !!req.body,
      method: req.method,
      path: req.path,
    });

    // STEP 1: Validate webhook secret
    const providedSecret = req.headers['x-webhook-secret'] as string;
    const expectedSecret = process.env.CLOUDFLARE_WEBHOOK_SECRET;

    logger.info('[WEBHOOK] Secret validation', {
      hasProvidedSecret: !!providedSecret,
      hasExpectedSecret: !!expectedSecret,
      providedLength: providedSecret?.length,
      expectedLength: expectedSecret?.length,
    });

    if (!expectedSecret) {
      logger.error('[WEBHOOK] CLOUDFLARE_WEBHOOK_SECRET not configured');
      res.status(500).json({ error: 'Webhook not configured' });
      return;
    }

    if (providedSecret !== expectedSecret) {
      logger.warn('[WEBHOOK] Invalid webhook secret provided', {
        providedLength: providedSecret?.length,
        expectedLength: expectedSecret.length,
      });
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }

    // STEP 2: Check idempotency key (prevent duplicate processing using Redis)
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      logger.warn('[WEBHOOK] Missing idempotency key');
      res.status(400).json({ error: 'Missing idempotency key' });
      return;
    }

    // Parse gameId early for idempotency logging
    const payload: WebhookPayload = req.body;
    const { gameId } = payload;

    if (!gameId) {
      logger.warn('[WEBHOOK] Missing gameId in payload');
      res.status(400).json({ error: 'Missing gameId' });
      return;
    }

    // Atomic idempotency check using Redis SET NX
    // This works across multiple server instances (distributed system safe)
    const redisKey = `webhook:idempotency:${idempotencyKey}`;
    const isNew = await redisService.setIfNotExists(
      redisKey,
      { gameId, timestamp: new Date().toISOString() },
      IDEMPOTENCY_TTL
    );

    if (!isNew) {
      // Webhook already processed
      const cached = await redisService.getIdempotencyKey<{ gameId: string; timestamp: string }>(redisKey);
      logger.info('[WEBHOOK] Duplicate webhook detected (idempotency)', {
        idempotencyKey,
        gameId,
        originalTimestamp: cached?.timestamp,
      });
      res.status(200).json({ 
        message: 'Already processed',
        gameId,
      });
      return;
    }

    // STEP 3: Parse remaining payload fields
    const { status, entryPoint, s3Key, fileCount, totalSize, processedAt, error, progress, currentFile, filesUploaded } = payload;

    logger.info('[WEBHOOK] Processing webhook', {
      gameId,
      status,
      entryPoint,
      fileCount,
      totalSize,
      progress,
      filesUploaded,
      idempotencyKey,
    });

    // STEP 4: Find game in database
    let game = await gameRepository.findOne({ where: { id: gameId } });
    
    // FALLBACK: If game not found by ID, search PENDING or PROCESSING games by temp path in metadata
    // This handles cases where worker uses folder UUID instead of real game ID
    if (!game) {
      logger.warn('[WEBHOOK] Game not found by ID, searching by metadata', { gameId });
      
      // Search pending OR processing games for one with matching temp path
      const games = await gameRepository.find({
        where: [
          { processingStatus: GameProcessingStatus.PENDING },
          { processingStatus: GameProcessingStatus.PROCESSING }
        ]
      });
      
      // Find game with matching temp path in metadata
      // The gameId from worker is actually the folder UUID (e.g., 66201f4c-b1e8-4176-9519-8c26e031c1bf)
      for (const g of games) {
        if (g.metadata && (g.metadata as any)._tempGameFileKey) {
          const tempKey = (g.metadata as any)._tempGameFileKey;
          // Check if temp path contains the folder UUID
          if (tempKey.includes(gameId)) {
            game = g;
            logger.info('[WEBHOOK] Found game by metadata search', {
              actualGameId: game.id,
              folderUUID: gameId,
              tempPath: tempKey
            });
            break;
          }
        }
      }
    }
    
    if (!game) {
      logger.error('[WEBHOOK] Game not found', { gameId, s3Key });
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    // STEP 5: Handle completion, failure, or progress
    if (status === 'completed') {
      await handleSuccessfulProcessing(game, { entryPoint, s3Key, fileCount, totalSize, processedAt });
    } else if (status === 'failed') {
      await handleFailedProcessing(game, error || 'Unknown error');
    } else if (status === 'progress') {
      // Handle progress updates - emit WebSocket event only
      await handleProgressUpdate(game, { progress, currentFile, filesUploaded, fileCount });
    } else {
      logger.warn('[WEBHOOK] Unknown status', { status, gameId });
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    // STEP 6: Webhook processed successfully
    // Note: Idempotency already handled in STEP 2 via Redis SET NX
    logger.info('[WEBHOOK] Webhook processed successfully', { gameId, status });
    res.status(200).json({ 
      message: 'Webhook processed',
      gameId,
      status,
    });

  } catch (error: any) {
    console.error('============ [WEBHOOK ERROR] ============');
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Request Body:', JSON.stringify(req.body, null, 2));
    console.error('=========================================');
    
    logger.error('[WEBHOOK] Error processing webhook', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      headers: {
        secret: !!req.headers['x-webhook-secret'],
        idempotency: req.headers['x-idempotency-key'],
      },
    });
    res.status(500).json({ error: 'Internal server error', details: error.message });
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
  }
): Promise<void> {
  const gameId = game.id;

  try {
    // STEP 1: Create file record for the game
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
    logger.info('[WEBHOOK] Game file record created', {
      gameId,
      fileId: gameFileRecord.id,
      s3Key: data.s3Key,
    });

    // STEP 2: Update game - mark as completed and activate
    // This matches the behavior in gameZipProcessor.ts
    await gameRepository.update(gameId, {
      gameFileId: gameFileRecord.id,
      processingStatus: GameProcessingStatus.COMPLETED,
      processingError: undefined,
      status: GameStatus.ACTIVE, // Activate the game
      jobId: undefined, // Clear job ID (no longer relevant)
    });

    logger.info('[WEBHOOK] Game activated', {
      gameId,
      fileCount: data.fileCount,
      totalSize: data.totalSize,
    });

    // STEP 3: Emit WebSocket event - game is now completed and active
    websocketService.emitGameStatusUpdate(gameId, {
      processingStatus: GameProcessingStatus.COMPLETED,
      status: GameStatus.ACTIVE,
    });

    websocketService.emitGameProcessingProgress(gameId, 100);

    // STEP 4: Trigger CDN JSON regeneration and Cloudflare cache purge
    // This ensures the newly activated game appears in games_active.json
    try {
      const { cacheInvalidationService } = await import('../services/cache-invalidation.service');
      await cacheInvalidationService.invalidateGameCreation(gameId);
      logger.info('[WEBHOOK] CDN cache invalidated for newly activated game', { gameId });
    } catch (cdnError) {
      logger.warn('[WEBHOOK] Failed to invalidate CDN cache', {
        gameId,
        error: cdnError,
      });
      // Don't fail the webhook for CDN errors
    }

    logger.info('[WEBHOOK] Successfully completed game processing', { gameId });

  } catch (error: any) {
    logger.error('[WEBHOOK] Error handling successful processing', {
      gameId,
      error: error.message,
      stack: error.stack,
    });
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
  }
): Promise<void> {
  const gameId = game.id;

  try {
    logger.info('[WEBHOOK] Progress update received', {
      gameId,
      progress: data.progress,
      filesUploaded: data.filesUploaded,
      fileCount: data.fileCount,
    });

    // Emit WebSocket event for progress
    if (data.progress !== undefined) {
      websocketService.emitGameProcessingProgress(gameId, data.progress);
    }

    // Optionally update game status to "processing" if still "pending"
    if (game.processingStatus === GameProcessingStatus.PENDING) {
      await gameRepository.update(gameId, {
        processingStatus: GameProcessingStatus.PROCESSING,
      });

      // Emit status change
      websocketService.emitGameStatusUpdate(gameId, {
        processingStatus: GameProcessingStatus.PROCESSING,
      });
    }

  } catch (error: any) {
    logger.error('[WEBHOOK] Error handling progress update', {
      gameId,
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - progress updates are non-critical
  }
}

/**
 * Handle failed game processing
 */
async function handleFailedProcessing(game: Game, errorMessage: string): Promise<void> {
  const gameId = game.id;

  try {
    // Update game status to failed
    await gameRepository.update(gameId, {
      processingStatus: GameProcessingStatus.FAILED,
      processingError: errorMessage,
      jobId: undefined, // Clear job ID
    });

    logger.error('[WEBHOOK] Game processing failed', {
      gameId,
      error: errorMessage,
    });

    // Emit WebSocket event for failed status
    websocketService.emitGameStatusUpdate(gameId, {
      processingStatus: GameProcessingStatus.FAILED,
      processingError: errorMessage,
    });

  } catch (error: any) {
    logger.error('[WEBHOOK] Error handling failed processing', {
      gameId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Health check endpoint for Cloudflare Worker
 */
export async function handleWebhookHealth(req: Request, res: Response): Promise<void> {
  res.status(200).json({ 
    status: 'ok',
    service: 'webhook-receiver',
    timestamp: new Date().toISOString(),
  });
}
