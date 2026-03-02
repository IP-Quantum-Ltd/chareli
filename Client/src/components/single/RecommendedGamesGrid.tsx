import { useNavigate } from 'react-router-dom';
import { LazyImage } from '../ui/LazyImage';
import type { SimilarGame } from '../../backend/types';
import placeholderImg from '@/assets/gamesImg/1.svg';

interface RecommendedGamesGridProps {
  games: SimilarGame[];
}

export function RecommendedGamesGrid({ games }: RecommendedGamesGridProps) {
  const navigate = useNavigate();

  if (!games || games.length === 0) {
    return null;
  }

  const handleGameClick = (gameId: string) => {
    navigate(`/gameplay/${gameId}`);
    // Scroll to top when new game loads
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6 font-dmmono">
        Recommended Games
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {games.map((game) => (
          <div
            key={game.id}
            onClick={() => handleGameClick(game.id)}
            className="group cursor-pointer bg-white dark:bg-[#121C2D] rounded-lg overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 hover:scale-105"
          >
            <div className="aspect-square relative overflow-hidden bg-gray-100 dark:bg-gray-800">
              <LazyImage
                src={game.thumbnailFile?.s3Key || placeholderImg}
                alt={game.title}
                placeholder={placeholderImg}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                loadingClassName="rounded-t-lg"
                spinnerColor="#6A7282"
                rootMargin="50px"
              />
            </div>
            <div className="p-3">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate font-dmmono">
                {game.title}
              </h3>

            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
