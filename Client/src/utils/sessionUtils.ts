const SESSION_ID_KEY = 'visitor_session_id';

// Fallback for environments where sessionStorage throws on access (Safari private
// mode, locked-down enterprise browsers, sandboxed iframes). Without this fallback,
// every getOrCreateSessionId call would mint a fresh UUID and the analytics worker
// would see each pageview as a new anonymous "visitor", inflating session counts.
let inMemorySessionId: string | null = null;

const safeGet = (): string | null => {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY);
  } catch {
    return inMemorySessionId;
  }
};

const safeSet = (value: string): void => {
  try {
    sessionStorage.setItem(SESSION_ID_KEY, value);
  } catch {
    inMemorySessionId = value;
  }
};

const safeRemove = (): void => {
  try {
    sessionStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // No-op — we'll clear in-memory below regardless.
  }
  inMemorySessionId = null;
};

/**
 * Get existing session ID or create a new one
 */
export const getOrCreateSessionId = (): string => {
  let sessionId = safeGet();
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    safeSet(sessionId);
  }
  return sessionId;
};

/**
 * Clear the session ID (call on login)
 */
export const clearSessionId = (): void => {
  safeRemove();
};

/**
 * Get session ID without creating one
 */
export const getSessionId = (): string | null => {
  return safeGet();
};
