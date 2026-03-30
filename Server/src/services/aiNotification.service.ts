import axios from 'axios';
import config from '../config/config';
import logger from '../utils/logger';

interface ProposalCreatedPayload {
  proposalId: string;
  type: 'create' | 'update';
  gameId: string | null;
  editorId: string;
  proposedData: Record<string, any>;
  createdAt: Date;
}

/**
 * Fires a fire-and-forget POST to the AI agent service when a new proposal is created.
 * Errors are logged but never thrown — the main app flow must not be blocked.
 */
export const notifyProposalCreated = (payload: ProposalCreatedPayload): void => {
  const agentUrl = config.aiAgent?.webhookUrl;

  if (!agentUrl) {
    logger.debug('AI_AGENT_WEBHOOK_URL not configured — skipping AI notification');
    return;
  }

  axios
    .post(`${agentUrl}/webhook/proposal-created`, payload, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    })
    .then(() => {
      logger.info(`[aiNotification] Notified AI agent for proposal ${payload.proposalId}`);
    })
    .catch((err: Error) => {
      logger.warn(`[aiNotification] Failed to notify AI agent for proposal ${payload.proposalId}: ${err.message}`);
    });
};
