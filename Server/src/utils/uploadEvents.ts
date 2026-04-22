import logger from './logger';

export interface UploadEventData {
  userId?: string;
  gameId?: string;
  fileId?: string;
  fileKey?: string;
  fileSize?: number;
  mime?: string;
  step?: string;
  durationMs?: number;
  provider?: string;
  bucket?: string;
  mode?: string;
  reason?: string;
  statusCode?: number;
  errorName?: string;
  errorMessage?: string;
  errorCode?: string | number;
  // Freeform fields are allowed — upload paths are varied enough that a strict
  // shape would just force every call site to widen the event object.
  [key: string]: unknown;
}

/**
 * Emit a structured upload-pipeline event. Every log line carries a stable
 * `event:` field so CloudWatch Insights can filter the whole pipeline with
 * one query. `reqId` / `userId` are auto-attached by the logger's ALS hook.
 */
export const logUploadEvent = (
  event: string,
  data: UploadEventData = {},
  level: 'info' | 'warn' | 'error' = 'info'
): void => {
  logger[level](event, { event, ...data });
};

export const toErrorFields = (err: unknown): Partial<UploadEventData> => {
  if (err instanceof Error) {
    const maybeCode = (err as { code?: string | number }).code;
    const maybeStatus = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    return {
      errorName: err.name,
      errorMessage: err.message,
      errorCode: maybeCode,
      statusCode: maybeStatus,
    };
  }
  return { errorMessage: String(err) };
};

/**
 * Which ZIP-processing path the server is configured for. Used as a log field
 * so we can tell "cloudflare mode worker never webhooked back" apart from
 * "local mode worker crashed" in CloudWatch.
 */
export const getZipMode = (): 'cloudflare' | 'local' =>
  process.env.ZIP_PROCESSING_MODE === 'cloudflare' ? 'cloudflare' : 'local';

/**
 * Wrap an async storage call with structured `start` / `complete` / `failed`
 * events. Keeps the call sites in each storage adapter uniform without forcing
 * the caller to duplicate try/catch around every operation.
 *
 * Usage:
 *   return instrumentStorage('storage.upload', { provider: 'r2', fileKey: key, bucket }, () =>
 *     this.s3Client.send(new PutObjectCommand({ ... }))
 *   );
 */
export async function instrumentStorage<T>(
  operation: string,
  context: UploadEventData,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  logUploadEvent(`${operation}.start`, context, 'info');
  try {
    const result = await fn();
    logUploadEvent(
      `${operation}.complete`,
      { ...context, durationMs: Date.now() - started },
      'info'
    );
    return result;
  } catch (err) {
    logUploadEvent(
      `${operation}.failed`,
      {
        ...context,
        durationMs: Date.now() - started,
        ...toErrorFields(err),
      },
      'error'
    );
    throw err;
  }
}
