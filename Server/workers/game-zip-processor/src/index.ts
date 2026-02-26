/**
 * ============================================================================
 * Chareli Game ZIP Processor - Cloudflare Worker
 * ============================================================================
 *
 * This worker matches the exact logic of Server/src/services/zip.service.ts
 * and Server/src/workers/gameZipProcessor.ts
 *
 * KEY BEHAVIORS (matching current system):
 * - Recursively searches for index.html (case-insensitive)
 * - Uploads all files from ZIP to R2
 * - Preserves directory structure
 * - Sends webhook to backend when complete
 *
 * FLOW:
 * 1. User uploads ZIP → R2 storage (uploads/{gameId}/game.zip)
 * 2. R2 event notification → Triggers this worker via queue
 * 3. Worker downloads and extracts ZIP
 * 4. Worker searches for index.html recursively
 * 5. Worker uploads all files to R2 (games/{gameId}/)
 * 6. Worker sends webhook to backend
 * 7. Backend updates database and emits WebSocket
 */

import { unzipSync } from 'fflate';

export interface Env {
  GAMES_BUCKET: R2Bucket;
  GAME_STATUS: KVNamespace;
  BACKEND_WEBHOOK_URL: string;
  WEBHOOK_SECRET?: string;
}

interface R2EventMessage {
  account: string;
  bucket: string;
  object: {
    key: string;
    size: number;
    eTag: string;
  };
  action: string;
  eventTime: string;
}

