/**
 * Backend API routes
 */
export const BackendRoute = {
  USER: '/api/users',
  USER_BY_ID: '/api/users/:id',
  HEALTH: '/api/health',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_VERIFY_OTP: '/api/auth/verify-otp',
  AUTH_ME: '/api/auth/me',
  AUTH_CHANGE_PASSWORD: '/api/auth/me/change-password',
  AUTH_REFRESH_TOKEN: '/api/auth/refresh-token',
  AUTH_REGISTER: '/api/auth/register',
  AUTH_REQUEST_OTP: '/api/auth/request-otp',
  AUTH_FORGOT_PASSWORD: '/api/auth/forgot-password',
  AUTH_RESET_PASSWORD: '/api/auth/reset-password',
  AUTH_INVITE: '/api/auth/invite',
  AUTH_INVITATIONS: '/api/auth/invitations',
  AUTH_INVITATION_BY_ID: '/api/auth/invitations/:id',
  AUTH_VERIFY_INVITATION: '/api/auth/verify-invitation/:token',
  AUTH_REGISTER_FROM_INVITATION: '/api/auth/register/:token',
  AUTH_RESET_PASSWORD_FROM_INVITATION: '/api/auth/reset-password-from-invitation/:token',
  AUTH_REVOKE_ROLE: '/api/auth/revoke-role/:id',
  GAMES: '/api/games',
  GAME_BY_ID: '/api/games/:id',
  GAME_BY_POSITION: '/api/games/position/:position',
  CATEGORIES: '/api/categories',
  CATEGORY_BY_ID: '/api/categories/:id',

  // Game Proposal Routes
  GAME_PROPOSALS: '/api/game-proposals',
  GAME_PROPOSAL_BY_ID: '/api/game-proposals/:id',
  MY_PROPOSALS: '/api/game-proposals/my',
  APPROVE_PROPOSAL: '/api/game-proposals/:id/approve',
  DECLINE_PROPOSAL: '/api/game-proposals/:id/decline',
  DISMISS_PROPOSAL: '/api/game-proposals/:id/dismiss',
  REVISE_PROPOSAL: '/api/game-proposals/:id/revise',

  // Game Position History Routes
  GAME_POSITION_HISTORY: '/api/game-position-history',
  GAME_POSITION_HISTORY_BY_GAME: '/api/game-position-history/:gameId',
  GAME_POSITION_HISTORY_CLICK: '/api/game-position-history/:gameId/click',
  GAME_POSITION_HISTORY_ANALYTICS: '/api/game-position-history/analytics',
  GAME_POSITION_HISTORY_PERFORMANCE: '/api/game-position-history/performance',

  // Analytics Routes
  ANALYTICS: '/api/analytics',
  ANALYTICS_BY_ID: '/api/analytics/:id',
  ANALYTICS_END_TIME: '/api/analytics/:id/end',
  ANALYTICS_HOMEPAGE_VISIT: '/api/analytics/homepage-visit',

  // Admin Dashboard Routes
  ADMIN_DASHBOARD: '/api/admin/dashboard',
  ADMIN_GAMES: '/api/admin/games',
  ADMIN_USERS_ANALYTICS: '/api/admin/users-analytics',
  ADMIN_USER_ANALYTICS: '/api/admin/users/:id/analytics',
  ADMIN_GAMES_ANALYTICS: '/api/admin/games-analytics',
  ADMIN_GAME_ANALYTICS: '/api/admin/games/:id/analytics',
  ADMIN_USER_ACTIVITY: '/api/admin/user-activity-log',
  ADMIN_GAMES_ANALYTICS_POPULARITY: '/api/admin/games-popularity',
  ADMIN_CHECK_INACTIVE: '/api/admin/check-inactive-users',

  // User Stats Route
  USER_STATS: '/api/users/me/stats',

  // Heartbeat Routes
  USER_HEARTBEAT: '/api/users/heartbeat',
  USER_ONLINE_STATUS: '/api/users/online-status',

  // Signup Analytics Routes
  SIGNUP_ANALYTICS_CLICK: '/api/signup-analytics/click',
  SIGNUP_ANALYTICS_DATA: '/api/signup-analytics/data',

  // System Config Routes
  SYSTEM_CONFIG: '/api/system-configs',
  SYSTEM_CONFIG_FORMATTED: '/api/system-configs/formatted',
  SYSTEM_CONFIG_BY_KEY: '/api/system-configs/:key',

  // Game Likes Routes
  GAME_LIKE: '/api/games/:gameId/like',
  GAME_UNLIKE: '/api/games/:gameId/like',
} as const;
