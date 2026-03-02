/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import ReOrderModal from "../../../components/modals/AdminModals/ReOrderModal";
import { Card } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { DeleteConfirmationModal } from "../../../components/modals/DeleteConfirmationModal";
import { toast } from "sonner";
import {
  useAllPositionHistory,
  useDeleteGame,
} from "../../../backend/games.service";
// import { useGamesAnalytics } from "../../../backend/analytics.service";
import type { GameStatus } from "../../../backend/types";
import { useQuery } from "@tanstack/react-query";
import { backendService } from "../../../backend/api.service";
import { NoResults } from "../../../components/single/NoResults";
import { useQueryClient } from "@tanstack/react-query";
import { BackendRoute } from "../../../backend/constants";
import { FilterSheet } from "../../../components/single/Filter-Sheet";
import { HistoryFilterSheet } from "../../../components/single/HistoryFilter-Sheet";
import { IoEyeOutline, IoEyeOffOutline } from "react-icons/io5";
import { CiEdit } from "react-icons/ci";
import {
  RiDeleteBin6Line,
  RiEqualizer2Line,
  RiGamepadLine,
} from "react-icons/ri";
// import { CreateGameSheet } from "../../../components/single/CreateGame-Sheet";
import { useNavigate } from "react-router-dom";

import { cn } from "../../../lib/utils";
import { formatTime } from "../../../utils/main";
import GameThumbnail from "../Analytics/GameThumbnail";
import { X, Search } from "lucide-react";
import { usePermissions } from "../../../hooks/usePermissions";
import { useWebSocket } from "../../../hooks/useWebSocket";
import { getGameProgress } from "../../../utils/gameProgress";
import { Input } from "../../../components/ui/input";

const pageSize = 10;

// Custom hook to detect user activity/idle state
const useUserActivity = (idleTimeMs = 60000) => {
  const [isUserActive, setIsUserActive] = useState(true);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const resetActivityTimer = () => {
      clearTimeout(timeout);
      setIsUserActive(true);
      timeout = setTimeout(() => {
        setIsUserActive(false); // User becomes inactive after 60s
      }, idleTimeMs);
    };

    // All user activity events
    const activityEvents = [
      'mousedown', 'mousemove', 'mouseup', 'click',
      'keydown', 'keyup', 'scroll', 'wheel',
      'touchstart', 'touchmove', 'touchend'
    ];

    activityEvents.forEach(event => {
      document.addEventListener(event, resetActivityTimer, { passive: true });
    });

    // Initialize timer
    resetActivityTimer();

    return () => {
      clearTimeout(timeout);
      activityEvents.forEach(event => {
        document.removeEventListener(event, resetActivityTimer);
      });
    };
  }, [idleTimeMs]);

  return isUserActive;
};

