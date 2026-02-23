export const CONFIG = {
  BASE_URL: __ENV.BASE_URL || 'http://localhost:5000',
  AUTH: {
    IDENTIFIER: __ENV.TEST_IDENTIFIER || 'admin@example.com',
    PASSWORD: __ENV.TEST_PASSWORD || 'Admin123!',
  },
  THRESHOLDS: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],    // Error rate should be less than 1%
  },
};

export const SLEEP_DURATION = 1;
