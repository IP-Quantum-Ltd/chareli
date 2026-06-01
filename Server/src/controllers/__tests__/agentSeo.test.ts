import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../../services/aiAgent.service', () => ({
  triggerAgentRun: jest.fn(),
}));

jest.mock('../../services/websocket.service', () => ({
  websocketService: {
    emitAgentSeoStarted: jest.fn(),
    emitAgentSeoComplete: jest.fn(),
  },
}));

jest.mock('../../utils/fileUtils', () => ({
  moveFileToPermanentStorage: jest.fn().mockResolvedValue('permanent/thumb.png'),
}));

jest.mock('../../utils/slugify', () => ({
  generateUniqueSlug: jest.fn().mockResolvedValue('test-game'),
}));

jest.mock('../../services/cache-invalidation.service', () => ({
  cacheInvalidationService: {
    invalidateGameCreation: jest.fn().mockResolvedValue(undefined),
    invalidateGameUpdate: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/queue.service', () => ({
  queueService: {
    addImageProcessingJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    addGameZipProcessingJob: jest.fn().mockResolvedValue({ id: 'job-2' }),
  },
}));

jest.mock('../../services/storage.service', () => ({
  storageService: {
    getPublicUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
  },
}));

jest.mock('../../services/aiNotification.service', () => ({
  notifyProposalCreated: jest.fn().mockResolvedValue(undefined),
}));

const mockQueryRunner = {
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  manager: {
    findOne: jest.fn().mockResolvedValue({ id: 'category-uuid' }),
    save: jest.fn().mockImplementation(async (entity: { id?: string }) => ({
      ...entity,
      id: entity.id ?? 'saved-entity-id',
      createdAt: new Date(),
    })),
  },
};

jest.mock('../../config/database', () => ({
  AppDataSource: {
    createQueryRunner: jest.fn(() => mockQueryRunner),
    getRepository: jest.fn(() => ({
      create: jest.fn((data: unknown) => data),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    })),
  },
}));

import { triggerAgentRun } from '../../services/aiAgent.service';
import { websocketService } from '../../services/websocket.service';
import * as gameController from '../gameController';
import { RoleType } from '../../entities/Role';

const { runAgentSeoOnGame, scheduleAgentSeoForGame, createGame } =
  gameController;

const GAME_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('Agent SEO', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (triggerAgentRun as jest.Mock).mockResolvedValue({ ok: true });
  });

  describe('scheduleAgentSeoForGame (auto trigger)', () => {
    it('calls triggerAgentRun with game_id and submit_review', async () => {
      scheduleAgentSeoForGame(GAME_ID);

      expect(triggerAgentRun).toHaveBeenCalledWith({
        game_id: GAME_ID,
        submit_review: true,
      });
    });

    it('does not throw when triggerAgentRun rejects', async () => {
      (triggerAgentRun as jest.Mock).mockRejectedValue(new Error('agent down'));

      expect(() => scheduleAgentSeoForGame(GAME_ID)).not.toThrow();
      await flushPromises();
      expect(triggerAgentRun).toHaveBeenCalled();
    });
  });

  describe('runAgentSeoOnGame (manual trigger)', () => {
    const invokeHandler = async () => {
      const req = {
        params: { id: GAME_ID },
        user: { userId: 'admin-1' },
      } as unknown as Request;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const next = jest.fn() as NextFunction;

      await runAgentSeoOnGame(req, res, next);
      return { res, next };
    };

    it('returns 202 and emits agent-seo-started on success', async () => {
      const { res, next } = await invokeHandler();

      expect(triggerAgentRun).toHaveBeenCalledWith({
        game_id: GAME_ID,
        submit_review: true,
      });
      expect(websocketService.emitAgentSeoStarted).toHaveBeenCalledWith(GAME_ID);
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { gameId: GAME_ID },
        message: 'Agent SEO triggered',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards errors to next when triggerAgentRun fails', async () => {
      const agentError = new Error('AI agent unavailable');
      (triggerAgentRun as jest.Mock).mockRejectedValue(agentError);

      const { res, next } = await invokeHandler();

      expect(next).toHaveBeenCalledWith(agentError);
      expect(res.status).not.toHaveBeenCalled();
      expect(websocketService.emitAgentSeoStarted).not.toHaveBeenCalled();
    });
  });

  describe('POST /games/:id/run-agent-seo (integration)', () => {
    const createTestApp = () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = {
          userId: 'admin-1',
          role: RoleType.ADMIN,
        } as Request['user'];
        next();
      });
      app.post('/games/:id/run-agent-seo', runAgentSeoOnGame);
      return app;
    };

    it('wires route to handler and returns 202', async () => {
      const app = createTestApp();
      const response = await request(app).post(
        `/games/${GAME_ID}/run-agent-seo`
      );

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        success: true,
        data: { gameId: GAME_ID },
        message: 'Agent SEO triggered',
      });
      expect(triggerAgentRun).toHaveBeenCalledWith({
        game_id: GAME_ID,
        submit_review: true,
      });
    });
  });

  describe('createGame editor path (auto trigger negative)', () => {
    it('does not schedule agent SEO when editor creates a proposal', async () => {
      const scheduleSpy = jest.spyOn(
        gameController,
        'scheduleAgentSeoForGame'
      );

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = {
          userId: 'editor-1',
          role: RoleType.EDITOR,
        } as Request['user'];
        next();
      });
      app.post('/games', createGame);

      const response = await request(app).post('/games').send({
        title: 'Editor Game',
        categoryId: 'category-uuid',
        thumbnailFileKey: 'temp/thumb.png',
        gameFileKey: 'temp/game.zip',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Game creation submitted for review');
      expect(scheduleSpy).not.toHaveBeenCalled();

      scheduleSpy.mockRestore();
    });
  });
});
