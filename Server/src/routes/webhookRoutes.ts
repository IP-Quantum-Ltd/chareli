/**
 * ============================================================================
 * Webhook Routes
 * ============================================================================
 * 
 * Routes for receiving webhooks from Cloudflare Worker
 * Internal routes - should be protected by IP allowlist or secret validation
 */

import { Router } from 'express';
import { handleGameProcessed, handleWebhookHealth } from '../controllers/webhookController';

const router = Router();

/**
 * POST /api/internal/game-processed
 * Receive game processing completion webhook from Cloudflare Worker
 */
router.post('/game-processed', handleGameProcessed);

/**
 * GET /api/internal/webhook-health
 * Health check for webhook endpoint (used by Cloudflare Worker to verify connectivity)
 */
router.get('/webhook-health', handleWebhookHealth);

export default router;
