/**
 * Mock infrastructure for adminDashboardController tests
 * Provides repository mocks and test data factories
 */

// ============= MOCK QUERY BUILDER =============
export const createMockQueryBuilder = () => {
  const queryBuilder: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  return queryBuilder;
};

// ============= MOCK REPOSITORIES =============
export const createMockAnalyticsRepository = () => ({
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  query: jest.fn().mockResolvedValue([]),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'mock-id', ...entity })),
  create: jest.fn().mockImplementation((entity) => entity),
});

export const createMockUserRepository = () => ({
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'mock-id', ...entity })),
});

export const createMockGameRepository = () => ({
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
});

export const createMockSignupAnalyticsRepository = () => ({
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  find: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
});

export const createMockGamePositionHistoryRepository = () => ({
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  find: jest.fn().mockResolvedValue([]),
});

// ============= TEST DATA FACTORIES =============

/**
 * Creates mock dashboard analytics response data
 */
export const createMockDashboardData = (overrides: Partial<MockDashboardData> = {}): MockDashboardData => ({
  authenticatedSessions: 10,
  anonymousSessions: 50,
  authenticatedTimePlayed: 3600,
  anonymousTimePlayed: 18000,
  totalRegisteredUsers: 25,
  dailyActiveUsers: 5,
  dailyAnonymousPlayers: 20,
  avgSessionDuration: 180,
  ...overrides,
});

export interface MockDashboardData {
  authenticatedSessions: number;
  anonymousSessions: number;
  authenticatedTimePlayed: number;
  anonymousTimePlayed: number;
  totalRegisteredUsers: number;
  dailyActiveUsers: number;
  dailyAnonymousPlayers: number;
  avgSessionDuration: number;
}

/**
 * Creates mock user objects for testing
 */
export const createMockUser = (overrides: Partial<MockUser> = {}): MockUser => ({
  id: `user-${Math.random().toString(36).substr(2, 9)}`,
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  isActive: true,
  isDeleted: false,
  hasCompletedFirstLogin: true,
  lastLoggedIn: new Date(),
  lastSeen: new Date(),
  createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
  country: 'US',
  isAdult: true,
  ...overrides,
});

export interface MockUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  isDeleted: boolean;
  hasCompletedFirstLogin: boolean;
  lastLoggedIn: Date | null;
  lastSeen: Date | null;
  createdAt: Date;
  country: string;
  isAdult: boolean;
}

/**
 * Creates mock analytics records for testing
 */
export const createMockAnalyticsRecord = (overrides: Partial<MockAnalyticsRecord> = {}): MockAnalyticsRecord => ({
  id: `analytics-${Math.random().toString(36).substr(2, 9)}`,
  userId: null, // Anonymous by default
  sessionId: `session-${Math.random().toString(36).substr(2, 9)}`,
  gameId: `game-${Math.random().toString(36).substr(2, 9)}`,
  activityType: 'game_session',
  startTime: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
  endTime: new Date(),
  duration: 180, // 3 minutes
  createdAt: new Date(),
  ...overrides,
});

export interface MockAnalyticsRecord {
  id: string;
  userId: string | null;
  sessionId: string | null;
  gameId: string | null;
  activityType: string;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  createdAt: Date;
}

/**
 * Creates a batch of mock analytics with specific authenticated/anonymous split
 */
export const createMockAnalyticsBatch = (
  authenticatedCount: number,
  anonymousCount: number
): MockAnalyticsRecord[] => {
  const records: MockAnalyticsRecord[] = [];

  // Create authenticated records
  for (let i = 0; i < authenticatedCount; i++) {
    records.push(createMockAnalyticsRecord({
      userId: `user-${i}`,
      sessionId: null, // Authenticated users don't need sessionId
    }));
  }

  // Create anonymous records
  for (let i = 0; i < anonymousCount; i++) {
    records.push(createMockAnalyticsRecord({
      userId: null,
      sessionId: `session-${i}`,
    }));
  }

  return records;
};

// ============= UTILITY FUNCTIONS =============

/**
 * Configures mock query builder to return specific count/data
 */
export const configureMockQueryBuilderCounts = (
  queryBuilder: ReturnType<typeof createMockQueryBuilder>,
  counts: { authenticated?: number; anonymous?: number; total?: number }
) => {
  const getCountMock = queryBuilder.getCount as jest.Mock;

  // Reset and configure
  getCountMock.mockReset();

  if (counts.authenticated !== undefined) {
    getCountMock.mockResolvedValueOnce(counts.authenticated);
  }
  if (counts.anonymous !== undefined) {
    getCountMock.mockResolvedValueOnce(counts.anonymous);
  }
  if (counts.total !== undefined) {
    getCountMock.mockResolvedValueOnce(counts.total);
  }
};

/**
 * Configures mock to return raw aggregation results
 */
export const configureMockQueryBuilderRaw = (
  queryBuilder: ReturnType<typeof createMockQueryBuilder>,
  results: Array<Record<string, unknown>>
) => {
  const getRawOneMock = queryBuilder.getRawOne as jest.Mock;
  getRawOneMock.mockReset();

  results.forEach((result) => {
    getRawOneMock.mockResolvedValueOnce(result);
  });
};
