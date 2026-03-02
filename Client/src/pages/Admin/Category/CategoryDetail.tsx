import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { IoChevronBack } from "react-icons/io5";
import { CiEdit } from "react-icons/ci";
import { RiDeleteBin6Line } from "react-icons/ri";
import { FiClock } from "react-icons/fi";
import { LuGamepad2 } from "react-icons/lu";
import { TbCalendarClock } from "react-icons/tb";
import { FaTrophy, FaMedal } from "react-icons/fa";
import { Button } from "../../../components/ui/button";
import { useCategoryById, useDeleteCategory } from "../../../backend/category.service";
import { EditCategory } from "../../../components/single/EditCategory-Sheet";
import { DeleteConfirmationModal } from "../../../components/modals/DeleteConfirmationModal";
import { toast } from "sonner";
import { usePermissions } from "../../../hooks/usePermissions";
import { formatTime } from "../../../utils/main";

export default function CategoryDetail() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [currentPage, setCurrentPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { mutateAsync: deleteCategory, isPending: isDeletingCategory } = useDeleteCategory();
  const { data: categoryData, isLoading } = useCategoryById(categoryId!, {
    page: currentPage,
    limit: 5
  });

  const handleDelete = async () => {
    if (!categoryId) return;
    try {
      await deleteCategory(categoryId);
      toast.success("Category deleted successfully");
      setShowDeleteModal(false);
      navigate("/admin/categories");
    } catch (error: any) {
      console.log(error);
    }
  };

  const getTrophyIcon = (position: number) => {
    switch (position) {
      case 1:
        return <FaTrophy className="w-5 h-5 text-yellow-500" title="Gold Medal" />;
      case 2:
        return <FaMedal className="w-5 h-5 text-gray-400" title="Silver Medal" />;
      case 3:
        return <FaMedal className="w-5 h-5 text-amber-600" title="Bronze Medal" />;
      default:
        return null;
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282]"></div>
      </div>
    );
  }

  if (!categoryData) {
    return (
      <div className="p-8">
        <div className="text-center py-8">Category not found</div>
      </div>
    );
  }

  // The backend returns the category data directly, not nested
  const category = categoryData;
  const games = categoryData.games || [];
  const metrics = categoryData.metrics || { totalPlays: 0, totalSessions: 0, totalTimePlayed: 0 };
  const pagination = categoryData.pagination || { currentPage: 1, totalPages: 1, totalItems: 0, itemsPerPage: 5 };

  return (
    <div className="p-8 flex flex-col gap-6">
      <button
        className="flex items-center justify-center gap-2 text-[#475568] mb-2 border border-[#475568] rounded-lg w-22 py-2 px-1 shadow-md hover:bg-accent dark:text-white cursor-pointer"
        onClick={() => navigate("/admin/categories")}
      >
        <IoChevronBack />
        <p>Back</p>
      </button>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="bg-transparent dark:bg-[#334154] rounded-2xl p-6 flex flex-col items-center w-full md:w-1/3 md:self-start">
          <h2 className="text-sm sm:text-base font-normal font-dmmono text-[#121C2D] tracking-wider dark:text-white text-center truncate mb-4">
            {category.name}
          </h2>

          <div className="flex flex-col gap-2 w-full">
            {permissions.canManageGames ? (
              <>
                <Button
                  variant="outline"
                  className="flex items-center justify-center gap-2 w-full border-2 border-[white] text-[#475568] bg-transparent dark:border-2 dark:border-white dark:text-white cursor-pointer"
                  onClick={() => setEditOpen(true)}
                >
                  Edit <CiEdit className="dark:text-white" />
                </Button>

                {!category.isDefault && (
                  <Button
                    className="flex items-center justify-center gap-2 w-full bg-[#EF4444] text-white tracking-wider hover:bg-[#dc2626] cursor-pointer"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    Delete <RiDeleteBin6Line />
                  </Button>
                )}
              </>
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
          <div className="bg-transparent dark:bg-[#121C2D] rounded-2xl p-6">
            <h3 className="text-base font-normal mb-2 text-[#475568] tracking-wider dark:text-white">
              Overview
            </h3>
            <p className="text-[#475568] whitespace-pre-line dark:text-white font-dmmono text-sm tracking-wider break-words overflow-wrap-anywhere">
              {category.description ?? ""}
            </p>
          </div>

          <div>
            <p className="text-[#18192b] text-xl dark:text-white">
              Game Category Metrics
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-transparent dark:bg-[#121C2D] rounded-xl p-4 sm:p-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="bg-[#6A7282] rounded-full p-2 sm:p-3 flex-shrink-0">
                  <LuGamepad2 className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[#475568] text-base font mb-1 dark:text-white block">
                    Total Plays
                  </span>
                  <span className="text-sm text-[#475568] font-sans dark:text-white">
                    {metrics.totalPlays}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-transparent dark:bg-[#121C2D] rounded-xl p-4 sm:p-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="bg-[#6A7282] rounded-full p-2 sm:p-3 flex-shrink-0">
                  <TbCalendarClock className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[#475568] text-base font mb-1 dark:text-white block">
                    Sessions
                  </span>
                  <span className="text-sm text-[#475568] font-sans dark:text-white">
                    {metrics.totalSessions}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-transparent dark:bg-[#121C2D] rounded-xl p-4 sm:p-6 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="bg-[#6A7282] rounded-full p-2 sm:p-3 flex-shrink-0">
                  <FiClock className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[#475568] text-base font mb-1 dark:text-white block">
                    Minutes Played
                  </span>
                  <span className="text-sm text-[#475568] font-sans dark:text-white">
                    {formatTime(metrics.totalTimePlayed)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-transparent dark:bg-[#121C2D] rounded-2xl p-6">
            <p className="text-[#18192b] text-xl dark:text-white mb-6">
              Category Games
            </p>
            {games.length === 0 ? (
              <div>
                <p className="text-[#475568] dark:text-white text-center">No games in this category</p>
              </div>
            ) : (
              <div>
                {/* Games Table */}
                <div className="overflow-x-auto mb-6">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                          Game
                        </th>
                        <th className="text-left py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                          Sessions
                        </th>
                        <th className="text-left py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                          Total Time Played
                        </th>
                        <th className="text-center py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                          Position
                        </th>
                        <th className="text-center py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                          Best Performing
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((game: any) => {
                        return (
                          <tr
                            key={game.id}
                            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            <td className="py-3 px-2 sm:px-4">
                              <div className="flex items-center gap-2 sm:gap-3">
                                {game.thumbnailFile?.url && (
                                  <img
                                    src={game.thumbnailFile.url}
                                    alt={game.title}
                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded object-cover flex-shrink-0"
                                  />
                                )}
                                <span className="text-xs sm:text-sm font-medium text-[#475568] dark:text-white truncate">
                                  {game.title}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-2 sm:px-4">
                              <span className="text-xs sm:text-sm text-[#475568] dark:text-white">
                                {game.analytics.sessions}
                              </span>
                            </td>
                            <td className="py-3 px-2 sm:px-4">
                              <span className="text-xs sm:text-sm text-[#475568] dark:text-white">
                                {formatTime(game.analytics.totalTimePlayed)}
                              </span>
                            </td>
                            <td className="py-3 px-2 sm:px-4">
                              <div className="flex items-center justify-center">
                                <span className="text-xs sm:text-sm font-medium text-[#475568] dark:text-white">
                                  {game.analytics.position}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-2 sm:px-4">
                              <div className="flex items-center justify-center">
                                {getTrophyIcon(game.analytics.position)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-3">
                    <span className="text-sm order-2 sm:order-1">
                      Showing {((pagination.currentPage - 1) * pagination.itemsPerPage) + 1}-
                      {Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)}{" "}
                      from {pagination.totalItems} data
                    </span>
                    <div className="flex items-center gap-1 order-1 sm:order-2">
                      {/* Previous button */}
                      <button
                        className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                          pagination.currentPage === 1
                            ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                            : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                        }`}
                        onClick={() => handlePageChange(Math.max(1, pagination.currentPage - 1))}
                        disabled={pagination.currentPage === 1}
                      >
                        ‹
                      </button>

                      {/* Mobile: Show only current page info */}
                      <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                        <span className="text-sm text-black dark:text-white">
                          {pagination.currentPage} / {pagination.totalPages}
                        </span>
                      </div>

                      {/* Desktop: Show page numbers */}
                      <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                        {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                          <button
                            key={page}
                            className={`w-8 h-8 rounded-full transition-colors ${
                              page === pagination.currentPage
                                ? "bg-[#6A7282] text-white"
                                : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                            }`}
                            onClick={() => handlePageChange(page)}
                          >
                            {page}
                          </button>
                        ))}
                      </div>

                      {/* Next button */}
                      <button
                        className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                          pagination.currentPage === pagination.totalPages
                            ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                            : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                        }`}
                        onClick={() => handlePageChange(Math.min(pagination.totalPages, pagination.currentPage + 1))}
                        disabled={pagination.currentPage === pagination.totalPages}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Modals */}
      <DeleteConfirmationModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        onConfirm={handleDelete}
        isDeleting={isDeletingCategory}
        title="Are you sure you want to Delete Category?"
        description="This action cannot be reversed"
      />

      {editOpen && categoryId && (
        <EditCategory
          open={editOpen}
          onOpenChange={setEditOpen}
          categoryId={categoryId}
        />
      )}
    </div>
  );
}
