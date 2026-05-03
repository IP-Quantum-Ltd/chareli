/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCategories } from '../../backend/category.service';
import { useGames } from '../../backend/games.service';
import { useGameClickHandler } from '../../hooks/useGameClickHandler';
import { LazyImage } from '../../components/ui/LazyImage';
import GamesSkeleton from '../../components/single/GamesSkeleton';
import {
  CategoriesSidebar,
  type SecondaryFilter,
} from '../../components/single/CategoriesSidebar';
import type { Category } from '../../backend/types';

import emptyGameImg from '../../assets/empty-game.png';

const FILTER_PARAM_TO_SECONDARY: Record<string, SecondaryFilter> = {
  recently_added: 'Recently Added',
  popular: 'Popular',
  recommended: 'Recommended for you',
};

const SECONDARY_TO_GAMES_FILTER: Record<
  SecondaryFilter,
  'recently_added' | 'popular' | 'recommended'
> = {
  'Recently Added': 'recently_added',
  Popular: 'popular',
  'Recommended for you': 'recommended',
};

export default function Categories() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSecondary, setSelectedSecondary] =
    useState<SecondaryFilter | null>(null);
  const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>(
    'mobile'
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { data: categoriesData } = useCategories();

  // Legacy /categories?category=<id> redirects to /categories/<slug>.
  // /categories?filter=<key> sets the secondary filter so links from a
  // category landing back to the index preserve the user's intent.
  useEffect(() => {
    const categoryId = searchParams.get('category');
    if (categoryId) {
      const list = categoriesData || [];
      const match = list.find((c) => c.id === categoryId);
      if (match?.slug) {
        navigate(`/categories/${match.slug}`, { replace: true });
        return;
      }
      if (list.length > 0) {
        setSelectedCategory(categoryId);
      }
    }
    const filter = searchParams.get('filter');
    if (filter && FILTER_PARAM_TO_SECONDARY[filter]) {
      setSelectedSecondary(FILTER_PARAM_TO_SECONDARY[filter]);
    }
  }, [searchParams, categoriesData, navigate]);

  const {
    data: gamesData,
    isLoading: gamesLoading,
    error: gamesError,
  } = useGames({
    categoryId: selectedCategory || undefined,
    filter: selectedSecondary
      ? SECONDARY_TO_GAMES_FILTER[selectedSecondary]
      : undefined,
    status: 'active',
  });

  const games: any = gamesData?.data || [];
  const { handleGameClick } = useGameClickHandler();

  // Active primary slug (only set via the legacy redirect fallback path).
  const categoriesList = (categoriesData || []) as Category[];
  const activeCategorySlug = selectedCategory
    ? categoriesList.find((c) => c.id === selectedCategory)?.slug
    : null;

  // Screen size detection
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

  const handleAllClick = () => {
    setSelectedCategory(null);
    setSelectedSecondary(null);
    if (searchParams.has('filter') || searchParams.has('category')) {
      setSearchParams({}, { replace: true });
    }
  };

  const handleSecondaryClick = (sec: SecondaryFilter) => {
    setSelectedSecondary(sec);
    setSelectedCategory(null);
    setSearchParams(
      { filter: SECONDARY_TO_GAMES_FILTER[sec] },
      { replace: true }
    );
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-80px)] bg-white dark:bg-[#0f1221]">
      <CategoriesSidebar
        activeCategorySlug={activeCategorySlug}
        activeSecondary={selectedSecondary}
        onAllClick={handleAllClick}
        onSecondaryClick={handleSecondaryClick}
      />

      {/* Main Content */}
      <div className="flex-1 p-4 lg:p-8">
        {gamesLoading ? (
          <GamesSkeleton count={9} showCategories={true} />
        ) : gamesError ? (
          <div className="text-center py-8 text-red-500">
            Error loading games
          </div>
        ) : (
          <div className="flex flex-col">
            {games.length === 0 ? (
              <div className="text-center py-8 min-h-[60vh] flex flex-col items-center justify-center gap-4 text-[#6A7282] text-lg lg:text-lg">
                <img
                  src={emptyGameImg}
                  alt="No games"
                  className="w-40 h-40 lg:w-80 lg:h-80 object-contain"
                />
                No games found{' '}
                {selectedCategory
                  ? 'in this category'
                  : selectedSecondary
                  ? 'for this filter'
                  : ''}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4 md:gap-6 auto-rows-[1fr] sm:auto-rows-[160px] md:auto-rows-[150px]">
                {games.map((game: any, index: number) => {
                  let colSpan = 1;
                  let rowSpan = 1;
                  if (screenSize === 'mobile') {
                    colSpan = 1;
                  } else {
                    const spans = [1.2, 1.3, 1.25];
                    const spanIndex = index % spans.length;
                    rowSpan = Math.round(spans[spanIndex] * 2);
                  }
                  return (
                    <div
                      key={game.id}
                      className="relative group cursor-pointer"
                      style={{
                        gridColumn:
                          screenSize === 'mobile'
                            ? `span ${colSpan}`
                            : 'span 1',
                        gridRow:
                          screenSize === 'mobile'
                            ? 'span 1'
                            : `span ${rowSpan}`,
                      }}
                      onClick={() =>
                        handleGameClick(
                          game.id,
                          game.slug,
                          game.category?.slug
                        )
                      }
                    >
                      <div className="relative h-full overflow-hidden rounded-[20px] transition-all duration-300 ease-in-out group-hover:shadow-[0_0px_20px_#6A7282,0_0px_10px_rgba(106,114,130,0.8)] aspect-square sm:aspect-auto">
                        <div className="w-full h-full rounded-[16px] overflow-hidden">
                          <LazyImage
                            src={game.thumbnailFile?.s3Key || emptyGameImg}
                            alt={game.title}
                            className="w-full h-full object-fill"
                            variants={game.thumbnailFile?.variants}
                            dimensions={game.thumbnailFile?.dimensions}
                            enableTransform={!game.thumbnailFile?.variants}
                            loadingClassName="rounded-[28px]"
                            spinnerColor="#64748A"
                            rootMargin="50px"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent group-hover:opacity-100 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100 rounded-[16px]">
                            <h4 className="absolute font-worksans bottom-2 left-2 md:bottom-3 md:left-4 text-white font-bold text-xs md:text-lg drop-shadow-lg m-0">
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
          </div>
        )}
      </div>
    </div>
  );
}
