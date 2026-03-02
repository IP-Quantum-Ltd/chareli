import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { LazyImage } from '../../components/ui/LazyImage';
import { useGames } from '../../backend/games.service';
import { useCategories } from '../../backend/category.service';
import { useGameClickHandler } from '../../hooks/useGameClickHandler';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import GamesSkeleton from './GamesSkeleton';
import './AllGamesSection.css';
import { trackInteraction } from '../../utils/analytics';

import emptyGameImg from '../../assets/empty-game.png';

interface AllGamesSectionProps {
  searchQuery: string;
}

const GAMES_PER_PAGE = 40;

const AllGamesSection = ({ searchQuery }: AllGamesSectionProps) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>(
    'mobile'
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const gridTopRef = useRef<HTMLDivElement | null>(null);
  const savedScrollPosition = useRef<number>(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [accumulatedGames, setAccumulatedGames] = useState<any[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Refs to track loading state for IntersectionObserver
  const isLoadingMoreRef = useRef(false);
  const isFetchingRef = useRef(false);

  // Track which category the accumulatedGames belong to, to avoid cross-category leaks
  const accumulatedCategoryRef = useRef<string>('all');

  // Flag to control scroll restoration
  const [shouldRestoreScroll, setShouldRestoreScroll] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories();

  const shouldUsePagination = selectedCategory !== 'recent';

  const {
    data: gamesData,
    isLoading: gamesLoading,
    error: gamesError,
    isFetching,
  } = useGames({
    categoryId:
      selectedCategory === 'all'
        ? undefined
        : selectedCategory === 'recent'
        ? undefined
        : selectedCategory,
    filter: 'recently_added',
    status: 'active',
    search: searchQuery || undefined,
    ...(shouldUsePagination && {
      page: currentPage,
      limit: GAMES_PER_PAGE,
    }),
  });

  // Derived games list
  // Simplified: If we have accumulated games, use them. Otherwise fallback to current data.
  const games: any = useMemo(() => {
    if (!shouldUsePagination) return gamesData?.data || [];
    if (accumulatedGames.length > 0) return accumulatedGames;
    return gamesData?.data || [];
  }, [shouldUsePagination, accumulatedGames, gamesData]);

  // Calculate if there are more games to load
  const totalGames = gamesData?.total || 0;
  const hasMoreGames = shouldUsePagination && totalGames > 0 && games.length < totalGames;

  const allCategories = useMemo(
    () => [
      { id: 'all', name: 'All Games', color: '#64748A' },
      ...(categoriesData?.map((cat) => ({
        id: cat.id,
        name: cat.name,
        color: '#94A3B7',
      })) || []),
      { id: 'recent', name: 'Recently Added', color: '#94A3B7' },
    ],
    [categoriesData]
  );

  const sectionHeader = useMemo(() => {
    const category = allCategories.find((cat) => cat.id === selectedCategory);
    return category?.name || 'All Games';
  }, [selectedCategory, allCategories]);

  // 1. Reset Effect: Handles Category/Search changes
  useEffect(() => {
    // Update ref so accumulation effect can ignore stale responses
    accumulatedCategoryRef.current = selectedCategory;

    setCurrentPage(1);
    setAccumulatedGames([]); // Clear data immediately to prevent ID conflicts
    setIsLoadingMore(false);
    setShouldRestoreScroll(true); // Enable scroll restoration for the new category
  }, [selectedCategory, searchQuery]);

  // 2. Accumulation Effect: Handles incoming data
  useEffect(() => {
    // If fetching, wait until finished to ensure data is fresh and consistent
    if (isFetching || !gamesData?.data) {
      return;
    }

    // Ignore data that was fetched for a previous category
    if (accumulatedCategoryRef.current !== selectedCategory) {
      return;
    }

    // Always reset loading spinner when data arrives
    setIsLoadingMore(false);

    if (currentPage === 1) {
      // First page: replace all games
      setAccumulatedGames(gamesData.data);
    } else {
      // Subsequent pages: strictly append
      setAccumulatedGames((prev) => {
        // Double-check category still matches before mutating state
        if (accumulatedCategoryRef.current !== selectedCategory) {
          return prev;
        }

        // Safety: If prev is empty but we are on page > 1,
        // it means state was lost; recover by showing current chunk.
        if (prev.length === 0) return gamesData.data;

        const existingIds = new Set(prev.map((g: any) => g.id));
        const newGames = gamesData.data.filter((g: any) => !existingIds.has(g.id));

        if (newGames.length === 0) return prev;
        return [...prev, ...newGames];
      });
    }
  }, [gamesData, currentPage, isFetching, selectedCategory]);

  const handleSeeMoreGames = useCallback(() => {
    // Prevent multiple concurrent loads or loading when no more games
    if (isLoadingMore || isFetching || !hasMoreGames) {
      return;
    }

    const nextPage = currentPage + 1;
    setIsLoadingMore(true);
    trackInteraction.seeMoreGames(nextPage, sectionHeader, games.length);
    setCurrentPage(nextPage);
    setShowBackToTop(true);
  }, [currentPage, sectionHeader, games.length, isLoadingMore, isFetching, hasMoreGames]);

  const { handleGameClick } = useGameClickHandler();

  const handleBackToTop = useCallback(() => {
    const container = gridTopRef.current || containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
      const target = scrollTop + rect.top - 80; // offset for any fixed header
      window.scrollTo({ top: target < 0 ? 0 : target, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    trackInteraction.backToTop(sectionHeader, games.length);
  }, [sectionHeader, games.length]);

  // Monitor scroll position to show/hide back-to-top button
  useEffect(() => {
    // Only enable this behavior after "See more" has been clicked at least once
    if (currentPage === 1) return;

    const handleScroll = () => {
      const container = gridTopRef.current;
      if (!container) {
        // Fallback: show if scrolled down, hide if near top
        const scrolled = window.pageYOffset || document.documentElement.scrollTop;
        setShowBackToTop(scrolled > 300);
        return;
      }

      const rect = container.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const containerTop = scrollTop + rect.top;

      // Show button if scrolled more than 200px past container top, hide if within 200px
      setShowBackToTop(scrollTop >= containerTop + 200);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setScreenSize('mobile');
      } else if (width < 1024) {
        setScreenSize('tablet');
      } else {
        setScreenSize('desktop');
      }
    };
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  // Save scroll position
  useEffect(() => {
    const saveScrollPosition = () => {
      savedScrollPosition.current = window.scrollY;
    };
    if (selectedCategory !== 'all') {
      saveScrollPosition();
    }
  }, [selectedCategory]);

  // Restore scroll position ONLY when switching categories (via flag)
  useEffect(() => {
    if (!shouldRestoreScroll) return;

    if (!gamesLoading && games.length > 0) {
      const timer = setTimeout(() => {
        if (screenSize === 'mobile') {
          if (savedScrollPosition.current > 0) {
            window.scrollTo({
              top: Math.min(
                savedScrollPosition.current,
                document.documentElement.scrollTop
              ),
              behavior: 'instant',
            });
          }
        } else {
          if (savedScrollPosition.current > 0) {
            window.scrollTo({
              top: savedScrollPosition.current,
              behavior: 'smooth',
            });
          }
        }
        setShouldRestoreScroll(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [gamesLoading, games.length, screenSize, shouldRestoreScroll]);

  // Prevent unwanted scroll on mobile
  useEffect(() => {
    if (screenSize === 'mobile') {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
      const preventAutoScroll = (e: Event) => {
        if (!e.isTrusted) {
          e.preventDefault();
          return false;
        }
      };
      window.addEventListener('scroll', preventAutoScroll, { passive: false });
      return () => {
        window.removeEventListener('scroll', preventAutoScroll);
        if ('scrollRestoration' in history) {
          history.scrollRestoration = 'auto';
        }
      };
    }
  }, [screenSize]);

  // Sync refs for Observer
  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    isFetchingRef.current = isFetching;
  }, [isFetching]);

  // Infinite scroll Observer
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        // Trigger if visible AND not loading AND not fetching
        if (entry.isIntersecting && !isLoadingMoreRef.current && !isFetchingRef.current) {
          handleSeeMoreGames();
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleSeeMoreGames]); // Stable dependency

  return (
    <div ref={containerRef} className="p-4">
      <div>
        <h2 className="text-[#6A7282] dark:text-[#FEFEFE] text-3xl mb-4 font-worksans">
          {sectionHeader}
        </h2>
      </div>

      {/* Filtering tabs */}
      <div className="relative mb-8">
        {categoriesLoading ? (
          <div>Loading categories...</div>
        ) : (
          <div className="relative">
            <div
              className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white dark:from-[#0f1221] to-transparent z-10 pointer-events-none opacity-0 transition-opacity duration-300"
              id="left-fade"
            ></div>
            <div
              className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white dark:from-[#0f1221] to-transparent z-10 pointer-events-none opacity-0 transition-opacity duration-300"
              id="right-fade"
            ></div>
            <div
              className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth pb-2"
              onScroll={(e) => {
                const container = e.currentTarget;
                const leftFade = document.getElementById('left-fade');
                const rightFade = document.getElementById('right-fade');
                if (leftFade && rightFade) {
                  leftFade.style.opacity = container.scrollLeft > 10 ? '1' : '0';
                  const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 10;
                  rightFade.style.opacity = isAtEnd ? '0' : '1';
                }
              }}
              ref={(el) => {
                if (el) {
                  setTimeout(() => {
                    const leftFade = document.getElementById('left-fade');
                    const rightFade = document.getElementById('right-fade');
                    if (leftFade && rightFade) {
                      leftFade.style.opacity = el.scrollLeft > 10 ? '1' : '0';
                      const isAtEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 10;
                      rightFade.style.opacity = isAtEnd ? '0' : '1';
                    }
                  }, 100);
                }
              }}
            >
              {allCategories.map((category) => {
                const truncatedName =
                  category.name.length > 18
                    ? `${category.name.substring(0, 18)}...`
                    : category.name;

                return (
                  <Button
                    key={category.id}
                    className={`text-white cursor-pointer min-w-[120px] max-w-[200px] px-4 py-2 relative group flex-shrink-0 ${
                      selectedCategory === category.id
                        ? 'bg-[#64748A]'
                        : 'bg-[#94A3B8]'
                    }`}
                    onClick={() => setSelectedCategory(category.id)}
                    title={category.name.length > 18 ? category.name : undefined}
                  >
                    <h3 className="block truncate text-sm font-medium m-0 font-worksans">
                      {truncatedName}
                    </h3>
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="" ref={gridTopRef}>
        <Card className="border-hidden shadow-none p-0 bg-transparent dark:bg-[#0f1221]">
          {gamesLoading || (isFetching && games.length === 0) ? (
            <GamesSkeleton count={9} showCategories={true} />
          ) : gamesError ? (
            <div className="text-center py-8 text-red-500">
              Error loading games
            </div>
          ) : games.length === 0 && !isFetching ? (
            <div className="text-center py-8 min-h-[60vh] flex flex-col items-center justify-center gap-4 text-[#64748A] text-4xl">
              <img
                src={emptyGameImg}
                alt="No games"
                className="w-80 h-80 object-contain"
              />
              No games found for{' '}
              {selectedCategory === 'all'
                ? 'all categories'
                : selectedCategory === 'recent'
                ? 'recently added'
                : allCategories.find((cat) => cat.id === selectedCategory)
                    ?.name || 'this category'}
            </div>
          ) : (
            <div className="grid gap-6 grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 gap-2 auto-rows-[1fr] sm:auto-rows-[160px] md:auto-rows-[150px] all-games-grid sm:min-h-[500px]">
              {games.map((game: any) => {
                return (
                  <div
                    key={game.id}
                    className="relative group cursor-pointer"
                    onClick={() => handleGameClick(game.id, game.slug)}
                  >
                    <div className="relative h-full overflow-hidden rounded-[20px] transition-all duration-300 ease-in-out group-hover:shadow-[0_0px_20px_#64748A,0_0px_10px_rgba(100,116,138,0.8)] aspect-square sm:aspect-auto">
                      <div className="w-full h-full rounded-[16px] overflow-hidden">
                        <LazyImage
                          src={game.thumbnailFile?.s3Key}
                          alt={game.title}
                          className="w-full h-full object-fill"
                          aspectRatio="1/1"
                          width={400}
                          sizes="(max-width: 640px) 256px, (max-width: 1024px) 400px, 512px"
                          variants={game.thumbnailFile?.variants}
                          dimensions={game.thumbnailFile?.dimensions}
                          enableTransform={!game.thumbnailFile?.variants}
                          loadingClassName="rounded-[16px]"
                          spinnerColor="#64748A"
                          rootMargin="50px"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent group-hover:opacity-100 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100 rounded-[16px]">
                          <h4 className="absolute bottom-2 left-2 md:bottom-3 md:left-4 text-white font-semibold text-xs md:text-base drop-shadow-lg text-shadow-black/55 text-shadow-lg m-0 font-worksans">
                            {game.title}
                          </h4>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* See more button */}
          {!gamesLoading && !gamesError && games.length > 0 && hasMoreGames && (
            <div className="flex justify-center mt-8 mb-4 py-4">
              <Button
                onClick={handleSeeMoreGames}
                disabled={isLoadingMore || isFetching}
                className="see-more-button font-worksans disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingMore || isFetching ? (
                  <div className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-6 w-6"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span className="font-worksans">Loading more games...</span>
                  </div>
                ) : (
                  <span className="font-worksans">See more games</span>
                )}
              </Button>
            </div>
          )}

          {/* Back to top floating button (shown after user has loaded more games) */}
          {showBackToTop && (
            <button
              type="button"
              className="back-to-top-button"
              onClick={handleBackToTop}
              aria-label="Back to top of games"
            >
              <span className="back-to-top-icon">↑</span>
              <span className="back-to-top-label">Back to top</span>
            </button>
          )}
        </Card>
      </div>
    </div>
  );
};

export default AllGamesSection;
