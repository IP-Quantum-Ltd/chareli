
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { LazyImage } from '../../../components/ui/LazyImage';
import {
  useMyProposals,
  useDeleteProposal,
} from '../../../backend/proposal.service';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { GameProposalStatus, type GameProposal } from '../../../backend/types';
import { format } from 'date-fns';
import { Edit, Eye, Trash2, Gamepad2, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DeleteConfirmationModal } from '../../../components/modals/DeleteConfirmationModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';

export default function MyProposals() {
  const navigate = useNavigate();
  useWebSocket(); // Enable real-time updates
  const { data: proposals, isLoading } = useMyProposals();
  const { mutateAsync: deleteProposal, isPending: isDeleting } =
    useDeleteProposal();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const pendingProposals = proposals?.filter(p => p.status === GameProposalStatus.PENDING) || [];
  const historyProposals = proposals?.filter(p => p.status !== GameProposalStatus.PENDING && p.status !== GameProposalStatus.SUPERSEDED) || [];

  const getStatusBadge = (status: GameProposalStatus) => {
    switch (status) {
      case GameProposalStatus.APPROVED:
        return <Badge className="bg-green-500 hover:bg-green-600">Approved</Badge>;
      case GameProposalStatus.DECLINED:
        return <Badge className="bg-red-500 hover:bg-red-600">Declined</Badge>;
      default:
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">Pending</Badge>;
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteProposal(deleteId);
      toast.success('Proposal deleted successfully');
      setDeleteId(null);
    } catch (error) {
      console.error('Failed to delete proposal:', error);
      toast.error('Failed to delete proposal');
    }
  };

  const ProposalTable = ({ data }: { data: GameProposal[] }) => (
    <div className="bg-white dark:bg-[#1E293B] rounded-xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-700">
        {!data.length ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 dark:text-slate-400">
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
              <Gamepad2 className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-lg font-medium mb-1">No proposals found</h3>
            <p className="max-w-xs mx-auto mb-6 opacity-80">
              When you submit game changes or new games, they will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Game</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date Modified</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((proposal: GameProposal) => (
                  <TableRow key={proposal.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200 dark:border-slate-700">
                          {proposal.proposedData?.thumbnailUrl ||
                           proposal.proposedData?.thumbnailFile?.url ||
                           proposal.proposedData?.thumbnailFile?.publicUrl ||
                           proposal.game?.thumbnailFile?.s3Key ? (
                            <LazyImage
                              src={
                                proposal.proposedData?.thumbnailUrl ||
                                proposal.proposedData?.thumbnailFile?.url ||
                                proposal.proposedData?.thumbnailFile?.publicUrl ||
                                proposal.game?.thumbnailFile?.s3Key
                              }
                              alt={proposal.proposedData?.title || proposal.game?.title || 'Game thumbnail'}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Gamepad2 className="w-6 h-6" />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white line-clamp-1">
                            {proposal.proposedData?.title || 'Untitled Game'}
                          </p>
                          {proposal.adminFeedback && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              <span>Feedback Available</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        {proposal.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {format(new Date(proposal.updatedAt), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                    <TableCell>{getStatusBadge(proposal.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/admin/edit-proposal/${proposal.id}`)}
                          title="Edit Proposal"
                          className="h-8 w-8 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          {proposal.status === GameProposalStatus.PENDING ? (
                            <Edit className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(proposal.id)}
                          title="Delete Proposal"
                          className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-[#6A7282] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 bg-[#F1F5F9] dark:bg-[#121C2D] min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-worksans text-[#232B3B] dark:text-white font-medium">
          My Proposals
        </h1>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="mb-4 bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700">
          <TabsTrigger value="pending" className="data-[state=active]:bg-[#6A7282] data-[state=active]:text-white">
            Pending
            {pendingProposals.length > 0 && (
                <span className="ml-2 bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full dark:bg-slate-700 dark:text-slate-300">
                    {pendingProposals.length}
                </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-[#6A7282] data-[state=active]:text-white">
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
            <ProposalTable data={pendingProposals} />
        </TabsContent>

        <TabsContent value="history">
            <ProposalTable data={historyProposals} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmationModal
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title="Delete Proposal"
        description="Are you sure you want to delete this proposal? This action cannot be undone."
        confirmButtonText="Delete Proposal"
      />
    </div>
  );
}
