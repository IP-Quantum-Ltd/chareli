import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiShare2 } from 'react-icons/fi';
import { FaWhatsapp, FaFacebookF } from 'react-icons/fa';
import { LuPenLine } from 'react-icons/lu';
import type { GameData } from '../../backend/types';
import { format } from 'date-fns';
import { trackGameplay } from '../../utils/analytics';
import DOMPurify from 'dompurify';
import { usePermissions } from '../../hooks/usePermissions';
import { DEFAULT_FAQ_TEMPLATE, renderFAQ, parseFAQ } from '../../utils/faqTemplate';

interface GameInfoSectionProps {
  game: GameData;
  likeCount: number;
  hideEditButton?: boolean;
}

export function GameInfoSection({ game, likeCount, hideEditButton = false }: GameInfoSectionProps) {
  const { metadata } = game;
  const [shareStatus, setShareStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const navigate = useNavigate();
  const permissions = usePermissions();

  // Helper function to ensure tags is always an array
  const ensureArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value as string[];
    // If it's an object with numeric keys (converted from array), convert back to array
    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
    }
    return [];
  };

  // Handle share button click
  const handleShare = async () => {
    // Always use gameplay URL with slug, not current location
    const gameplayUrl = `${window.location.origin}/gameplay/${game.slug}`;

    const shareData = {
      title: game.title,
      text: game.description || `Play ${game.title} on ArcadesBox`,
      url: gameplayUrl,
    };

    try {
      // Try Web Share API first (mobile/modern browsers)
      if (navigator.share) {
        await navigator.share(shareData);
        trackGameplay.gameShare(game.id, game.title, 'web_share');
        setShareStatus('success');
        setTimeout(() => setShareStatus('idle'), 3000);
      } else {
        // Fallback to clipboard
        await navigator.clipboard.writeText(gameplayUrl);
        trackGameplay.gameShare(game.id, game.title, 'clipboard');
        setShareStatus('success');
        setTimeout(() => setShareStatus('idle'), 3000);
      }
    } catch (error) {
      // Only set error if user didn't cancel
      if (error instanceof Error && error.name !== 'AbortError') {
        setShareStatus('error');
        setTimeout(() => setShareStatus('idle'), 3000);
      }
    }
  };

  // Format release date to "Month Year" format
  const releaseDate = metadata?.releaseDate
    ? format(new Date(metadata.releaseDate), 'MMMM yyyy')
    : null;

  // Get developer name from metadata
  const developerName = metadata?.developer || null;

  return (
    <div className="space-y-6 md:space-y-8 px-4 md:px-0">
      {/* Game Title */}
      <h1 className="text-[32px] leading-[1.2] md:text-4xl md:leading-tight font-bold text-gray-900 dark:text-white font-dmmono">
        {game.title}: Play Unblocked & Free Online - Arcades Box
      </h1>

      {/* Game Details Link */}
      <a
        href="#game-details"
        className="text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 text-sm font-worksans inline-block underline"
      >
        Game Details
      </a>

      {/* Metadata List */}
      <div className="space-y-3 text-sm">
        {developerName && (
          <div className="flex gap-2">
            <span className="text-gray-500 dark:text-gray-400 font-worksans">
              Developer:
            </span>
            <span className="text-gray-900 dark:text-white font-worksans">
              {developerName}
            </span>
          </div>
        )}
        {releaseDate && (
          <div className="flex gap-2">
            <span className="text-gray-500 dark:text-gray-400 font-worksans">
              Released:
            </span>
            <span className="text-gray-900 dark:text-white font-worksans">
              {releaseDate}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-gray-500 dark:text-gray-400 font-worksans">
            Platform:
          </span>
          <span className="text-gray-900 dark:text-white font-worksans">
            {metadata?.platform
              ? `Browser (${Array.isArray(metadata.platform) ? metadata.platform.join(', ') : metadata.platform})`
              : 'Browser (desktop, mobile, tablet)'
            }
          </span>
        </div>
      </div>

      {/* Likes Display with Thumbs Up */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">👍</span>
          <span className="text-lg font-semibold text-gray-900 dark:text-white font-dmmono">
            {likeCount.toLocaleString()} likes
          </span>
        </div>
      </div>

      {/* Share and Edit Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Share Button */}
        <div className="relative">
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300 text-[16px] font-semibold font-worksans"
          >
            <FiShare2 className="w-4 h-4" />
            {shareStatus === 'success' ? 'Copied!' : 'Share'}
          </button>
          {shareStatus === 'success' && (
            <div className="absolute top-full mt-2 left-0 bg-green-500 text-white px-3 py-1.5 rounded text-xs font-worksans whitespace-nowrap shadow-lg z-10">
              ✓ Link copied to clipboard
            </div>
          )}
        </div>

        {/* WhatsApp Share */}
        <button
          onClick={() => {
            const gameplayUrl = `${window.location.origin}/gameplay/${game.slug}`;
            const text = `Check out ${game.title} on ArcadesBox!`;
            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + gameplayUrl)}`;
            window.open(whatsappUrl, '_blank');
            trackGameplay.gameShare(game.id, game.title, 'whatsapp');
          }}
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300 text-[16px] font-semibold font-worksans"
          title="Share on WhatsApp"
        >
          <FaWhatsapp className="w-4 h-4 text-green-600 dark:text-green-400" />
          <span className="hidden sm:inline">WhatsApp</span>
        </button>

        {/* Facebook Share */}
        <button
          onClick={() => {
            const gameplayUrl = `${window.location.origin}/gameplay/${game.slug}`;
            const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(gameplayUrl)}`;
            window.open(facebookUrl, '_blank', 'width=600,height=400');
            trackGameplay.gameShare(game.id, game.title, 'facebook');
          }}
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300 text-[16px] font-semibold font-worksans"
          title="Share on Facebook"
        >
          <FaFacebookF className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="hidden sm:inline">Facebook</span>
        </button>

        {/* Admin Edit Button */}
        {!hideEditButton && permissions.hasAdminAccess && (
          <button
            onClick={() => navigate(`/admin/edit-game/${game.id}`)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300 text-[16px] font-semibold font-worksans"
          >
            <LuPenLine className="w-4 h-4" />
            Edit
          </button>
        )}
      </div>

      {/* Game Description */}
      {game.description && (
        <section id="game-details" className="space-y-3">
          <h2 className="text-[28px] leading-[1.25] md:text-3xl font-semibold text-gray-900 dark:text-white font-dmmono">
            Game Description
          </h2>
          <div
            className="prose prose-sm dark:prose-invert max-w-none
              prose-headings:font-dmmono prose-p:font-worksans prose-li:font-worksans
              prose-ul:list-disc prose-ol:list-decimal prose-ul:ml-6 prose-ol:ml-6
              dark:prose-headings:text-white dark:prose-p:text-gray-300 dark:prose-li:text-gray-300
              prose-h1:text-[32px] prose-h1:leading-[1.2] md:prose-h1:text-4xl
              prose-h2:text-[28px] prose-h2:leading-[1.25] md:prose-h2:text-3xl
              prose-h3:text-[22px] prose-h3:leading-[1.3] md:prose-h3:text-2xl
              prose-h4:text-[20px] prose-h4:leading-[1.35] md:prose-h4:text-xl
              prose-h5:text-[18px] prose-h5:leading-[1.4] md:prose-h5:text-lg
              prose-h6:text-[16px] prose-h6:leading-[1.4] md:prose-h6:text-base
              prose-p:text-[16px] prose-p:leading-[1.6] md:prose-p:text-lg
              prose-li:text-[16px] prose-li:leading-[1.6] md:prose-li:text-lg"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(game.description) }}
          />
        </section>
      )}

      {/* How to Play */}
      {metadata?.howToPlay && (
        <section className="space-y-3">
          <h2 className="text-[28px] leading-[1.25] md:text-3xl font-semibold text-gray-900 dark:text-white font-dmmono">
            How to Play {game.title}
          </h2>
          <div
            className="prose prose-sm dark:prose-invert max-w-none
              prose-headings:font-dmmono prose-p:font-worksans prose-li:font-worksans
              prose-ul:list-disc prose-ol:list-decimal prose-ul:ml-6 prose-ol:ml-6
              dark:prose-headings:text-white dark:prose-p:text-gray-300 dark:prose-li:text-gray-300
              prose-h1:text-[32px] prose-h1:leading-[1.2] md:prose-h1:text-4xl
              prose-h2:text-[28px] prose-h2:leading-[1.25] md:prose-h2:text-3xl
              prose-h3:text-[22px] prose-h3:leading-[1.3] md:prose-h3:text-2xl
              prose-h4:text-[20px] prose-h4:leading-[1.35] md:prose-h4:text-xl
              prose-h5:text-[18px] prose-h5:leading-[1.4] md:prose-h5:text-lg
              prose-h6:text-[16px] prose-h6:leading-[1.4] md:prose-h6:text-base
              prose-p:text-[16px] prose-p:leading-[1.6] md:prose-p:text-lg
              prose-li:text-[16px] prose-li:leading-[1.6] md:prose-li:text-lg"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(metadata.howToPlay) }}
          />
        </section>
      )}

      {/* FAQ Section */}
      <section className="space-y-3">
        <div
          className="prose prose-sm dark:prose-invert max-w-none
            prose-headings:font-dmmono prose-p:font-worksans
            dark:prose-headings:text-white dark:prose-p:text-gray-300
            prose-h1:text-[32px] prose-h1:leading-[1.2] md:prose-h1:text-4xl
            prose-h2:text-[28px] prose-h2:leading-[1.25] md:prose-h2:text-3xl
            prose-h3:text-[22px] prose-h3:leading-[1.3] md:prose-h3:text-2xl
            prose-h4:text-[20px] prose-h4:leading-[1.35] md:prose-h4:text-xl
            prose-h5:text-[18px] prose-h5:leading-[1.4] md:prose-h5:text-lg
            prose-h6:text-[16px] prose-h6:leading-[1.4] md:prose-h6:text-base
            prose-p:text-[16px] prose-p:leading-[1.6] md:prose-p:text-lg
            prose-li:text-[16px] prose-li:leading-[1.6] md:prose-li:text-lg"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              (() => {
                const override = metadata?.faqOverride;
                // Use override ONLY if it exists AND parses to valid items
                if (override && parseFAQ(override).length > 0) {
                  return renderFAQ(override, game);
                }
                // Otherwise use default
                return renderFAQ(DEFAULT_FAQ_TEMPLATE, game);
              })()
            ),
          }}
        />
      </section>

      {/* Tags - Clickable links to categories */}
      {(() => {
        const tags = ensureArray(metadata?.tags);
        return tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
              <Link
                key={index}
                to={`/category/${encodeURIComponent(tag.toLowerCase())}`}
                className="px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-xs font-medium font-worksans transition-colors"
              >
                {tag}
              </Link>
            ))}
          </div>
        ) : null;
      })()}
    </div>
  );
}
