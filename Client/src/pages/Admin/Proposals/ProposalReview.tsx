import { Link, useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle, History } from 'lucide-react';
import { useProposalById, useApproveProposal, useDeclineProposal } from '../../../backend/proposal.service';
import { useCategories } from '../../../backend/category.service';
import { DEFAULT_FAQ_TEMPLATE, parseFAQ, generateFAQHtml } from '../../../utils/faqTemplate';
import { GameProposalStatus, GameProposalType } from '../../../backend/types';
import { Badge } from '../../../components/ui/badge';
import { LazyImage } from '../../../components/ui/LazyImage';
import { toast } from 'sonner';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/textarea';

// Helper to diff FAQ items
const FAQDiff = ({ currentHtml, proposedHtml, formatter }: { currentHtml: string, proposedHtml: string, formatter?: (val: string) => string }) => {
    // Parse both
    // Ensure we handle potentially raw/unformatted inputs gracefully
    const currentItems = parseFAQ(formatter ? formatter(currentHtml) : currentHtml);
    const proposedItems = parseFAQ(formatter ? formatter(proposedHtml) : proposedHtml);

    // simple map key by Question (assuming questions are unique enough for this context)
    const currentMap = new Map(currentItems.map(i => [i.question, i.answer]));
    const proposedMap = new Map(proposedItems.map(i => [i.question, i.answer]));

    // All unique questions
    const allQuestions = Array.from(new Set([...currentItems.map(i => i.question), ...proposedItems.map(i => i.question)]));

    return (
        <div className="space-y-4 max-h-96 overflow-y-auto p-2">
            {allQuestions.map((q, idx) => {
                const curAns = currentMap.get(q);
                const propAns = proposedMap.get(q);

                const isNew = curAns === undefined;
                const isDeleted = propAns === undefined;
                const isModified = !isNew && !isDeleted && curAns !== propAns;

                if (!isNew && !isDeleted && !isModified) {
                    // Unchanged - Show quietly
                    return (
                        <div key={idx} className="opacity-60 hover:opacity-100 transition-opacity border-l-2 border-slate-200 pl-3">
                            <h4 className="font-semibold text-xs uppercase text-slate-500">{q}</h4>
                            <div className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2" dangerouslySetInnerHTML={{ __html: propAns || '' }} />
                        </div>
                    );
                }

                // Changed/New/Deleted
                return (
                    <div key={idx} className={`border-l-4 pl-3 py-1 ${isDeleted ? 'border-red-500 bg-red-50/50' : 'border-green-500 bg-green-50/50 dark:bg-green-900/10'}`}>
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">{q}</h4>
                            {isNew && <Badge variant="outline" className="border-green-500 text-green-600 h-5 text-[10px]">New Q</Badge>}
                            {isDeleted && <Badge variant="outline" className="border-red-500 text-red-600 h-5 text-[10px]">Deleted</Badge>}
                            {isModified && <Badge variant="outline" className="border-green-500 text-green-600 h-5 text-[10px] bg-green-100 dark:bg-green-900/40">Ans. Changed</Badge>}
                        </div>

                        {/* If Modified, show Diff visually (Simple Side-by-Side stack) */}
                        {isModified && (
                            <div className="space-y-2 mt-2">
                                <div className="text-xs text-slate-400 uppercase font-semibold">Previous Answer:</div>
                                <div className="text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800" dangerouslySetInnerHTML={{ __html: curAns || '' }} />

                                <div className="text-xs text-green-600 uppercase font-semibold mt-2">New Answer:</div>
                                <div className="text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 p-2 rounded border border-green-200 ring-1 ring-green-500/20" dangerouslySetInnerHTML={{ __html: propAns || '' }} />
                            </div>
                        )}

                        {/* If New, just show Answer */}
                        {isNew && (
                            <div className="text-sm text-slate-800 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: propAns || '' }} />
                        )}

                        {/* If Deleted, show Strikethrough */}
                        {isDeleted && (
                            <div className="text-sm text-slate-400 line-through" dangerouslySetInnerHTML={{ __html: curAns || '' }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// Helper component to display field comparison
const ComparisonRow = ({
  label,
  currentValue,
  proposedValue,
  isRichText = false,
  isCreate = false,
  formatter,
  isFAQ = false, // New Prop
}: {
  label: string,
  currentValue?: unknown,
  proposedValue: unknown,
  isRichText?: boolean,
  isCreate?: boolean,
  formatter?: (val: unknown) => string, // loosened type
  isFAQ?: boolean
}) => {
    // Basic equality check
    // Normalize properties for comparison (treat undefined and null as same, empty string as same if desirable, but strict is better for diff)
    const norm = (v: unknown) => (v === undefined || v === null) ? '' : v;
    const isModified = JSON.stringify(norm(currentValue)) !== JSON.stringify(norm(proposedValue));

    // Style classes
    const rowClass = "grid grid-cols-12 gap-4 py-4 border-b border-slate-100 dark:border-slate-800 last:border-0";
    const labelClass = "col-span-12 md:col-span-3 font-medium text-slate-600 dark:text-slate-400";
    const gridValueClass = "col-span-12 md:col-span-9 grid grid-cols-2 gap-4"; // Split remaining 9 cols into 2 for side-by-side

    // If FAQ and Modified, use special renderer
    if (isFAQ && isModified && !isCreate) {
         return (
             <div className={`${rowClass} bg-slate-50/50 dark:bg-slate-900/50`}>
                 <div className={labelClass}>
                     {label} <span className="ml-2 inline-block w-2 h-2 rounded-full bg-blue-500" title="Smart Diff"></span>
                 </div>
                 <div className="col-span-12 md:col-span-9">
                     <FAQDiff
                        currentHtml={String(currentValue || '')}
                        proposedHtml={String(proposedValue || '')}
                        formatter={formatter}
                     />
                 </div>
             </div>
         );
    }

    return (
        <div className={`${rowClass} ${isModified ? 'bg-yellow-50/50 dark:bg-yellow-900/10 -mx-4 px-4 rounded-lg' : ''}`}>
            <div className={labelClass}>
                {label}
                {isModified && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-yellow-500" title="Modified"></span>}
            </div>

            <div className={gridValueClass}>
                {/* Current Value Column */}
                <div className="space-y-1">
                    <div className="text-xs uppercase font-bold text-slate-400 mb-1">Current</div>
                     {isCreate ? (
                         <span className="text-slate-400 italic text-sm">N/A (New Game)</span>
                     ) : (
                        isRichText ? (
                            <div className="prose prose-sm dark:prose-invert max-h-40 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 text-sm" dangerouslySetInnerHTML={{ __html: String(formatter ? formatter(currentValue) : currentValue) }} />
                        ) : (
                             <div className="text-sm p-2 bg-slate-50 dark:bg-slate-900 rounded border border-transparent text-slate-700 dark:text-slate-300">
                                {formatter ? formatter(currentValue) : String(currentValue ?? '')}
                             </div>
                        )
                     )}
                </div>

                {/* Proposed Value Column */}
                <div className="space-y-1">
                    <div className={`text-xs uppercase font-bold mb-1 ${isModified ? 'text-green-600' : 'text-slate-400'}`}>
                        {isCreate ? 'New Value' : (isModified ? 'Proposed' : 'Proposed (No Change)')}
                    </div>
                     {isRichText ? (
                        <div className={`prose prose-sm dark:prose-invert max-h-40 overflow-y-auto p-3 rounded border text-sm ${isModified ? 'bg-white dark:bg-slate-900 border-green-200 shadow-sm ring-1 ring-green-500/20' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70'}`} dangerouslySetInnerHTML={{ __html: String(formatter ? formatter(proposedValue) : proposedValue) }} />
                    ) : (
                         <div className={`text-sm p-2 rounded border ${isModified ? 'bg-white dark:bg-slate-900 border-green-200 shadow-sm font-medium text-slate-900 dark:text-white' : 'bg-slate-50 dark:bg-slate-900 border-transparent text-slate-500 dark:text-slate-400'}`}>
                            {formatter ? formatter(proposedValue) : String(proposedValue ?? '')}
                         </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function ProposalReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Normalize the default template to match the editor's output format exactly
  const normalizedDefaultFAQ = generateFAQHtml(parseFAQ(DEFAULT_FAQ_TEMPLATE));

  const { data: proposal, isLoading } = useProposalById(id || '');
  const { data: categories } = useCategories();
  const approveMutation = useApproveProposal();
  const declineMutation = useDeclineProposal();

  const [declineFeedback, setDeclineFeedback] = useState('');
  const [isDeclineOpen, setIsDeclineOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-[#6A7282] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!proposal) {
      return <div className="p-8">Proposal not found</div>;
  }

  const isCreate = proposal?.type === GameProposalType.CREATE;
  const isPending = proposal?.status === GameProposalStatus.PENDING;

  // Prepare data for diff - Cast to Partial<GameData> intersected with possible form fields
  type GameDataWithFiles = Partial<import('../../../backend/types').GameData> & {
      thumbnailFileId?: string;
      gameFileId?: string;
      thumbnailFileKey?: string;
      gameFileKey?: string;
      thumbnailUrl?: string;
  };

  const proposed = (proposal?.proposedData || {}) as GameDataWithFiles;
  const current = (proposal?.game || {}) as unknown as GameDataWithFiles;

  // Flatten metadata for comparison convenience
  const currentMeta = current.metadata || {};
  const proposedMeta = proposed.metadata || {};

  // -- Helpers --

  // 1. Category Name Lookup
  const getCategoryName = (id?: unknown) => {
      if (!id) return '';
      const catId = String(id);
      const category = categories?.find(c => c.id === catId);
      return category ? category.name : (catId || 'Unassigned');
  };

  // 2. FAQ Placeholder Replacement
  const replaceFAQPlaceholders = (text: unknown) => {
      if (!text || typeof text !== 'string') return '';
      // We need to use the PROPOSED title for replacement if available, otherwise current
      const gameTitle = proposed.title || current.title || 'Game Name';
      // Find category name for placeholders
      const catId = proposed.categoryId || current.categoryId;
      const categoryName = getCategoryName(catId);

      let processed = text;
      // Replace safe placeholders
      processed = processed.replace(/\[Game Name\]/g, gameTitle);
      processed = processed.replace(/\[Category Name\]/g, categoryName);

      return processed;
  };

  const handleApprove = async () => {
      try {
          await approveMutation.mutateAsync({ id: proposal.id });
          toast.success('Proposal approved successfully');
          navigate('/admin/proposals');
      } catch {
          toast.error('Failed to approve proposal');
      }
  };

  const handleDecline = async () => {
      if (!declineFeedback.trim()) {
          toast.error('Please provide a reason for declining');
          return;
      }
      try {
          await declineMutation.mutateAsync({ id: proposal.id, feedback: declineFeedback });
          toast.success('Proposal declined');
          setIsDeclineOpen(false);
          navigate('/admin/proposals');
      } catch {
          toast.error('Failed to decline proposal');
      }
  };

  return (
    <div className="p-4 sm:p-8 bg-[#F1F5F9] dark:bg-[#121C2D] min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
            <Button
            variant="ghost"
            className="mb-4 pl-0 hover:bg-transparent hover:text-[#6A7282]"
            onClick={() => navigate('/admin/proposals')}
            >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
            </Button>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                   <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold dark:text-white">
                            {isCreate ? 'Review New Game' : 'Review Changes'}
                        </h1>
                        <Badge variant="outline" className="uppercase">{proposal.type}</Badge>
                        <Badge className={`${
                            proposal.status === 'approved' ? 'bg-green-500' :
                            proposal.status === 'declined' ? 'bg-red-500' : 'bg-yellow-500 text-black'
                        }`}>
                            {proposal.status}
                        </Badge>
                   </div>
                   <p className="text-slate-500 dark:text-slate-400">
                       Submitted by <span className="font-semibold text-slate-700 dark:text-slate-300">{proposal.editor?.firstName} {proposal.editor?.lastName}</span> on {new Date(proposal.createdAt).toLocaleDateString()}
                   </p>
                   {proposal.previousProposalId && (
                        <div className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                            <History className="w-4 h-4" />
                            <span>Revises previous proposal:</span>
                            <Link to={`/admin/proposals/${proposal.previousProposalId}/review`} className="underline hover:text-blue-800 dark:hover:text-blue-300">
                                View Previous
                            </Link>
                        </div>
                   )}
                </div>

                {/* Actions - Only visible if Pending */}
                {isPending ? (
                    <div className="flex gap-3 w-full md:w-auto">
                         <Dialog open={isDeclineOpen} onOpenChange={setIsDeclineOpen}>
                            <DialogTrigger asChild>
                                <Button variant="destructive" className="gap-2 flex-1 md:flex-none">
                                    <XCircle className="w-4 h-4" /> Decline
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Decline Proposal</DialogTitle>
                                    <DialogDescription>
                                        Please provide a reason for declining this proposal. This feedback will be sent to the editor.
                                    </DialogDescription>
                                </DialogHeader>
                                <Textarea
                                    placeholder="e.g., Fix typos in description, update thumbnail resolution..."
                                    value={declineFeedback}
                                    onChange={(e) => setDeclineFeedback(e.target.value)}
                                    className="min-h-[100px]"
                                />
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsDeclineOpen(false)}>Cancel</Button>
                                    <Button variant="destructive" onClick={handleDecline} disabled={declineMutation.isPending}>
                                        {declineMutation.isPending ? 'Declining...' : 'Decline Proposal'}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Button
                            className="bg-green-600 hover:bg-green-700 text-white gap-2 flex-1 md:flex-none"
                            onClick={handleApprove}
                            disabled={approveMutation.isPending}
                        >
                            {approveMutation.isPending ? <div className="animate-spin w-4 h-4 border-2 border-white rounded-full border-t-transparent"/> : <CheckCircle2 className="w-4 h-4" />}
                            Approve
                        </Button>
                    </div>
                ) : (
                    <div className="text-slate-500 dark:text-slate-400 italic">
                        This proposal has been {proposal.status}. Actions are disabled.
                    </div>
                )}
            </div>
        </div>

        <div className="bg-white dark:bg-[#1E293B] rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-8">

            {/* Admin Feedback Display */}
            {proposal.adminFeedback && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
                    <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <h3 className="font-semibold text-amber-900 dark:text-amber-400">Review Feedback</h3>
                           <p className="text-amber-800 dark:text-amber-300 text-sm whitespace-pre-wrap">{proposal.adminFeedback}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* General Info */}
            <section>
                <h3 className="text-lg font-bold border-b pb-4 mb-4 dark:border-slate-700 text-slate-800 dark:text-white flex items-center gap-2">
                    Core Details
                </h3>
                <div className="space-y-1">
                    <ComparisonRow label="Title" currentValue={current.title} proposedValue={proposed.title} isCreate={isCreate} />
                    <ComparisonRow
                        label="Category"
                        currentValue={current.categoryId}
                        proposedValue={proposed.categoryId}
                        isCreate={isCreate}
                        formatter={getCategoryName}
                    />
                    <ComparisonRow label="Config (Free Time)" currentValue={current.config} proposedValue={proposed.config} isCreate={isCreate} />
                </div>
            </section>

             {/* Metadata */}
             <section>
                <h3 className="text-lg font-bold border-b pb-4 mb-4 dark:border-slate-700 text-slate-800 dark:text-white">
                    Metadata
                </h3>
                <div className="space-y-1">
                    <ComparisonRow label="Developer" currentValue={currentMeta.developer} proposedValue={proposedMeta.developer} isCreate={isCreate} />
                    <ComparisonRow label="Platform" currentValue={currentMeta.platform} proposedValue={proposedMeta.platform} isCreate={isCreate} />
                    <ComparisonRow label="Tags" currentValue={currentMeta.tags} proposedValue={proposedMeta.tags} isCreate={isCreate} />
                </div>
            </section>

            {/* Content */}
            <section>
                <h3 className="text-lg font-bold border-b pb-4 mb-4 dark:border-slate-700 text-slate-800 dark:text-white">
                    Content
                </h3>
                 <div className="space-y-1">
                    <ComparisonRow label="Description" currentValue={current.description} proposedValue={proposed.description} isRichText isCreate={isCreate} />
                    <ComparisonRow label="How To Play" currentValue={currentMeta.howToPlay} proposedValue={proposedMeta.howToPlay} isRichText isCreate={isCreate} />
                    <ComparisonRow
                        label="FAQ"
                        currentValue={currentMeta.faqOverride || normalizedDefaultFAQ}
                        proposedValue={proposedMeta.faqOverride}
                        isRichText
                        isCreate={isCreate}
                        formatter={replaceFAQPlaceholders}
                        isFAQ // Activate Smart Diff
                    />
                </div>
            </section>

             {/* Media */}
             <section>
                <h3 className="text-lg font-bold border-b pb-4 mb-4 dark:border-slate-700 text-slate-800 dark:text-white">
                    Media & Files
                </h3>

                {/* Thumbnail Diff */}
                <div className="grid grid-cols-12 gap-4 py-4">
                    <div className="col-span-12 md:col-span-3 font-medium text-slate-600 dark:text-slate-400">Thumbnail</div>
                     <div className="col-span-12 md:col-span-9 grid grid-cols-2 gap-4">
                         {/* Current */}
                         <div className="space-y-2">
                             <div className="text-xs uppercase font-bold text-slate-400">Current</div>
                             {isCreate ? (
                                 <span className="text-slate-400 italic text-sm">N/A</span>
                             ) : (
                                 <div className="w-40 h-24 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden border dark:border-slate-700">
                                    {/* Use current.thumbnailFile.url from nested relation */}
                                    <LazyImage src={current.thumbnailFile?.url || ''} alt="Current" className="w-full h-full object-cover" />
                                 </div>
                             )}
                         </div>
                         {/* Proposed */}
                         <div className="space-y-2">
                             <div className="text-xs uppercase font-bold text-slate-400">
                                 {(proposed.thumbnailFileId || proposed.thumbnailFileKey) ? (
                                     <span className="text-green-600">Proposed New File</span>
                                 ) : 'Proposed (No Change)'}
                             </div>
                             <div className={`w-40 h-24 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden border dark:border-slate-700 ${proposed.thumbnailFileKey ? 'ring-2 ring-green-500' : ''}`}>
                                 <LazyImage
                                    src={proposed.thumbnailFile?.s3Key || proposed.thumbnailFile?.url || proposed.thumbnailUrl || current.thumbnailFile?.url || ''}
                                    alt="Proposed"
                                    className="w-full h-full object-cover"
                                />
                             </div>
                         </div>
                    </div>
                </div>

                {/* Game File Diff */}
                <div className="grid grid-cols-12 gap-4 py-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="col-span-12 md:col-span-3 font-medium text-slate-600 dark:text-slate-400">
                        <div>Game Build File</div>
                        <p className="text-xs text-slate-400 font-normal mt-1">The actual game ZIP file.</p>
                    </div>
                     <div className="col-span-12 md:col-span-9 grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <div className="text-xs uppercase font-bold text-slate-400">Current</div>
                             {/* Use current.gameFile.s3Key from nested relation */}
                            <div className="text-sm font-mono bg-slate-50 dark:bg-slate-900 dark:text-slate-300 border border-slate-200 dark:border-slate-700 p-2 rounded truncate" title={current.gameFile?.s3Key}>
                                {current.gameFile?.s3Key ? current.gameFile.s3Key.split('/').pop() : <span className="text-slate-400 italic">No file uploaded</span>}
                            </div>
                        </div>
                        <div className="space-y-2">
                             <div className="text-xs uppercase font-bold text-slate-400">
                                 {proposed.gameFileKey ? <span className="text-green-600">Proposed Change</span> : 'No Change'}
                             </div>
                            <div className={`text-sm font-mono bg-slate-50 dark:bg-slate-900 dark:text-slate-300 border border-slate-200 dark:border-slate-700 p-2 rounded truncate ${proposed.gameFileKey ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' : ''}`} title={proposed.gameFileKey || current.gameFile?.s3Key}>
                                {proposed.gameFileKey ? proposed.gameFileKey.split('/').pop() : 'Same as current'}
                            </div>
                        </div>
                     </div>
                </div>

            </section>

        </div>
      </div>
    </div>
  );
}
