import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, SLEEP_DURATION } from './config.js';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Simulate 100 concurrent active sessions
    { duration: '3m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: CONFIG.THRESHOLDS,
};

// Helper to create a session if one isn't provided
export function createSession() {
  const url = `${CONFIG.BASE_URL}/api/analytics`;
  const payload = JSON.stringify({
    activityType: 'session_start',
    startTime: new Date().toISOString(),
    sessionId: `load-test-${Date.now()}-${Math.random()}`,
  });
  const res = http.post(url, payload, { headers: { 'Content-Type': 'application/json' } });

  if (res.status !== 201 && res.status !== 200) {
    return null;
  }
  return res.json().data?.id;
}

// Setup: Used when running this script STANDALONE
export function setup() {
  return { id: createSession() };
}

export default function (data) {
  // Use session ID from setup() [standalone] or create one on the fly [suite]
  const id = data && data.id ? data.id : createSession();
  if (!id) return;

  const heartbeatUrl = `${CONFIG.BASE_URL}/api/analytics/${id}/heartbeat`;
  const res = http.post(heartbeatUrl);

  check(res, {
    'heartbeat status is 200': (r) => r.status === 200 || r.status === 204,
  });

  sleep(5);
}
