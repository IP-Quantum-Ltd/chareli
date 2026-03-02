import { useEffect } from 'react';
import type { GameData } from '../../backend/types';
import { DEFAULT_FAQ_TEMPLATE, renderFAQ } from '../../utils/faqTemplate';

interface GameSchemaLDProps {
  game: GameData;
  likeCount: number;
}

// Utility to parse FAQ HTML into Q&A pairs for Schema.org
function parseFAQFromHTML(html: string): Array<{ question: string; answer: string }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const questions = doc.querySelectorAll('h3');

  return Array.from(questions).map(q => {
    const questionText = q.textContent?.replace(/^Q:\s*/i, '').trim() || '';
    const answerEl = q.nextElementSibling;
    const answerText = answerEl?.textContent?.trim() || '';

    return { question: questionText, answer: answerText };
  }).filter(qa => qa.question && qa.answer);
}

export function GameSchemaLD({ game, likeCount }: GameSchemaLDProps) {
  useEffect(() => {
    // Calculate rating value from likes (scale to 3-5 stars)
    const ratingValue = Math.min(5, likeCount / 50 + 3);

    const schemaData = {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.title,
      description:
        game.description ||
        game.metadata?.howToPlay ||
        'Play this exciting game!',
      image: game.thumbnailFile?.s3Key,
      genre: game.category?.name,
      gamePlatform: game.metadata?.platform
        ? `Browser (${Array.isArray(game.metadata.platform) ? game.metadata.platform.join(', ') : game.metadata.platform})`
        : 'Browser (desktop, mobile, tablet)',
      author: {
        '@type': 'Organization',
        name: game.metadata?.developer || 'Unknown',
      },
      datePublished: game.createdAt,
      dateModified: game.updatedAt,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: ratingValue.toFixed(1),
        reviewCount: likeCount,
        bestRating: '5',
        worstRating: '1',
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    };

    // Create Game schema script
    const gameScript = document.createElement('script');
    gameScript.type = 'application/ld+json';
    gameScript.text = JSON.stringify(schemaData);
    gameScript.id = 'game-schema-ld';

    // Remove existing game schema if present
    const existingGameScript = document.getElementById('game-schema-ld');
    if (existingGameScript) {
      existingGameScript.remove();
    }

    // Add game schema to head
    document.head.appendChild(gameScript);

    // Add FAQ schema
    const faqHTML = game.metadata?.faqOverride || renderFAQ(DEFAULT_FAQ_TEMPLATE, game);
    const faqItems = parseFAQFromHTML(faqHTML);

    if (faqItems.length > 0) {
      const faqSchemaData = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map(qa => ({
          '@type': 'Question',
          name: qa.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: qa.answer
          }
        }))
      };

      const faqScript = document.createElement('script');
      faqScript.type = 'application/ld+json';
      faqScript.text = JSON.stringify(faqSchemaData);
      faqScript.id = 'faq-schema-ld';

      // Remove existing FAQ schema if present
      const existingFaqScript = document.getElementById('faq-schema-ld');
      if (existingFaqScript) {
        existingFaqScript.remove();
      }

      // Add FAQ schema to head
      document.head.appendChild(faqScript);
    }

    // Cleanup on unmount
    return () => {
      const gameScriptToRemove = document.getElementById('game-schema-ld');
      if (gameScriptToRemove) {
        gameScriptToRemove.remove();
      }
      const faqScriptToRemove = document.getElementById('faq-schema-ld');
      if (faqScriptToRemove) {
        faqScriptToRemove.remove();
      }
    };
  }, [game, likeCount]);

  return null; // This component doesn't render anything visible
}
