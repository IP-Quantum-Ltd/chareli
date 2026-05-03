import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCategories } from '../../backend/category.service';
import type { Category } from '../../backend/types';

export const SECONDARY_FILTERS = [
  'Recently Added',
  'Popular',
  'Recommended for you',
] as const;

export type SecondaryFilter = (typeof SECONDARY_FILTERS)[number];

const SECONDARY_TO_FILTER_PARAM: Record<SecondaryFilter, string> = {
  'Recently Added': 'recently_added',
  Popular: 'popular',
  'Recommended for you': 'recommended',
};

interface CategoriesSidebarProps {
  /** Slug of the currently-active primary category, if any. Drives highlight. */
  activeCategorySlug?: string | null;
  /** Currently-active secondary filter, if any. Drives highlight. */
  activeSecondary?: SecondaryFilter | null;
  /**
   * Optional override for the "All Categories" click. If omitted the sidebar
   * navigates to /categories (router-driven). Categories.tsx supplies this to
   * keep in-page filter state.
   */
  onAllClick?: () => void;
  /**
   * Optional override for secondary-filter clicks. If omitted the sidebar
   * navigates to /categories?filter=<param>. Categories.tsx supplies this to
   * keep in-page filter state.
   */
  onSecondaryClick?: (sec: SecondaryFilter) => void;
}

export function CategoriesSidebar({
  activeCategorySlug,
  activeSecondary,
  onAllClick,
  onSecondaryClick,
}: Readonly<CategoriesSidebarProps>) {
  const navigate = useNavigate();
  const [showMobileCategories, setShowMobileCategories] = useState(false);
  const {
    data: categoriesData,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useCategories();

  const categories = (categoriesData || []) as Category[];
  const isAllActive = !activeCategorySlug && !activeSecondary;

  const activeCategoryName =
    categories.find((cat) => cat.slug === activeCategorySlug)?.name || '';

  const handleAll = () => {
    setShowMobileCategories(false);
    if (onAllClick) onAllClick();
    else navigate('/categories');
  };

  const handlePrimary = (cat: Category) => {
    setShowMobileCategories(false);
    navigate(`/categories/${cat.slug}`);
  };

  const handleSecondary = (sec: SecondaryFilter) => {
    setShowMobileCategories(false);
    if (onSecondaryClick) onSecondaryClick(sec);
    else navigate(`/categories?filter=${SECONDARY_TO_FILTER_PARAM[sec]}`);
  };

  const renderMobileLabel = () => {
    if (activeCategoryName) {
      return activeCategoryName.length > 20
        ? `${activeCategoryName.substring(0, 20)}...`
        : activeCategoryName;
    }
    if (activeSecondary) {
      return activeSecondary.length > 20
        ? `${activeSecondary.substring(0, 20)}...`
        : activeSecondary;
    }
    return 'All Categories';
  };

  return (
    <>
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
            <button
              onClick={() => setShowMobileCategories(!showMobileCategories)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-left"
              title={
                activeCategoryName ||
                (activeSecondary ?? 'All Categories')
              }
            >
              <h3 className="font-semibold text-[#121C2D] font-worksans dark:text-white truncate mr-2 m-0">
                {renderMobileLabel()}
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

            {showMobileCategories && (
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg max-h-80 overflow-y-auto">
                <div className="p-2">
                  <button
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                        ${
                          isAllActive
                            ? 'bg-[#6A7282] text-white'
                            : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                        }
                    `}
                    onClick={handleAll}
                  >
                    All Categories
                  </button>

                  {categories.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                  )}

                  {categories.map((cat) => {
                    const truncatedName =
                      cat.name.length > 25
                        ? `${cat.name.substring(0, 25)}...`
                        : cat.name;
                    const isActive = cat.slug === activeCategorySlug;
                    return (
                      <button
                        key={cat.id}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                          ${
                            isActive
                              ? 'bg-[#6A7282] text-white'
                              : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                          }
                        `}
                        onClick={() => handlePrimary(cat)}
                        title={cat.name.length > 25 ? cat.name : undefined}
                      >
                        <h4 className="block truncate m-0 font-worksans">
                          {truncatedName}
                        </h4>
                      </button>
                    );
                  })}

                  <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

                  {SECONDARY_FILTERS.map((sec) => (
                    <button
                      key={sec}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition
                        ${
                          activeSecondary === sec
                            ? 'bg-[#6A7282] text-white'
                            : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:bg-gray-800'
                        }
                      `}
                      onClick={() => handleSecondary(sec)}
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
                        isAllActive
                          ? 'bg-[#6A7282] text-white dark:text-white tracking-wider'
                          : 'bg-transparent text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white dark:hover:text-[#6A7282] tracking-wider'
                      }
                    `}
                    onClick={handleAll}
                  >
                    All Categories
                  </button>
                </li>
                {categories.map((cat) => {
                  const truncatedName =
                    cat.name.length > 16
                      ? `${cat.name.substring(0, 16)}...`
                      : cat.name;
                  const isActive = cat.slug === activeCategorySlug;
                  return (
                    <li key={cat.id}>
                      <button
                        className={`w-full text-left text-lg px-4 py-2 rounded-lg font-semibold cursor-pointer transition relative group
                          ${
                            isActive
                              ? 'bg-[#6A7282] text-white shadow dark:text-white tracking-wider'
                              : 'text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white tracking-wider dark:hover:text-[#6A7282]'
                          }
                        `}
                        onClick={() => handlePrimary(cat)}
                        title={cat.name.length > 16 ? cat.name : undefined}
                      >
                        <h3 className="block truncate m-0 font-worksans">
                          {truncatedName}
                        </h3>
                        {cat.name.length > 16 && (
                          <div className="absolute left-full top-1/2 transform -translate-y-1/2 ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                            {cat.name}
                            <div className="absolute right-full top-1/2 transform -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-900" />
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
                {SECONDARY_FILTERS.map((sec) => (
                  <li key={sec}>
                    <button
                      className={`w-full text-left text-lg px-4 py-2 rounded-lg font-semibold text-[#121C2D] hover:bg-[#E5E7EB] hover:text-[#6A7282] dark:text-white tracking-wider transition dark:hover:text-[#6A7282] cursor-pointer ${
                        activeSecondary === sec
                          ? 'bg-[#6A7282] text-white'
                          : ''
                      }`}
                      onClick={() => handleSecondary(sec)}
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
    </>
  );
}
