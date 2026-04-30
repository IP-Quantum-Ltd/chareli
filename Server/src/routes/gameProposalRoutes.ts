import { Router } from 'express';
import {
  getProposals,
  getPendingProposals,
  getMyProposals,
  approveProposal,
  declineProposal,
  deleteProposal,
  getProposalById,
  updateProposal,
  dismissFeedback,
  reviseProposal
} from '../controllers/gameProposalController';
import {
  authenticate,
  isAdmin,
  isEditor
} from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

// Admin Routes
router.get('/', isAdmin, getProposals);
router.post('/:id/approve', isAdmin, approveProposal);
router.post('/:id/decline', isAdmin, declineProposal);

// AI agent cron fallback — read-only list of pending proposals (editor + admin)
router.get('/pending', isEditor, getPendingProposals);

// Editor Routes
router.get('/my', isEditor, getMyProposals);
router.post('/:id/dismiss', isEditor, dismissFeedback);
router.post('/:id/revise', isEditor, reviseProposal);

// Shared/Common Routes
router.get('/:id', getProposalById);
router.put('/:id', updateProposal);
router.delete('/:id', deleteProposal);

export default router;

