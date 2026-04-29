module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Only pick up *.test.ts / *.spec.ts. The looser **/__tests__/**/*.ts
  // pattern used to swallow shared fixtures (e.g. mocks/*.mocks.ts) as empty
  // suites.
  testMatch: ['**/__tests__/**/*.(spec|test).ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/migrations/**',
    '!src/entities/**',
    '!src/config/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testTimeout: 15000,
  clearMocks: true,
  restoreMocks: true,
  // Force Jest to exit after tests complete
  forceExit: true,
  // Detect open handles to help identify resource leaks
  detectOpenHandles: true,
  // Maximum number of workers to prevent resource exhaustion
  maxWorkers: 1,
}
