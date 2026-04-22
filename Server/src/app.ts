import 'reflect-metadata';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import routes from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { requestId } from './middlewares/requestId';
import { requestLogger } from './middlewares/requestLogger';
import { sanitizeInput } from './middlewares/sanitizationMiddleware';
import logger from './utils/logger';
import { specs } from './config/swagger';
import config from './config/config';
import { redisService } from './services/redis.service';


const app: Express = express();

// Attach a request ID + AsyncLocalStorage context. Must run first so every
// downstream log line can pick up `reqId` automatically.
app.use(requestId);

// Request logging middleware
app.use(requestLogger);

import { crawlProtection } from './middlewares/crawlProtection';
app.use(crawlProtection);


// Security middleware
app.use(helmet()); // Adds various HTTP headers for security

// CORS configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) {
      return callback(null, true);
    }

    // List of allowed origins based on environment
    const allowedOrigins = [
      config.app.clientUrl,
      'http://localhost:5173',
      'http://localhost:3000',
      // Add staging and production domains
      'https://staging.arcadesbox.com',
      'https://arcadesbox.com',
      'https://www.arcadesbox.com',
    ].filter(Boolean); // Remove any empty strings

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow Cloudflare Pages preview deployments
    if (origin.endsWith('.pages.dev')) {
      return callback(null, true);
    }

    // In development, allow all origins
    if (config.env === 'development') {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'X-Webhook-Secret',      // For Cloudflare Worker webhooks
    'X-Idempotency-Key',     // For webhook idempotency
    'X-Attempt',             // For webhook retry tracking
  ],
};
app.use(cors(corsOptions));

// Content Security Policy
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;"
  );
  next();
});

// Body parsing middleware
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Set longer timeout for game creation requests
app.use('/api/games', (req, res, next) => {
  // Set timeout to 25 minutes for game creation and updates
  if (req.method === 'POST' || req.method === 'PUT') {
    req.setTimeout(25 * 60 * 1000); // 25 minutes in milliseconds
    res.setTimeout(25 * 60 * 1000); // 25 minutes in milliseconds
  }
  next();
});

// Input sanitization middleware
app.use(sanitizeInput);


// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    docExpansion: 'none',
  },
}));

// Robots.txt route - Disallow all crawlers
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

// Sitemap.xml proxy - Serve dynamic sitemap from CDN
import axios from 'axios';
app.get('/sitemap.xml', async (req, res) => {
  try {
    const sitemapUrl = `${config.jsonCdn.baseUrl}/sitemap.xml`;
    const response = await axios.get(sitemapUrl, {
      responseType: 'stream',
      timeout: 5000, // 5 second timeout
    });

    res.setHeader('Content-Type', 'application/xml');
    response.data.pipe(res);
  } catch (error) {
    logger.error('Failed to proxy sitemap.xml:', error);
    res.status(404).send('Sitemap not found');
  }
});

// API Routes
app.use('/api', routes);


// Error handling middleware
app.use(errorHandler);
logger.info(`Express application initialized in ${config.env} mode`);

// Initialize Redis connection and background services
async function initializeServices(): Promise<void> {
  try {
    // Connect to Redis
    await redisService.connect();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    // Don't exit process, allow app to start without Redis
    // Background processing will just be disabled
  }
}

// Initialize services when app starts
initializeServices();

export default app;
