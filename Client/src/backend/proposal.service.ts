import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendService } from './api.service';
import { BackendRoute } from './constants';
import type { GameProposal } from './types';
import { GameProposalStatus } from './types';

export const useMyProposals = (enabled: boolean = true) => {
  return useQuery<GameProposal[]>({
    queryKey: [BackendRoute.MY_PROPOSALS],
    queryFn: async () => {
      const response = await backendService.get(BackendRoute.MY_PROPOSALS);
      return response.data;
    },
    enabled,
  });
};

export const useProposalById = (id: string) => {
  return useQuery<GameProposal>({
    queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID, id],
    queryFn: async () => {
      const response = await backendService.get(BackendRoute.GAME_PROPOSAL_BY_ID.replace(':id', id));
      return response.data;
    },
    enabled: !!id,
  });
};

export const useUpdateProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<GameProposal['proposedData']> }) =>
      backendService.put(BackendRoute.GAME_PROPOSAL_BY_ID.replace(':id', id), { proposedData: data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });
      // Invalidate the specific proposal
      await queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] });
    },
  });
};

export const useDeleteProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      backendService.delete(BackendRoute.GAME_PROPOSAL_BY_ID.replace(':id', id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });
      await queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSALS] });
    },
  });
};

// --- Admin Hooks ---

export const useProposals = (status?: GameProposalStatus, enabled: boolean = true) => {
  return useQuery<GameProposal[]>({
    queryKey: [BackendRoute.GAME_PROPOSALS, status],
    queryFn: async () => {
      const params = status ? { status } : undefined;
      const response = await backendService.get(BackendRoute.GAME_PROPOSALS, { params });
      return response.data;
    },
    enabled,
  });
};

export const useApproveProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminFeedback }: { id: string; adminFeedback?: string }) =>
      backendService.post(BackendRoute.APPROVE_PROPOSAL.replace(':id', id), { adminFeedback }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] })
      ]);
    },
  });
};

export const useDeclineProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: string }) =>
      backendService.post(BackendRoute.DECLINE_PROPOSAL.replace(':id', id), { feedback }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] })
      ]);
    },
  });
};

export const useDismissFeedback = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      backendService.post(BackendRoute.DISMISS_PROPOSAL.replace(':id', id), {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] })
      ]);
    },
  });
};

export const useReviseProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      backendService.post(BackendRoute.REVISE_PROPOSAL.replace(':id', id), {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] }),
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] })
      ]);
    },
  });
};

