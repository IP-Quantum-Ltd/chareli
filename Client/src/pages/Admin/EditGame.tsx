import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import { object as yupObject, string as yupString, number as yupNumber } from 'yup';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { useProposalById, useUpdateProposal, useDismissFeedback, useReviseProposal } from '../../backend/proposal.service';
import { useGameById, useUpdateGame } from '../../backend/games.service';
import { useCategories } from '../../backend/category.service';
import { toast } from 'sonner';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { GameBreadcrumb } from '../../components/single/GameBreadcrumb';
import UppyUpload from '../../components/single/UppyUpload';
import { X, AlertCircle, RefreshCcw } from 'lucide-react';
import DOMPurify from 'dompurify';
import { FAQEditor } from '../../components/admin/FAQEditor';
import { EditorGameSidebar } from '../../components/admin/EditorGameSidebar';
import { usePermissions } from '../../hooks/usePermissions';

// ... other imports

interface FormValues {
  title: string;
  developer: string;
  platform: string;
  categoryId: string;
  position: number;
  config: number;
  description: string;
  howToPlay: string;
  tags: string[];
  faqOverride: string; // New field
  thumbnailFile?: UploadedFile;
  gameFile?: UploadedFile;
}

interface UploadedFile {
  name: string;
  publicUrl: string;
  key: string;
}

const validationSchema = yupObject({
  title: yupString().required('Title is required').trim(),
  developer: yupString().trim(),
  categoryId: yupString(),
  position: yupNumber().min(0, 'Position must be a positive number'),
  config: yupNumber().required('Free game time is required').min(0, 'Must be a positive number'),
  description: yupString(),
  howToPlay: yupString(),
});

