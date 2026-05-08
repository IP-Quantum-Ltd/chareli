import { useMemo } from 'react';
import {
  CATEGORY_FAQ_QUESTIONS,
} from '../../utils/categoryFaq';
import type { CategoryFaqAnswers } from '../../backend/types';

interface CategoryEditorialProps {
  category: {
    name: string;
    introText?: string | null;
    faqAnswers?: CategoryFaqAnswers | null;
  };
}

/**
 * Renders the editorial blocks for a category — the "About <Name> Games"
 * intro section and the templated FAQ section. Used on both the public
 * category landing page and the homepage filtered-by-category view.
 *
 * Returns null when the category has neither intro text nor any FAQ
 * answers, so callers can drop it in unconditionally.
 */
export function CategoryEditorial({
  category,
}: Readonly<CategoryEditorialProps>) {
  const faqItems = useMemo(() => {
    const answers = category.faqAnswers || {};
    return CATEGORY_FAQ_QUESTIONS.map((q) => ({
      question: q.template(category.name),
      answer: (answers[q.key] || '').trim(),
    })).filter((qa) => qa.answer.length > 0);
  }, [category.name, category.faqAnswers]);

  const introText = category.introText?.trim() ? category.introText : null;

  if (!introText && faqItems.length === 0) return null;

  return (
    <>
      {introText && (
        <section className="mt-12 max-w-3xl">
          <h2 className="text-2xl font-worksans text-[#121C2D] dark:text-white mb-3">
            About {category.name} Games
          </h2>
          <div className="text-[#475568] dark:text-gray-300 font-worksans text-base whitespace-pre-line">
            {introText}
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
    </>
  );
}
