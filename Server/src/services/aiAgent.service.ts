import axios from 'axios';
import config from '../config/config';

export const triggerAgentRun = async (body: Record<string, any>): Promise<any> => {
  const baseUrl = config.aiAgent?.webhookUrl;
  if (!baseUrl) throw new Error('AI_AGENT_WEBHOOK_URL is not configured');

  const { data } = await axios.post(`${baseUrl}/agent/run`, body, { timeout: 10_000 });
  return data;
};
