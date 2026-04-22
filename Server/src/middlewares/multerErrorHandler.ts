import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { logUploadEvent } from '../utils/uploadEvents';

const REASON_BY_CODE: Record<string, string> = {
  LIMIT_FILE_SIZE: 'file_too_large',
  LIMIT_FILE_COUNT: 'too_many_files',
  LIMIT_FIELD_COUNT: 'too_many_fields',
  LIMIT_FIELD_KEY: 'field_name_too_long',
  LIMIT_FIELD_VALUE: 'field_value_too_long',
  LIMIT_PART_COUNT: 'too_many_parts',
  LIMIT_UNEXPECTED_FILE: 'unexpected_field',
};

/**
 * Catch MulterError ahead of the generic errorHandler so an upload rejection
 * emits a structured `upload.rejected` log line (with the specific reason)
 * instead of disappearing into a generic 500.
 */
export const multerErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err instanceof multer.MulterError) {
    const reason = REASON_BY_CODE[err.code] || err.code || 'multer_error';
    logUploadEvent(
      'upload.rejected',
      {
        reason,
        field: err.field,
        errorCode: err.code,
        errorMessage: err.message,
        url: req.originalUrl,
        contentLength: req.headers['content-length']
          ? parseInt(req.headers['content-length'] as string, 10)
          : undefined,
      },
      'warn'
    );
    res.status(400).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        reason,
        field: err.field,
      },
    });
    return;
  }
  next(err);
};
