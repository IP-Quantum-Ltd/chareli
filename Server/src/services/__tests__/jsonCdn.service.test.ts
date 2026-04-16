/**
 * Unit tests for JSON CDN Service
 *
 * Note: Basic surface tests plus regression tests for incremental update
 * correctness. The incremental path must not leak drafts or still-processing
 * games into the public CDN JSON files.
 */

import { GameStatus, GameProcessingStatus } from '../../entities/Games';

describe('JsonCdnService', () => {
  it('should be importable', () => {
    // This test verifies the module can be required/loaded
    const { jsonCdnService } = require('../jsonCdn.service');
    expect(jsonCdnService).toBeDefined();
  });

  it('should have required methods', () => {
    const { jsonCdnService } = require('../jsonCdn.service');
    expect(typeof jsonCdnService.isEnabled).toBe('function');
    expect(typeof jsonCdnService.getCdnUrl).toBe('function');
    expect(typeof jsonCdnService.getMetrics).toBe('function');
    expect(typeof jsonCdnService.invalidateCache).toBe('function');
    expect(typeof jsonCdnService.generateAllJsonFiles).toBe('function');
    expect(typeof jsonCdnService.generateGameDetailJson).toBe('function');
    expect(typeof jsonCdnService.updateSingleGameInLists).toBe('function');
  });

  it('should return metrics object with expected properties', () => {
    const { jsonCdnService } = require('../jsonCdn.service');
    const metrics = jsonCdnService.getMetrics();

    expect(metrics).toHaveProperty('generationCount');
    expect(metrics).toHaveProperty('lastGenerationDuration');
    expect(metrics).toHaveProperty('failureCount');
    expect(metrics).toHaveProperty('isGenerating');
    expect(metrics).toHaveProperty('config');

    expect(typeof metrics.generationCount).toBe('number');
    expect(typeof metrics.lastGenerationDuration).toBe('number');
    expect(typeof metrics.failureCount).toBe('number');
    expect(typeof metrics.isGenerating).toBe('boolean');
    expect(typeof metrics.config).toBe('object');
  });

  it('should generate proper CDN URLs when enabled', () => {
    const { jsonCdnService } = require('../jsonCdn.service');

    if (jsonCdnService.isEnabled()) {
      const url = jsonCdnService.getCdnUrl('test.json');
      expect(url).toContain('/cdn/test.json');
    } else {
      const url = jsonCdnService.getCdnUrl('test.json');
      expect(url).toBe('');
    }
  });

  it('should handle invalidateCache with empty array', async () => {
    const { jsonCdnService } = require('../jsonCdn.service');

    // Should not throw
    await expect(jsonCdnService.invalidateCache([])).resolves.not.toThrow();
  });
});

describe('JsonCdnService.updateSingleGameInLists — visibility gating', () => {
  const { jsonCdnService } = require('../jsonCdn.service');
  const { AppDataSource } = require('../../config/database');

  // Minimal game factory – only the fields the incremental path reads.
  const buildGame = (
    overrides: Partial<{
      status: GameStatus;
      processingStatus: GameProcessingStatus;
    }> = {}
  ) => ({
    id: 'game-1',
    slug: 'game-one',
    title: 'Game One',
    status: GameStatus.ACTIVE,
    processingStatus: GameProcessingStatus.COMPLETED,
    baseLikeCount: 100,
    lastLikeIncrement: new Date(),
    thumbnailFile: null,
    gameFile: null,
    category: null,
    createdBy: null,
    ...overrides,
  });

  let patchSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;
  let detailSpy: jest.SpyInstance;

  const mockRepoReturning = (game: any) => ({
    findOne: jest.fn().mockResolvedValue(game),
  });

  beforeEach(() => {
    patchSpy = jest
      .spyOn(jsonCdnService as any, 'patchGameInJson')
      .mockResolvedValue(undefined);
    removeSpy = jest
      .spyOn(jsonCdnService as any, 'removeGameFromJson')
      .mockResolvedValue(undefined);
    detailSpy = jest
      .spyOn(jsonCdnService as any, 'generateGameDetailJson')
      .mockResolvedValue(undefined);
    // Prevent the real DB call without needing a handle on the spy.
    jest
      .spyOn(jsonCdnService as any, 'getUserLikesCount')
      .mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('patches both games_active and games_all when game is publicly visible', async () => {
    jest
      .spyOn(AppDataSource, 'getRepository')
      .mockReturnValue(mockRepoReturning(buildGame()) as any);

    await jsonCdnService.updateSingleGameInLists('game-1');

    const patchedFiles = patchSpy.mock.calls.map((c: any[]) => c[0]);
    expect(patchedFiles).toEqual(
      expect.arrayContaining(['games_active.json', 'games_all.json'])
    );
    expect(removeSpy).not.toHaveBeenCalled();
    expect(detailSpy).toHaveBeenCalled();
  });

  it('removes game from BOTH games_active and games_all when unpublished (regression: draft leak)', async () => {
    jest
      .spyOn(AppDataSource, 'getRepository')
      .mockReturnValue(
        mockRepoReturning(
          buildGame({ status: GameStatus.DISABLED })
        ) as any
      );

    await jsonCdnService.updateSingleGameInLists('game-1');

    const removedFiles = removeSpy.mock.calls.map((c: any[]) => c[0]);
    expect(removedFiles).toEqual(
      expect.arrayContaining(['games_active.json', 'games_all.json'])
    );
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it.each([
    GameProcessingStatus.PENDING,
    GameProcessingStatus.PROCESSING,
    GameProcessingStatus.FAILED,
  ])(
    'removes from public lists when processingStatus=%s regardless of status=ACTIVE',
    async (ps) => {
      jest.spyOn(AppDataSource, 'getRepository').mockReturnValue(
        mockRepoReturning(
          buildGame({
            status: GameStatus.ACTIVE,
            processingStatus: ps,
          })
        ) as any
      );

      await jsonCdnService.updateSingleGameInLists('game-1');

      const removedFiles = removeSpy.mock.calls.map((c: any[]) => c[0]);
      expect(removedFiles).toEqual(
        expect.arrayContaining(['games_active.json', 'games_all.json'])
      );
      expect(patchSpy).not.toHaveBeenCalled();
    }
  );

  it('no-ops when game is not found', async () => {
    jest
      .spyOn(AppDataSource, 'getRepository')
      .mockReturnValue(mockRepoReturning(null) as any);

    await jsonCdnService.updateSingleGameInLists('missing');

    expect(patchSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(detailSpy).not.toHaveBeenCalled();
  });
});
