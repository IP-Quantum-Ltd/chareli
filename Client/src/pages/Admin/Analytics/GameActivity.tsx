import { useState } from "react";
import { Card } from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { FaChevronUp, FaChevronDown } from "react-icons/fa6";
import { RiGamepadLine } from "react-icons/ri";
import { useGamesWithPopularity, type DashboardFilters } from "../../../backend/analytics.service";
import { NoResults } from "../../../components/single/NoResults";
import GameThumbnail from "./GameThumbnail";
import { formatTime } from "../../../utils/main";

interface GameActivityProps {
  filters?: DashboardFilters;
}

export default function GameActivity({ filters }: GameActivityProps) {
  const { data: gamesAnalytics, isError, isLoading } = useGamesWithPopularity(filters);

  const gamesPerPage = 4;
  const [gamePage, setGamePage] = useState(1);
  const [sortBy, setSortBy] = useState<'time' | 'sessions'>('time');

  if (isLoading) {
    return (
      <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-2">
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full pl-4">
          <div className="justify-between items-center flex p-3">
            <p className="text-lg md:text-2xl">Game Activity</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="text-base font-normal">
                <TableHead>Game</TableHead>
                <TableHead>Total Plays</TableHead>
                <TableHead>Total Time Played</TableHead>
                <TableHead>Most Played At</TableHead>
                <TableHead>Game Status</TableHead>
                <TableHead>Popularity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-6 bg-[#F8FAFC] dark:bg-[#0F1221]"
                >
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282] mx-auto"></div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-4">
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full pl-4">
          <div className="justify-between items-center flex p-3">
            <p className="text-lg md:text-2xl">Game Activity</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="text-lg font-bold">
                <TableHead>Game</TableHead>
                <TableHead>Total Plays</TableHead>
                <TableHead>Total Time Played</TableHead>
                <TableHead>Most Played At</TableHead>
                <TableHead>Game Status</TableHead>
                <TableHead>Popularity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-6 bg-[#F8FAFC] dark:bg-[#0F1221]"
                >
                  <div className="text-red-500">
                    Error loading game activity data
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  const allGames = gamesAnalytics || [];

  // Sort games based on selected sort option
  const sortedGames = [...allGames].sort((a: any, b: any) => {
    if (sortBy === 'time') {
      return (b.metrics?.totalTime || 0) - (a.metrics?.totalTime || 0);
    }
    return (b.metrics?.totalPlays || 0) - (a.metrics?.totalPlays || 0);
  });

  const totalGamePages = Math.ceil(sortedGames.length / gamesPerPage);
  const startIdx = (gamePage - 1) * gamesPerPage;
  const endIdx = startIdx + gamesPerPage;
  const gamesToShow = sortedGames.slice(startIdx, endIdx);

  return (
    <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-4">
      <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full pl-4">
        <div className="justify-between items-center flex p-3">
          <p className="text-lg md:text-2xl">Game Activity</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 mr-2">Sort by:</span>
            <button
              onClick={() => { setSortBy('time'); setGamePage(1); }}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'time'
                  ? 'bg-[#6A7282] text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Time
            </button>
            <button
              onClick={() => { setSortBy('sessions'); setGamePage(1); }}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'sessions'
                  ? 'bg-[#6A7282] text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Sessions
            </button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="text-base">
              <TableHead>
                <p className="pr-8">Game</p>
              </TableHead>
              <TableHead>
                {" "}
                <p className="pr-8">Total Plays</p>
              </TableHead>
              <TableHead>
                {" "}
                <p className="pr-8">Total Time Played</p>
              </TableHead>
              <TableHead>Most Played At</TableHead>
              <TableHead>
                {" "}
                <p className="pr-8">Game Status</p>
              </TableHead>
              <TableHead>
                {" "}
                <p className="pr-8">Popularity</p>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!gamesToShow.length ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-6 bg-[#F8FAFC] dark:bg-[#0F1221]"
                >
                  <NoResults
                    title="No game activity"
                    message="There are no game activity records to display at this time."
                    icon={<RiGamepadLine className="w-12 h-12 text-gray-400" />}
                  />
                </TableCell>
              </TableRow>
            ) : (
              gamesToShow.map((game: any) => (
                <TableRow key={game.id} className="text-sm tracking-wider">
                  <TableCell>
                    <div className="flex items-center gap-3 pr-12">
                      <GameThumbnail src={game.thumbnailUrl} alt={game.title} />
                      <span className="font-dmmono">{game.title ?? '-'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-dmmono pr-8">
                      {game.metrics.totalPlays ?? '-'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-dmmono pr-8">
                      {formatTime(game.metrics.totalTime)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-dmmono">{game.metrics?.mostPlayedAt?.position ?? '-'}</p>
                  </TableCell>
                  <TableCell>
                    {game.status === "active" ? (
                      <span className="inline-flex items-center gap-2 p-1 rounded bg-[#419E6A] text-white font-dmmono  tracking-wider">
                        <span className="w-2 h-2 bg-white rounded-full inline-block"></span>
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 p-1 rounded bg-[#CBD5E0] text-[#22223B] font-dmmono  tracking-wider">
                        <span className="w-2 h-2 bg-red-500 rounded-full inline-block"></span>
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {game.metrics.popularity === "up" ? (
                      <span className="text-green-500 text-2xl">
                        <FaChevronUp />
                      </span>
                    ) : (
                      <span className="text-red-500 text-2xl">
                        <FaChevronDown />
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {gamesToShow.length > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 pr-4 gap-3">
            <span className="text-sm order-2 sm:order-1">
              Showing {startIdx + 1}-{Math.min(endIdx, allGames.length)} from{" "}
              {allGames.length} data
            </span>
            {totalGamePages > 1 && (
              <div className="flex items-center gap-1 order-1 sm:order-2">
                {/* Previous button */}
                <button
                  className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                    gamePage === 1
                      ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                  }`}
                  onClick={() => setGamePage(Math.max(1, gamePage - 1))}
                  disabled={gamePage === 1}
                >
                  ‹
                </button>

                {/* Mobile: Show only current page info */}
                <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                  <span className="text-sm text-black dark:text-white">
                    {gamePage} / {totalGamePages}
                  </span>
                </div>

                {/* Desktop: Show page numbers with smart truncation */}
                <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                  {(() => {
                    const pages = [];
                    const maxVisiblePages = 5;

                                          if (totalGamePages <= maxVisiblePages) {
                        // Show all pages if total is small
                        for (let i = 1; i <= totalGamePages; i++) {
                          pages.push(
                            <button
                              key={i}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                gamePage === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setGamePage(i)}
                            >
                              {i}
                            </button>
                          );
                        }
                    } else {
                      // Smart truncation for many pages
                      const startPage = Math.max(1, gamePage - 2);
                      const endPage = Math.min(totalGamePages, gamePage + 2);

                                              // First page
                        if (startPage > 1) {
                          pages.push(
                            <button
                              key={1}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                gamePage === 1
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setGamePage(1)}
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
                                gamePage === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setGamePage(i)}
                            >
                              {i}
                            </button>
                          );
                        }

                      // Last page
                      if (endPage < totalGamePages) {
                        if (endPage < totalGamePages - 1) {
                          pages.push(
                            <span key="end-ellipsis" className="px-2 text-gray-500">
                              ...
                            </span>
                          );
                        }
                                                  pages.push(
                            <button
                              key={totalGamePages}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                gamePage === totalGamePages
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setGamePage(totalGamePages)}
                            >
                              {totalGamePages}
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
                    gamePage === totalGamePages
                      ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                  }`}
                  onClick={() => setGamePage(Math.min(totalGamePages, gamePage + 1))}
                  disabled={gamePage === totalGamePages}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