interface GameStatus {
  status: 'extracting' | 'uploading' | 'ready' | 'failed';
  progress: number;
  currentFile?: string;
  filesUploaded?: number;
  totalFiles?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Queue consumer - Triggered when new ZIP uploaded to R2
 */
export default {
  async queue(batch: MessageBatch<R2EventMessage>, env: Env): Promise<void> {
    console.log(`📦 Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      const event = message.body;
      const key = event.object.key; // e.g., "temp-games/abc-123-timestamp/game.zip"

      console.log(`🔄 Processing: ${key}`);

    // Extract gameId from path
    // Format: "temp-games/{gameId}-{timestamp}/game.zip"
    // where gameId is a UUID like "7ad4c4c1-cb38-4ad5-b3f4-d8b9065733db"
    const pathParts = key.split('/');
    if (pathParts.length < 2) {
      console.error(`❌ Invalid key format: ${key}`);
      message.ack();
      continue;
    }

    // The folder name is "{gameId}-{timestamp}"
    // We need to extract the UUID (everything except the last timestamp segment)
    const folderName = pathParts[1]; // e.g., "7ad4c4c1-cb38-4ad5-b3f4-d8b9065733db-1770978040452"
    const parts = folderName.split('-');

    // UUID has 5 segments (8-4-4-4-12 format), timestamp is the 6th segment
    // Rejoin the first 5 segments to get the complete UUID
    const gameId = parts.slice(0, 5).join('-');

      try {
        await processGameZip(gameId, key, env);
        message.ack();
        console.log(`✅ Successfully processed: ${gameId}`);
      } catch (error) {
        console.error(`❌ Failed to process ${gameId}:`, error);

        // Update status to failed in KV
        await env.GAME_STATUS.put(
          `game:${gameId}`,
          JSON.stringify({
            status: 'failed',
            progress: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            failedAt: new Date().toISOString(),
          } as GameStatus)
        );

        // Retry logic - matches your current BullMQ retry behavior
        const attempts = message.attempts || 0;
        if (attempts >= 2) {
          // After 3 attempts (0, 1, 2), give up and move to DLQ
          console.log(`⚠️ Max retries reached for ${gameId}, moving to DLQ`);
          message.ack(); // Will move to dead-letter queue
        } else {
          // Retry with exponential backoff (matches BullMQ behavior)
          const delaySeconds = Math.pow(2, attempts + 1) * 30; // 30s, 60s, 120s
          console.log(`🔄 Retry attempt ${attempts + 1}/3 for ${gameId} in ${delaySeconds}s`);
          message.retry({ delaySeconds });
        }
      }
    }
  },
};

/**
 * Main ZIP processing function
 * Matches logic from Server/src/workers/gameZipProcessor.ts
 */
async function processGameZip(gameId: string, zipKey: string, env: Env): Promise<void> {
  console.log(`[${gameId}] 🚀 Starting ZIP processing...`);

  // STEP 1: Update status - Starting (matches WebSocket progress updates)
  await updateStatus(env, gameId, {
    status: 'extracting',
    progress: 10,
    currentFile: 'Downloading ZIP...',
    startedAt: new Date().toISOString(),
  });

  // STEP 2: Download ZIP from R2 (matches storageService.downloadFile)
  console.log(`[${gameId}] ⬇️ Downloading ZIP from R2...`);
  const zipObject = await env.GAMES_BUCKET.get(zipKey);
  if (!zipObject) {
    throw new Error(`ZIP file not found: ${zipKey}`);
  }

  const zipSize = zipObject.size;
  console.log(`[${gameId}] 📦 ZIP size: ${(zipSize / 1024 / 1024).toFixed(2)} MB`);

  await updateStatus(env, gameId, {
    status: 'extracting',
    progress: 30,
    currentFile: 'Extracting files...',
  });

  // STEP 3: Extract ZIP (matches zipService.processGameZip)
  console.log(`[${gameId}] 📂 Extracting ZIP...`);
  const zipBuffer = await zipObject.arrayBuffer();
  const zipData = new Uint8Array(zipBuffer);

  // unzipSync runs inline — unzip() uses new Worker() internally which
  // is not available in the Cloudflare Workers runtime.
  const files = unzipSync(zipData);

  const fileEntries = Object.entries(files);
  console.log(`[${gameId}] ✅ Extracted ${fileEntries.length} files`);

  // STEP 4: Find index.html recursively (matches zipService.findIndexHtml)
  // Case-insensitive search, just like current system
  const indexPath = findIndexHtml(fileEntries);
  if (!indexPath) {
    throw new Error('No index.html file found in the ZIP file');
  }

  console.log(`[${gameId}] 📍 Found index.html at: ${indexPath}`);

  await updateStatus(env, gameId, {
    status: 'uploading',
    progress: 50,
    currentFile: 'Uploading files to R2...',
    totalFiles: fileEntries.length,
    filesUploaded: 0,
  });

  // STEP 5: Upload each file to R2 (matches storageService.uploadDirectory)
  // Use a unique folder ID using Cloudflare Workers' native crypto.randomUUID()
  const gameFolderId = crypto.randomUUID();
  const gamePath = `games/${gameFolderId}`;

  console.log(`[${gameId}] ⬆️ Uploading files to permanent storage at: ${gamePath}`);

  const fileList: { path: string; size: number; contentType: string }[] = [];
  let uploaded = 0;

  for (const [filePath, fileData] of fileEntries) {
    // Skip directories (they have no data) - matches current system
    if (fileData.length === 0 && filePath.endsWith('/')) {
      continue;
    }

    // Skip hidden files and system files (macOS cruft)
    const fileName = filePath.split('/').pop() || '';
    if (fileName.startsWith('.') || fileName.startsWith('__MACOSX')) {
      continue;
    }

    // Upload with full path structure (preserves directories)
    const destKey = `${gamePath}/${filePath}`;
    const contentType = getContentType(filePath);

    await env.GAMES_BUCKET.put(destKey, fileData, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
    });

    fileList.push({
      path: filePath,
      size: fileData.length,
      contentType,
    });

    // Update progress (matches current WebSocket progress updates every 5 files)
    uploaded++;
    const progress = 50 + Math.round((uploaded / fileEntries.length) * 40);

    if (uploaded % 5 === 0 || uploaded === fileEntries.length) {
      console.log(`[${gameId}] 📤 Uploaded ${uploaded}/${fileEntries.length} files`);
      await updateStatus(env, gameId, {
        status: 'uploading',
        progress,
        currentFile: filePath,
        filesUploaded: uploaded,
        totalFiles: fileEntries.length,
      });
    }
  }

  // STEP 6: Mark as ready in KV
  const result = {
    status: 'ready' as const,
    progress: 90,
    entryPoint: indexPath,
    files: fileList,
    totalFiles: fileList.length,
    totalSize: fileList.reduce((sum, f) => sum + f.size, 0),
    gamePath, // Store the path for reference
    completedAt: new Date().toISOString(),
  };

  await env.GAME_STATUS.put(`game:${gameId}`, JSON.stringify(result), {
    expirationTtl: 86400 * 7, // Keep for 7 days
  });

  console.log(`[${gameId}] ✅ Processing complete, sending webhook...`);

  // STEP 7: Notify backend via webhook
  await notifyBackend(env, gameId, result);

  // STEP 8: Delete source ZIP (cleanup - matches current system)
  console.log(`[${gameId}] 🗑️ Cleaning up source ZIP...`);
  try {
    await env.GAMES_BUCKET.delete(zipKey);
  } catch (error) {
    console.warn(`[${gameId}] ⚠️ Failed to delete source ZIP:`, error);
    // Don't fail the job for cleanup errors
  }

  console.log(`[${gameId}] 🎉 All done!`);
}

/**
 * Find index.html recursively (case-insensitive)
 * Matches: Server/src/services/zip.service.ts -> findIndexHtml()
 */
function findIndexHtml(fileEntries: [string, Uint8Array][]): string | null {
  // Search for index.html (case-insensitive)
  for (const [filePath, _] of fileEntries) {
    const fileName = filePath.split('/').pop()?.toLowerCase();
    if (fileName === 'index.html') {
      return filePath;
    }
  }
  return null;
}

/**
 * Update status in KV
 */
async function updateStatus(env: Env, gameId: string, status: Partial<GameStatus>): Promise<void> {
  await env.GAME_STATUS.put(`game:${gameId}`, JSON.stringify(status));
}

/**
 * Notify backend via webhook with retry logic
 * Matches current system's webhook behavior
 */
async function notifyBackend(env: Env, gameId: string, result: any): Promise<void> {
  const maxRetries = 3;
  const idempotencyKey = `${gameId}-${result.completedAt}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${gameId}] 📡 Sending webhook (attempt ${attempt}/${maxRetries})...`);

      const response = await fetch(env.BACKEND_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': env.WEBHOOK_SECRET || '',
          'X-Idempotency-Key': idempotencyKey,
          'X-Attempt': attempt.toString(),
        },
        body: JSON.stringify({
          gameId,
          status: 'completed',
          entryPoint: result.entryPoint,
          s3Key: `${result.gamePath}/${result.entryPoint}`, // Full S3 key for File record
          fileCount: result.totalFiles,
          totalSize: result.totalSize,
          processedAt: result.completedAt,
        }),
      });

      if (response.ok) {
        console.log(`[${gameId}] ✅ Webhook delivered successfully`);
        return;
      }

      console.warn(`[${gameId}] ⚠️ Webhook attempt ${attempt} failed: ${response.status}`);

      // Non-retryable error (4xx - client error)
      if (response.status >= 400 && response.status < 500) {
        console.error(`[${gameId}] ❌ Webhook rejected by server (${response.status})`);
        break;
      }

      // Wait before retry (exponential backoff: 2s, 4s, 8s)
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`[${gameId}] ⏳ Waiting ${delayMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      console.error(`[${gameId}] ❌ Webhook attempt ${attempt} error:`, error);

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(`[${gameId}] ❌ All webhook attempts failed`);
  // Note: Game files are still uploaded and accessible
  // Backend reconciliation cron should catch this
}

/**
 * Get content type based on file extension
 */
function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    // HTML/Text
    html: 'text/html',
    htm: 'text/html',
    txt: 'text/plain',
    xml: 'application/xml',

    // JavaScript/JSON
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',

    // CSS
    css: 'text/css',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    bmp: 'image/bmp',

    // Fonts
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',

    // Audio
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',

    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',

    // Other
    wasm: 'application/wasm',
    pdf: 'application/pdf',
    zip: 'application/zip',
    map: 'application/json',
  };

  return types[ext || ''] || 'application/octet-stream';
}
