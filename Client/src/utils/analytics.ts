/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cloudflare Zaraz Analytics utility functions for tracking gameplay events
 */

/**
 * Check if analytics is enabled and Zaraz is available
 */
export const isAnalyticsEnabled = (): boolean => {
  return (
    typeof window !== "undefined" &&
    (window as any).shouldLoadAnalytics === true &&
    typeof (window as any).zaraz !== "undefined"
  );
};

/**
 * Track a custom event to Google Analytics via Cloudflare Zaraz
 */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, any>
): void => {
  if (!isAnalyticsEnabled()) {
    return;
  }

  try {
    (window as any).zaraz.track(eventName, {
      ...eventParams,
    });
  } catch (error) {
    console.error("Failed to track analytics event:", error);
  }
};

/**
 * Track gameplay-specific events
 */
export const trackGameplay = {
  /**
   * Track when a game session starts
   */
  gameStart: (gameId: string, gameTitle: string) => {
    trackEvent("game_start", {
      game_id: gameId,
      game_title: gameTitle,
      event_category: "Gameplay",
      event_label: gameTitle,
    });
  },

  /**
   * Track when a game session ends
   */
  gameEnd: (gameId: string, gameTitle: string, durationSeconds: number) => {
    trackEvent("game_end", {
      game_id: gameId,
      game_title: gameTitle,
      duration: durationSeconds,
      event_category: "Gameplay",
      event_label: gameTitle,
    });
  },

  /**
   * Track game session duration milestones
   */
  gameMilestone: (
    gameId: string,
    gameTitle: string,
    milestone: string,
    durationSeconds: number
  ) => {
    trackEvent("game_milestone", {
      game_id: gameId,
      game_title: gameTitle,
      milestone,
      duration: durationSeconds,
      event_category: "Gameplay",
      event_label: `${gameTitle} - ${milestone}`,
    });
  },

  /**
   * Track when a game is loaded
   */
  gameLoaded: (gameId: string, gameTitle: string, loadTimeMs: number) => {
    trackEvent("game_loaded", {
      game_id: gameId,
      game_title: gameTitle,
      load_time: loadTimeMs,
      event_category: "Gameplay",
      event_label: gameTitle,
    });
  },

  /**
   * Track when user exits game early
   */
  gameExit: (
    gameId: string,
    gameTitle: string,
    durationSeconds: number,
    reason?: string
  ) => {
    trackEvent("game_exit", {
      game_id: gameId,
      game_title: gameTitle,
      duration: durationSeconds,
      reason: reason || "user_action",
      event_category: "Gameplay",
      event_label: gameTitle,
    });
  },

  /**
   * Track when user shares a game
   */
  gameShare: (
    gameId: string,
    gameTitle: string,
    method: 'web_share' | 'clipboard' | 'whatsapp' | 'facebook'
  ) => {
    trackEvent("game_share", {
      game_id: gameId,
      game_title: gameTitle,
      share_method: method,
      event_category: "Engagement",
      event_label: `${gameTitle} - ${method}`,
    });
  },
};

/**
 * Track user interaction events
 */
export const trackInteraction = {
  /**
   * Track when user clicks "See More Games" button
   */
  seeMoreGames: (currentPage: number, currentCategory: string, totalGamesLoaded: number) => {
    trackEvent("see_more_games", {
      page: currentPage,
      category: currentCategory,
      total_games_loaded: totalGamesLoaded,
      event_category: "Engagement",
      event_label: `Page ${currentPage} - ${currentCategory}`,
    });
  },

  /**
   * Track when user clicks "Back to Top" in All Games section
   */
  backToTop: (currentCategory: string, totalGamesLoaded: number) => {
    trackEvent("back_to_top_all_games", {
      category: currentCategory,
      total_games_loaded: totalGamesLoaded,
      event_category: "Engagement",
      event_label: `Back to Top - ${currentCategory}`,
    });
  },
};
