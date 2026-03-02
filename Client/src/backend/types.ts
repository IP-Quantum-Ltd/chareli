export interface Role {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  games?: Game[];
  gameCount?: number;
  topGames?: {
    id: string;
    title: string;
    thumbnailUrl?: string;
    sessionCount: number;
  }[];
  metrics?: {
    gameCount: number;
    sessionCount: number;
    averageSessions: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  url: string;
  s3Key: string;
  type: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export type GameStatus = 'active' | 'disabled';

export type GameProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface Game {
  id: string;
  title: string;
  description?: string;
  thumbnailFileId?: string;
  thumbnailFile?: FileMetadata;
  status: GameStatus;
  gameFileId?: string;
  gameFile?: FileMetadata;
  config: number;
  categoryId?: string;
  category?: Category;
  createdById?: string;
  createdBy?: User;
  processingStatus?: GameProcessingStatus;
  processingError?: string;
  jobId?: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGameDto {
  title: string;
  description?: string;
  thumbnailFile?: File;
  gameFile?: File;
  config?: number;
  categoryId?: string;
}

export type UpdateGameDto = Partial<CreateGameDto>;

// These types represent the actual API response structure
export interface PaginatedResponse<T> {
  success: boolean;
  count: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  data: T[];
}

export interface GameFile {
  id: string;
  s3Key: string;
  url: string;
  type: string;
  variants?: {
    thumbnail?: string;
    xsmall?: string;
    small?: string;
    medium?: string;
    large?: string;
  };
  dimensions?: {
    original?: { width: number; height: number };
    thumbnail?: { width: number; height: number };
    xsmall?: { width: number; height: number };
    small?: { width: number; height: number };
    medium?: { width: number; height: number };
    large?: { width: number; height: number };
  };
  isProcessed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SimilarGame {
  id: string;
  title: string;
  description: string;
  thumbnailFile?: GameFile;
}

export interface GameData {
  id: string;
  title: string;
  description?: string;
  thumbnailFile?: GameFile;
  gameFile?: GameFile;
  status: GameStatus;
  config: number;
  categoryId?: string;
  category?: Category;
  createdById?: string;
  createdBy?: User;
  processingStatus?: GameProcessingStatus;
  processingError?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
  slug: string;
  metadata?: {
    developer?: string;
    howToPlay?: string;
    features?: string[];
    tags?: string[];
    seoKeywords?: string;
    schemaVersion?: string;
    releaseDate?: string;
    platform?: string[];
    faqOverride?: string;
  };
  statistics?: {
    totalSessions: number;
    uniquePlayers: number;
    averageSessionDuration: number;
  };
  recommendedGames?: SimilarGame[];
}

export type GameResponse = GameData;
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  password?: string;
  isAdmin: boolean;
  isActive: boolean;
  country?: string;
  lastLoggedIn?: string;
  lastSeen?: string;
  createdAt: string;
  updatedAt: string;
  role: Role;
}

export interface LoginCredentials {
  identifier: string;
  password: string;
}

export interface OtpVerification {
  userId: string;
  otp: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type RegistrationData = Partial<User> & {
  password: string;
  hasAcceptedTerms: boolean;
  isAdult: boolean;
};

export interface ForgotPasswordData {
  email: string;
}

export interface ResetPasswordData {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface ChangePasswordData {
  id: string;
  oldPassword: string;
  password: string;
}

export interface CreateAnalyticsData {
  gameId?: string;
  activityType: string;
  startTime?: Date;
  endTime?: Date;
  sessionCount?: number;
}

export interface Analytics {
  id: string;
  userId: string;
  gameId?: string;
  activityType: string;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  sessionCount?: number;
  exitReason?: string;
  loadTime?: number;
  milestone?: string;
  errorMessage?: string;
  lastSeenAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameProcessingStatusResponse {
  success: boolean;
  data: {
    processingStatus: GameProcessingStatus;
    processingError?: string;
    jobId?: string;
    jobStatus?: {
      status: string;
      progress?: number;
      error?: string;
      result?: unknown;
    };
  };
}

export const GameProposalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  SUPERSEDED: 'superseded',
} as const;

export type GameProposalStatus = (typeof GameProposalStatus)[keyof typeof GameProposalStatus];

export const GameProposalType = {
  CREATE: 'create',
  UPDATE: 'update',
} as const;

export type GameProposalType = (typeof GameProposalType)[keyof typeof GameProposalType];

export interface GameProposal {
  id: string;
  type: GameProposalType;
  gameId?: string;
  game?: Game;
  editorId: string;
  editor?: User;
  status: GameProposalStatus;
  previousProposalId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proposedData: any;
  adminFeedback?: string;
  reviewedBy?: string;
  reviewer?: User;
  createdAt: string;
  updatedAt: string;
  feedbackDismissedAt?: string | null;
}

