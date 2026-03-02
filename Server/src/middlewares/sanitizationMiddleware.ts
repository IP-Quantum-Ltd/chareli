import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { JSDOM } from 'jsdom';

// Import DOMPurify using require for Node.js compatibility
const createDOMPurify = require('dompurify');

// Create DOMPurify instance for Node.js
const window = new JSDOM('').window;
const purify = createDOMPurify(window as unknown as Window);

/**
 * Fields that are allowed to contain HTML (will be sanitized with DOMPurify instead of stripped)
 */
const HTML_ALLOWED_FIELDS = [
  'description',
  'howToPlay',
  'faqOverride',
];

/**
 * Check if a field path allows HTML content
 * @param path Field path (e.g., 'description', 'metadata.howToPlay')
 * @returns true if HTML is allowed
 */
const isHtmlAllowedField = (path: string): boolean => {
  // Check direct field name
  if (HTML_ALLOWED_FIELDS.includes(path)) {
    return true;
  }
  // Check nested paths (e.g., metadata.howToPlay)
  return HTML_ALLOWED_FIELDS.some(field => path.includes(`.${field}`) || path.endsWith(`.${field}`));
};

/**
 * Middleware to sanitize request body, query, and params
 * Prevents XSS attacks while preserving HTML in allowed fields
 */
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body, 'body');
  }

  // Sanitize request query
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        // Query params should never contain HTML
        req.query[key] = sanitizePlainString(req.query[key] as string);
      }
    });
  }

  // Sanitize request params
  if (req.params) {
    Object.keys(req.params).forEach(key => {
      if (typeof req.params[key] === 'string') {
        // Params should never contain HTML
        req.params[key] = sanitizePlainString(req.params[key]);
      }
    });
  }

  next();
};

/**
 * Sanitize a plain string (no HTML allowed)
 * @param value String to sanitize
 * @returns Sanitized string
 */
const sanitizePlainString = (value: string): string => {
  // Remove script tags
  value = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove HTML tags
  value = value.replace(/<[^>]*>/g, '');

  // Replace potentially dangerous characters
  value = value.replace(/[&<>"'`=\/]/g, (match) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '`': '&#x60;',
      '=': '&#x3D;',
      '/': '&#x2F;'
    };
    return replacements[match];
  });

  return value;
};

/**
 * Sanitize HTML string using DOMPurify (allows safe HTML)
 * @param value HTML string to sanitize
 * @returns Sanitized HTML string
 */
const sanitizeHtmlString = (value: string): string => {
  // Use DOMPurify to sanitize HTML while preserving safe tags
  return purify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
    ALLOWED_ATTR: ['href', 'class'],
    ALLOW_DATA_ATTR: false,
  });
};

/**
 * Recursively sanitize an object
 * @param obj Object to sanitize
 * @param path Current field path (for checking if HTML is allowed)
 * @returns Sanitized object
 */
const sanitizeObject = (obj: Record<string, any>, path: string = ''): Record<string, any> => {
  const result: Record<string, any> = {};

  Object.keys(obj).forEach(key => {
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof obj[key] === 'string') {
      // Check if this field allows HTML
      if (isHtmlAllowedField(currentPath)) {
        // Sanitize HTML with DOMPurify (preserves safe HTML)
        result[key] = sanitizeHtmlString(obj[key]);
      } else {
        // Plain string sanitization (strips HTML)
        result[key] = sanitizePlainString(obj[key]);
      }
    } else if (Array.isArray(obj[key])) {
      // Handle arrays - preserve array structure
      result[key] = obj[key].map((item: any, index: number) => {
        if (typeof item === 'string') {
          // Array items are typically plain strings (tags, features), not HTML
          return sanitizePlainString(item);
        } else if (typeof item === 'object' && item !== null) {
          return sanitizeObject(item, `${currentPath}[${index}]`);
        }
        return item;
      });
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      // Recursively sanitize nested objects
      result[key] = sanitizeObject(obj[key], currentPath);
    } else {
      // Keep other types as is (numbers, booleans, null, etc.)
      result[key] = obj[key];
    }
  });

  return result;
};
