import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { GameProposal, GameProposalStatus, GameProposalType } from '../entities/GameProposal';
import { Game, GameStatus, GameProcessingStatus } from '../entities/Games';
import { File } from '../entities/Files';
import { User } from '../entities/User';
import { ApiError } from '../middlewares/errorHandler';
import { queueService } from '../services/queue.service';
import { storageService } from '../services/storage.service';
import { moveFileToPermanentStorage } from '../utils/fileUtils';
import { generateUniqueSlug } from '../utils/slugify';
import { DeepPartial } from 'typeorm';
import logger from '../utils/logger';
import { websocketService } from '../services/websocket.service';

const proposalRepository = AppDataSource.getRepository(GameProposal);
const gameRepository = AppDataSource.getRepository(Game);
const fileRepository = AppDataSource.getRepository(File);

/**
 * Get all proposals (Admin/Superadmin)
 */
export const getProposals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const proposals = await proposalRepository.find({
      where,
      relations: ['editor', 'game', 'reviewer', 'game.thumbnailFile'],
      order: { createdAt: 'DESC' }
    });

    // Transform URLs for potential nested game thumbnail
    proposals.forEach(proposal => {
        if (proposal.game?.thumbnailFile) {
             const s3Key = proposal.game.thumbnailFile.s3Key;
             proposal.game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
        }
    });

    res.status(200).json({ success: true, data: proposals });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my proposals (Editor)
 */
export const getMyProposals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const proposals = await proposalRepository.find({
      where: { editorId: userId },
      relations: ['game', 'game.thumbnailFile'],
      order: { createdAt: 'DESC' }
    });

    // Transform URLs for potential nested game thumbnail
    proposals.forEach(proposal => {
        if (proposal.game?.thumbnailFile) {
             const s3Key = proposal.game.thumbnailFile.s3Key;
             proposal.game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
        }
    });

    res.status(200).json({ success: true, data: proposals });
  } catch (error) {
    next(error);
  }
};

/**
 * Approve a proposal
 */
export const approveProposal = async (req: Request, res: Response, next: NextFunction) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { id } = req.params;
    const proposal = await proposalRepository.findOne({
      where: { id },
      relations: ['game']
    });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    if (proposal.status !== GameProposalStatus.PENDING) {
      return next(ApiError.badRequest('Proposal is not pending'));
    }

    const proposedData = proposal.proposedData || {};
    let game: Game;

    if (proposal.type === GameProposalType.CREATE) {
      // Create new game
      const slug = await generateUniqueSlug(proposedData.title);
      // Explicitly cast to simple object to avoid array type inference ambiguity
      const gameData = {
        ...proposedData,
        slug,
        createdById: proposal.editorId,
        status: proposedData.status || GameStatus.ACTIVE,
      } as unknown as DeepPartial<Game>;

      game = gameRepository.create(gameData);
      await queryRunner.manager.save(game);

      // If we have a game ID now, we update the proposal linked game
      proposal.gameId = game.id;
    } else {
      // Update existing game
      const existingGame = await queryRunner.manager.findOne(Game, { where: { id: proposal.gameId } });
      if (!existingGame) {
        throw new ApiError(404, 'Target game not found');
      }
      game = existingGame;

      // Merge data
      Object.assign(game, proposedData);
      await queryRunner.manager.save(game);
    }

    // Handle File Processing (Late Binding)
    // If proposedData contained file keys (which were saved to permanent storage during proposal creation),
    // we might need to Trigger Processing Jobs now.

    if (proposedData.gameFileKey) {
        // Update game processing status
        game.processingStatus = GameProcessingStatus.PENDING;
        game.status = GameStatus.DISABLED; // Disable while processing
        await queryRunner.manager.save(game);

        await queueService.addGameZipProcessingJob({
          gameId: game.id,
          gameFileKey: proposedData.gameFileKey,
          userId: proposal.editorId
        });
    }

    // Update Proposal Status
    proposal.status = GameProposalStatus.APPROVED;
    proposal.reviewedBy = req.user?.userId || null;
    proposal.adminFeedback = req.body.adminFeedback; // Optional comment

    await queryRunner.manager.save(proposal);
    await queryRunner.commitTransaction();

    websocketService.emitProposalUpdate('approve', proposal);

    res.status(200).json({ success: true, message: 'Proposal approved', gameId: game.id });
  } catch (error) {
    await queryRunner.rollbackTransaction();
    next(error);
  } finally {
    await queryRunner.release();
  }
};

/**
 * Decline a proposal
 */
export const declineProposal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body;

    if (!feedback) {
      return next(ApiError.badRequest('Feedback is required for declining'));
    }

    const proposal = await proposalRepository.findOne({ where: { id } });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    if (proposal.status !== GameProposalStatus.PENDING) {
      return next(ApiError.badRequest('Proposal is not pending'));
    }

    proposal.status = GameProposalStatus.DECLINED;
    proposal.reviewedBy = req.user?.userId || null;
    proposal.adminFeedback = feedback;

    await proposalRepository.save(proposal);

    websocketService.emitProposalUpdate('decline', proposal);

    res.status(200).json({ success: true, message: 'Proposal declined' });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a proposal
 * Editor: Can delete own PENDING/DECLINED proposals
 * Admin: Can delete any proposal
 */
