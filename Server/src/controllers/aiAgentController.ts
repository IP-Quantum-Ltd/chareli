import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../middlewares/errorHandler';
import { triggerAgentRun } from '../services/aiAgent.service';
import logger from '../utils/logger';

/**
 * @swagger
 * /game-proposals/agent/run:
 *   post:
 *     summary: Trigger AI agent run
 *     description: >
 *       Forwards the request body directly to the AI agent POST /agent/run endpoint.
 *       No transformation — whatever is sent here is passed through as-is.
 *       Requires admin role.
 *     tags: [Game Proposals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - game_id
 *             properties:
 *               game_id:
 *                 type: string
 *                 format: uuid
 *                 description: The game ID to run the agent against
 *               submit_review:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the agent should auto-submit the review on completion
 *               override:
 *                 type: boolean
 *                 default: false
 *                 description: Force a re-run even if a job is already active
 *     responses:
 *       202:
 *         description: Job accepted by the AI agent
 *       500:
 *         description: AI agent unavailable or rejected the request
 */
export const runAiReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info(`[aiAgent] Admin ${req.user?.userId} triggering agent run`);

    let result;
    try {
      result = await triggerAgentRun(req.body);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err.message;
      logger.error(`[aiAgent] Agent call failed: ${detail}`);
      return next(ApiError.internal('AI agent unavailable or rejected the request'));
    }

    res.status(202).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
