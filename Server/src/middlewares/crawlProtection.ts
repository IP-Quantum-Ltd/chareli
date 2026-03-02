
import { Request, Response, NextFunction } from 'express';

const BLOCKED_PATHS = [
  /^\/admin/,
  /^\/register-invitation/,
  /^\/reset-password/,
];

/**
 * Middleware to add X-Robots-Tag header to prevent indexing of sensitive routes.
 * This is an alternative to robots.txt which would expose these paths.
 */
export function crawlProtection(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isBlocked = BLOCKED_PATHS.some((pattern) =>
    pattern.test(req.path)
  );

  if (isBlocked) {
    res.setHeader(
      'X-Robots-Tag',
      'noindex, nofollow, nosnippet, noarchive'
    );
  }

  next();
}
