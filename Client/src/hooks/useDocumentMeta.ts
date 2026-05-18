import { useEffect } from 'react';

const setMetaContent = (name: string, content: string) => {
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`
  );
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

const setCanonicalHref = (href: string) => {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
};

/**
 * Sets <title> and <meta name="description"> for the current page, with an
 * optional <link rel="canonical"> override for cases where the visible URL
 * isn't the canonical one (e.g. homepage filtered to a category — canonical
 * should point at /categories/<slug> instead of the current /<slug>).
 *
 * Restores previous values on unmount.
 */
export function useDocumentMeta(
  title: string | undefined,
  description: string | undefined,
  canonicalOverride?: string
) {
  useEffect(() => {
    if (!title && !description && !canonicalOverride) return;

    const previousTitle = document.title;
    const previousDescription =
      document.head
        .querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.getAttribute('content') ?? '';
    const previousCanonical =
      document.head
        .querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.getAttribute('href') ?? '';

    if (title) document.title = title;
    if (description) setMetaContent('description', description);
    if (canonicalOverride) setCanonicalHref(canonicalOverride);

    return () => {
      document.title = previousTitle;
      if (description) setMetaContent('description', previousDescription);
      if (canonicalOverride && previousCanonical) {
        setCanonicalHref(previousCanonical);
      }
    };
  }, [title, description, canonicalOverride]);
}
