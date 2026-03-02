import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { UserManagementFilterSheet } from "../../../components/single/UserMgtFilter-Sheet";
import { Button } from "../../../components/ui/button";
import { RiEqualizer2Line, RiDeleteBin6Line } from "react-icons/ri";
import { Search } from "lucide-react";
import ExportModal from "../../../components/modals/AdminModals/ExportModal";
import { DeleteConfirmationModal } from "../../../components/modals/DeleteConfirmationModal";
import { useNavigate } from "react-router-dom";
import {
  useUsersAnalytics,
} from "../../../backend/analytics.service";
import { useDeleteUser } from "../../../backend/user.service";
import type {
  FilterState,
} from "../../../backend/analytics.service";
import { NoResults } from "../../../components/single/NoResults";
import { formatTime } from "../../../utils/main";
import { toast } from "sonner";
// import { useQueryClient } from "@tanstack/react-query";
// import { BackendRoute } from "../../../backend/constants";
import { useAuth } from "../../../context/AuthContext";
import { usePermissions } from "../../../hooks/usePermissions";

export default function UserManagement() {
  const navigate = useNavigate();
  // const queryClient = useQueryClient();
  const { user: currentUser, logout } = useAuth();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [userToDelete, setUserToDelete] = useState<any>(null);
  const deleteUser = useDeleteUser();
  const [filters, setFilters] = useState<FilterState>({
    registrationDates: {
      startDate: "",
      endDate: "",
    },
    lastLoginDates: {
      startDate: "",
      endDate: "",
    },
    sessionCount: "",
    timePlayed: {
      min: 0,
      max: 0,
    },
    gameTitle: [],
    gameCategory: [],
    country: [],
    ageGroup: "",
    sortBy: "createdAt",
    sortOrder: "asc",
  });

  const { data: users, isLoading } = useUsersAnalytics(filters);
  const usersPerPage = 12;

  const handleFiltersChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  };

  const handleFilterReset = () => {
    setFilters({
      registrationDates: {
        startDate: "",
        endDate: "",
      },
      lastLoginDates: {
        startDate: "",
        endDate: "",
      },
      sessionCount: "",
      timePlayed: {
        min: 0,
        max: 0,
      },
      gameTitle: [],
      gameCategory: [],
      country: [],
      ageGroup: "",
      sortBy: "createdAt",
      sortOrder: "asc",
    });
    setPage(1);
  };

  // Handle delete user with permission check
  // const handleDeleteUser = (user: any) => {
  //   setUserToDelete(user);
  // };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    // Check if admin is deleting themselves
    const isDeletingSelf = currentUser?.id === userToDelete.id;

    try {
      await deleteUser.mutateAsync(userToDelete.id);

      toast.success(`User ${userToDelete.firstName} ${userToDelete.lastName} deleted successfully`);
      setUserToDelete(null);

      // If admin deleted themselves, log them out and redirect
      if (isDeletingSelf) {
        setTimeout(() => {
          logout(true); // Silent logout (no additional toast)
          navigate("/");
        }, 1000); // Give time for the success toast to be seen
      }
    } catch (error: any) {
      // Check if it's a permission error for trying to delete superadmin
      if (error?.response?.data?.message?.includes('cannot delete superadmin')) {
        toast.error("Admin cannot delete superadmin accounts");
      } else {
        toast.error("Failed to delete user");
      }
    }
  };

  // Filter users based on search query
  const getFilteredUsers = () => {
    if (!users) return [];

    if (!searchQuery.trim()) return users;

    const query = searchQuery.toLowerCase();
    return users.filter(user => {
      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
      const email = (user.email || "").toLowerCase();
      const phone = (user.phoneNumber || "").toLowerCase();
      const country = (user.country || "").toLowerCase();
      const id = user.id.toLowerCase();

      return fullName.includes(query) ||
             email.includes(query) ||
             phone.includes(query) ||
             country.includes(query) ||
             id.includes(query);
    });
  };

  const filteredUsers = getFilteredUsers();

  return (
    <div className="px-3 bg-[#F1F5F9] dark:bg-[#121C2D]">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-[#6A7282] dark:text-white text-2xl sm:text-3xl font-worksans">
          User Management
        </h1>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-end">
          {permissions.canFilter && (
            <>
              <div className="relative w-full sm:w-auto sm:min-w-[250px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="pl-10 bg-white dark:bg-[#1E293B] border-gray-300 dark:border-gray-600 h-12"
                />
              </div>

              <UserManagementFilterSheet
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onReset={handleFilterReset}
                users={users}
              >
                <Button
                  variant="outline"
                  className="border-[#475568] text-[#475568] flex items-center gap-2 dark:text-white py-5 cursor-pointer"
                >
                  Filter
                  <div className="text-white bg-[#6A7282] px-2 sm:px-3 py-1 rounded-full text-sm">
                    {
                      Object.entries(filters).filter(([, value]) =>
                        typeof value === "object"
                          ? Object.values(value).some((v) => v !== "" && v !== 0)
                          : typeof value === "boolean"
                          ? value === true
                          : value !== ""
                      ).length
                    }
                  </div>
                  <RiEqualizer2Line size={24} className="sm:size-8" />
                </Button>
              </UserManagementFilterSheet>
            </>
          )}

          {permissions.canExport && (
            <ExportModal
              data={filteredUsers || []}
              filters={filters}
              title="Export User Data"
              description="Choose the format you'd like to export your user data"
            />
          )}
        </div>
      </div>
      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
          <div className="flex justify-between p-4 text-3xl">
            <p className="text-xl text-[#6A7282] dark:text-white">Recent User Activity</p>
            {/* <p className="text-xl cursor-pointer">View All</p> */}
          </div>

          {/* table */}
          <div className="px-4 pb-4">
            {isLoading ? (
              <div className="text-center py-4">Loading...</div>
            ) : !filteredUsers?.length ? (
              <NoResults
                title={users?.length ? "No matching results" : "No users found"}
                message={
                  users?.length
                    ? "Try adjusting your filters or search criteria"
                    : "There are no users in the system yet"
                }
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="text-lg font-worksans">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Registration Date</TableHead>
                      <TableHead>Games Played</TableHead>
                      <TableHead>Time Played</TableHead>
                      <TableHead>Session count</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers &&
                      filteredUsers
                        .slice((page - 1) * usersPerPage, page * usersPerPage)
                        .map((user, idx) => (
                          <TableRow
                            key={idx}
                            className="font-worksans text-sm tracking-wider cursor-pointer hover:bg-[#f3e8ff] dark:hover:bg-[#23243a]"
                            onClick={() =>
                              navigate(`/admin/management/${user.id}`, {
                                state: { user },
                              })
                            }
                          >
                            <TableCell>{`${user.firstName || ""} ${
                              user.lastName || ""
                            }`}</TableCell>
                            <TableCell>{user.email || "-"}</TableCell>
                            <TableCell>{user.country || "-"}</TableCell>
                            <TableCell className="">
                              {user.phoneNumber || "-"}
                            </TableCell>
                            <TableCell>
                              {new Date(user.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {user.analytics?.totalGamesPlayed || 0}
                            </TableCell>
                            <TableCell>
                              {formatTime(user.analytics?.totalTimePlayed || 0)}
                            </TableCell>
                            <TableCell>
                              {user.analytics?.totalSessionCount || 0}
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <div className="bg-[#94A3B7] p-2 rounded-lg">
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${
                                      user.lastLoggedIn
                                        ? "bg-green-500"
                                        : "bg-red-500"
                                    }`}
                                  />
                                  <span className="rounded px-2 py-1 text-white font-semibold text-sm">
                                    {user.hasCompletedFirstLogin
                                      ? new Date(
                                          user.lastLoggedIn
                                        ).toLocaleTimeString("en-US", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          hour12: true,
                                        })
                                      : "Never logged in"}
                                  </span>
                                </div>
                              </span>
                            </TableCell>
                            <TableCell>
                              {/* Hide delete button for viewers or if admin trying to delete superadmin */}
                              {permissions.canDelete && !(currentUser?.role.name === 'admin' && user.role?.name === 'superadmin') ? (
                                <Button
                                  className="bg-[#EF4444] hover:bg-[#dc2626] text-white p-2 h-8 w-8 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation(); // Prevent row click navigation
                                    setUserToDelete(user);
                                  }}
                                >
                                  <RiDeleteBin6Line className="h-4 w-4" />
                                </Button>
                              ) : permissions.isViewer ? (
                                <div className="flex items-center justify-center h-8 w-8">
                                  <span className="text-gray-400 text-xs">View Only</span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-8 w-8">
                                  <span className="text-gray-400 text-xs">Protected</span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                  </TableBody>
                </Table>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-3">
                  <span className="text-sm order-2 sm:order-1">
                    Showing {(page - 1) * usersPerPage + 1}-
                    {Math.min(page * usersPerPage, filteredUsers?.length || 0)}{" "}
                    from {filteredUsers?.length || 0} data
                  </span>
                  {Math.ceil((filteredUsers?.length || 0) / usersPerPage) > 1 && (
                    <div className="flex items-center gap-1 order-1 sm:order-2">
                      {/* Previous button */}
                      <button
                        className={`w-8 h-8 rounded-full transition-colors border border-[#6A7282] ${
                          page === 1
                            ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                            : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                        }`}
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                      >
                        ‹
                      </button>

                      {/* Mobile: Show only current page info */}
                      <div className="sm:hidden flex items-center gap-1 px-3 py-1 rounded-full border border-[#6A7282]">
                        <span className="text-sm text-black dark:text-white">
                          {page} / {Math.ceil((filteredUsers?.length || 0) / usersPerPage)}
                        </span>
                      </div>

                      {/* Desktop: Show page numbers with smart truncation */}
                      <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                        {(() => {
                          const pages = [];
                          const totalPages = Math.ceil((filteredUsers?.length || 0) / usersPerPage);
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
                          page === Math.ceil((filteredUsers?.length || 0) / usersPerPage)
                            ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                            : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                        }`}
                        onClick={() => setPage(Math.min(Math.ceil((filteredUsers?.length || 0) / usersPerPage), page + 1))}
                        disabled={page === Math.ceil((filteredUsers?.length || 0) / usersPerPage)}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        open={!!userToDelete}
        onOpenChange={() => setUserToDelete(null)}
        onConfirm={confirmDeleteUser}
        isDeleting={deleteUser.isPending}
        title="Delete User"
        description={
          userToDelete ? (
            <span>
              Are you sure you want to delete <strong>{userToDelete.firstName} {userToDelete.lastName}</strong>? This action cannot be undone.
            </span>
          ) : ""
        }
        confirmButtonText="Delete User"
        loadingText="Deleting..."
      />
    </div>
  );
}
