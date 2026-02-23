import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, SLEEP_DURATION } from './config.js';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '30s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: CONFIG.THRESHOLDS,
};

export default function () {
  const loginUrl = `${CONFIG.BASE_URL}/api/auth/login`;
  const payload = JSON.stringify({
    identifier: CONFIG.AUTH.IDENTIFIER,
    password: CONFIG.AUTH.PASSWORD,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const loginRes = http.post(loginUrl, payload, params);

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'has access token': (r) => r.json().data?.tokens?.accessToken !== undefined,
  });

  if (loginRes.status === 200 && loginRes.json().data?.tokens?.accessToken) {
    const token = loginRes.json().data.tokens.accessToken;
    const authHeaders = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    const meRes = http.get(`${CONFIG.BASE_URL}/api/auth/me`, authHeaders);
    check(meRes, {
      'me status is 200': (r) => r.status === 200,
      'user email matches': (r) => r.json().data?.email === CONFIG.AUTH.IDENTIFIER,
    });
  }

  sleep(SLEEP_DURATION);
}
