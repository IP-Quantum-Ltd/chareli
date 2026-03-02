import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LuExpand, LuX, LuChevronLeft } from 'react-icons/lu';
import KeepPlayingModal from '../../components/modals/KeepPlayingModal';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useGameById } from '../../backend/games.service';
import {
  useCreateAnalytics,
  useUpdateAnalytics,
} from '../../backend/analytics.service';
import GameLoadingScreen from '../../components/single/GameLoadingScreen';
import { useIsMobile } from '../../hooks/useIsMobile';
import { trackGameplay } from '../../utils/analytics';
import { useSystemConfigByKey } from '../../backend/configuration.service';
import { useLikeGame, useUnlikeGame } from '../../backend/gameLikes.service';
import { getOrCreateSessionId } from '../../utils/sessionUtils';
import { GameBreadcrumb } from '../../components/single/GameBreadcrumb';
import { GameSchemaLD } from '../../components/single/GameSchemaLD';
import { GameInfoSection } from '../../components/single/GameInfoSection';
import { RecommendedGamesGrid } from '../../components/single/RecommendedGamesGrid';
import { usePermissions } from '../../hooks/usePermissions';

export default function GamePlay() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data: game, isLoading, error } = useGameById(gameId || '');
  const { mutate: createAnalytics } = useCreateAnalytics();
  const { mutate: updateAnalytics } = useUpdateAnalytics();
  const analyticsIdRef = useRef<string | null>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameStartTimeRef = useRef<Date | null>(null);
  const gameLoadStartTimeRef = useRef<Date | null>(null);
  const updateEndTimeRef = useRef<((reason?: string) => Promise<void>) | null>(
    null,
  );

  // Milestone tracking ref for triggered milestones
  const triggeredMilestonesRef = useRef<Set<number>>(new Set());

  const handleOpenSignUpModal = () => {
    setIsModalOpen(true);
  };

  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [isGameLoading, setIsGameLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const { isAuthenticated } = useAuth();
  const { hasAdminAccess } = usePermissions();
  const { data: freeTimeConfig } = useSystemConfigByKey(
    'bulk_free_time_settings',
  );
  const { mutate: likeGame, isPending: isLiking } = useLikeGame();
  const { mutate: unlikeGame, isPending: isUnliking } = useUnlikeGame();
  const [hasLiked, setHasLiked] = useState(game?.hasLiked ?? false);
  const [likeCount, setLikeCount] = useState(game?.likeCount ?? 100);
  const [isAnimating, setIsAnimating] = useState(false);

  // Load guest like state from localStorage
  useEffect(() => {
    if (!isAuthenticated && gameId) {
      const guestLikes = JSON.parse(localStorage.getItem('guestLikes') || '{}');
      if (guestLikes[gameId]) {
        setHasLiked(true);
      }
    }
  }, [gameId, isAuthenticated]);

  // Sync hasLiked state with game data for authenticated users
  useEffect(() => {
    if (isAuthenticated && game?.hasLiked !== undefined) {
      setHasLiked(game.hasLiked);
      setLikeCount(game.likeCount);
    } else if (!isAuthenticated && game?.likeCount !== undefined) {
      setLikeCount(game.likeCount);
    }
  }, [game?.hasLiked, game?.likeCount, isAuthenticated]);

  // Handle like button click
  const handleLikeClick = () => {
    if (!gameId) return;

    // Trigger animation
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 400);

    if (isAuthenticated) {
      // Authenticated user - use API
      if (hasLiked) {
        setHasLiked(false);
        setLikeCount(likeCount - 1);
        unlikeGame(gameId, {
          onError: () => {
            setHasLiked(true);
            setLikeCount(likeCount + 1);
          },
        });
      } else {
        setHasLiked(true);
        setLikeCount(likeCount + 1);
        likeGame(gameId, {
          onError: () => {
            setHasLiked(false);
            setLikeCount(likeCount - 1);
          },
        });
      }
    } else {
      // Guest user - use localStorage
      const guestLikes = JSON.parse(localStorage.getItem('guestLikes') || '{}');

      if (hasLiked) {
        // Unlike
        delete guestLikes[gameId];
        localStorage.setItem('guestLikes', JSON.stringify(guestLikes));
        setHasLiked(false);
        setLikeCount(likeCount - 1);
      } else {
        // Like
        guestLikes[gameId] = true;
        localStorage.setItem('guestLikes', JSON.stringify(guestLikes));
        setHasLiked(true);
        setLikeCount(likeCount + 1);
      }
    }
  };

  // Auto-expand to fullscreen on mobile devices
  // Auto-expand to fullscreen on mobile devices - DISABLED to show SEO content
  // useEffect(() => {
  //   if (isMobile) {
  //     setExpanded(true);
  //   }
  // }, [isMobile]);

  // Prevent body scroll on mobile fullscreen to fix viewport issues
  // Prevent body scroll on mobile fullscreen to fix viewport issues
  useEffect(() => {
    if (isMobile && expanded) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [isMobile, expanded]);

  // Reset loading states when gameId changes (for similar games navigation)
  useEffect(() => {
    setIsGameLoading(true);
    setLoadProgress(0);
    setTimeRemaining(null);
    gameLoadStartTimeRef.current = new Date();

    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, [gameId]);

  // Scroll management: Keep users at the top (main game area) when they arrive
  useEffect(() => {
    // Scroll to top when component mounts or gameId changes
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Also ensure the game container is visible
    if (gameContainerRef.current) {
      gameContainerRef.current.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      });
    }
  }, [gameId]);

  // Prevent auto-scroll when page loads
  useEffect(() => {
    // Override any potential scroll restoration
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    // Force scroll to top on initial load
    window.scrollTo(0, 0);

    return () => {
      // Restore scroll restoration when component unmounts
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'auto';
      }
    };
  }, []);

  useEffect(() => {
    if (game?.gameFile?.s3Key) {
      const timer = setTimeout(() => {
        setIsGameLoading(false);
        setLoadProgress(100);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [game]);

  // Timer for non-authenticated users - starts after game is loaded
  useEffect(() => {
    let timer: NodeJS.Timeout;

    // Check if free time is disabled for guests
    const isFreeTimeDisabled =
      freeTimeConfig?.value?.disableFreeTimeForGuests === true;

    // Only start timer if:
    // 1. Game exists
    // 2. User is not authenticated
    // 3. Game has free time configured (game.config > 0)
    // 4. Game is loaded
    // 5. Free time is NOT disabled for guests
    if (
      game &&
      !isAuthenticated &&
      game.config > 0 &&
      !isGameLoading &&
      !isFreeTimeDisabled
    ) {
      setIsModalOpen(false);
      setTimeRemaining(game.config * 60);

      timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev === null || prev <= 0) {
            clearInterval(timer);
            setIsModalOpen(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
        setIsModalOpen(false);
      }
    };
  }, [game, isAuthenticated, isGameLoading, freeTimeConfig]);

  // Create analytics record when game starts
  useEffect(() => {
    if (game && !hasAdminAccess) {
      const startTime = new Date();
      gameStartTimeRef.current = startTime;

      createAnalytics(
        {
          gameId: game.id,
          activityType: 'game_session',
          startTime: new Date(),
          ...(!isAuthenticated && { sessionId: getOrCreateSessionId() }),
        },
        {
          onSuccess: (response) => {
            analyticsIdRef.current = response.id;
          },
        },
      );

      // Track game start in Google Analytics
      trackGameplay.gameStart(game.id, game.title);

      // Reset milestones for new game session
      triggeredMilestonesRef.current.clear();
    }
  }, [game, createAnalytics, hasAdminAccess, isAuthenticated]);

  // Track play duration milestones (30s, 1m, 5m, 10m)
  useEffect(() => {
    if (!game || isGameLoading || hasAdminAccess) return;

    // Milestone thresholds in seconds
    const MILESTONES = [30, 60, 300, 600];

    const interval = setInterval(() => {
      if (!gameStartTimeRef.current) return;

      const elapsedSeconds = Math.floor(
        (Date.now() - gameStartTimeRef.current.getTime()) / 1000,
      );

      MILESTONES.forEach((milestone: number) => {
        if (
          elapsedSeconds >= milestone &&
          !triggeredMilestonesRef.current.has(milestone)
        ) {
          triggeredMilestonesRef.current.add(milestone);

          // Format milestone label for readability
          const label = milestone < 60 ? `${milestone}s` : `${milestone / 60}m`;

          trackGameplay.gameMilestone(game.id, game.title, label, milestone);

          // Update backend analytics with milestone
           if (analyticsIdRef.current) {
             updateAnalytics({
               id: analyticsIdRef.current,
               milestone: label,
             });
           }
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [game, isGameLoading, hasAdminAccess, updateAnalytics]);

  // Heartbeat tracking (every 15s)
  useEffect(() => {
    if (!game || isGameLoading || hasAdminAccess) return;

    const interval = setInterval(() => {
       if (analyticsIdRef.current) {
          // Use fetch directly to avoid re-renders or hook complexity for simple ping
          const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';
          fetch(`${baseURL}/api/analytics/${analyticsIdRef.current}/heartbeat`, {
             method: 'POST',
             keepalive: true,
             headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}` // If needed, but route is optionalAuthenticate
             }
          }).catch(err => console.error("Heartbeat failed", err));
       }
    }, 15000);

    return () => clearInterval(interval);
  }, [game, isGameLoading, hasAdminAccess]);

  const location = useLocation();


  // Function to update end time
  const updateEndTime = useCallback(
    async (reason?: string) => {
      if (!analyticsIdRef.current) return;

      try {
        const endTime = new Date();
        const startTime = gameStartTimeRef.current;

        // Calculate duration for Google Analytics
        let durationSeconds = 0;
        if (startTime) {
          durationSeconds = Math.floor(
            (endTime.getTime() - startTime.getTime()) / 1000,
          );
        }

        await updateAnalytics({
          id: analyticsIdRef.current,
          endTime,
          exitReason: reason,
        });

        // Track game end in Google Analytics
        if (game) {
          trackGameplay.gameEnd(game.id, game.title, durationSeconds);

          // If user exited early, track that too
          if (reason) {
            trackGameplay.gameExit(
              game.id,
              game.title,
              durationSeconds,
              reason,
            );
          }
        }

        // Clear ID after successful update to prevent duplicate updates
        analyticsIdRef.current = null;
        gameStartTimeRef.current = null;
      } catch (error) {
        console.error('Failed to update analytics:', error);
        // Clear ID even on error to prevent duplicate attempts
        analyticsIdRef.current = null;
        gameStartTimeRef.current = null;
      }
    },
    [game, updateAnalytics],
  );

  // Store latest updateEndTime in ref to avoid dependency issues
  updateEndTimeRef.current = updateEndTime;

  // Handle route changes
  useEffect(() => {
    if (analyticsIdRef.current && updateEndTimeRef.current) {
      updateEndTimeRef.current('route_change');
    }
  }, [location]);

  // Handle tab visibility and cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.hidden &&
        analyticsIdRef.current &&
        updateEndTimeRef.current
      ) {
        updateEndTimeRef.current('tab_hidden');
      }
    };

    const handleBeforeUnload = () => {
      if (analyticsIdRef.current && game) {
        const endTime = new Date();
        const startTime = gameStartTimeRef.current;
        let durationSeconds = 0;

        if (startTime) {
          durationSeconds = Math.floor(
            (endTime.getTime() - startTime.getTime()) / 1000,
          );
        }

        // Track game exit event via Zaraz (using trackGameplay utility)
        if ((window as any).shouldLoadAnalytics) {
          try {
            trackGameplay.gameExit(
              game.id,
              game.title,
              durationSeconds,
              'page_unload',
            );
          } catch (error) {
            console.error('Failed to send analytics event:', error);
          }
        }

        const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';
        const url = `${baseURL}/api/analytics/${analyticsIdRef.current}/end`;
        const data = new Blob([JSON.stringify({ endTime, exitReason: 'page_unload' })], {
          type: 'application/json',
        });
        navigator.sendBeacon(url, data);
        analyticsIdRef.current = null;
        gameStartTimeRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (analyticsIdRef.current && updateEndTimeRef.current) {
        updateEndTimeRef.current('component_unmount');
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      const iframe = document.querySelector<HTMLIFrameElement>('#gameIframe');
      if (iframe) {
        iframe.src = 'about:blank';
      }
    };
  }, [game]);

  // Handle game loading progress
  const handleLoadProgress = (progress: number) => {
    setLoadProgress(progress);
  };

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center h-[80vh]">
          <span className="text-xl">Loading game...</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-[80vh]">
          <span className="text-xl text-red-500">
            {error instanceof Error ? error.message : 'Error loading game'}
          </span>
        </div>
      ) : game?.gameFile?.s3Key ? (
        <>
          <div
            ref={gameContainerRef}
            className={expanded ? 'fixed inset-0 z-40 bg-black' : 'relative'}
            style={
              !expanded
                ? {
                    height: 'calc(100vh - 64px)',
                    padding: '16px',
                  }
                : undefined
            }
          >
            <div
              className={`relative ${
                expanded
                  ? 'h-full w-full flex flex-col'
                  : 'w-full h-full flex flex-col'
              } overflow-hidden`}
              style={
                !expanded
                  ? {
                      border: '2px solid #fb923c',
                      borderRadius: '32px',
                    }
                  : undefined
              }
            >
              {/* Back button - always shown, visible above modal */}
              <button
                onClick={() => {
                  if (analyticsIdRef.current && updateEndTimeRef.current) {
                    updateEndTimeRef.current('back_button');
                  }
                  navigate(-1);
                }}
                className={`absolute top-4 left-4 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-3 py-2 shadow-lg hover:bg-white transition-all ${
                  isModalOpen ? 'z-[80]' : 'z-50'
                }`}
                style={{ minHeight: '44px', minWidth: '60px' }}
                title="Go Back"
              >
                <div className="bg-orange-600 rounded-full p-1.5">
                  <LuChevronLeft
                    className="w-5 h-5 text-white"
                    strokeWidth={3}
                  />
                </div>
              </button>
              {isGameLoading && (
                <GameLoadingScreen
                  game={game}
                  onProgress={handleLoadProgress}
                  progress={loadProgress}
                />
              )}
              {!isModalOpen ? (
                <iframe
                  src={`${game.gameFile.s3Key}`}
                  className="w-full flex-1"
                  style={{
                    display: 'block',
                    // background: "transparent",
                    border: 'none',
                    overflow: 'hidden',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title={game.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  onLoad={() => {
                    setLoadProgress(100);

                    // Track game loaded event
                    if (game && gameLoadStartTimeRef.current) {
                      const loadTime =
                        new Date().getTime() -
                        gameLoadStartTimeRef.current.getTime();
                      trackGameplay.gameLoaded(game.id, game.title, loadTime);

                      // Update backend with load time
                      if (analyticsIdRef.current) {
                         updateAnalytics({
                            id: analyticsIdRef.current,
                            loadTime
                         });
                      }
                    }
                  }}
                />
              ) : (
                <div className="w-full bg-gray-900 flex-1" />
              )}

              {/* Beautiful game platform overlay when time is up */}
              {isModalOpen && (
                <div
                  className="absolute inset-0 z-50 bg-gradient-to-br from-orange-900 via-orange-800 to-orange-900"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseUp={(e) => e.preventDefault()}
                  onMouseMove={(e) => e.preventDefault()}
                  onClick={(e) => e.preventDefault()}
                  onKeyDown={(e) => e.preventDefault()}
                  onKeyUp={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onTouchMove={(e) => e.preventDefault()}
                  onTouchEnd={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  tabIndex={-1}
                />
              )}
              <KeepPlayingModal
                open={isModalOpen}
                openSignUpModal={handleOpenSignUpModal}
                isGameLoading={isGameLoading}
              />
              {/* Control bar - always shown, styling changes based on expanded state */}
              <div
                className={`flex items-center justify-between px-6 py-2 bg-[#7C2D12] border-t border-orange-400 z-50 ${
                  !expanded ? 'rounded-b-2xl' : ''
                }`}
                style={
                  expanded
                    ? {
                        paddingBottom:
                          'max(0.5rem, env(safe-area-inset-bottom))',
                        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
                        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
                      }
                    : undefined
                }
              >
                <h2 className="text-white text-sm font-semibold m-0 font-worksans">
                  {game.title}
                </h2>
                <div className="flex items-center space-x-4">
                  {/* Like counter with thumbs up */}
                  <button
                    onClick={handleLikeClick}
                    disabled={isLiking || isUnliking}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer bg-white/10 border-white/20 hover:bg-white/20`}
                    // hasLiked
                    //   ? "bg-blue-500/30 border-blue-400/50 hover:bg-blue-500/40"
                    title={
                      isAuthenticated
                        ? hasLiked
                          ? 'Unlike'
                          : 'Like'
                        : 'Sign in to like'
                    }
                  >
                    <span
                      role="img"
                      aria-label="thumbs up"
                      className={`text-lg ${
                        isAnimating ? 'animate-scale-bounce' : ''
                      }`}
                      style={
                        !isAnimating
                          ? {
                              transform: hasLiked ? 'scale(1.1)' : 'scale(1)',
                              transition: 'transform 2s ease-in-out',
                            }
                          : undefined
                      }
                    >
                      👍
                    </span>
                    <span className="text-white text-sm font-medium font-worksans">
                      {likeCount.toLocaleString()}
                    </span>
                  </button>
                  <div className="flex items-center space-x-3">
                    {/* Timer display for unauthenticated users */}
                    {!isAuthenticated &&
                      timeRemaining !== null &&
                      timeRemaining > 0 && (
                        <div className="flex items-center space-x-2 bg-orange-600/20 px-3 py-1 rounded-full border border-orange-400/30">
                          <span className="text-xs text-orange-300">⏱️</span>
                          <span className="text-white text-sm font-medium">
                            {Math.floor(timeRemaining / 60)}:
                            {(timeRemaining % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      )}
                    {/* Hide expand button on mobile since it's auto-fullscreen */}
                    {!isMobile && (
                      <button
                        className="text-white hover:text-orange-400 transition-colors"
                        onClick={() => setExpanded((e) => !e)}
                        title={expanded ? 'Exit Fullscreen' : 'Expand'}
                      >
                        <LuExpand className="w-5 h-5" />
                      </button>
                    )}
                    <button
                      className="text-white hover:text-orange-400 transition-colors"
                      onClick={() => {
                        if (
                          analyticsIdRef.current &&
                          updateEndTimeRef.current
                        ) {
                          updateEndTimeRef.current('close_button');
                        }
                        if (expanded) {
                          navigate(-1);
                        } else {
                          navigate('/');
                        }
                      }}
                      title="Close Game"
                    >
                      <LuX className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SEO Content Section - Only visible when not in fullscreen */}
          {!expanded && game && (
            <div
              className="bg-white dark:bg-[#0F1221]"
              style={{
                maxWidth: '1408px',
                margin: '0 auto',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
                gap: '32px',
              }}
            >
              {/* Schema.org JSON-LD for SEO */}
              <GameSchemaLD game={game} likeCount={likeCount} />

              {/* Breadcrumb Navigation */}
              <div>
                <GameBreadcrumb
                  categoryName={game.category?.name}
                  categoryId={game.category?.id}
                  gameTitle={game.title}
                />
              </div>

              {/* Game Information Section */}
              <GameInfoSection game={game} likeCount={likeCount} />

              {/* Recommended Games Grid */}
              {game.recommendedGames && game.recommendedGames.length > 0 && (
                <RecommendedGamesGrid games={game.recommendedGames} />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-[80vh]">
          <span className="text-xl">
            Game not found or no game file available
          </span>
        </div>
      )}
    </div>
  );
}
