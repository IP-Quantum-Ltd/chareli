import { Request, Response, NextFunction } from 'express';
import { authService, TokenPayload } from '../services/auth.service';
import { ApiError } from './errorHandler';
import { attachUserToRequestContext } from './requestId';
import { RoleType } from '../entities/Role';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';

/**
 * Middleware to optionally verify JWT token and attach user to request
 * Does not require authentication, but will set user if valid token is provided
 */
export const optionalAuthenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Continue without authentication
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return next(); // Continue without authentication
    }

    // Verify token and attach user if valid
    const decoded = authService.verifyToken(token);
    req.user = decoded;
    attachUserToRequestContext(decoded.userId);
    next();
  } catch (error) {
    // If token is invalid, continue without authentication
    next();
  }
};

// Extend Express Request interface to include user property
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware to verify JWT token and attach user to request
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    // Verify token
    const decoded = authService.verifyToken(token);

    // Attach user to request
    req.user = decoded;
    attachUserToRequestContext(decoded.userId);
    
    // Update user's lastSeen timestamp (fire and forget - don't wait for it)
    if (decoded.userId) {
      const userRepository = AppDataSource.getRepository(User);
      userRepository.update(
        { id: decoded.userId, isDeleted: false }, 
        { lastSeen: new Date() }
      ).catch(error => {
        console.error('Failed to update lastSeen:', error);
      });
    }
    
    next();
  } catch (error) {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
};

/**
 * Middleware to check if user has required role
 */
export const authorize = (roles: RoleType[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!roles.includes(req.user.role as RoleType)) {
      return next(ApiError.forbidden('You do not have permission to access this resource'));
    }

    next();
  };
};

/**
 * Middleware to check if user is a superadmin
 */
export const isSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (req.user.role !== RoleType.SUPERADMIN) {
    return next(ApiError.forbidden('Superadmin access required'));
  }

  next();
};

/**
 * Middleware to check if user is an admin or superadmin
 */
export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (req.user.role !== RoleType.ADMIN && req.user.role !== RoleType.SUPERADMIN && req.user.role !== RoleType.VIEWER) {
    return next(ApiError.forbidden('Admin access required'));
  }

  next();
};

/**
 * Middleware to check if user is an editor, admin, or superadmin
 */
export const isEditor = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (
    req.user.role !== RoleType.EDITOR && 
    req.user.role !== RoleType.ADMIN && 
    req.user.role !== RoleType.SUPERADMIN
  ) {
    return next(ApiError.forbidden('Editor access required'));
  }

  next();
};

/**
 * Middleware to check if user has admin panel access (viewer, editor, admin, or superadmin)
 */
export const hasAdminPanelAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (
    req.user.role !== RoleType.VIEWER &&
    req.user.role !== RoleType.EDITOR && 
    req.user.role !== RoleType.ADMIN && 
    req.user.role !== RoleType.SUPERADMIN
  ) {
    return next(ApiError.forbidden('Admin panel access required'));
  }

  next();
};

/**
 * Middleware to check if user can perform write operations (editor, admin, or superadmin)
 * Viewers can only read, not write
 */
export const canWrite = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (
    req.user.role !== RoleType.EDITOR && 
    req.user.role !== RoleType.ADMIN && 
    req.user.role !== RoleType.SUPERADMIN
  ) {
    return next(ApiError.forbidden('Write access required. Viewers can only read data.'));
  }

  next();
};

/**
 * Middleware to check if user is accessing their own resource or has admin privileges
 */
export const isOwnerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  const resourceUserId = req.params.id;
  
  // Allow if user is accessing their own resource
  if (req.user.userId === resourceUserId) {
    return next();
  }
  
  // Allow if user is admin or superadmin
  if (req.user.role === RoleType.ADMIN || req.user.role === RoleType.SUPERADMIN) {
    return next();
  }
  
  return next(ApiError.forbidden('You do not have permission to access this resource'));
};