// Sub-component for the Dismiss Feedback button to isolate the hook usage
function DismissFeedbackButton({ proposalId }: { proposalId: string }) {
  const dismissFeedback = useDismissFeedback();

  const handleDismiss = () => {
    dismissFeedback.mutate(proposalId, {
      onSuccess: () => {
        toast.success('Feedback dismissed. This proposal will no longer appear in your attention counter.');
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to dismiss feedback');
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleDismiss}
      disabled={dismissFeedback.isPending}
      className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
    >
      {dismissFeedback.isPending ? 'Dismissing...' : 'Dismiss Feedback'}
    </Button>
  );
}

export default function EditGame() {
  const { gameId, proposalId } = useParams();
  const navigate = useNavigate();
  const formikRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [newTag, setNewTag] = useState('');

  // Conditionally fetch game or proposal
  const { data: game, isLoading: isLoadingGame } = useGameById(gameId || '');

  const { data: proposal, isLoading: isLoadingProposal } = useProposalById(proposalId || '');

  const { data: categories } = useCategories();
  const updateGame = useUpdateGame();
  const updateProposal = useUpdateProposal();
  const permissions = usePermissions();
  const reviseProposal = useReviseProposal();

  const handleRevise = async () => {
    if (!proposalId) return;
    try {
      const result = await reviseProposal.mutateAsync(proposalId);
      toast.success('Proposal revised! You are now editing the new version.');
      if (result?.data?.id) {
          navigate(`/admin/edit-proposal/${result.data.id}`);
      }
    } catch {
      toast.error('Failed to revise proposal');
    }
  };

  const isLoading = gameId ? isLoadingGame : (proposalId ? isLoadingProposal : false);

  const effectiveData = gameId ? game : proposal?.proposedData;

  // Clean up unused variables if not needed, or keep for future logic
  const currentCategory = gameId ? game?.category : categories?.find(c => c.id === proposal?.proposedData?.categoryId);

  const [uploadedFiles, setUploadedFiles] = useState<{
    thumbnail: UploadedFile | null;
    game: UploadedFile | null;
  }>({
    thumbnail: null,
    game: null,
  });

  const [isUploading, setIsUploading] = useState({
    thumbnail: false,
    game: false,
  });


  const handleThumbnailUploadStart = () => {
    setIsUploading(prev => ({ ...prev, thumbnail: true }));
  };

  const handleThumbnailUploaded = (file: UploadedFile) => {
    setUploadedFiles(prev => ({ ...prev, thumbnail: file }));
    setIsUploading(prev => ({ ...prev, thumbnail: false }));
  };

  const handleThumbnailUploadError = () => {
    setIsUploading(prev => ({ ...prev, thumbnail: false }));
    toast.error('Failed to upload thumbnail');
  };



  const handleThumbnailReplaced = () => {
    setUploadedFiles(prev => ({ ...prev, thumbnail: null }));
  };

  const handleGameUploadStart = () => {
    setIsUploading(prev => ({ ...prev, game: true }));
  };

  const handleGameUploaded = (file: UploadedFile) => {
    setUploadedFiles(prev => ({ ...prev, game: file }));
    setIsUploading(prev => ({ ...prev, game: false }));
  };

  const handleGameUploadError = () => {
    setIsUploading(prev => ({ ...prev, game: false }));
    toast.error('Failed to upload game file');
  };

  const handleGameReplaced = () => {
    setUploadedFiles(prev => ({ ...prev, game: null }));
  };

  const handleSubmit = async (values: FormValues, { setSubmitting }: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      // Sanitize HTML content with DOMPurify before sending
      const gameData: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        title: values.title,
        description: values.description ? DOMPurify.sanitize(values.description, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
          ALLOWED_ATTR: ['href', 'class'],
        }) : undefined,
        categoryId: values.categoryId || undefined,
        position: values.position || undefined,
        config: values.config,
        metadata: {
          developer: values.developer || undefined,
          platform: values.platform || 'desktop',
          howToPlay: values.howToPlay ? DOMPurify.sanitize(values.howToPlay, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
            ALLOWED_ATTR: ['href', 'class'],
          }) : undefined,
          tags: values.tags.length > 0 ? values.tags : undefined,
          faqOverride: values.faqOverride,
        },
      };

      // Add file keys if new files were uploaded
      if (values.thumbnailFile) {
        if (proposalId) {
             gameData.thumbnailFileKey = values.thumbnailFile.key;
             // Save full file object for frontend preview
             gameData.thumbnailFile = values.thumbnailFile;
        } else {
             gameData.thumbnailFileKey = values.thumbnailFile.key;
        }
      }
      if (values.gameFile) {
        gameData.gameFileKey = values.gameFile.key;
        if (proposalId) {
             gameData.gameFile = values.gameFile;
        }
      }

      if (proposalId) {
          // Update Proposal
          await updateProposal.mutateAsync({ id: proposalId, data: gameData });
           toast.success('Proposal updated successfully!');
           navigate('/admin/my-proposals');
      } else {
          // Update Game
          await updateGame.mutateAsync({ id: gameId || '', data: gameData });
          toast.success('Game updated successfully!');
          if (permissions?.isEditor) {
            navigate('/admin/my-proposals');
          } else {
            navigate(`/admin/view-game/${gameId}`);
          }
      }
    } catch {
      toast.error('Failed to update game');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#6A7282]"></div>
      </div>
    );
  }


  if (!effectiveData) {
    return (
      <div className="p-6">
        <p className="text-red-500">{proposalId ? `Proposal not found (ID: ${proposalId})` : 'Game not found'}</p>
      </div>
    );
  }

  // Helper function to ensure tags is always an array
  const ensureArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') {
      return Object.values(value).filter((v): v is string => typeof v === 'string');
    }
    return [];
  };

  const initialValues: FormValues = {
    title: effectiveData.title || '',
    developer: effectiveData.metadata?.developer || '',
    platform: Array.isArray(effectiveData.metadata?.platform)
      ? effectiveData.metadata.platform
      : effectiveData.metadata?.platform
        ? [effectiveData.metadata.platform]
        : ['desktop'],
    categoryId: (gameId ? game.category?.id : effectiveData.categoryId) || '',
    position: effectiveData.position || 0,
    config: effectiveData.config || 1,
    description: effectiveData.description || '',
    howToPlay: effectiveData.metadata?.howToPlay || '',
    tags: ensureArray(effectiveData.metadata?.tags),
    faqOverride: effectiveData.metadata?.faqOverride || '',
  };

  const categoryOptions = categories?.map((cat) => ({
    value: cat.id,
    label: cat.name,
  })) || [];

  // Determine if Read Only
  const isReadOnly = !!(proposalId && proposal && proposal.status !== 'pending');

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <GameBreadcrumb
          categoryName={currentCategory?.name || (gameId ? game?.category?.name : '')}
          categoryId={currentCategory?.id || (gameId ? game?.category?.id : '')}
          gameTitle={effectiveData?.title || (gameId ? game?.title : '')}
          overrideLink={proposalId ? `/admin/my-proposals` : `/admin/view-game/${gameId}`}
          overrideText={proposalId ? "My Proposals" : "Game Detail"}
        />
        <div className="flex items-center gap-3 mt-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {proposalId ? 'Edit Proposal' : 'Edit Game'}: {effectiveData?.title}
            </h1>
            {isReadOnly && (
                <Badge variant={proposal.status === 'approved' ? 'default' : 'destructive'}>
                    {proposal.status.toUpperCase()}
                </Badge>
            )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {proposalId ? 'Update your game proposal details' : 'Update all game information and metadata'}
        </p>
      </div>

      {/* Read Only Alert */}
      {isReadOnly && (
        <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
             <h3 className="font-semibold text-blue-900 dark:text-blue-400">Read Only View</h3>
             <p className="text-blue-800 dark:text-blue-300 text-sm">
                This proposal has been {proposal.status}. You cannot make further edits.
                {proposal.status === 'declined' && " Please submit a new proposal to address the feedback."}
             </p>
             {proposal.status === 'declined' && (
                 <Button
                    size="sm"
                    onClick={handleRevise}
                    disabled={reviseProposal.isPending}
                    className="mt-2 bg-blue-600 hover:bg-blue-700 text-white gap-2"
                 >
                    {reviseProposal.isPending ? 'Creating Revision...' : <><RefreshCcw className="w-4 h-4" /> Revise & Resubmit</>}
                 </Button>
             )}
          </div>
        </div>
      )}

      {/* Admin Feedback Prompt */}
      {proposal?.adminFeedback && (proposal?.status === 'declined' || proposal?.status === 'pending') && (
        <div className="mb-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
               <h3 className="font-semibold text-amber-900 dark:text-amber-400">Feedback from Admin</h3>
               <p className="text-amber-800 dark:text-amber-300 text-sm whitespace-pre-wrap">{proposal.adminFeedback}</p>
            </div>
          </div>
          {/* Dismiss Feedback Button for Declined Proposals */}
          {proposal?.status === 'declined' && !proposal?.feedbackDismissedAt && (
            <div className="mt-4 pt-3 border-t border-amber-200 dark:border-amber-800">
              <DismissFeedbackButton proposalId={proposal.id} />
            </div>
          )}
        </div>
      )}

      {/* Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Form Area */}
        <div className="lg:col-span-2">
          {/* Form */}
          <Formik
            innerRef={formikRef}
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={handleSubmit}
            enableReinitialize
          >
            {({ values, setFieldValue, isSubmitting }) => (
              <Form className={`space-y-6 ${isReadOnly ? 'opacity-80 pointer-events-none' : ''}`}>
                {/* ... Form Content ... */}
                {/* Thumbnail Upload */}
                <div className="space-y-2">
                  <Label>Thumbnail Image</Label>
                  {/* Hide upload controls if read only, just show current */}
                  {!isReadOnly && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {(effectiveData.thumbnailUrl || effectiveData.thumbnailFile?.url || effectiveData.thumbnailFile?.publicUrl) ? 'Current thumbnail will be replaced if you upload a new one' : 'Upload a new thumbnail'}
                    </p>
                  )}
                  <div className="flex flex-col gap-4">
                    {(effectiveData.thumbnailUrl || effectiveData.thumbnailFile?.url || effectiveData.thumbnailFile?.publicUrl) && !uploadedFiles.thumbnail && (
                      <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                        <p className="text-sm font-medium mb-2">Current Thumbnail:</p>
                        <img
                          src={effectiveData.thumbnailUrl || effectiveData.thumbnailFile?.url || effectiveData.thumbnailFile?.publicUrl}
                          alt="Current thumbnail"
                          className="max-w-xs rounded border"
                        />
                      </div>
                    )}
                    {!isReadOnly && (
                        <UppyUpload
                        onFileUploaded={handleThumbnailUploaded}
                        onFileReplaced={handleThumbnailReplaced}
                        onUploadStart={handleThumbnailUploadStart}
                        onUploadError={handleThumbnailUploadError}
                        fileType="thumbnail"
                        accept={['image/*']}
                        maxFileSize={5 * 1024 * 1024}
                        />
                    )}
                  </div>
                </div>

                {/* Game File Upload */}
                <div className="space-y-2">
                  <Label>Game File</Label>
                   {!isReadOnly && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(effectiveData.gameUrl || effectiveData.gameFile?.url || effectiveData.gameFile?.publicUrl) ? 'Current game file will be replaced if you upload a new one' : 'Upload a new game file'}
                      </p>
                   )}
                  <div className="flex flex-col gap-4">
                    {(effectiveData.gameUrl || effectiveData.gameFile?.url || effectiveData.gameFile?.publicUrl) && !uploadedFiles.game && (
                      <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                        <p className="text-sm font-medium">Current Game File:</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {effectiveData.gameUrl || effectiveData.gameFile?.url || effectiveData.gameFile?.publicUrl}
                        </p>
                      </div>
                    )}
                    {!isReadOnly && (
                        <UppyUpload
                        onFileUploaded={handleGameUploaded}
                        onFileReplaced={handleGameReplaced}
                        onUploadStart={handleGameUploadStart}
                        onUploadError={handleGameUploadError}
                        fileType="game"
                        maxFileSize={100 * 1024 * 1024}
                        />
                    )}
                  </div>
                </div>

                {/* Position/Order */}
                <div className="space-y-2">
                  <Label htmlFor="position">Position/Order Number</Label>
                  <Field
                    as={Input}
                    id="position"
                    name="position"
                    type="number"
                    disabled={isReadOnly}
                    placeholder="Enter position number (e.g., 1, 2, 3...)"
                    className="bg-white dark:bg-gray-800"
                  />
                  {!isReadOnly && (
                      <ErrorMessage
                        name="position"
                        component="p"
                        className="text-sm text-red-500"
                      />
                  )}
                </div>

                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">Game Title *</Label>
                  <Field
                    as={Input}
                    id="title"
                    name="title"
                    disabled={isReadOnly}
                    placeholder="Enter game title"
                    className="bg-white dark:bg-gray-800"
                  />
                  {!isReadOnly && (
                      <ErrorMessage
                        name="title"
                        component="p"
                        className="text-sm text-red-500"
                      />
                  )}
                </div>

                {/* Developer */}
                <div className="space-y-2">
                  <Label htmlFor="developer">Developer</Label>
                  <Field
                    as={Input}
                    id="developer"
                    name="developer"
                    disabled={isReadOnly}
                    placeholder="Enter developer name (e.g., ArcadesBox)"
                    className="bg-white dark:bg-gray-800"
                  />
                  <ErrorMessage
                    name="developer"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* Platform */}
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <SearchableSelect
                    options={[
                      { value: 'Desktop', label: 'Desktop' },
                      { value: 'Mobile', label: 'Mobile' },
                      { value: 'Tablet', label: 'Tablet' },
                    ]}
                    value={values.platform}
                    onValueChange={(value) => setFieldValue('platform', value)}
                    placeholder="Select platforms..."
                    isMulti={true}
                    disabled={isReadOnly}
                  />
                  <ErrorMessage
                    name="platform"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* Release Date */}
                <div className="space-y-2">
                  <Label htmlFor="releaseDate">Release Date</Label>
                  <Field
                    as={Input}
                    id="releaseDate"
                    name="releaseDate"
                    type="date"
                    disabled={isReadOnly}
                    placeholder="Select release date"
                    className="bg-white dark:bg-gray-800"
                  />
                  <ErrorMessage
                    name="releaseDate"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* Game Category */}
                <div className="space-y-2">
                  <Label htmlFor="categoryId">Game Category</Label>
                  <SearchableSelect
                    options={categoryOptions}
                    value={values.categoryId}
                    onValueChange={(value) => setFieldValue('categoryId', value)}
                    placeholder="Select a category"
                    disabled={isReadOnly}
                  />
                  <ErrorMessage
                    name="categoryId"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* Free Game Time / Config */}
                <div className="space-y-2">
                  <Label htmlFor="config">Free Game Time (minutes) *</Label>
                  <Field
                    as={Input}
                    id="config"
                    name="config"
                    type="number"
                    disabled={isReadOnly}
                    placeholder="Enter free game time in minutes"
                    className="bg-white dark:bg-gray-800"
                  />
                  <ErrorMessage
                    name="config"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* Game Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Game Description</Label>
                  {!isReadOnly && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Rich text editor - supports formatting, lists, and links
                      </p>
                  )}
                  <RichTextEditor
                    content={values.description}
                    onChange={(html) => setFieldValue('description', html)}
                    placeholder="Enter game description with formatting..."
                    disabled={isReadOnly}
                  />
                  <ErrorMessage
                    name="description"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* How to Play */}
                <div className="space-y-2">
                  <Label htmlFor="howToPlay">How to Play</Label>
                  {!isReadOnly && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Rich text editor - supports formatting, lists, and links
                      </p>
                  )}
                  <RichTextEditor
                    content={values.howToPlay}
                    onChange={(html) => setFieldValue('howToPlay', html)}
                    placeholder="Enter instructions on how to play..."
                    disabled={isReadOnly}
                  />
                  <ErrorMessage
                    name="howToPlay"
                    component="p"
                    className="text-sm text-red-500"
                  />
                </div>

                {/* FAQ Editor */}
                <div className="space-y-2">
                    <FAQEditor
                        initialContent={values.faqOverride}
                        gameTitle={values.title}
                        categoryName={
                            categoryOptions.find(c => c.value === values.categoryId)?.label || ''
                        }
                        onChange={(html) => setFieldValue('faqOverride', html)}
                        isReadOnly={isReadOnly}
                    />
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <Label>Tags</Label>
                  {!isReadOnly && (
                      <div className="flex gap-2">
                        <Input
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (newTag.trim() && !values.tags.includes(newTag.trim())) {
                                setFieldValue('tags', [...values.tags, newTag.trim()]);
                                setNewTag('');
                              }
                            }
                          }}
                          placeholder="Add a tag and press Enter"
                          className="bg-white dark:bg-gray-800"
                        />
                        <Button
                          type="button"
                          onClick={() => {
                            if (newTag.trim() && !values.tags.includes(newTag.trim())) {
                              setFieldValue('tags', [...values.tags, newTag.trim()]);
                              setNewTag('');
                            }
                          }}
                          variant="outline"
                        >
                          Add
                        </Button>
                      </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {values.tags.map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="flex items-center gap-1 px-3 py-1"
                      >
                        {tag}
                        {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => {
                                setFieldValue(
                                  'tags',
                                  values.tags.filter((_, i) => i !== index)
                                );
                              }}
                              className="ml-1 hover:text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700 pointer-events-auto">
                 {/* Re-enable pointer events for buttons so user can leave */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(proposalId ? '/admin/my-proposals' : `/admin/view-game/${gameId}`)}
                  >
                    {isReadOnly ? 'Back to List' : 'Cancel'}
                  </Button>
                  {!isReadOnly && (
                      <Button
                        type="submit"
                        disabled={isSubmitting || isUploading.thumbnail || isUploading.game}
                        className="bg-[#6A7282] hover:bg-[#5A626F] text-white"
                      >
                        {isSubmitting
                          ? (permissions?.isEditor ? 'Submitting...' : 'Saving...')
                          : (permissions?.isEditor ? 'Submit for Review' : 'Save Changes')}
                      </Button>
                  )}
                </div>
              </Form>
            )}
          </Formik>
        </div>

        {/* Sidebar */}
        {(permissions?.isEditor || proposalId) && (
          <div className="order-first lg:order-last lg:col-span-1">
             <EditorGameSidebar gameId={gameId} proposalId={proposalId} />
          </div>
        )}
      </div>
    </div>
  );
}
