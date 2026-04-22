import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { method, originalUrl, ip } = req;
  const contentLength = req.headers['content-length'];

  logger.http('request.start', {
    event: 'request.start',
    method,
    url: originalUrl,
    ip,
    contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
  });

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'http';
    logger[level]('request.finish', {
      event: 'request.finish',
      method,
      url: originalUrl,
      statusCode,
      durationMs: duration,
    });
  });

  next();
};
