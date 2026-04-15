import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3x3, List, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  useGames,
  useToggleGameStatus,
} from '../../../backend/games.service';
import { usePermissions } from '../../../hooks/usePermissions';
import type { GameResponse, GameStatus } from '../../../backend/types';
import { Button } from '../../../components/ui/button';

type FilterValue = 'all' | 'published' | 'drafts';
type ViewMode = 'grid' | 'list';

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'All games', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Drafts', value: 'drafts' },
];

const statusQueryParam = (
  filter: FilterValue
): GameStatus | undefined => {
  if (filter === 'published') return 'active' as GameStatus;
  if (filter === 'drafts') return 'disabled' as GameStatus;
  return undefined;
};

export default function GameLibrary() {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canManage = permissions.isAdmin || permissions.isSuperAdmin;

  const [filter, setFilter] = useState<FilterValue>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useGames({
    status: statusQueryParam(filter),
    page,
    limit: 24,
  });

  const toggleStatus = useToggleGameStatus();

  const games = useMemo<GameResponse[]>(
    () => (data?.data as GameResponse[]) || [],
    [data]
  );

  const handleToggle = async (game: GameResponse) => {
    try {
      await toggleStatus.mutateAsync({
        gameId: game.id,
        currentStatus: game.status as string,
      });
      toast.success(
        game.status === 'active'
          ? `Unpublished "${game.title}"`
          : `Published "${game.title}"`
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to update publish state';
      toast.error(message);
    }
  };

  if (!canManage) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
        You need admin access to view the Game Library.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-wider text-[#121C2D] dark:text-white font-dmmono">
            Game Library
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-worksans">
            Every game in the system — live and draft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded border ${
              viewMode === 'grid'
                ? 'bg-[#6A7282] text-white border-[#6A7282]'
                : 'bg-white dark:bg-[#1E293B] text-[#334154] dark:text-gray-300 border-[#E2E8F0] dark:border-[#334155]'
            }`}
            aria-label="Grid view"
            title="Grid view"
          >
            <Grid3x3 size={18} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`p-2 rounded border ${
              viewMode === 'list'
                ? 'bg-[#6A7282] text-white border-[#6A7282]'
                : 'bg-white dark:bg-[#1E293B] text-[#334154] dark:text-gray-300 border-[#E2E8F0] dark:border-[#334155]'
            }`}
            aria-label="List view"
            title="List view"
          >
            <List size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
            className={`px-4 py-2 rounded-full text-sm font-worksans tracking-wider ${
              filter === f.value
                ? 'bg-[#6A7282] text-white'
                : 'bg-[#F8FAFC] dark:bg-[#1E293B] text-[#334154] dark:text-gray-300 border border-[#E2E8F0] dark:border-[#334155]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500 dark:text-gray-400">
          Loading games…
        </div>
      ) : games.length === 0 ? (
        <div className="py-12 text-center text-gray-500 dark:text-gray-400">
          No games match this filter.
        </div>
      ) : viewMode === 'grid' ? (
        <GridView
          games={games}
          onView={(g) => navigate(`/admin/view-game/${g.id}`)}
          onToggle={handleToggle}
          toggling={toggleStatus.isPending}
        />
      ) : (
        <ListView
          games={games}
          onView={(g) => navigate(`/admin/view-game/${g.id}`)}
          onToggle={handleToggle}
          toggling={toggleStatus.isPending}
        />
      )}

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between mt-6">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}
            {isFetching && ' · refreshing…'}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              disabled={
                data.total <= page * data.limit
              }
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ViewProps {
  games: GameResponse[];
  onView: (game: GameResponse) => void;
  onToggle: (game: GameResponse) => void;
  toggling: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const isPublished = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs tracking-wider ${
        isPublished
          ? 'bg-[#419E6A] text-white'
          : 'bg-[#CBD5E0] text-[#22223B]'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isPublished ? 'bg-white' : 'bg-red-500'
        }`}
      />
      {isPublished ? 'Published' : 'Draft'}
    </span>
  );
}

function GridView({ games, onView, onToggle, toggling }: ViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {games.map((game) => {
        const isPublished = game.status === 'active';
        return (
          <div
            key={game.id}
            className="rounded-lg overflow-hidden bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] flex flex-col"
          >
            <button
              type="button"
              className="aspect-video bg-[#F8FAFC] dark:bg-[#0F172A] relative overflow-hidden cursor-pointer group"
              onClick={() => onView(game)}
              title="View game"
            >
              {(game.thumbnailFile?.s3Key || game.thumbnailFile?.url) ? (
                <img
                  src={game.thumbnailFile.s3Key || game.thumbnailFile.url}
                  alt={game.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  No thumbnail
                </div>
              )}
              <div className="absolute top-2 left-2">
                <StatusBadge status={game.status as string} />
              </div>
            </button>
            <div className="p-3 flex flex-col gap-2 flex-1">
              <h3
                className="font-semibold text-[#121C2D] dark:text-white truncate"
                title={game.title}
              >
                {game.title}
              </h3>
              <div className="flex gap-2 mt-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onView(game)}
                  className="flex-1"
                >
                  <Eye size={14} /> View
                </Button>
                <Button
                  type="button"
                  onClick={() => onToggle(game)}
                  disabled={toggling}
                  className={`flex-1 text-white ${
                    isPublished
                      ? 'bg-[#CBD5E0] text-[#22223B] hover:bg-[#a6b4c5]'
                      : 'bg-[#419E6A] hover:bg-[#347f54]'
                  }`}
                >
                  {isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ games, onView, onToggle, toggling }: ViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {games.map((game) => {
        const isPublished = game.status === 'active';
        return (
          <div
            key={game.id}
            className="flex items-center gap-4 p-3 rounded-lg bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155]"
          >
            <button
              type="button"
              className="w-20 h-12 rounded overflow-hidden flex-shrink-0 bg-[#F8FAFC] dark:bg-[#0F172A] cursor-pointer"
              onClick={() => onView(game)}
            >
              {(game.thumbnailFile?.s3Key || game.thumbnailFile?.url) ? (
                <img
                  src={game.thumbnailFile.s3Key || game.thumbnailFile.url}
                  alt={game.title}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[#121C2D] dark:text-white truncate">
                  {game.title}
                </h3>
                <StatusBadge status={game.status as string} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                /{game.slug}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onView(game)}>
                <Eye size={14} /> View
              </Button>
              <Button
                type="button"
                onClick={() => onToggle(game)}
                disabled={toggling}
                className={`text-white ${
                  isPublished
                    ? 'bg-[#CBD5E0] text-[#22223B] hover:bg-[#a6b4c5]'
                    : 'bg-[#419E6A] hover:bg-[#347f54]'
                }`}
              >
                {isPublished ? 'Unpublish' : 'Publish'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
