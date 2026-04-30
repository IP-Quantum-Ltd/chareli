import { useNavigate } from 'react-router-dom';
import { useRecordGameClick } from '../backend/games.service';
import { trackEvent } from '../utils/analytics';
import { gameplayPath } from '../utils/gameUrl';

interface UseGameClickHandlerOptions {
  onSuccess?: () => void;
  onError?: (error: any) => void;
  trackingEnabled?: boolean;
}

export const useGameClickHandler = (
  options: UseGameClickHandlerOptions = {}
) => {
  const navigate = useNavigate();
  const recordGameClick = useRecordGameClick();
  const { onSuccess, onError, trackingEnabled = true } = options;

  const handleGameClick = async (
    gameId: string,
    gameSlug?: string,
    categorySlug?: string
  ) => {
    // Navigate immediately to avoid blocking gameplay.
    navigate(
      gameplayPath({
        id: gameId,
        slug: gameSlug,
        category: categorySlug ? { slug: categorySlug } : undefined,
      })
    );

    // Track click asynchronously using sendBeacon for reliability during navigation
   if (trackingEnabled) {
      try {
        const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';
        const url = `${baseURL}/api/game-position-history/${gameId}/click`;

        // Use regular fetch in development (sendBeacon has CORS issues on localhost)
        const isDevelopment = baseURL.includes('localhost') || baseURL.includes('127.0.0.1');

        if (isDevelopment) {
          // Use regular fetch for development
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          })
            .then(() => onSuccess?.())
            .catch((error) => {
              console.warn('Failed to track game click:', error);
              onError?.(error);
            });
        } else {
          // Use sendBeacon for production (works during page unload)
          const data = new Blob([JSON.stringify({})], {
            type: 'application/json',
          });

          const sent = navigator.sendBeacon(url, data);

          if (sent) {
            onSuccess?.();
          } else {
            // Fallback to regular fetch if sendBeacon fails
            recordGameClick.mutateAsync(gameId).catch((error) => {
              console.warn('Failed to track game click:', error);
              onError?.(error);
            });
          }
        }

        // Track in Google Analytics via Zaraz. Routed through trackEvent so the
        // shouldLoadAnalytics gate is honored (the previous direct zaraz.track
        // call only checked Zaraz presence, not the env-loading flag).
        trackEvent('game_click', {
          game_id: gameId,
          game_slug: gameSlug || gameId,
          source: window.location.pathname,
        });
      } catch (error) {
        console.warn('Failed to track game click:', error);
        onError?.(error);
      }
    }
  };

  return {
    handleGameClick,
    isTracking: recordGameClick.isPending,
    trackingError: recordGameClick.error,
  };
};
