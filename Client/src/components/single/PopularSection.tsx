import { Card } from '../../components/ui/card';
import { Input } from '../ui/input';
import { LazyImage } from '../../components/ui/LazyImage';
import { Search } from 'lucide-react';
import { useGames } from '../../backend/games.service';
import { useGameClickHandler } from '../../hooks/useGameClickHandler';
import { useUISettings } from '../../hooks/useUISettings';
import GamesSkeleton from './GamesSkeleton';
import emptyGameImg from '../../assets/empty-game.png';

interface PopularSectionProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const PopularSection = ({
  searchQuery,
  setSearchQuery,
}: PopularSectionProps) => {
  const { uiSettings } = useUISettings();

  const {
    data: gamesData,
    isLoading,
    error,
  } = useGames({
    filter: 'popular',
    status: 'active',
    search: searchQuery || undefined,
    limit: 6, // This limit will only apply to auto mode, manual mode ignores it
  });
  const games: any = gamesData?.data || [];
  const { handleGameClick } = useGameClickHandler();

  // If no games and no search query, only show search bar (if enabled)
  if (!isLoading && !error && games.length === 0 && !searchQuery) {
    return (
      <div className="p-4">
        {uiSettings.showSearchBar && (
          <div className="flex justify-end mb-8">
            <div className="relative w-full md:w-[400px]">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#64748A] w-5 h-5 pointer-events-none" />
              <Input
                className="pl-12 w-full h-12 rounded-2xl text-[#64748A] tracking-wider border-2 border-[#64748A] focus:border-[#64748A] focus:outline-none shadow-[0_0_8px_rgba(100,116,138,0.2)]
                            placeholder:text-[#64748A] bg-white/5
                            placeholder:text-sm"
                placeholder="Which game do you want to search for?"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div
        className={`flex flex-col sm:flex-row items-start sm:items-center ${
          uiSettings.showSearchBar ? 'justify-between' : 'justify-start'
        } gap-4 mb-8`}
      >
        <h2 className="text-[#6A7282] dark:text-[#FEFEFE] text-3xl font-worksans tracking-wide">
          Popular
        </h2>
        {uiSettings.showSearchBar && (
          <div className="relative w-full md:w-[400px]">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#64748A] w-5 h-5 pointer-events-none" />
            <Input
              className="pl-12 w-full h-12 rounded-2xl text-[#64748A] tracking-wider border-2 border-[#64748A] focus:border-[#64748A] focus:outline-none shadow-[0_0_8px_rgba(100,116,138,0.2)]
                          placeholder:text-[#64748A] bg-white/5
                          placeholder:text-sm"
              placeholder="Which game do you want to search for?"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="">
        <Card className="border-hidden shadow-none p-0 bg-transparent dark:bg-[#0f1221]">
          {isLoading && <GamesSkeleton count={4} />}
          {error && (
            <div className="text-center py-8 text-red-500">
              Error loading games
            </div>
          )}
          {!isLoading && !error && games.length === 0 && searchQuery && (
            <div className="text-center py-8 min-h-[60vh] flex flex-col items-center justify-center gap-4 text-[#64748A] text-4xl">
              <img
                src={emptyGameImg}
                alt="No games"
                className="w-80 h-80 object-contain"
              />
              No popular games found for "{searchQuery}"
            </div>
          )}
          {!isLoading && !error && games.length > 0 && (
            <div className="grid gap-6 w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 auto-rows-[1fr] sm:auto-rows-[350px] justify-center">
              {games.map((game: any, _index: number) => {
                return (
                  <div
                    key={game.id}
                    className="relative group cursor-pointer w-full"
                  >
                    <div
                      className="relative h-full sm:h-[350px] sm:min-h-[350px] sm:max-h-[350px] rounded-[32px] border-4 border-transparent group-hover:border-[#64748A] transition-all duration-300 ease-in-out group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(100,116,138,0.3)] box-border overflow-hidden aspect-square sm:aspect-auto"
                      onClick={() => handleGameClick(game.id, game.slug)}
                    >
                      <LazyImage
                        src={game.thumbnailFile?.s3Key || emptyGameImg}
                        alt={game.title}
                        className="w-full h-full object-fill"
                        aspectRatio="1/1"
                        width={400}
                        sizes="(max-width: 640px) 256px, (max-width: 1024px) 400px, 512px"
                        variants={game.thumbnailFile?.variants}
                        dimensions={game.thumbnailFile?.dimensions}
                        enableTransform={!game.thumbnailFile?.variants}
                        loadingClassName="rounded-[28px]"
                        spinnerColor="#64748A"
                        rootMargin="50px"
                        fetchPriority={_index < 3 ? 'high' : 'auto'}
                      />
                      {/* Game Info Overlay - Always visible on mobile, hover on desktop */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent group-hover:opacity-100 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100 rounded-[28px]">
                        <h4 className="absolute bottom-2 left-2 md:bottom-3 md:left-4 text-white font-semibold text-xs md:text-base drop-shadow-lg text-shadow-black/55 text-shadow-lg m-0 font-worksans">
                          {game.title}
                        </h4>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default PopularSection;
