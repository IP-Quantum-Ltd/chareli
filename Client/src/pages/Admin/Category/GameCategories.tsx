import { Trash2, Edit } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateCategory from '../../../components/single/CreateCategory-Sheet';
import { EditCategory } from '../../../components/single/EditCategory-Sheet';
import {
  useCategories,
  useDeleteCategory,
} from '../../../backend/category.service';
// import { useGames } from '../../../backend/games.service';
import { DeleteConfirmationModal } from '../../../components/modals/DeleteConfirmationModal';
import { toast } from 'sonner';
import { usePermissions } from '../../../hooks/usePermissions';

export default function GameCategories() {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { data: categories, isLoading: loadingCategories } = useCategories({
    sortBy: 'averageSessions',
  });
  const { mutateAsync: deleteCategory, isPending: issDeletingCategory } =
    useDeleteCategory();
  // const { data: games, isLoading: loadingGames } = useGames();
  const isLoading = loadingCategories;

  const handleDelete = async () => {
    if (!selectedCategoryId) return;
    try {
      await deleteCategory(selectedCategoryId);
      toast.success('Category deleted successfully');
      setShowDeleteModal(false);
      setSelectedCategoryId(null);
      setEditOpen(false);
    } catch (error: any) {
      console.log(error);
    }
  };

  const getRankMedal = (index: number) => {
    if (index === 0) return '🥇'; // Gold
    if (index === 1) return '🥈'; // Silver
    if (index === 2) return '🥉'; // Bronze
    return `#${index + 1}`;
  };

  return (
    <div className="p-8 bg-[#F1F5F9] dark:bg-[#121C2D]">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <h1 className="text-lg sm:text-3xl font-worksans text-[#6A7282] dark:text-white">
          Game Category
        </h1>
        {permissions.canManageGames && (
          <button
            className="bg-[#6A7282] text-white px-3 py-2 sm:py-3 rounded-lg text-sm sm:text-base tracking-wide hover:bg-[#5A626F] transition self-start sm:self-auto font-dmmono cursor-pointer"
            onClick={() => setCreateOpen(true)}
          >
            Create New Category
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center py-8">Loading...</div>
        ) : !categories?.length ? (
          <div className="col-span-full text-center py-12">
            <p className="text-xl font-dmmono text-[#475568] dark:text-white mb-2">
              No categories found
            </p>
            <p className="text-sm text-[#475568] dark:text-white">
              Click "Create New Category" to add your first category
            </p>
          </div>
        ) : (
          categories.map((cat, index) => (
            <div
              key={cat.name}
              className="bg-[#F1F5F9] rounded-2xl p-6 shadow flex flex-col gap-2 relative min-h-[120px] dark:bg-[#121C2D] cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(`/admin/categories/${cat.id}`)}
              title={`Rank #${index + 1} - Avg Sessions: ${cat.metrics?.averageSessions?.toFixed(1) || 0}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl" title="Category Rank">
                    {getRankMedal(index)}
                  </span>
                  <h2 className="text-xl tracking-wide font-medium font-dmmono text-[#232B3B] dark:text-white">
                    {cat.name}
                  </h2>
                  {cat.isDefault && (
                    <span className="bg-[#6A7282] text-white text-xs px-2 py-1 rounded-full font-medium">
                      Default
                    </span>
                  )}
                </div>
                {permissions.canManageGames ? (
                  <div className="flex gap-2">
                    <button
                      className="p-1 rounded transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCategoryId(cat.id);
                        setEditOpen(true);
                      }}
                    >
                      <Edit className="dark:text-white w-5 h-5 text-black cursor-pointer" />
                    </button>
                    {!cat.isDefault && (
                      <button
                        className="p-1 rounded transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategoryId(cat.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <Trash2 className="text-black w-5 h-5 dark:text-white cursor-pointer" />
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-400 text-xs">View Only</span>
                )}
              </div>
              <p className="text-[#475568] mb-2 font-worksans text-base tracking-wider dark:text-white">
                {cat.description || 'No description'}
              </p>

              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#6A7282] font-bold text-sm shadow-none tracking-wider dark:text-gray-300">
                    {cat.gameCount || (cat.metrics?.gameCount) || 0} games
                  </span>
                  <span className="text-[#6A7282] font-bold text-sm shadow-none tracking-wider dark:text-gray-300">
                    Avg: {cat.metrics?.averageSessions?.toFixed(1) || 0} sessions
                  </span>
                </div>

                {/* Top 3 Games Section */}
                {cat.topGames && cat.topGames.length > 0 && (
                  <div className="mt-1 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                      Top 3 Games (Sessions)
                    </p>
                    <div className="space-y-1">
                      {cat.topGames.map((game: any, index: number) => (
                        <div
                          key={game.id}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="truncate max-w-[150px] text-gray-700 dark:text-gray-300">
                            {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}{' '}
                            {game.title}
                          </span>
                          <span className="text-gray-500 font-mono">
                            {game.sessionCount}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <DeleteConfirmationModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        onConfirm={handleDelete}
        isDeleting={issDeletingCategory}
        title="Are you sure you want to Delete Category?"
        description="This action cannot be reversed"
      />
      <CreateCategory open={createOpen} onOpenChange={setCreateOpen} />
      {editOpen && selectedCategoryId && (
        <EditCategory
          open={editOpen}
          onOpenChange={setEditOpen}
          categoryId={selectedCategoryId}
        />
      )}
    </div>
  );
}
