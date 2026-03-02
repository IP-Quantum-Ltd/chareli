import { Link } from 'react-router-dom';
import { AlertCircle, Clock, ArrowRight, History } from 'lucide-react';
import { useMyProposals } from '../../backend/proposal.service';
import { GameProposalStatus } from '../../backend/types';
import { Badge } from '../ui/badge';
import { LazyImage } from '../ui/LazyImage';
import { format } from 'date-fns';

interface EditorGameSidebarProps {
  gameId?: string;
  proposalId?: string;
}

export const EditorGameSidebar = ({ gameId, proposalId }: EditorGameSidebarProps) => {
  const { data: proposals, isLoading } = useMyProposals();

  const proposal = proposals?.find(p =>
    (proposalId && p.id === proposalId) ||
    (gameId && p.gameId === gameId)
  );

  const successor = proposals?.find(p => p.previousProposalId === proposal?.id);
  const predecessor = proposals?.find(p => p.id === proposal?.previousProposalId);

  console.log(`proposal in EditorGameSidebar.tsx: ${proposal}`);

  if (isLoading) {
    return <div className="w-full h-48 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" />;
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-white dark:bg-[#121C2D] rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Review Status
        </h3>

        {proposal ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">Current Status</span>
              {proposal.status === GameProposalStatus.APPROVED ? (
                <Badge className="bg-green-500">Approved</Badge>
              ) : proposal.status === GameProposalStatus.DECLINED ? (
                <Badge className="bg-red-500">Changes Requested</Badge>
              ) : proposal.status === GameProposalStatus.SUPERSEDED ? (
                <Badge variant="secondary">Superseded</Badge>
              ) : (
                <Badge className="bg-yellow-500 text-black">Pending Review</Badge>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
                <Clock className="w-4 h-4" />
                <span>Last Updated</span>
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {format(new Date(proposal.updatedAt), 'MMM d, yyyy h:mm a')}
              </p>
            </div>

            {/* Revision History Links */}
            {(successor || predecessor) && (
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
                  <History className="w-4 h-4" />
                  <span>Revision History</span>
                </div>

                {predecessor && (
                  <Link
                    to={`/admin/edit-proposal/${predecessor.id}`}
                    className="block p-2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400">Revises</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Previous Version</span>
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>
                )}

                {successor && (
                  <Link
                    to={`/admin/edit-proposal/${successor.id}`}
                    className="block p-2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400">Superseded by</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Newer Version</span>
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This game has not been submitted for review yet.
            </p>
          </div>
        )}
      </div>

      {/* Admin Feedback */}
      {proposal?.adminFeedback && (
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-6 border border-amber-100 dark:border-amber-900/20">
          <div className="flex items-center gap-2 mb-4 text-amber-800 dark:text-amber-400">
            <AlertCircle className="w-5 h-5" />
            <h3 className="font-medium">Admin Feedback</h3>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <p className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap">
              {proposal.adminFeedback}
            </p>
          </div>
        </div>
      )}

      {/* Game Preview (Thumbnail) */}
      {proposal?.proposedData?.thumbnailFile?.url && (
         <div className="bg-white dark:bg-[#121C2D] rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
           <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
             Proposed Thumbnail
           </h3>
           <div className="rounded-lg overflow-hidden bg-gray-100 border border-gray-200 dark:border-gray-700 aspect-video relative">
             <LazyImage
               src={proposal.proposedData.thumbnailFile.url}
               alt="Proposed thumbnail"
               className="w-full h-full object-cover"
             />
           </div>
         </div>
      )}
    </div>
  );
};
