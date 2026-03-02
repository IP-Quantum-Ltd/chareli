const SESSION_ID_KEY = 'visitor_session_id';

/**
 * Get existing session ID or create a new one
 */
export const getOrCreateSessionId = (): string => {
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
};

/**
 * Clear the session ID (call on login)
 */
export const clearSessionId = (): void => {
  sessionStorage.removeItem(SESSION_ID_KEY);
};

/**
 * Get session ID without creating one
 */
export const getSessionId = (): string | null => {
  return sessionStorage.getItem(SESSION_ID_KEY);
};
