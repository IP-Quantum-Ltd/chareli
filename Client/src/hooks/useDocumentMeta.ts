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

export function useDocumentMeta(
  title: string | undefined,
  description: string | undefined
) {
  useEffect(() => {
    if (!title && !description) return;

    const previousTitle = document.title;
    const previousDescription =
      document.head
        .querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.getAttribute('content') ?? '';

    if (title) document.title = title;
    if (description) setMetaContent('description', description);

    return () => {
      document.title = previousTitle;
      if (description) setMetaContent('description', previousDescription);
    };
  }, [title, description]);
}
