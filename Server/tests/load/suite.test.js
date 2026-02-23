import { sleep } from 'k6';
import authTest from './auth.test.js';
import discoveryTest from './game-discovery.test.js';
import analyticsTest from './analytics.test.js';
import gameplayTest from './gameplay.test.js';

const TOTAL_VUS = (__ENV.VUS ? parseInt(__ENV.VUS) : 100);

export const options = {
  scenarios: {
    // 10% of traffic is authentication
    authentication: {
      executor: 'constant-vus',
      exec: 'auth_scenario',
      vus: Math.max(1, Math.floor(TOTAL_VUS * 0.10)),
      duration: '5m',
    },
    // 50% of traffic is browsing/discovery
    discovery: {
      executor: 'constant-vus',
      exec: 'discovery_scenario',
      vus: Math.max(1, Math.floor(TOTAL_VUS * 0.50)),
      duration: '5m',
    },
    // 10% of traffic is high-frequency analytics
    analytics: {
      executor: 'constant-vus',
      exec: 'analytics_scenario',
      vus: Math.max(1, Math.floor(TOTAL_VUS * 0.10)),
      duration: '5m',
    },
    // 30% of traffic is full gameplay flow
    gameplay: {
      executor: 'constant-vus',
      exec: 'gameplay_scenario',
      vus: Math.max(1, Math.floor(TOTAL_VUS * 0.30)),
      duration: '5m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// Map scenarios to their respective functions
export function auth_scenario() {
  authTest();
}

export function discovery_scenario() {
  discoveryTest();
}

export function analytics_scenario() {
  // analytics.test.js uses setup(), so we need to handle it carefully in unified suites
  // For simplicity in this suite, we call the default function
  analyticsTest();
}

export function gameplay_scenario() {
  gameplayTest();
}

export default function() {
  // Placeholder for k6
}
