/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCategories } from '../../backend/category.service';
import { useGames } from '../../backend/games.service';
import { useGameClickHandler } from '../../hooks/useGameClickHandler';
import { LazyImage } from '../../components/ui/LazyImage';
import GamesSkeleton from '../../components/single/GamesSkeleton';
import type { Category } from '../../backend/types';

import emptyGameImg from '../../assets/empty-game.png';

const secondary = ['Recently Added', 'Popular', 'Recommended for you'];

export default function Categories() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSecondary, setSelectedSecondary] = useState<string | null>(
    null
  );
  const [showMobileCategories, setShowMobileCategories] = useState(false);
  const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>(
    'mobile'
  );
  const [searchParams] = useSearchParams();

  // Initialize selectedCategory from URL query param if present
  useEffect(() => {
    const categoryId = searchParams.get('category');
    if (categoryId) {
      setSelectedCategory(categoryId);
    }
  }, [searchParams]);

  const {
    data: categoriesData,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useCategories();
  const {
    data: gamesData,
    isLoading: gamesLoading,
    error: gamesError,
  } = useGames({
    categoryId: selectedCategory || undefined,
    filter: selectedSecondary
      ? selectedSecondary === 'Recently Added'
        ? 'recently_added'
        : selectedSecondary === 'Popular'
        ? 'popular'
        : selectedSecondary === 'Recommended for you'
        ? 'recommended'
        : undefined
      : undefined,
    status: 'active',
  });

  const categories = (categoriesData || []) as Category[];
  const games: any = gamesData?.data || [];
  const { handleGameClick } = useGameClickHandler();

  // Screen size detection
  useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setScreenSize('mobile'); // 2 columns
      } else if (width < 1024) {
        setScreenSize('tablet'); // 3 columns
      } else {
        setScreenSize('desktop'); // 3+ columns
      }
    };

    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-80px)] bg-white dark:bg-[#0f1221]">
      {/* Mobile Category Selector */}
      <div className="lg:hidden bg-transparent py-4 px-4 border-b border-gray-200 dark:border-gray-700">
        {categoriesLoading ? (
          <div className="text-center text-sm">Loading categories...</div>
        ) : categoriesError ? (
          <div className="text-center text-red-500 text-sm">
            Error loading categories
          </div>
        ) : (
          <div className="space-y-3">
            {/* Current Selection Display & Toggle */}
            <button
              onClick={() => setShowMobileCategories(!showMobileCategories)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-left"
              title={
                selectedCategory
                  ? categories.find((cat) => cat.id === selectedCategory)?.name
                  : selectedSecondary
                  ? selectedSecondary
                  : 'All Categories'
              }
            >
              <h3 className="font-semibold text-[#121C2D] font-worksans dark:text-white truncate mr-2 m-0">
                {selectedCategory
                  ? (() => {
                      const categoryName =
                        categories.find((cat) => cat.id === selectedCategory)
                          ?.name || '';
                      return categoryName.length > 20
                        ? `${categoryName.substring(0, 20)}...`
                        : categoryName;
                    })()
                  : selectedSecondary
                  ? selectedSecondary.length > 20
                    ? `${selectedSecondary.substring(0, 20)}...`
                    : selectedSecondary
                  : 'All Categories'}
              </h3>
              <svg
                className={`w-5 h-5 text-[#121C2D] dark:text-white transition-transform ${
                  showMobileCategories ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Collapsible Category List */}
            {showMobileCategories && (
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg max-h-80 overflow-y-auto">
                <div className="p-2">
                  {/* All Categories Option */}
                  <button
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                        ${
                          !selectedCategory && !selectedSecondary
                            ? 'bg-[#6A7282] text-white'
                            : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                        }
                    `}
                    onClick={() => {
                      setSelectedCategory(null);
                      setSelectedSecondary(null);
                      setShowMobileCategories(false);
                    }}
                  >
                    All Categories
                  </button>

                  {/* Category Divider */}
                  {categories.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                  )}

                  {/* Primary Categories */}
                  {categories.map((cat) => {
                    const truncatedName =
                      cat.name.length > 25
                        ? `${cat.name.substring(0, 25)}...`
                        : cat.name;

                    return (
                      <button
                        key={cat.id}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                          ${
                            selectedCategory === cat.id
                              ? 'bg-[#6A7282] text-white'
                              : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                          }
                        `}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setSelectedSecondary(null);
                          setShowMobileCategories(false);
                        }}
                        title={cat.name.length > 25 ? cat.name : undefined}
                      >
                        <h4 className="block truncate m-0 font-worksans">
                          {truncatedName}
                        </h4>
                      </button>
                    );
                  })}

                  {/* Secondary Categories Divider */}
                  <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

                  {/* Secondary Categories */}
                  {secondary.map((sec) => (
                    <button
                      key={sec}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                        ${
                          selectedSecondary === sec
                            ? 'bg-[#6A7282] text-white'
                            : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                        }
                      `}
                      onClick={() => {
                        setSelectedSecondary(sec);
                        setSelectedCategory(null);
                        setShowMobileCategories(false);
                      }}
                    >
                      {sec}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-56 min-w-[220px] bg-transparent py-6 px-2 flex-col gap-2">
        {categoriesLoading ? (
          <div className="p-4 text-center">Loading categories...</div>
        ) : categoriesError ? (
          <div className="p-4 text-center text-red-500">
            Error loading categories
          </div>
        ) : (
          <div>
            <nav>
              <ul className="flex flex-col gap-1">
                <li>
                  <button
                    className={`w-full flex items-center gap-2 px-4 py-2 text-lg rounded-lg font-bold tracking-widest cursor-pointer transition
                      ${
                        !selectedCategory && !selectedSecondary
                          ? 'bg-[#6A7282] text-white dark:text-white tracking-wider'
                          : 'bg-transparent text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:text-[#6A7282] tracking-wider'
                      }
                    `}
                    onClick={() => {
                      setSelectedCategory(null);
                      setSelectedSecondary(null);
                    }}
                  >
                    All Categories
                  </button>
                </li>
                {categories.map((cat) => {
                  const truncatedName =
                    cat.name.length > 16
                      ? `${cat.name.substring(0, 16)}...`
                      : cat.name;

                  return (
                    <li key={cat.id}>
                      <button
                        className={`w-full text-left text-lg px-4 py-2 rounded-lg font-semibold cursor-pointer transition relative group
                          ${
                            selectedCategory === cat.id
                              ? 'bg-[#6A7282] text-white shadow dark:text-white tracking-wider'
                              : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white tracking-wider dark:hover:text-[#6A7282]'
                          }
                        `}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setSelectedSecondary(null);
                        }}
                        title={cat.name.length > 16 ? cat.name : undefined}
                      >
                        <h3 className="block truncate m-0 font-worksans">
                          {truncatedName}
                        </h3>
                        {cat.name.length > 16 && (
                          <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                            {cat.name}
                            <div className="absolute right-full top-1/2 transform -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-900"></div>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="border-t border-[#E5E7EB] my-4" />
            <nav>
              <ul className="flex flex-col gap-1 tracking-widest">
                {secondary.map((sec) => (
                  <li key={sec}>
                    <button
                      className={`w-full text-left text-lg px-4 py-2 rounded-lg font-semibold text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white tracking-wider transition dark:hover:text-[#6A7282] cursor-pointer ${
                        selectedSecondary === sec
                          ? 'bg-[#6A7282] text-white'
                          : ''
                      }`}
                      onClick={() => {
                        setSelectedSecondary(sec);
                        setSelectedCategory(null);
                      }}
                    >
                      {sec}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        )}
      </aside>
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
                  // Different behavior for mobile vs desktop
                  let colSpan = 1;
                  let rowSpan = 1;

                  if (screenSize === 'mobile') {
                    // Mobile: uniform sizes (no varied widths)
                    colSpan = 1;
                  } else {
                    // Desktop: keep original varied heights
                    const spans = [1.2, 1.3, 1.25]; // Original desktop height variations
                    const spanIndex = index % spans.length;
                    const heightSpan = spans[spanIndex];
                    rowSpan = Math.round(heightSpan * 2);
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
                      onClick={() => handleGameClick(game.id)}
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
