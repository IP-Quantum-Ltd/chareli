import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendService } from './api.service';
import { BackendRoute } from './constants';
import type { User } from './types';

export interface InviteUserRequest {
  email: string;
  role: 'superadmin' | 'admin' | 'editor' | 'player' | 'viewer';
}

export interface ResetPasswordFromInvitationRequest {
  password: string;
  confirmPassword: string;
}

export interface RegisterFromInvitationRequest {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
  phoneNumber: string;
  email: string;
}

// interface Invitation {
//   id: string;
//   email: string;
//   role: {
//     name: string;
//   };
//   invitedBy: {
//     firstName: string;
//     lastName: string;
//   };
//   isAccepted: boolean;
//   expiresAt: string;
//   createdAt: string;
// }

interface InviteUserResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  };
}

// interface InvitationsResponse {
//   success: boolean;
//   count: number;
//   data: Invitation[];
// }

interface VerifyInvitationResponse {
  success: boolean;
  message: string;
  data: {
    email: string;
    userExists: boolean;
    role: string;
  };
}

/**
 * Hook to fetch all team invitations
 * @returns Query result with invitations data
 */
export const useTeamInvitations = () => {
  return useQuery({
    queryKey: [BackendRoute.AUTH_INVITATIONS],
    queryFn: async () => {
      const response = await backendService.get<Record<string, unknown>[]>(BackendRoute.AUTH_INVITATIONS);
      return response;
    },
    refetchOnWindowFocus: false,
  });
};

/**
 * Hook to invite a new team member
 * @returns Mutation function to send invitation
 */
export const useInviteTeamMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InviteUserRequest) => {
      const response = await backendService.post(BackendRoute.AUTH_INVITE, data);
      return response.data as InviteUserResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.AUTH_INVITATIONS] });
    },
  });
};

/**
 * Hook to verify an invitation token
 * @returns Query function to verify token
 */
export const useVerifyInvitation = (token: string) => {
  return useQuery<VerifyInvitationResponse>({
    queryKey: ['verifyInvitation', token],
    queryFn: async () => {
      const url = BackendRoute.AUTH_VERIFY_INVITATION.replace(':token', token);
      const response = await backendService.get<VerifyInvitationResponse>(url);
      return response.data;
    },
    enabled: !!token,
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0
  });
};

/**
 * Hook to register from invitation
 * @returns Mutation function to register
 */
export const useRegisterFromInvitation = () => {
  return useMutation({
    mutationFn: async ({ token, data }: { token: string, data: RegisterFromInvitationRequest }) => {
      const url = BackendRoute.AUTH_REGISTER_FROM_INVITATION.replace(':token', token);
      const response = await backendService.post(url, data);
      return response.data;
    }
  });
};

/**
 * Hook to reset password from invitation
 * @returns Mutation function to reset password
 */
export const useResetPasswordFromInvitation = () => {
  return useMutation({
    mutationFn: async ({ token, data }: { token: string, data: ResetPasswordFromInvitationRequest }) => {
      const url = BackendRoute.AUTH_RESET_PASSWORD_FROM_INVITATION.replace(':token', token);
      const response = await backendService.post(url, data);
      return response.data;
    }
  });
};

export const useAllTeamMembers = () => {
  return useQuery<User[]>({
    queryKey: ['allTeamMembers'], 
    queryFn: async () => {
      const { data } = await backendService.get<User[]>(BackendRoute.USER);
      return data;
    },
    refetchOnWindowFocus: false,
  });
};

export const useRevokeRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const url = BackendRoute.AUTH_REVOKE_ROLE.replace(':id', id);
      const response = await backendService.put(url);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.USER] });
      queryClient.invalidateQueries({ queryKey: ["allTeamMembers"] });
    },
  });
};

export const useDeleteTeamInvitation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const url = BackendRoute.AUTH_INVITATION_BY_ID.replace(':id', id);
      const response = await backendService.delete(url);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.AUTH_INVITATIONS] });
    },
  });
};