export const deleteProposal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    // Find proposal
    const proposal = await proposalRepository.findOne({ where: { id } });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    // Check permissions
    const isOwner = proposal.editorId === userId;
    const isAdminUser = userRole === 'admin' || userRole === 'superadmin';

    if (!isOwner && !isAdminUser) {
      return next(ApiError.forbidden('You do not have permission to delete this proposal'));
    }

    // Check status constraints for cancellation/deletion
    // Allowed: Editors can delete any of their proposals (it's just an audit record for them)
    // if (proposal.status === GameProposalStatus.APPROVED && !isAdminUser) {
    //   return next(ApiError.badRequest('Cannot delete an approved proposal'));
    // }

    await proposalRepository.remove(proposal);

    websocketService.emitProposalUpdate('delete', proposal);

    res.status(200).json({ success: true, message: 'Proposal deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Get proposal by ID
 */
export const getProposalById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const proposal = await proposalRepository.findOne({
      where: { id },
      relations: ['game', 'game.category', 'game.thumbnailFile', 'game.gameFile']
    });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    // Check permissions (Owner or Admin)
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const isOwner = proposal.editorId === userId;
    const isAdminUser = userRole === 'admin' || userRole === 'superadmin' || userRole === 'viewer'; // Viewers need read access

    if (!isOwner && !isAdminUser) {
      return next(ApiError.forbidden('You do not have permission to view this proposal'));
    }

    // Transform URLs for nested game files (Current Game Data)
    if (proposal.game) {
        if (proposal.game.thumbnailFile) {
             proposal.game.thumbnailFile.s3Key = storageService.getPublicUrl(proposal.game.thumbnailFile.s3Key);
             // Ensure 'url' property is also populated if frontend uses it
             (proposal.game.thumbnailFile as any).url = proposal.game.thumbnailFile.s3Key;
        }
        if (proposal.game.gameFile) {
             proposal.game.gameFile.s3Key = storageService.getPublicUrl(proposal.game.gameFile.s3Key);
             (proposal.game.gameFile as any).url = proposal.game.gameFile.s3Key;
        }
    }

    res.status(200).json({ success: true, data: proposal });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a proposal (Editor only, for PENDING proposals)
 */
export const updateProposal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { proposedData } = req.body;
    const userId = req.user?.userId;

    const proposal = await proposalRepository.findOne({ where: { id } });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    if (proposal.editorId !== userId) {
      return next(ApiError.forbidden('You can only update your own proposals'));
    }

    if (proposal.status !== GameProposalStatus.PENDING) {
      return next(ApiError.badRequest('Cannot update a proposal that is not pending'));
    }

    // Update data
    proposal.proposedData = {
      ...proposal.proposedData,
      ...proposedData
    };

    // If file keys are provided, we accept them directly as valid URLs
    // (assuming frontend has handled upload/presigning)

    await proposalRepository.save(proposal);

    websocketService.emitProposalUpdate('update', proposal);

    res.status(200).json({ success: true, data: proposal, message: 'Proposal updated successfully' });
  } catch (error) {
    next(error);
  }
};


/**
 * Dismiss feedback on a declined proposal (Editor only)
 * This marks the feedback as acknowledged so it no longer appears in the counter
 */
export const dismissFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const proposal = await proposalRepository.findOne({ where: { id } });

    if (!proposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    if (proposal.editorId !== userId) {
      return next(ApiError.forbidden('You can only dismiss feedback on your own proposals'));
    }

    if (proposal.status !== GameProposalStatus.DECLINED) {
      return next(ApiError.badRequest('Can only dismiss feedback on declined proposals'));
    }

    if (proposal.feedbackDismissedAt) {
      return next(ApiError.badRequest('Feedback has already been dismissed'));
    }

    proposal.feedbackDismissedAt = new Date();
    await proposalRepository.save(proposal);

    websocketService.emitProposalUpdate('dismiss_feedback', proposal);

    res.status(200).json({ success: true, data: proposal, message: 'Feedback dismissed successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Revise and Resubmit a declined proposal
 * Creates a new clone of the proposal and marks the old one as SUPERSEDED
 */
export const reviseProposal = async (req: Request, res: Response, next: NextFunction) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const oldProposal = await proposalRepository.findOne({ where: { id } });

    if (!oldProposal) {
      return next(ApiError.notFound('Proposal not found'));
    }

    if (oldProposal.editorId !== userId) {
      return next(ApiError.forbidden('You can only revise your own proposals'));
    }

    if (oldProposal.status !== GameProposalStatus.DECLINED) {
      return next(ApiError.badRequest('Can only revise declined proposals'));
    }

    // Create new proposal based on old one
    const newProposal = proposalRepository.create({
      type: oldProposal.type,
      gameId: oldProposal.gameId,
      editorId: userId,
      status: GameProposalStatus.PENDING,
      proposedData: oldProposal.proposedData,
      previousProposalId: oldProposal.id
    });

    await queryRunner.manager.save(newProposal);

    // Update old proposal status
    oldProposal.status = GameProposalStatus.SUPERSEDED;
    await queryRunner.manager.save(oldProposal);

    await queryRunner.commitTransaction();

    websocketService.emitProposalUpdate('revise', newProposal);

    res.status(201).json({
      success: true,
      message: 'Proposal revised and resubmitted successfully',
      data: newProposal
    });
  } catch (error) {
    await queryRunner.rollbackTransaction();
    next(error);
  } finally {
    await queryRunner.release();
  }
};

