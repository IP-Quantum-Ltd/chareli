import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, SLEEP_DURATION } from './config.js';

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp up to 50 users (discovery is high traffic)
    { duration: '2m', target: 50 },  // Stay at 50 users
    { duration: '30s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: CONFIG.THRESHOLDS,
};

export default function () {
  const baseUrl = `${CONFIG.BASE_URL}/api/games`;

  // 1. Get all games (paginated)
  const listRes = http.get(`${baseUrl}?limit=20&page=1`);
  check(listRes, {
    'list games status is 200': (r) => r.status === 200,
    'list has data': (r) => r.json().data !== undefined,
  });

  if (listRes.status === 200 && listRes.json().data?.length > 0) {
    const games = listRes.json().data;
    const randomGame = games[Math.floor(Math.random() * games.length)];

    // 2. Fetch a specific game by ID
    const detailRes = http.get(`${baseUrl}/${randomGame.id}`);
    check(detailRes, {
      'game detail status is 200': (r) => r.status === 200,
      'game id matches': (r) => r.json().data?.id === randomGame.id,
    });
  }

  // 3. Search for a game (simulating user typing)
  const searchRes = http.get(`${baseUrl}?search=test&limit=10`);
  check(searchRes, {
    'search status is 200': (r) => r.status === 200,
  });

  sleep(SLEEP_DURATION);
}
