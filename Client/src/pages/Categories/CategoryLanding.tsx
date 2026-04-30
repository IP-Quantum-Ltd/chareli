/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCategoryBySlug } from '../../backend/category.service';
import { useGameClickHandler } from '../../hooks/useGameClickHandler';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { LazyImage } from '../../components/ui/LazyImage';
import GamesSkeleton from '../../components/single/GamesSkeleton';
import { CategorySchemaLD } from '../../components/single/CategorySchemaLD';
import { CATEGORY_FAQ_QUESTIONS } from '../../utils/categoryFaq';
import emptyGameImg from '../../assets/empty-game.png';

export default function CategoryLanding() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useCategoryBySlug(slug, {
    page,
    limit: 24,
  });
  const { handleGameClick } = useGameClickHandler();

  const category = data;
  const games: any[] = data?.games || [];
  const pagination = data?.pagination;

  const faqItems = useMemo(() => {
    if (!category) return [];
    const answers = category.faqAnswers || {};
    return CATEGORY_FAQ_QUESTIONS.map((q) => ({
      question: q.template(category.name),
      answer: (answers[q.key] || '').trim(),
    })).filter((qa) => qa.answer.length > 0);
  }, [category]);

  const metaDescription = useMemo(() => {
    if (!category) return undefined;
    const source = category.introText || category.description || '';
    return source ? source.toString().slice(0, 160) : undefined;
  }, [category]);

  useDocumentMeta(
    category ? `${category.name} Games | Arcadesbox` : undefined,
    metaDescription
  );

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-white dark:bg-[#0f1221] p-4 lg:p-8">
        <GamesSkeleton count={12} showCategories={false} />
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center text-center bg-white dark:bg-[#0f1221] p-8">
        <h1 className="text-2xl font-worksans text-[#121C2D] dark:text-white mb-2">
          Category not found
        </h1>
        <p className="text-[#6A7282] dark:text-gray-300 mb-6">
          The category you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/categories"
          className="text-[#6A7282] underline font-dmmono"
        >
          Browse all categories
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-80px)] bg-white dark:bg-[#0f1221]">
      <CategorySchemaLD
        name={category.name}
        slug={category.slug}
        description={category.description}
        introText={category.introText}
        games={games}
        faqItems={faqItems}
      />

      <div className="max-w-7xl mx-auto p-4 lg:p-8">
        <header className="mb-6">
          <nav className="text-sm text-[#6A7282] dark:text-gray-400 mb-2 font-worksans">
            <Link to="/categories" className="hover:underline">
              Categories
            </Link>
            <span className="mx-2">/</span>
            <span>{category.name}</span>
          </nav>
          <h1 className="text-3xl lg:text-4xl font-worksans text-[#121C2D] dark:text-white m-0">
            {category.name} Games
          </h1>
          {category.description && (
            <p className="mt-3 text-[#475568] dark:text-gray-300 font-worksans text-base max-w-3xl">
              {category.description}
            </p>
          )}
        </header>

        {games.length === 0 ? (
          <div className="text-center py-16 min-h-[40vh] flex flex-col items-center justify-center gap-4 text-[#6A7282] text-lg">
            <img
              src={emptyGameImg}
              alt="No games"
              className="w-40 h-40 lg:w-60 lg:h-60 object-contain"
            />
            No games in this category yet.
          </div>
        ) : (
          <section aria-label={`${category.name} games`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
              {games.map((game: any) => (
                <button
                  key={game.id}
                  type="button"
                  className="relative group cursor-pointer text-left"
                  onClick={() => handleGameClick(game.id, game.slug)}
                >
                  <div className="relative aspect-square overflow-hidden rounded-[20px] transition-all duration-300 group-hover:shadow-[0_0px_20px_#6A7282,0_0px_10px_rgba(106,114,130,0.8)]">
                    <div className="w-full h-full rounded-[16px] overflow-hidden">
                      <LazyImage
                        src={game.thumbnailFile?.s3Key || emptyGameImg}
                        alt={game.title}
                        className="w-full h-full object-cover"
                        variants={game.thumbnailFile?.variants}
                        dimensions={game.thumbnailFile?.dimensions}
                        enableTransform={!game.thumbnailFile?.variants}
                        loadingClassName="rounded-[28px]"
                        spinnerColor="#64748A"
                        rootMargin="50px"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-300 rounded-[16px]">
                        <h3 className="absolute font-worksans bottom-2 left-2 md:bottom-3 md:left-4 text-white font-bold text-xs md:text-base drop-shadow-lg m-0">
                          {game.title}
                        </h3>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md border border-[#6A7282] text-[#475568] dark:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!pagination.hasPrevPage}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="text-sm text-[#475568] dark:text-gray-300">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  className="px-4 py-2 rounded-md border border-[#6A7282] text-[#475568] dark:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!pagination.hasNextPage}
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            )}
          </section>
        )}

        {category.introText && (
          <section className="mt-12 max-w-3xl">
            <h2 className="text-2xl font-worksans text-[#121C2D] dark:text-white mb-3">
              About {category.name} Games
            </h2>
            <div className="text-[#475568] dark:text-gray-300 font-worksans text-base whitespace-pre-line">
              {category.introText}
            </div>
          </section>
        )}

        {faqItems.length > 0 && (
          <section className="mt-12 max-w-3xl">
            <h2 className="text-2xl font-worksans text-[#121C2D] dark:text-white mb-4">
              Frequently Asked Questions
            </h2>
            <div className="space-y-5">
              {faqItems.map((qa) => (
                <div key={qa.question}>
                  <h3 className="text-base font-semibold font-worksans text-[#121C2D] dark:text-white m-0">
                    {qa.question}
                  </h3>
                  <p className="mt-1 text-[#475568] dark:text-gray-300 font-worksans text-sm">
                    {qa.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
