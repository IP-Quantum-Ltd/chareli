import { IoEyeOutline } from "react-icons/io5";
import { RiDeleteBin6Line } from "react-icons/ri";
import { CiEdit } from "react-icons/ci";
import { Button } from "../../components/ui/button";
import { LazyImage } from "../../components/ui/LazyImage";
import { IoChevronBack } from "react-icons/io5";
import { FiClock } from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import {
  useToggleGameStatus,
  useDeleteGame,
  useGameById,
} from "../../backend/games.service";
import { toast } from "sonner";
import { DeleteConfirmationModal } from "../../components/modals/DeleteConfirmationModal";
import { ToggleGameStatusModal } from "../../components/modals/ToggleGameStatusModal";
import { useState } from "react";
import { formatTime } from "../../utils/main";
import { usePermissions } from "../../hooks/usePermissions";
import { GameBreadcrumb } from "../../components/single/GameBreadcrumb";
import { GameInfoSection } from "../../components/single/GameInfoSection";
import { LuGamepad2 } from "react-icons/lu";
import { TbCalendarClock } from "react-icons/tb";

export default function ViewGame() {
  const permissions = usePermissions();
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { data: gameData, isLoading } = useGameById(gameId || '');
  const toggleStatus = useToggleGameStatus();
  const deleteGame = useDeleteGame();

  // Safe access to game data
  const game = (gameData as any)?.game || gameData;
  const gameImg = game?.thumbnailFile?.s3Key || "/placeholder-game.png";

  const handleBack = () => {
    navigate("/admin/game-management");
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282]"></div>
      </div>
    );
  }

  return (
    <div className="p-8 flex flex-col gap-6">
      <button
        className="flex items-center justify-center gap-2 text-[#475568] mb-2 border border-[#475568] rounded-lg w-22 py-2 px-1 shadow-md hover:bg-accent dark:text-white"
        onClick={handleBack}
      >
        <IoChevronBack />
        <p>Back</p>
      </button>
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left: Game Card */}
        <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-6 flex flex-col items-center w-full md:w-1/3">
          <div className="w-28 h-28 rounded-full overflow-hidden mb-4 bg-gray-100">
            <LazyImage
              src={game?.thumbnailFile?.s3Key || gameImg}
              alt={game?.description || "Game"}
              placeholder={gameImg}
              className="w-full h-full object-cover"
              loadingClassName="rounded-full"
              spinnerColor="#6A7282"
              rootMargin="50px"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center sm:justify-center w-full">
            <h2 className="text-sm sm:text-base font-normal font-dmmono text-[#121C2D] tracking-wider dark:text-white text-center truncate">
              {game?.title || "-"}
            </h2>
            <div className="flex items-center gap-2 flex-shrink-0 mb-2">
              <span
                className={`inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded font-dmmono text-xs sm:text-sm tracking-wider ${
                  game?.status === "active"
                    ? "bg-[#6A7282]/20 dark:bg-[#6A7282] text-[#121C2D] dark:text-white"
                    : "bg-[#CBD5E0] text-[#121C2D]"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded inline-block ${
                    game?.status === "active"
                      ? "bg-[#419E6A]"
                      : "bg-red-500"
                  }`}
                ></span>
                {game?.status === "active"
                  ? "Active"
                  : "Inactive"}
              </span>
              {/* <RiDeleteBin6Line className="text-[#121C2D] w-4 h-5 sm:h-6 dark:text-white" /> */}
            </div>
          </div>
          {/* <p className="text-center text-[#475568] mb-4 text-sm dark:text-white tracking-wider font-worksans text-xl tracking-wider">{(game as any).game?.description || "N/A"}</p> */}
          <div className="flex flex-col gap-2 w-full">
            {permissions.canManageGames ? (
              <>
                <Button
                  variant="outline"
                  className="flex items-center justify-center gap-2 w-full border-2 border-[white] text-[#475568] bg-transparent dark:border-2 dark:border-white dark:text-white cursor-pointer"
                  onClick={() => navigate(`/admin/edit-game/${gameId}`)}
                >
                  Edit <CiEdit className="dark:text-white" />
                </Button>
                {(permissions.isAdmin || permissions.isSuperAdmin) && (
                  <Button
                    className="flex items-center justify-center gap-2 w-full bg-[#6A7282] text-white tracking-wider hover:bg-[#5A626F] cursor-pointer"
                    onClick={() => setShowDisableModal(true)}
                  >
                    {game?.status === "active" ? "Disable" : "Enable"}{" "}
                    <IoEyeOutline />
                  </Button>
                )}
              </>
            ) : null}

            {permissions.canDelete ? (
              <Button
                className="flex items-center justify-center gap-2 w-full bg-[#EF4444] text-white tracking-wider hover:bg-[#dc2626] cursor-pointer"
                onClick={() => setShowDeleteModal(true)}
              >
                Delete <RiDeleteBin6Line />
              </Button>
            ) : null}

            {permissions.isViewer && (
              <div className="flex items-center justify-center w-full py-2 px-4 bg-gray-300 text-gray-600 rounded-md">
                <span className="text-sm font-medium">View Only</span>
              </div>
            )}
          </div>
        </div>
        {/* Right: Details */}
        <div className="flex-1 flex flex-col gap-6">
          {/* <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-6">
            <h3 className="text-base font-normal mb-2 text-[#475568] tracking-wider dark:text-white">
              Overview
            </h3>
            {game?.description ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none
                  prose-headings:font-dmmono prose-p:font-worksans prose-li:font-worksans
                  prose-ul:list-disc prose-ol:list-decimal prose-ul:ml-6 prose-ol:ml-6
                  dark:prose-headings:text-white dark:prose-p:text-gray-300 dark:prose-li:text-gray-300"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(game.description) }}
              />
            ) : (
              <p className="text-[#475568] dark:text-white font-dmmono text-sm">-</p>
            )}
          </div> */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex-1">
              <h3 className="font-normal mb-1 text-[#475568] tracking-wider text-base dark:text-white">
                Game Category
              </h3>
              <p className=" text-[#475568] dark:text-white  font-dmmono text-sm tracking-wider">
                {game?.category?.name || "-"}
              </p>
            </div>
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex-1">
              <h3 className="font-normal mb-1 text-[#475568] dark:text-white">
                Position
              </h3>
              <p className="text-[#475568] dark:text-white font-dmmono text-sm tracking-wider">
                {game?.position
                  ? `#${game.position}`
                  : "Not assigned"}
              </p>
            </div>
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex-1">
              <h3 className="font-normal mb-1 text-[#475568] dark:text-white">
                Gameplay URL
              </h3>
              {(() => {
                const slug = game?.slug;
                // Construct the public gameplay URL
                const gameplayUrl = slug
                  ? `${window.location.origin}/gameplay/${slug}`
                  : null;
                return (
                  <a
                    href={gameplayUrl || "#"}
                    className="text-[#475568] underline dark:text-white font-dmmono tracking-wider text-sm break-all overflow-wrap-anywhere block"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={gameplayUrl || "#"}
                  >
                    {gameplayUrl || "-"}
                  </a>
                );
              })()}
            </div>
          </div>
          <div>
            <p className="text-[#18192b] text-xl border-b dark:text-white">
              Game Metrics
            </p>
          </div>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex gap-4">
              <div className="bg-[#6A7282] rounded-full px-3 py-3 items-center">
                <FiClock className="w-8 h-8  text-white dark:text-[#OF1621]" />
              </div>
              <div className="flex flex-col justify-start">
                <span className="text-[#475568] text-base font mb-1 dark:text-white">
                  Minutes Played
                </span>
                <span className="text-sm text-[#475568] font-sans dark:text-white">
                  {formatTime(game?.analytics?.totalPlayTime || 0)}
                </span>
              </div>
            </div>
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex gap-4">
              <div className="bg-[#6A7282] rounded-full px-3 py-3">
                <LuGamepad2 className="w-8 h-8 text-white dark:text-[#OF1621]" />
              </div>
              <div className="flex flex-col justify-start">
                <span className="text-[#475568] text-base font mb-1 dark:text-white">
                  Total Plays
                </span>
                <span className="text-sm text-[#475568] font-sans dark:text-white">
                  {game?.analytics?.uniquePlayers ?? "-"}
                </span>
              </div>
            </div>
            <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl p-4 flex-1 flex gap-4">
              <div className="bg-[#6A7282] rounded-full px-3 py-3">
                <TbCalendarClock className="w-8 h-8 text-white dark:text-[#OF1621]" />
              </div>
              <div className="flex flex-col justify-start">
                <span className="text-[#475568] text-base font mb-1 dark:text-white">
                  Game Sessions
                </span>
                <span className="text-sm text-[#475568] font-sans dark:text-white">
                  {game?.analytics?.totalSessions ?? "-"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SEO Content Preview Section */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white font-dmmono">
              SEO Content
            </h2>
          </div>
          {permissions.canManageGames && (
            <Button
              variant="outline"
              className="flex items-center gap-2 border-2 border-gray-300 dark:border-gray-600"
              onClick={() => navigate(`/admin/edit-game/${gameId}`)}
            >
              <CiEdit className="w-4 h-4" />
              Edit Game
            </Button>
          )}
        </div>

        {/* SEO Preview Container */}
        <div className="bg-white dark:bg-[#0F1221] rounded-lg p-6 sm:p-8">
          {/* Breadcrumb */}
          <div className="mb-8">
            <GameBreadcrumb
              categoryName={game?.category?.name}
              categoryId={game?.category?.id}
              gameTitle={game?.title}
            />
          </div>

          {/* Game Info Section */}
          <GameInfoSection
            game={game}
            likeCount={gameData?.likeCount || 0}
            hideEditButton={true}
          />
        </div>
      </div>

      {/* Toggle Game Status Modal */}
      <ToggleGameStatusModal
        open={showDisableModal}
        onOpenChange={setShowDisableModal}
        gameStatus={game?.status || "disabled"}
        gameTitle={game?.title || "this game"}
        isToggling={toggleStatus.isPending}
        onConfirm={async () => {
          try {
            await toggleStatus.mutateAsync({
              gameId: gameId || "",
              currentStatus: game?.status || "disabled",
            });
            toast.success(
              `Game ${
                game?.status === "active"
                  ? "disabled"
                  : "enabled"
              } successfully`
            );
            setShowDisableModal(false);
          } catch {
            toast.error("Failed to update game status");
          }
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        onConfirm={async () => {
          try {
            await deleteGame.mutateAsync(gameId || "");
            toast.success("Game deleted successfully");
            navigate("/admin/game-management");
          } catch {
            toast.error("Failed to delete game");
          }
        }}
        isDeleting={deleteGame.isPending}
      />

      {/* Edit Sheet */}

    </div>
  );
}
