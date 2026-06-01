jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../../config/config', () => ({
  __esModule: true,
  default: {
    aiAgent: {
      webhookUrl: 'https://agent.internal',
    },
  },
}));

import axios from 'axios';
import { triggerAgentRun } from '../aiAgent.service';

describe('aiAgent.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.post as jest.Mock).mockResolvedValue({ data: { run_id: 'run-1' } });
  });

  it('posts to agent run endpoint with body and timeout', async () => {
    const body = { game_id: 'game-uuid', submit_review: true };
    const result = await triggerAgentRun(body);

    expect(axios.post).toHaveBeenCalledWith(
      'https://agent.internal/agent/run',
      body,
      { timeout: 10_000 }
    );
    expect(result).toEqual({ run_id: 'run-1' });
  });
});

