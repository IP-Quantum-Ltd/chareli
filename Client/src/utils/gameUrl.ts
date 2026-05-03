interface GameForUrl {
  id?: string;
  slug?: string;
  category?: { slug?: string } | null;
}

/**
 * Canonical pathname for a game. Prefers the slug-based URL
 * /gameplay/<categorySlug>/<gameSlug>; falls back to /gameplay/<slug-or-id>
 * when the category slug isn't available. The legacy single-segment route is
 * still wired up and redirects via GamePlay's canonical effect once data
 * loads, so the fallback stays correct.
 */
export function gameplayPath(game: GameForUrl): string {
  if (game.category?.slug && game.slug) {
    return `/gameplay/${game.category.slug}/${game.slug}`;
  }
  return `/gameplay/${game.slug || game.id || ''}`;
}

export function gameplayUrl(
  game: GameForUrl,
  origin: string = window.location.origin
): string {
  return `${origin}${gameplayPath(game)}`;
}
