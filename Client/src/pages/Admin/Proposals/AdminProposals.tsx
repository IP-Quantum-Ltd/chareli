
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
import { useProposals } from '../../../backend/proposal.service';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { GameProposalStatus, type GameProposal } from '../../../backend/types';
import { format } from 'date-fns';
import { ArrowRight, Gamepad2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';

export default function AdminProposals() {
  const navigate = useNavigate();
  useWebSocket(); // Enable real-time updates
  // Fetch all proposals
  // Ideally, valid backend filter should be used, but for now we fetch all and filter in frontend or use separate hooks if volume is high.
  // The service supports status param, but we might want to fetch all to split them into tabs.
  // Or we use two queries. Let's start with one query for simplicity if volume is low, or separate queries.
  // Given current implementation of `useProposals(status)`, it's better to fetch based on active tab.
  // But Tabs component control flow might be simpler if we just fetch all or fetch separately.

  // Let's implement separate variables for ease
  const { data: allProposals, isLoading } = useProposals(); // Fetch all

  const pendingProposals = allProposals?.filter(p => p.status === GameProposalStatus.PENDING) || [];
  const historyProposals = allProposals?.filter(p => p.status !== GameProposalStatus.PENDING && p.status !== GameProposalStatus.SUPERSEDED) || [];

  const getStatusBadge = (status: GameProposalStatus) => {
    switch (status) {
      case GameProposalStatus.APPROVED:
        return <Badge className="bg-green-500 hover:bg-green-600 flex w-fit gap-1 items-center"><CheckCircle2 className="w-3 h-3"/> Approved</Badge>;
      case GameProposalStatus.DECLINED:
        return <Badge className="bg-red-500 hover:bg-red-600 flex w-fit gap-1 items-center"><XCircle className="w-3 h-3"/> Declined</Badge>;
      default:
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black flex w-fit gap-1 items-center"><AlertCircle className="w-3 h-3"/> Pending</Badge>;
    }
  };

  const ProposalTable = ({ proposals, showActions = true }: { proposals: GameProposal[], showActions?: boolean }) => (
    <div className="bg-white dark:bg-[#1E293B] rounded-xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-700">
        {!proposals.length ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 dark:text-slate-400">
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
              <Gamepad2 className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-lg font-medium mb-1">No proposals found</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Game</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Editor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  {showActions && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((proposal: GameProposal) => (
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
                            {proposal.proposedData?.title || proposal.game?.title || 'Untitled Game'}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            ID: {proposal.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        {proposal.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                         <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-200">
                                {proposal.editor ? `${proposal.editor.firstName} ${proposal.editor.lastName}` : 'Unknown'}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                {proposal.editor?.email}
                            </span>
                         </div>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {format(new Date(proposal.updatedAt), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                    <TableCell>{getStatusBadge(proposal.status)}</TableCell>
                    {showActions && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            className="bg-[#6A7282] hover:bg-[#5A626F] text-white gap-2"
                            onClick={() => navigate(`/admin/proposals/${proposal.id}/review`)}
                          >
                            Review <ArrowRight className="w-4 h-4" />
                          </Button>
                        </TableCell>
                    )}
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
        <div>
            <h1 className="text-2xl sm:text-3xl font-worksans text-[#232B3B] dark:text-white font-medium">
            Proposal Review Queue
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
                Review pending game changes and history.
            </p>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="mb-4 bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700">
          <TabsTrigger value="pending" className="data-[state=active]:bg-[#6A7282] data-[state=active]:text-white">
            Pending Reviews
            {pendingProposals.length > 0 && (
                <span className="ml-2 bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full dark:bg-red-900/30 dark:text-red-400">
                    {pendingProposals.length}
                </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-[#6A7282] data-[state=active]:text-white">
            Review History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
            <ProposalTable proposals={pendingProposals} showActions={true} />
        </TabsContent>

        <TabsContent value="history">
            <ProposalTable proposals={historyProposals} showActions={true} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
