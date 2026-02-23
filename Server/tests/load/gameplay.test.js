import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, SLEEP_DURATION } from './config.js';

export const options = {
  stages: [
    { duration: '30s', target: 30 }, // Simulation of 30 concurrent players
    { duration: '2m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: CONFIG.THRESHOLDS,
};

export default function () {
  // 1. User arrives and sees game list
  const listRes = http.get(`${CONFIG.BASE_URL}/api/games?limit=10`);
  check(listRes, { 'list status 200': (r) => r.status === 200 });

  if (listRes.status === 200 && listRes.json().data.length > 0) {
    const game = listRes.json().data[0];
    const gameId = game.id;

    // 2. User clicks "Play"
    const clickRes = http.post(`${CONFIG.BASE_URL}/api/game-position-history/${gameId}/click`);
    check(clickRes, { 'click recorded': (r) => r.status === 200 || r.status === 201 || r.status === 202 });

    // 3. Game loads - Fetch details
    const detailRes = http.get(`${CONFIG.BASE_URL}/api/games/${gameId}`);
    check(detailRes, { 'details fetched': (r) => r.status === 200 });

    const analyticsRes = http.post(`${CONFIG.BASE_URL}/api/analytics`, JSON.stringify({
      activityType: 'game_start',
      gameId: gameId,
      startTime: new Date().toISOString(),
      sessionId: `play-test-${Date.now()}-${__VU}`,
    }), { headers: { 'Content-Type': 'application/json' } });

    if (analyticsRes.status === 201 || analyticsRes.status === 200) {
      const analyticsId = analyticsRes.json().data?.id;

      // 5. Active gameplay - heartbeats
      if (analyticsId) {
        for (let i = 0; i < 3; i++) {
          const hbRes = http.post(`${CONFIG.BASE_URL}/api/analytics/${analyticsId}/heartbeat`);
          check(hbRes, { 'heartbeat 200': (r) => r.status === 200 || r.status === 204 });
          sleep(5); // Simulate 5 seconds of play between heartbeats
        }
      }
    }
  }

  sleep(SLEEP_DURATION);
}
