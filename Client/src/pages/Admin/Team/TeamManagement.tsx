/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { MdOutlineCancel } from "react-icons/md";
import { InviteSheet } from "../../../components/single/Invite-Sheet";
import {
  useAllTeamMembers,
  useRevokeRole,
  useTeamInvitations,
  useDeleteTeamInvitation,
} from "../../../backend/teams.service";
import { DeleteConfirmationModal } from "../../../components/modals/DeleteConfirmationModal";
import { NoResults } from "../../../components/single/NoResults";
import { RiTeamLine } from "react-icons/ri";
import { toast } from "sonner";
import type { User } from "../../../backend/types";
import { format } from "date-fns";
import { useAuth } from "../../../context/AuthContext";
import { usePermissions } from "../../../hooks/usePermissions";

export default function TeamManagement() {
  const { user } = useAuth();
  const permissions = usePermissions();
  // const isAdmin = user?.role?.name?.toLowerCase() === 'admin';
  const isSuperAdmin = user?.role?.name?.toLowerCase() === "superadmin";
  const [activeTab, setActiveTab] = useState<"members" | "invitations">(
    "members"
  );
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { data: teamData, isLoading, error } = useAllTeamMembers();
  const {
    data: invitationsData,
    isLoading: isLoadingInvitations,
    error: invitationsError,
  } = useTeamInvitations();
  const revokeRole = useRevokeRole();
  const deleteInvitation = useDeleteTeamInvitation();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedInvitationId, setSelectedInvitationId] = useState<
    string | null
  >(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleteInviteConfirmOpen, setIsDeleteInviteConfirmOpen] =
    useState(false);

  const handleRevokeClick = (user: User) => {
    setSelectedUser(user);
    setIsConfirmOpen(true);
  };

  const handleConfirmRevoke = async () => {
    if (!selectedUser) return;

    try {
      await revokeRole.mutateAsync(selectedUser.id);
      toast.success(`${selectedUser.firstName}'s role has been revoked`);
      setIsConfirmOpen(false);
      setSelectedUser(null);
    } catch (error: any) {
      console.log(error, "revoke error");
      // const { message, type } = getErrorMessage(error, 'Failed to revoke role');
      // if (type === 'warning') {
      //   toast.warning(message);
      // } else {
      //   toast.error(message);
      // }
    }
  };

  const handleDeleteInviteClick = (id: string) => {
    setSelectedInvitationId(id);
    setIsDeleteInviteConfirmOpen(true);
  };

  const handleConfirmDeleteInvite = async () => {
    if (!selectedInvitationId) return;

    try {
      await deleteInvitation.mutateAsync(selectedInvitationId);
      toast.success("Invitation has been deleted");
      setIsDeleteInviteConfirmOpen(false);
      setSelectedInvitationId(null);
    } catch (error: any) {
      console.log(error);
      // const { message, type } = getErrorMessage(error, 'Failed to delete invitation');
      // if (type === 'warning') {
      //   toast.warning(message);
      // } else {
      //   toast.error(message);
      // }
    }
  };

  // Reset pagination when switching tabs
  const handleTabChange = (tab: "members" | "invitations") => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  // Pagination logic for team members
  const filteredTeamMembers =
    teamData?.filter(
      (member: User) => member.role.name.toLowerCase() !== "player"
    ) || [];
  const totalMembersPages = Math.ceil(
    filteredTeamMembers.length / itemsPerPage
  );
  const paginatedMembers = filteredTeamMembers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Pagination logic for invitations
  const filteredInvitations =
    invitationsData?.data?.filter(
      (invitation: any) => !invitation.isAccepted
    ) || [];
  const totalInvitationsPages = Math.ceil(
    filteredInvitations.length / itemsPerPage
  );
  const paginatedInvitations = filteredInvitations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="px-4 sm:px-8 bg-[#F1F5F9] dark:bg-[#121C2D]">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-[#6A7282] dark:text-white text-2xl sm:text-3xl font-worksans ">
          Team Management
        </h1>
        {permissions.canInvite && (
          <InviteSheet>
            <button className="bg-[#6A7282] text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg hover:bg-[#5A626F] transition-all text-sm sm:text-base w-full sm:w-auto font-dmmono cursor-pointer">
              Invite Team Member
            </button>
          </InviteSheet>
        )}
      </div>

      <div className="flex gap-2 sm:gap-4 mb-6 overflow-x-auto font-dmmono pb-2">
        <button
          onClick={() => handleTabChange("members")}
          className={`px-4 py-2 sm:py-3 rounded-lg transition-all whitespace-nowrap text-xs sm:text-sm md:text-base flex-shrink-0 cursor-pointer ${
            activeTab === "members"
              ? "bg-[#6A7282] text-white"
              : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          }`}
        >
          Team Members
        </button>
        <button
          onClick={() => handleTabChange("invitations")}
          className={`px-4 py-2 sm:py-3 rounded-lg transition-all whitespace-nowrap text-xs sm:text-sm md:text-base flex-shrink-0 cursor-pointer ${
            activeTab === "invitations"
              ? "bg-[#6A7282] text-white"
              : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          }`}
        >
          Pending Invitations
        </button>
      </div>
      {activeTab === "members" ? (
        <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl shadow-none border-none p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-base text-[#121C2D] dark:text-white tracking-wide dark:font-none dark:tracking-wider sm:text-lg">
                  <th className="pr-4 font-normal">Name</th>
                  <th className="pr-4 font-normal">Email</th>
                  <th className="pr-4 font-normal">Role</th>
                  {isSuperAdmin && <th className="pr-4 font-normal">Action</th>}
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr className="font-worksans">
                    <td colSpan={4} className="text-center py-6 text-red-500">
                      Failed to load team members. Please try again.
                    </td>
                  </tr>
                ) : isLoading ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282] mx-auto"></div>
                    </td>
                  </tr>
                ) : !filteredTeamMembers.length ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6">
                      <NoResults
                        title="No team members found"
                        message="Your team doesn't have any members yet. Click 'Invite Team Member' to add someone."
                        icon={
                          <RiTeamLine className="w-12 h-12 text-gray-400" />
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paginatedMembers.map((member: User) => (
                    <tr
                      key={member.id}
                      className="border-t border-[#d8d9da] text-sm font-worksans font-normal tracking-wider"
                    >
                      <td className="py-6 pr-4 text-[#121C2D] dark:text-white text-nowrap">
                        {member.firstName || ""} {member.lastName || ""}
                      </td>
                      <td className="py-6 pr-4 text-[#121C2D] dark:text-white text-nowrap">
                        {member.email}
                      </td>
                      <td className="py-6 pr-4">
                        {member.role.name.toLowerCase() === "admin" ? (
                          <span className="bg-[#6A7282] text-white px-3 py-2 rounded-lg text-md text-nowrap">
                            Admin
                          </span>
                        ) : member.role.name.toLowerCase() === "superadmin" ? (
                          <span className="bg-[#5A626F] text-white px-3 py-2 rounded-lg text-md">
                            SuperAdmin
                          </span>
                        ) : member.role.name.toLowerCase() === "viewer" ? (
                          <span className="bg-[#6A7282] text-white px-3 py-2 rounded-lg text-md text-nowrap">
                            Viewer
                          </span>
                        ) : (
                          <span className="bg-[#5A626F] text-white px-3 py-2 rounded-lg text-md text-nowrap">
                            {member.role.name}
                          </span>
                        )}
                      </td>
                      {isSuperAdmin && (
                        <td className="py-6 pr-4">
                          {member.id !== user?.id ? (
                            <button
                              onClick={() => handleRevokeClick(member)}
                              className="flex items-center gap-2 bg-[#EF4444] hover:bg-[#dc2626] text-white px-3 py-1 rounded-lg text-md transition-all cursor-pointer"
                              disabled={
                                revokeRole.isPending &&
                                selectedUser?.id === member.id
                              }
                            >
                              <span className="text-xl">
                                <MdOutlineCancel className="w-4 h-4" />
                              </span>
                              {revokeRole.isPending &&
                              selectedUser?.id === member.id
                                ? "Revoking..."
                                : "Revoke"}
                            </button>
                          ) : (
                            <span className="text-gray-400 text-sm text-nowrap">
                              Cannot revoke self
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination for team members */}
          {filteredTeamMembers.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-3 bg-[#F1F5F9] dark:bg-[#121C2D] rounded-b-xl gap-3">
              <span className="text-sm order-2 sm:order-1">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(
                  currentPage * itemsPerPage,
                  filteredTeamMembers.length
                )}{" "}
                from {filteredTeamMembers.length} members
              </span>
              {totalMembersPages > 1 && (
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
                      {currentPage} / {totalMembersPages}
                    </span>
                  </div>

                  {/* Desktop: Show page numbers with smart truncation */}
                  <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                    {(() => {
                      const pages = [];
                      const maxVisiblePages = 5;

                      if (totalMembersPages <= maxVisiblePages) {
                        // Show all pages if total is small
                        for (let i = 1; i <= totalMembersPages; i++) {
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
                        const endPage = Math.min(
                          totalMembersPages,
                          currentPage + 2
                        );

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
                              <span
                                key="start-ellipsis"
                                className="px-2 text-gray-500"
                              >
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
                        if (endPage < totalMembersPages) {
                          if (endPage < totalMembersPages - 1) {
                            pages.push(
                              <span
                                key="end-ellipsis"
                                className="px-2 text-gray-500"
                              >
                                ...
                              </span>
                            );
                          }
                          pages.push(
                            <button
                              key={totalMembersPages}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                currentPage === totalMembersPages
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282] text-black dark:text-white"
                              }`}
                              onClick={() => setCurrentPage(totalMembersPages)}
                            >
                              {totalMembersPages}
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
                      currentPage === totalMembersPages
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#6A7282] text-black dark:text-white"
                    }`}
                    onClick={() =>
                      setCurrentPage(
                        Math.min(totalMembersPages, currentPage + 1)
                      )
                    }
                    disabled={currentPage === totalMembersPages}
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#F1F5F9] dark:bg-[#121C2D] rounded-2xl shadow-none border-none w-full p-3 sm:p-6 overflow-x-auto">
          <div className="min-w-[600px] sm:min-w-[750px]">
            <table className="w-full text-left">
              <thead>
                <tr className="text-base sm:text-lg text-[#121C2D] dark:text-white tracking-wide dark:font-none dark:tracking-wider">
                  <th className="pb-4 pr-4 font-normal">Email</th>
                  <th className="pb-4 pr-4 font-normal">Role</th>
                  <th className="pb-4 pr-4 font-normal">Status</th>
                  <th className="pb-4 pr-4 font-normal">Invited By</th>
                  <th className="pb-4 pr-4 font-normal">Expires At</th>
                  <th className="pb-4 pr-4 font-normal">Action</th>
                </tr>
              </thead>
              <tbody>
                {invitationsError ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-red-500">
                      Failed to load invitations. Please try again.
                    </td>
                  </tr>
                ) : isLoadingInvitations ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6A7282] mx-auto"></div>
                    </td>
                  </tr>
                ) : !filteredInvitations.length ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6">
                      <NoResults
                        title="No pending invitations"
                        message="There are no pending team invitations at the moment."
                        icon={
                          <RiTeamLine className="w-12 h-12 text-gray-400" />
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paginatedInvitations.map((invitation: any) => (
                    <tr
                      key={invitation.id}
                      className="border-t border-[#d8d9da] font-worksans text-xs sm:text-sm tracking-wider"
                    >
                      <td className="py-6 pr-4 text-[#121C2D] dark:text-white text-nowrap">
                        {invitation.email}
                      </td>
                      <td className="py-6 pr-4">
                        <span
                          className={`px-3 py-2 rounded-lg text-md text-nowrap ${
                            invitation.role.name.toLowerCase() === "admin"
                              ? "bg-[#6A7282] text-white"
                              : "bg-[#334154] text-white"
                          }`}
                        >
                          {invitation.role.name}
                        </span>
                      </td>
                      <td className="py-6 pr-4">
                        <span
                          className={`px-3 py-2 rounded-lg text-md text-nowrap ${
                            invitation.isAccepted
                              ? "bg-green-500 text-white"
                              : "bg-yellow-500 text-white"
                          }`}
                        >
                          {invitation.isAccepted ? "Accepted" : "Pending"}
                        </span>
                      </td>
                      <td className="py-6 pr-4 text-nowrap text-[#121C2D] dark:text-white">
                        {invitation.invitedBy.firstName}{" "}
                        {invitation.invitedBy.lastName}
                      </td>
                      <td className="py-6 pr-4 text-nowrap text-[#121C2D] dark:text-white">
                        {format(
                          new Date(invitation.expiresAt),
                          "MMM d, h:mm a"
                        )}
                      </td>
                      <td className="py-6 pr-4">
                        {permissions.canEditTeam ? (
                          <button
                            onClick={() =>
                              handleDeleteInviteClick(invitation.id)
                            }
                            className="flex items-center gap-2 bg-[#EF4444] hover:bg-[#dc2626] text-white px-3 py-1 rounded-lg text-md transition-all cursor-pointer"
                            disabled={
                              deleteInvitation.isPending &&
                              selectedInvitationId === invitation.id
                            }
                          >
                            <span className="text-xl">
                              <MdOutlineCancel className="w-4 h-4" />
                            </span>
                            {deleteInvitation.isPending &&
                            selectedInvitationId === invitation.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-sm">
                            View Only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination for invitations */}
          {filteredInvitations.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-3 bg-[#F1F5F9] dark:bg-[#121C2D] rounded-b-xl gap-3">
              <span className="text-sm order-2 sm:order-1">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(
                  currentPage * itemsPerPage,
                  filteredInvitations.length
                )}{" "}
                from {filteredInvitations.length} invitations
              </span>
              {totalInvitationsPages > 1 && (
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
                      {currentPage} / {totalInvitationsPages}
                    </span>
                  </div>

                  {/* Desktop: Show page numbers with smart truncation */}
                  <div className="hidden sm:flex items-center gap-1 rounded-full border border-[#6A7282] p-1">
                    {(() => {
                      const pages = [];
                      const maxVisiblePages = 5;

                      if (totalInvitationsPages <= maxVisiblePages) {
                        // Show all pages if total is small
                        for (let i = 1; i <= totalInvitationsPages; i++) {
                          pages.push(
                            <button
                              key={i}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                currentPage === i
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
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
                        const endPage = Math.min(
                          totalInvitationsPages,
                          currentPage + 2
                        );

                        // First page
                        if (startPage > 1) {
                          pages.push(
                            <button
                              key={1}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                currentPage === 1
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setCurrentPage(1)}
                            >
                              1
                            </button>
                          );
                          if (startPage > 2) {
                            pages.push(
                              <span
                                key="start-ellipsis"
                                className="px-2 text-gray-500"
                              >
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
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() => setCurrentPage(i)}
                            >
                              {i}
                            </button>
                          );
                        }

                        // Last page
                        if (endPage < totalInvitationsPages) {
                          if (endPage < totalInvitationsPages - 1) {
                            pages.push(
                              <span
                                key="end-ellipsis"
                                className="px-2 text-gray-500"
                              >
                                ...
                              </span>
                            );
                          }
                          pages.push(
                            <button
                              key={totalInvitationsPages}
                              className={`w-8 h-8 rounded-full transition-colors ${
                                currentPage === totalInvitationsPages
                                  ? "bg-[#6A7282] text-white"
                                  : "hover:bg-[#6A7282]/20 text-black dark:text-white"
                              }`}
                              onClick={() =>
                                setCurrentPage(totalInvitationsPages)
                              }
                            >
                              {totalInvitationsPages}
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
                      currentPage === totalInvitationsPages
                        ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800"
                        : "hover:bg-[#FFF7ED] text-black dark:text-white"
                    }`}
                    onClick={() =>
                      setCurrentPage(
                        Math.min(totalInvitationsPages, currentPage + 1)
                      )
                    }
                    disabled={currentPage === totalInvitationsPages}
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <DeleteConfirmationModal
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        onConfirm={handleConfirmRevoke}
        isDeleting={revokeRole.isPending}
        title="Revoke Team Member Role?"
        description={
          selectedUser
            ? `Are you sure you want to revoke ${selectedUser.firstName}'s ${selectedUser.role.name} role? They will be changed to a player.`
            : ""
        }
        confirmButtonText="Revoke"
        loadingText="Revoking..."
      />

      <DeleteConfirmationModal
        open={isDeleteInviteConfirmOpen}
        onOpenChange={setIsDeleteInviteConfirmOpen}
        onConfirm={handleConfirmDeleteInvite}
        isDeleting={deleteInvitation.isPending}
        title="Delete Team Invitation?"
        description="Are you sure you want to delete this invitation? This action cannot be undone."
        confirmButtonText="Delete"
        loadingText="Deleting..."
      />
    </div>
  );
}