export default function GameManagement() {
  const permissions = usePermissions();

  // Initialize WebSocket connection for real-time status updates
  useWebSocket();

  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [filters, setFilters] = useState<{
    categoryId?: string;
    status?: GameStatus;
  }>();
  const [historyFilters, setHistoryFilters] = useState<{
    position?: number;
    positionMin?: number;
    positionMax?: number;
    clickCountMin?: number;
    clickCountMax?: number;
    gameTitle?: string;
  }>();
  const navigate = useNavigate();


  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [reOrderModalOpen, setReOrderModalOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState<{
    id: string;
    title: string;
    category?: { id: string; name: string } | null;
    thumbnailFile?: { url: string } | null;
    position?: string | number;
  } | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderHistoryOpen, setReorderHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  // User activity detection (becomes inactive after 60s of no activity)
  const isUserActive = useUserActivity(60000);

  // Custom hook for smart polling games analytics - created locally for efficiency
  const useSmartGamesAnalytics = () => {
    return useQuery({
      queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      queryFn: async () => {
        const response = await backendService.get(BackendRoute.ADMIN_GAMES_ANALYTICS);
        return response.data;
      },
      refetchOnWindowFocus: false,
      refetchInterval: (data: any) => {
        if (!data?.data || !Array.isArray(data.data)) return false;

        const processingGames = data.data.filter((game: any) =>
          game.processingStatus && ['pending', 'processing'].includes(game.processingStatus)
        );

        if (processingGames.length === 0) return false;

        // User interaction checks - directly access local state
        const modalOpen = deleteModalOpen || reOrderModalOpen;
        const filterActive = !!filters || !!historyFilters;
        const reorderModeActive = reorderOpen || reorderHistoryOpen;

        // Smart polling logic:
        const shouldPausePolling = (modalOpen || filterActive || reorderModeActive) && isUserActive;

        if (shouldPausePolling) {
          console.log('⏸️ Polling paused - user actively interacting');
          return false;
        }

        if (modalOpen && !isUserActive) {
          console.log('▶️ Polling resumed - user idle for 60s');
        }

        // Poll every 10 seconds for processing games
        return 10000;
      },
      refetchIntervalInBackground: true,
      staleTime: 0, // Set to 0 to ensure cache updates trigger re-renders
      structuralSharing: false, // Disable structural sharing to force re-renders on cache updates
    });
  };

  // Use the local smart polling hook
  const { data: gamesWithAnalytics, isLoading, isRefetching, dataUpdatedAt } = useSmartGamesAnalytics();

  const deleteGame = useDeleteGame();

  console.log(isRefetching, dataUpdatedAt)

  // Enhanced status rendering function
  const renderGameStatus = (game: any) => {
    let pendingProgress = 0;
    let progress = 0;
    // Show processing status if game is being processed
    if (game.processingStatus && game.processingStatus !== 'completed') {
      switch (game.processingStatus) {
        case 'pending':
          // Get progress from global storage
          pendingProgress = getGameProgress(game.id) || 0;

          // If there's progress, show it like processing
          if (pendingProgress > 0) {
            return (
              <div className="flex flex-col gap-1 min-w-[120px]">
                <span className="inline-flex items-center gap-2 p-1 rounded bg-yellow-500 text-white tracking-wider text-nowrap">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  Queued... {pendingProgress}%
                </span>
                {/* Progress bar */}
                <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 transition-all duration-300 ease-out"
                    style={{ width: `${pendingProgress}%` }}
                  ></div>
                </div>
              </div>
            );
          }

          // No progress yet, show regular queued
          return (
            <span className="inline-flex items-center gap-2 p-1 rounded bg-yellow-500 text-white tracking-wider text-nowrap">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              Queued
            </span>
          );

        case 'processing':
          // Get progress from global storage
          progress = getGameProgress(game.id) || 0;
          return (
            <div className="flex flex-col gap-1 min-w-[120px]">
              <span className="inline-flex items-center gap-2 p-1 rounded bg-blue-500 text-white tracking-wider text-nowrap">
                <div className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin"></div>
                Processing... {progress}%
              </span>
              {/* Progress bar */}
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          );

        case 'failed':
          return (
            <div className="relative group">
              <span className="inline-flex items-center gap-2 p-1 rounded bg-red-500 text-white tracking-wider text-nowrap cursor-help">
                <span className="w-2 h-2 bg-white rounded-full"></span>
                Failed
              </span>

              {/* Error tooltip */}
              {game.processingError && (
                <div className="absolute left-0 top-full mt-1 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 shadow-lg max-w-xs">
                  {game.processingError}
                  <div className="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                </div>
              )}
            </div>
          );
      }
    }

    // Show normal active/inactive status for completed games
    return game.status === "active" ? (
      <span className="inline-flex items-center gap-2 p-1 rounded bg-[#419E6A] text-white tracking-wider text-nowrap">
        <span className="w-2 h-2 bg-white rounded-full"></span>
        Active
      </span>
    ) : (
      <span className="inline-flex items-center gap-2 p-1 rounded bg-[#CBD5E0] text-[#22223B] tracking-wider text-nowrap">
        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
        Inactive
      </span>
    );
  };
  const { data: historyResponse } = useAllPositionHistory({
    ...historyFilters
  });

  console.log("History Response:", historyResponse);

  // Handle both paginated and non-paginated responses
  const allHistoryData = Array.isArray(historyResponse) ? historyResponse : (historyResponse?.data || []);
  const historyTotal = allHistoryData.length;
  const historyTotalPages = Math.ceil(historyTotal / pageSize);

  // Apply client-side pagination to history data
  const startIndex = (historyPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const gameData = allHistoryData.slice(startIndex, endIndex);

  // Apply filters and search
  const filteredGames = (gamesWithAnalytics ?? []).filter((game: any) => {
    // Apply category and status filters
    if (filters?.categoryId && game.category?.id !== filters.categoryId)
      return false;
    if (filters?.status && game.status !== filters.status) return false;

    // Apply search filter
    if (searchQuery && !game.title.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;

    return true;
  });

  const handleDelete = async () => {
    if (!selectedGameId) return;
    try {
      await deleteGame.mutateAsync(selectedGameId);
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
      });
      toast.success("Game deleted successfully");
      setDeleteModalOpen(false);
      setDeleteModalOpen(false);
      setSelectedGameId(null); // Clear selected game
    } catch (error: any) {
      // Check if it's a "not found" error, which means the game was already deleted
      if (error?.response?.data?.error?.message?.includes("not found")) {
        queryClient.invalidateQueries({
          queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
        });
        toast.success("Game deleted successfully");
        setDeleteModalOpen(false);
        setDeleteModalOpen(false);
        setSelectedGameId(null); // Clear selected game
      } else {
        toast.error("Failed to delete game");
      }
    }
  };

  const totalGames = filteredGames.length;
  const totalPages = Math.ceil(totalGames / pageSize);

  // Apply client-side pagination to games data
  const gamesStartIndex = (page - 1) * pageSize;
  const gamesEndIndex = gamesStartIndex + pageSize;
  const paginatedGames = filteredGames.slice(gamesStartIndex, gamesEndIndex);

  return (
    <div className="p-6 bg-[#F1F5F9] dark:bg-[#121C2D]">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-[#6A7282] dark:text-white text-2xl sm:text-3xl font-worksans">
          All Games
        </h1>
        <div className="flex flex-wrap gap-3 justify-end ">
          {/* Filter buttons - hidden for viewers */}
          {permissions.canFilter && (
            <>
              {!reorderHistoryOpen ? (
                <FilterSheet
                  onFilter={setFilters}
                  onReset={() => setFilters(undefined)}
                >
                  <Button
                    variant="outline"
                    className="border-[#475568] text-[#475568] flex items-center gap-2 dark:text-white py-2 sm:py-[14px] text-sm sm:text-base h-[48px] font-dmmono cursor-pointer"
                  >
                    Filter Games
                    <RiEqualizer2Line size={24} className="sm:size-8" />
                  </Button>
                </FilterSheet>
              ) : (
                <HistoryFilterSheet
                  onFilter={setHistoryFilters}
                  onReset={() => setHistoryFilters(undefined)}
                >
                  <Button
                    variant="outline"
                    className="border-[#475568] text-[#475568] flex items-center gap-2 dark:text-white py-2 sm:py-[14px] text-sm sm:text-base h-[48px] font-dmmono cursor-pointer"
                  >
                    Filter History
                    <RiEqualizer2Line size={24} className="sm:size-8" />
                  </Button>
                </HistoryFilterSheet>
              )}
            </>
          )}

          {/* Hide reorder and create buttons for viewers */}
          {permissions.canManageGames && (
            <>
              <Button
                className={`text-[#0F1621] font-normal text-sm sm:text-base px-[16px] py-[14px] h-[48px] bg-[#F8FAFC] hover:bg-[#F8FAFC] border-[#E2E8F0] dark:border-none border-1 font-dmmono ${
                  reorderOpen ? "bg-[#94A3B7] hover:bg-[#94A3B7]" : ""
                }`}
                onClick={() => {
                  setReorderOpen(!reorderOpen);
                  setReorderHistoryOpen(false);
                }}
              >
                {reorderOpen ? (
                  <span className="flex justify-between items-center gap-2 text-white cursor-pointer">
                    Re-order mode <X size={16} color="white" />
                  </span>
                ) : (
                  <span className="cursor-pointer">Reorder Games</span>
                )}
              </Button>
              {reorderOpen && (
                <Button
                  className={`font-normal text-sm sm:text-base px-[16px] py-[14px] h-[48px] bg-white hover:bg-[#F8FAFC]  text-black border-[#E2E8F0] border-1 dark:border-none font-dmmono cursor-pointer ${
                    reorderHistoryOpen
                      ? "bg-[#6A7282] hover:bg-[#5A626F] text-white"
                      : ""
                  }`}
                  onClick={() => setReorderHistoryOpen(!reorderHistoryOpen)}
                >
                  Reorder History
                </Button>
              )}
              {!reorderOpen && (
                <Button
                  className="bg-[#6A7282] text-white hover:bg-[#6A7282] tracking-wider py-2 sm:py-[14px] text-sm sm:text-base h-[48px] font-dmmono cursor-pointer"
                  onClick={() => navigate('/admin/create-game')}
                >
                  Create New Game
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {/* Search bar */}
      {!reorderHistoryOpen && (
        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder="Search games by title..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1); // Reset to first page when searching
              }}
              className="pl-10 h-12 bg-white dark:bg-[#23243a] border-gray-300 dark:border-gray-600 focus:border-[#6A7282] dark:focus:border-[#6A7282]"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}
      {reorderOpen && (
        <div className="flex bg-[#6A7282] text-white text-sm sm:text-[18px] font-bolde justify-center items-center h-[52px] mb-[20px]">
          <p>Reorder-mode: Click game to reorder</p>
        </div>
      )}
      {!reorderHistoryOpen ? (
        <Card className="p-0 overflow-x-auto shadow-none border border-none bg-[#F1F5F9] dark:bg-[#18192b]">
          <table className="min-w-full bg-transparent font-worksans">
            <thead>
              <tr className="dark:bg-[#18192b] text-base sm:text-lg tracking-wide">
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Game
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Category
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Minutes played
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Position
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Game Status
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-3 text-center cursor-pointer"
                  >
                    Loading...
                  </td>
                </tr>
              ) : !filteredGames.length ? (
                <tr>
                  <td colSpan={6}>
                    <NoResults
                      title={
                        gamesWithAnalytics?.length
                          ? "No matching results"
                          : "No games found"
                      }
                      message={
                        gamesWithAnalytics?.length
                          ? "Try adjusting your filters"
                          : "No games have been added to the system yet"
                      }
                      icon={
                        <RiGamepadLine className="w-12 h-12 text-gray-400" />
                      }
                    />
                  </td>
                </tr>
              ) : (
                paginatedGames.map((game: any, idx: any) => (
                  <tr
                    key={game.id}
                    className={cn(
                      "border-b dark:border-[#23243a] hover:bg-[#FFF7ED]/40 dark:hover:bg-[#23243a]/40 transition  text-sm cursor-pointer space-x-12",
                      idx % 2 === 0 ? "dark:bg-[#18192b]" : "dark:bg-[#23243a]"
                    )}
                    onClick={() => {
                      if (reorderOpen) {
                        setSelectedGame({
                          id: game.id,
                          title: game.title,
                          category: game.category,
                          thumbnailFile: game.thumbnailFile,
                          position: game.position,
                        });
                        setReOrderModalOpen(true);
                      }
                    }}
                  >
                    <td className="px-4 py-3 flex items-center gap-3">
                      <GameThumbnail
                        src={(game.thumbnailFile as any)?.url || ""}
                        alt={game.title}
                      />
                      <span className="font-light text-nowrap">
                        {game.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 tracking-wider">
                      {game.category?.name ? (
                        <div className="relative group">
                          <span
                            className="block truncate max-w-[150px]"
                            title={game.category.name.length > 20 ? game.category.name : undefined}
                          >
                            {game.category.name.length > 20
                              ? `${game.category.name.substring(0, 20)}...`
                              : game.category.name
                            }
                          </span>
                          {game.category.name.length > 20 && (
                            <div className="absolute left-0 top-full mt-1 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 shadow-lg max-w-xs">
                              {game.category.name}
                              <div className="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                            </div>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3  tracking-wider text-nowrap">
                      {game.analytics?.totalPlayTime != null
                        ? formatTime(game.analytics.totalPlayTime || 0)
                        : "-"}
                    </td>
                    <td className="px-4 py-3  tracking-wider text-nowrap">
                      {`#${game.position ?? "-"}`}
                    </td>
                    <td className="px-4 py-3">
                      {renderGameStatus(game)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 items-center">
                        {/* Edit button - only for users who can manage games */}
                        {permissions.canManageGames && (
                          <button
                            className="text-black hover:text-black p-1 dark:text-white cursor-pointer"
                            title="Edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/admin/edit-game/${game.id}`);
                            }}
                          >
                            <CiEdit className="cursor-pointer" />
                          </button>
                        )}

                        {/* View button - available for all users */}
                        <button
                          className="text-black hover:text-black p-1 dark:text-white cursor-pointer"
                          title="View"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/view-game/${game.id}`);
                          }}
                        >
                          {game.status === "active" ? (
                            <IoEyeOutline className="cursor-pointer" />
                          ) : (
                            <IoEyeOffOutline className="cursor-pointer" />
                          )}
                        </button>

                        {/* Delete button - only for users who can delete */}
                        {permissions.canDelete && (
                          <button
                            className="text-black hover:text-black p-1 dark:text-white cursor-pointer"
                            title="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedGameId(game.id);
                              setDeleteModalOpen(true);
                            }}
                          >
                            <RiDeleteBin6Line className="cursor-pointer" />
                          </button>
                        )}

                        {/* Show "View Only" text for viewers when no actions are available */}
                        {permissions.isViewer && (
                          <span className="text-gray-400 text-xs">View Only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* Pagination */}
          {filteredGames.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-3 bg-[#F1F5F9] dark:bg-[#18192b] rounded-b-xl gap-3">
              <span className="text-sm order-2 sm:order-1">
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, totalGames)} from {totalGames} data
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1 order-1 sm:order-2">
                  {/* Previous button */}
                  <button
                    className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                      page === 1
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#FFF7ED] text-black dark:text-white"
                    }`}
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                  >
                    ‹
                  </button>

                  {/* Mobile: Show only current page info */}
                  <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                    <span className="text-sm text-black dark:text-white">
                      {page} / {totalPages}
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
                                page === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setPage(i)}
                            >
                              {i}
                            </button>
                          );
                        }
                      } else {
                        // Smart truncation for many pages
                        const startPage = Math.max(1, page - 2);
                        const endPage = Math.min(totalPages, page + 2);

                        // First page
                        if (startPage > 1) {
                          pages.push(
                            <button
                              key={1}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                page === 1
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setPage(1)}
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
                                page === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setPage(i)}
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
                                page === totalPages
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setPage(totalPages)}
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
                      page === totalPages
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#FFF7ED] text-black dark:text-white"
                    }`}
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-0 overflow-x-auto shadow-none border border-none bg-[#F1F5F9] dark:bg-[#18192b]">
          <table className="min-w-full bg-transparent">
            <thead>
              <tr className="dark:bg-[#18192b] text-base tracking-wide">
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Game
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Order number
                </th>
                <th className="px-4 py-3 text-left font-normal text-nowrap">
                  Number of Clicks
                </th>
              </tr>
            </thead>
            <tbody className="font-worksans">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-center">
                    Loading...
                  </td>
                </tr>
              ) : !gameData?.length ? (
                <tr>
                  <td colSpan={3}>
                    <NoResults
                      title={
                        gameData?.length
                          ? "No matching results"
                          : "No history found"
                      }
                      message={
                        gameData?.length
                          ? "Try adjusting your filters"
                          : "No position history data available yet"
                      }
                      icon={
                        <RiGamepadLine className="w-12 h-12 text-gray-400" />
                      }
                    />
                  </td>
                </tr>
              ) : (
                gameData.map((game: any, idx: number) => (
                  <tr
                    key={game.id}
                    className={cn(
                      "border-b dark:border-[#23243a] hover:bg-[#FFF7ED]/40 dark:hover:bg-[#23243a]/40 transition space-x-12",
                      idx % 2 === 0 ? "dark:bg-[#18192b]" : "dark:bg-[#23243a]"
                    )}
                  >
                    <td className="px-4 py-3 flex items-center gap-3">
                      <GameThumbnail
                        src={game.game?.thumbnailFile?.s3Key ?? ""}
                        alt={game.game?.title ?? ""}
                      />
                      <span className=" font-light text-sm text-nowrap">
                        {game?.game?.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm tracking-wider text-nowrap">
                      {`#${game?.position ?? "-"}`}
                    </td>
                    <td className="px-4 py-3 text-sm tracking-wider text-nowrap">
                      {game?.clickCount ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* Pagination for history table */}
          {historyTotal > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-3 bg-[#F1F5F9] dark:bg-[#18192b] rounded-b-xl gap-3">
              <span className="text-sm order-2 sm:order-1">
                Showing {(historyPage - 1) * pageSize + 1}-
                {Math.min(historyPage * pageSize, historyTotal)} from{" "}
                {historyTotal} history records
              </span>
              {historyTotalPages > 1 && (
                <div className="flex items-center gap-1 order-1 sm:order-2">
                  {/* Previous button */}
                  <button
                    className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                      historyPage === 1
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                    }`}
                    onClick={() => setHistoryPage(Math.max(1, historyPage - 1))}
                    disabled={historyPage === 1}
                  >
                    ‹
                  </button>

                  {/* Mobile: Show only current page info */}
                  <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                    <span className="text-sm text-black dark:text-white">
                      {historyPage} / {historyTotalPages}
                    </span>
                  </div>

                  {/* Desktop: Show page numbers with smart truncation */}
                  <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                    {(() => {
                      const pages = [];
                      const maxVisiblePages = 5;

                      if (historyTotalPages <= maxVisiblePages) {
                        // Show all pages if total is small
                        for (let i = 1; i <= historyTotalPages; i++) {
                          pages.push(
                            <button
                              key={i}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                historyPage === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setHistoryPage(i)}
                            >
                              {i}
                            </button>
                          );
                        }
                      } else {
                        // Smart truncation for many pages
                        const startPage = Math.max(1, historyPage - 2);
                        const endPage = Math.min(historyTotalPages, historyPage + 2);

                        // First page
                        if (startPage > 1) {
                          pages.push(
                            <button
                              key={1}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                historyPage === 1
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setHistoryPage(1)}
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
                                historyPage === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setHistoryPage(i)}
                            >
                              {i}
                            </button>
                          );
                        }

                        // Last page
                        if (endPage < historyTotalPages) {
                          if (endPage < historyTotalPages - 1) {
                            pages.push(
                              <span key="end-ellipsis" className="px-2 text-gray-500">
                                ...
                              </span>
                            );
                          }
                          pages.push(
                            <button
                              key={historyTotalPages}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                historyPage === historyTotalPages
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setHistoryPage(historyTotalPages)}
                            >
                              {historyTotalPages}
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
                      historyPage === historyTotalPages
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                    }`}
                    onClick={() => setHistoryPage(Math.min(historyTotalPages, historyPage + 1))}
                    disabled={historyPage === historyTotalPages}
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}



      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleDelete}
        isDeleting={deleteGame.isPending}
      />
      {reOrderModalOpen && selectedGame && (
        <div className="relative">
          <ReOrderModal
            onOpenChange={setReOrderModalOpen}
            game={selectedGame}
          />
        </div>
      )}
    </div>
  );
}
