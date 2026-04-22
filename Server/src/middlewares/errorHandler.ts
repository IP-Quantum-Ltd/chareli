import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface AppError extends Error {
  statusCode?: number;
  errors?: Record<string, string>;
  code?: string | number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  const context = {
    event: statusCode >= 500 ? 'request.error' : 'request.client_error',
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    statusCode,
    errorName: err.name,
    errorMessage: message,
    errorCode: err.code,
  };

  if (statusCode >= 500) {
    logger.error('request.error', { ...context, stack: err.stack });
  } else {
    logger.warn('request.client_error', context);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      errors: err.errors || {},
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

export class ApiError extends Error {
  statusCode: number;
  errors?: Record<string, string>;

  constructor(statusCode: number, message: string, errors?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static badRequest(message = 'Bad request', errors?: Record<string, string>) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }
}
