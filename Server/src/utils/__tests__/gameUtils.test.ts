import {
  isGamePubliclyVisible,
  canSeeUnpublishedGames,
  publiclyVisibleGameFilter,
} from '../gameUtils';
import { GameStatus, GameProcessingStatus } from '../../entities/Games';
import { RoleType } from '../../entities/Role';

describe('gameUtils visibility helpers', () => {
  describe('isGamePubliclyVisible', () => {
    it('returns true only when status=ACTIVE and processingStatus=COMPLETED', () => {
      expect(
        isGamePubliclyVisible({
          status: GameStatus.ACTIVE,
          processingStatus: GameProcessingStatus.COMPLETED,
        })
      ).toBe(true);
    });

    it('returns false when status is DISABLED (draft)', () => {
      expect(
        isGamePubliclyVisible({
          status: GameStatus.DISABLED,
          processingStatus: GameProcessingStatus.COMPLETED,
        })
      ).toBe(false);
    });

    it.each([
      GameProcessingStatus.PENDING,
      GameProcessingStatus.PROCESSING,
      GameProcessingStatus.FAILED,
    ])('returns false when processingStatus=%s even if ACTIVE', (ps) => {
      expect(
        isGamePubliclyVisible({
          status: GameStatus.ACTIVE,
          processingStatus: ps,
        })
      ).toBe(false);
    });
  });

  describe('canSeeUnpublishedGames', () => {
    it('allows admin and superadmin', () => {
      expect(canSeeUnpublishedGames(RoleType.ADMIN)).toBe(true);
      expect(canSeeUnpublishedGames(RoleType.SUPERADMIN)).toBe(true);
    });

    it('rejects other roles', () => {
      expect(canSeeUnpublishedGames(RoleType.PLAYER)).toBe(false);
      expect(canSeeUnpublishedGames(RoleType.VIEWER)).toBe(false);
      expect(canSeeUnpublishedGames(RoleType.EDITOR)).toBe(false);
    });

    it('rejects missing or null role', () => {
      expect(canSeeUnpublishedGames(undefined)).toBe(false);
      expect(canSeeUnpublishedGames(null)).toBe(false);
    });
  });

  describe('publiclyVisibleGameFilter', () => {
    it('matches the predicate shape exactly', () => {
      expect(publiclyVisibleGameFilter).toEqual({
        status: GameStatus.ACTIVE,
        processingStatus: GameProcessingStatus.COMPLETED,
      });
    });

    it('a game matching the filter is publicly visible', () => {
      expect(isGamePubliclyVisible(publiclyVisibleGameFilter)).toBe(true);
    });
  });
});
