import { useEffect } from 'react';

interface CategorySchemaLDProps {
  name: string;
  slug: string;
  description?: string | null;
  introText?: string | null;
  games: Array<{
    title: string;
    slug: string;
    thumbnailFile?: { url?: string } | null;
  }>;
  faqItems: Array<{ question: string; answer: string }>;
}

const SCHEMA_ID_COLLECTION = 'category-schema-ld';
const SCHEMA_ID_FAQ = 'category-faq-schema-ld';

const upsertScript = (id: string, json: object) => {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = id;
  script.text = JSON.stringify(json);
  document.head.appendChild(script);
};

export function CategorySchemaLD({
  name,
  slug,
  description,
  introText,
  games,
  faqItems,
}: CategorySchemaLDProps) {
  useEffect(() => {
    const baseUrl = window.location.origin;
    const collectionUrl = `${baseUrl}/categories/${slug}`;

    const itemList = {
      '@type': 'ItemList',
      itemListElement: games.map((game, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${baseUrl}/gameplay/${game.slug}`,
        name: game.title,
        image: game.thumbnailFile?.url,
      })),
    };

    const collection = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${name} Games`,
      url: collectionUrl,
      description: description || introText || `Play ${name} games online.`,
      mainEntity: itemList,
    };

    upsertScript(SCHEMA_ID_COLLECTION, collection);

    if (faqItems.length > 0) {
      const faq = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map((qa) => ({
          '@type': 'Question',
          name: qa.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: qa.answer,
          },
        })),
      };
      upsertScript(SCHEMA_ID_FAQ, faq);
    } else {
      document.getElementById(SCHEMA_ID_FAQ)?.remove();
    }

    return () => {
      document.getElementById(SCHEMA_ID_COLLECTION)?.remove();
      document.getElementById(SCHEMA_ID_FAQ)?.remove();
    };
  }, [name, slug, description, introText, games, faqItems]);

  return null;
}
