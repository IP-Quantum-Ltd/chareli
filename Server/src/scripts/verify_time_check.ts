
import { calculateLikeCount } from '../utils/gameUtils';
import { Game } from '../entities/Games';

// Mock Game object
const mockGame = {
  id: 'test-game-id',
  baseLikeCount: 100,
  lastLikeIncrement: new Date('2025-01-01T00:00:00Z'), // Fixed past date
} as Game;

console.log('--- Verifying calculateLikeCount ---');

// Test 1: Normal Operation (Current Time > 2025)
const resultNormal = calculateLikeCount(mockGame, 0);
console.log(`[Normal] Base: 100, LastIncrement: 2025-01-01. Result: ${resultNormal}`);

if (resultNormal > 100) {
  console.log('✅ Normal calculation works (result > 100)');
} else {
  console.error('❌ Normal calculation failed (expected > 100)');
}

// Test 2: Time Travel (Simulate 1970)
// We need to mock Date.prototype.getFullYear or similar, but gameUtils creates 'new Date()'.
// We can temporarily override the global Date constructor or just rely on manual verification if we can't easily mock.
// Actually, since we modified gameUtils to check `new Date().getFullYear()`, we can verify it by mocking Date.

const originalDate = global.Date;
const fixedDate1970 = new Date('1970-01-01T00:00:00Z');

// Mock Date to return 1970
class MockDate extends Date {
  constructor() {
    super();
    return fixedDate1970;
  }
  static now() {
    return fixedDate1970.getTime();
  }
}

// @ts-ignore
global.Date = MockDate;

try {
  console.log('\n[Simulated 1970] Testing guard clause...');
  const result1970 = calculateLikeCount(mockGame, 50); // Add 50 mock user likes
  console.log(`[1970] Base: 100, UserLikes: 50. Result: ${result1970}`);

  if (result1970 === 150) {
     console.log('✅ Guard clause worked! Returned (Base + UserLikes) without auto-increment.');
  } else {
     console.error(`❌ Guard clause failed. Expected 150, got ${result1970}`);
  }
} catch (e) {
  console.error(e);
} finally {
  // Restore Date
  global.Date = originalDate;
}
