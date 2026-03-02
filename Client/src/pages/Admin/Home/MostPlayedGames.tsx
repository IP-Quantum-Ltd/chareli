import { Card } from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { LazyImage } from "../../../components/ui/LazyImage";
import { useState, useMemo } from "react";
import {
  useGamesAnalytics,
  type GameAnalytics,
} from "../../../backend/analytics.service";
import { formatTime } from "../../../utils/main";
import { NoResults } from "../../../components/single/NoResults";
import { RiGamepadLine } from "react-icons/ri";

export function MostPlayedGames() {
  const { data: gamesWithAnalytics, isLoading } = useGamesAnalytics();

  // Sort state
  const [sortBy, setSortBy] = useState<'time' | 'sessions'>('sessions');

  // Sort games based on selected sort option
  const allGames = useMemo<GameAnalytics[]>(() => {
    if (!gamesWithAnalytics) return [];
    return [...gamesWithAnalytics].sort((a, b) => {
      if (sortBy === 'time') {
        return (b.analytics?.totalPlayTime || 0) - (a.analytics?.totalPlayTime || 0);
      }
      return (b.analytics?.totalSessions || 0) - (a.analytics?.totalSessions || 0);
    });
  }, [gamesWithAnalytics, sortBy]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const gamesPerPage = 4;
  const totalPages = Math.ceil(allGames.length / gamesPerPage);

  const getGamesForPage = (page: number) => {
    const startIdx = (page - 1) * gamesPerPage;
    const endIdx = startIdx + gamesPerPage;
    return allGames.slice(startIdx, endIdx);
  };

  const gamesToShow = getGamesForPage(currentPage);

  return (
    <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
      <div className="flex justify-between items-center p-4 text-2xl">
        <p>Most Played Games</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 mr-2">Sort by:</span>
          <button
            onClick={() => { setSortBy('time'); setCurrentPage(1); }}
            className={`px-3 py-1 rounded text-sm transition-colors cursor-pointer ${
              sortBy === 'time'
                ? 'bg-[#6A7282] text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Time Played
          </button>
          <button
            onClick={() => { setSortBy('sessions'); setCurrentPage(1); }}
            className={`px-3 py-1 rounded text-sm transition-colors cursor-pointer ${
              sortBy === 'sessions'
                ? 'bg-[#6A7282] text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Total Plays
          </button>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Table>
          <TableHeader>
            <TableRow className="text-base font">
              <TableHead>
                {" "}
                <p className="pr-12">Game</p>
              </TableHead>
              <TableHead>
                {" "}
                <p className="pr-12">Total Plays</p>
              </TableHead>
              <TableHead>
                {" "}
                <p className="pr-12">Minutes played</p>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center py-6 hover:bg-transparent"
                >
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282] mx-auto"></div>
                </TableCell>
              </TableRow>
            ) : !gamesToShow.length ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center py-6 bg-[#F8FAFC] dark:bg-[#0F1221]"
                >
                  <NoResults
                    title="No games played yet"
                    message="There are no game play records to display at this time."
                    icon={<RiGamepadLine className="w-12 h-12 text-gray-400" />}
                  />
                </TableCell>
              </TableRow>
            ) : (
              gamesToShow.map((game, idx) => (
                <TableRow key={idx} className="text-sm font-worksans">
                  <TableCell>
                    <div className="flex items-center gap-3 pr-12">
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                        <LazyImage
                          src={game.thumbnailFile?.url || ""}
                          alt={game.title}
                          className="w-full h-full object-cover"
                          loadingClassName="rounded-[16px]"
                          spinnerColor="#6A7282"
                          rootMargin="50px"
                        />
                      </div>
                      <span>{game.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="pr-12">{game.analytics?.totalSessions || 0}</p>
                  </TableCell>
                  <TableCell>
                    <p className="pr-12">
                      {formatTime(game.analytics?.totalPlayTime || 0)}
                    </p>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {gamesToShow.length > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-3">
            <span className="text-sm order-2 sm:order-1">
              Showing {(currentPage - 1) * gamesPerPage + 1}-
              {Math.min(currentPage * gamesPerPage, allGames.length)} from{" "}
              {allGames.length} data
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1 order-1 sm:order-2">
                {/* Previous button */}
                <button
                  className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                    currentPage === 1
                      ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-[#FFF7ED] text-black dark:text-white"
                  }`}
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  ‹
                </button>

                {/* Mobile: Show only current page info */}
                <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                  <span className="text-sm text-black dark:text-white">
                    {currentPage} / {totalPages}
                  </span>
                </div>

                {/* Desktop: Show page numbers with smart truncation */}
                <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                  {(() => {
                    const pages = [];
                    const maxVisiblePages = 5;

                    if (totalPages <= maxVisiblePages) {
                      // Show all pages if total is small
                      for (let i = 1; i <= totalPages; i++) {
                        pages.push(
                          <button
                            key={i}
                            className={`w-8 h-8 rounded-full transition-colors ${
                              currentPage === i
                                ? "bg-[#6A7282] text-white"
                                : "hover:bg-[#6A7282] text-black dark:text-white"
                            }`}
                            onClick={() => setCurrentPage(i)}
                          >
                            {i}
                          </button>
                        );
                      }
                    } else {
                      // Smart truncation for many pages
                      const startPage = Math.max(1, currentPage - 2);
                      const endPage = Math.min(totalPages, currentPage + 2);

                      // First page
                      if (startPage > 1) {
                        pages.push(
                          <button
                            key={1}
                            className={`w-8 h-8 rounded-full transition-colors ${
                              currentPage === 1
                                ? "bg-[#6A7282] text-white"
                                : "hover:bg-[#6A7282] text-black dark:text-white"
                            }`}
                            onClick={() => setCurrentPage(1)}
                          >
                            1
                          </button>
                        );
                        if (startPage > 2) {
                          pages.push(
                            <span key="start-ellipsis" className="px-2 text-gray-500">
                              ...
                            </span>
                          );
                        }
                      }

                      // Current range
                      for (let i = startPage; i <= endPage; i++) {
                        pages.push(
                          <button
                            key={i}
                            className={`w-8 h-8 rounded-full transition-colors ${
                              currentPage === i
                                ? "bg-[#6A7282] text-white"
                                : "hover:bg-[#6A7282] text-black dark:text-white"
                            }`}
                            onClick={() => setCurrentPage(i)}
                          >
                            {i}
                          </button>
                        );
                      }

                      // Last page
                      if (endPage < totalPages) {
                        if (endPage < totalPages - 1) {
                          pages.push(
                            <span key="end-ellipsis" className="px-2 text-gray-500">
                              ...
                            </span>
                          );
                        }
                        pages.push(
                          <button
                            key={totalPages}
                            className={`w-8 h-8 rounded-full transition-colors ${
                              currentPage === totalPages
                                ? "bg-[#6A7282] text-white"
                                : "hover:bg-[#6A7282] text-black dark:text-white"
                            }`}
                            onClick={() => setCurrentPage(totalPages)}
                          >
                            {totalPages}
                          </button>
                        );
                      }
                    }

                    return pages;
                  })()}
                </div>

                {/* Next button */}
                <button
                  className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                    currentPage === totalPages
                      ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-[#6A7282] text-black dark:text-white"
                  }`}
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
