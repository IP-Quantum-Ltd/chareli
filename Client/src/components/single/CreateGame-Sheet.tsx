/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef } from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import {
  number as yupNumber,
  object as yupObject,
  string as yupString,
} from 'yup';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Badge } from '../ui/badge';
import { RichTextEditor } from '../ui/RichTextEditor';
// import uploadImg from "../../assets/fetch-upload.svg";
import { useCreateGame } from '../../backend/games.service';
import { useCategories } from '../../backend/category.service';
import { backendService } from '../../backend/api.service';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { useQueryClient } from '@tanstack/react-query';
import { BackendRoute } from '../../backend/constants';
import GameCreationProgress from './GameCreationProgress';
import UppyUpload from './UppyUpload';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import { X } from 'lucide-react';
import DOMPurify from 'dompurify';

interface UploadedFile {
  name: string;
  publicUrl: string;
  key: string;
}

interface FormValues {
  title: string;
  description: string;
  config: number;
  categoryId: string;
  position?: number;
  thumbnailFile?: UploadedFile;
  gameFile?: UploadedFile;
  developer?: string;
  platform?: string[];
  releaseDate?: string;
  metadata?: {
    howToPlay?: string;
    tags?: string[];
  };
}

// Validation schema
const validationSchema = yupObject({
  title: yupString().required('Title is required').trim(),
  description: yupString().trim().optional(),
  config: yupNumber()
    .required('Config is required')
    .min(0, 'Config must be a positive number'),
  categoryId: yupString(),
  thumbnailFile: yupObject().required('Thumbnail image is required').shape({
    name: yupString().required(),
    publicUrl: yupString().required(),
    key: yupString().required(),
  }),
  gameFile: yupObject().required('Game file is required').shape({
    name: yupString().required(),
    publicUrl: yupString().required(),
    key: yupString().required(),
  }),
  developer: yupString().optional(),
  releaseDate: yupString().optional(),
});

// Initial values
const initialValues: FormValues = {
  title: '',
  description: '',
  config: 1,
  categoryId: '',
  developer: '',
  releaseDate: '',
  platform: ['desktop'],
  metadata: {
    howToPlay: '',
    tags: [],
  },
};

export function CreateGameSheet({
  children,
  onOpenChange,
}: {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const formikRef = useRef<any>(null);
  const [isOpen, setIsOpen] = useState(false);
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
  const [newTag, setNewTag] = useState('');

  // Stable callback functions to prevent re-renders
  const handleThumbnailUploaded = React.useCallback((file: UploadedFile) => {
    logger.debug('Thumbnail uploaded');
    setUploadedFiles((prev) => ({ ...prev, thumbnail: file }));
    setIsUploading((prev) => ({ ...prev, thumbnail: false }));
    if (formikRef.current) {
      formikRef.current.setFieldValue('thumbnailFile', file);
    }
  }, []);

  const handleGameUploaded = React.useCallback((file: UploadedFile) => {
    logger.debug('Game file uploaded');
    setUploadedFiles((prev) => ({ ...prev, game: file }));
    setIsUploading((prev) => ({ ...prev, game: false }));
    if (formikRef.current) {
      formikRef.current.setFieldValue('gameFile', file);
    }
  }, []);

  const handleThumbnailReplaced = React.useCallback(() => {
    logger.debug('Thumbnail replaced');
    setUploadedFiles((prev) => ({ ...prev, thumbnail: null }));
    setIsUploading((prev) => ({ ...prev, thumbnail: false }));
    if (formikRef.current) {
      formikRef.current.setFieldValue('thumbnailFile', undefined);
    }
  }, []);

  const handleGameReplaced = React.useCallback(() => {
    logger.debug('Game file replaced');
    setUploadedFiles((prev) => ({ ...prev, game: null }));
    setIsUploading((prev) => ({ ...prev, game: false }));
    if (formikRef.current) {
      formikRef.current.setFieldValue('gameFile', undefined);
    }
  }, []);

  const handleThumbnailUploadStart = React.useCallback(() => {
    logger.debug('Thumbnail upload started');
    setIsUploading((prev) => ({ ...prev, thumbnail: true }));
  }, []);

  const handleGameUploadStart = React.useCallback(() => {
    logger.debug('Game upload started');
    setIsUploading((prev) => ({ ...prev, game: true }));
  }, []);

  const handleThumbnailUploadError = React.useCallback((error: string) => {
    console.error('❌ Thumbnail upload error:', error);
    setIsUploading((prev) => ({ ...prev, thumbnail: false }));
    toast.error(`Thumbnail upload failed: ${error}`);
  }, []);

  const handleGameUploadError = React.useCallback((error: string) => {
    console.error('❌ Game upload error:', error);
    setIsUploading((prev) => ({ ...prev, game: false }));
    toast.error(`Game upload failed: ${error}`);
  }, []);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  // const [createdGameId, setCreatedGameId] = useState<string | null>(null);
  const createGame = useCreateGame();
  const { data: categories } = useCategories();
  const queryClient = useQueryClient(); // Add query client for manual cache invalidation
  // Don't log created game ID - use React DevTools to debug
  const handleSubmit = async (
    values: FormValues,
    { setSubmitting, resetForm }: any
  ) => {
    try {
      // Show progress bar
      setShowProgress(true);
      setProgress(25);
      setCurrentStep('Creating game record...');

      // Send file keys instead of files
      const metadata: any = {
        developer: values.developer || undefined,
        platform: values.platform && values.platform.length > 0 ? values.platform : ['desktop'],
        releaseDate: values.releaseDate || undefined,
        howToPlay: values.metadata?.howToPlay ? DOMPurify.sanitize(values.metadata.howToPlay, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
          ALLOWED_ATTR: ['href', 'class'],
        }) : undefined,
        tags: values.metadata?.tags && values.metadata.tags.length > 0 ? values.metadata.tags : undefined,
      };

      const gameData = {
        title: values.title,
        description: values.description ? DOMPurify.sanitize(values.description, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
          ALLOWED_ATTR: ['href', 'class'],
        }) : undefined,
        config: values.config,
        categoryId: values.categoryId,
        position: values.position,
        thumbnailFileKey: values.thumbnailFile?.key,
        gameFileKey: values.gameFile?.key,
        // Add metadata if any fields were provided
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };

      setProgress(75);
      setCurrentStep('Queueing background processing...');

      const result = await createGame.mutateAsync(gameData);
      //edmond check this
      const newGameId = result?.data?.data?.id;

      setProgress(100);
      setCurrentStep('Game created successfully!');

      // Store the created game ID for potential status tracking
      if (newGameId) {
        // setCreatedGameId(newGameId);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      toast.success(
        'Game created successfully! ZIP processing will continue in the background.',
        { duration: 4000 }
      );

      resetForm();
      setUploadedFiles({ thumbnail: null, game: null });
      setShowProgress(false);
      setProgress(0);
      setCurrentStep('');
      // setCreatedGameId(null);
      setIsOpen(false);
      onOpenChange?.(false);
    } catch (error: any) {
      console.error('Error creating game:', error);

      // Check if this is a network error but the game might have been created successfully
      if (error?.code === 'ERR_NETWORK' || error?.message === 'Network Error') {
        setCurrentStep('Verifying game creation...');
        setProgress(90);

        // Wait a moment for the server to complete processing
        await new Promise((resolve) => setTimeout(resolve, 10000));

        try {
          // Check if the game was actually created by searching for it
          // We'll search for games with the same title created in the last few minutes
          const { data: recentGames } = await backendService.get('/api/games', {
            params: {
              limit: 10,
              search: values.title,
            },
            suppressErrorToast: true,
          });

          // Look for a game with the exact title created recently (within the last 5 minutes)
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const possibleGame = recentGames?.data?.find(
            (game: any) =>
              game.title === values.title &&
              new Date(game.createdAt) > fiveMinutesAgo
          );

          if (possibleGame) {
            setProgress(100);
            setCurrentStep('Game created successfully!');
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Manually invalidate React Query cache to trigger UI updates
            queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
            queryClient.invalidateQueries({
              queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS],
            });
            queryClient.invalidateQueries({
              queryKey: [BackendRoute.CATEGORIES],
            });

            toast.success(
              'Game created successfully! (Upload completed despite network error)'
            );
            resetForm();
            setUploadedFiles({ thumbnail: null, game: null });
            setShowProgress(false);
            setProgress(0);
            setCurrentStep('');
            setIsOpen(false);
            onOpenChange?.(false);
            return;
          }
        } catch (verificationError) {
          console.error('Failed to verify game creation:', verificationError);
        }
      }

      // If we get here, the game creation actually failed
      setShowProgress(false);
      setProgress(0);
      setCurrentStep('');
      toast.error('Failed to create game');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open && formikRef.current) {
          formikRef.current.resetForm();
          setUploadedFiles({ thumbnail: null, game: null });
          setNewTag('');
          setShowProgress(false); // Reset progress state
          setProgress(0);
          setCurrentStep('');
        }
        onOpenChange?.(open);
      }}
    >
      <SheetTrigger asChild onClick={() => setIsOpen(true)}>
        {children}
      </SheetTrigger>
      <SheetContent className="font-dmmono dark:bg-[#0F1621] max-w-xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl font-medium tracking-wider mt-6 mb-2">
            Create New Game
          </SheetTitle>
          <div className="border border-b-gray-200 mb-2"></div>
        </SheetHeader>
        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
          innerRef={formikRef}
        >
          {({ isSubmitting, isValid, dirty, values, setFieldValue }) => (
            <Form className="grid grid-cols-1 gap-6 pl-4 pr-4">
              {/* Thumbnail Upload - Full Width */}
              <div>
                <Label className="text-base mb-3 block dark:text-white">
                  Game Thumbnail
                </Label>
                <UppyUpload
                  fileType="thumbnail"
                  accept={['image/*']}
                  onFileUploaded={handleThumbnailUploaded}
                  onFileReplaced={handleThumbnailReplaced}
                  onUploadStart={handleThumbnailUploadStart}
                  onUploadError={handleThumbnailUploadError}
                />
                {uploadedFiles.thumbnail && (
                  <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-worksans">
                      <span className="font-medium">
                        {uploadedFiles.thumbnail.name}
                      </span>
                      <span className="text-xs bg-green-100 dark:bg-green-800 px-2 py-1 rounded-full">
                        Uploaded
                      </span>
                    </div>
                  </div>
                )}
                {isUploading.thumbnail && (
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                    <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 font-worksans">
                      <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span>Uploading thumbnail...</span>
                    </div>
                  </div>
                )}
                <ErrorMessage
                  name="thumbnailFile"
                  component="div"
                  className="text-red-500 mt-2 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Order Number - Separate Row */}
              <div>
                <Label
                  htmlFor="position"
                  className="text-base mb-2 block dark:text-white"
                >
                  Order Number (Optional)
                </Label>
                <Field
                  as={Input}
                  type="number"
                  id="position"
                  name="position"
                  min="1"
                  className="w-full h-12 rounded-md border border-[#CBD5E0] dark:text-white bg-[#F1F5F9] dark:bg-[#121C2D] px-3 text-gray-700 focus:border-[#6A7282] focus:outline-none font-worksans tracking-wider text-sm"
                  placeholder="e.g., 1, 2, 3..."
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-worksans">
                  Position in the games list (leave empty for auto-assignment)
                </p>
                <ErrorMessage
                  name="position"
                  component="div"
                  className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Title Input */}
              <div>
                <Label
                  htmlFor="title"
                  className="text-base mb-2 block dark:text-white"
                >
                  Title
                </Label>
                <Field
                  as={Input}
                  id="title"
                  name="title"
                  className="w-full h-12 rounded-md border border-[#CBD5E0] dark:text-white bg-[#F1F5F9] dark:bg-[#121C2D] px-3 text-gray-700 focus:border-[#6A7282] focus:outline-none font-worksans tracking-wider text-sm"
                  placeholder="Enter game title"
                />
                <ErrorMessage
                  name="title"
                  component="div"
                  className="text-red-500  mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Developer Input */}
              <div>
                <Label
                  htmlFor="developer"
                  className="text-base mb-2 block dark:text-white"
                >
                  Developer (Optional)
                </Label>
                <Field
                  as={Input}
                  id="developer"
                  name="developer"
                  className="w-full h-12 rounded-md border border-[#CBD5E0] dark:text-white bg-[#F1F5F9] dark:bg-[#121C2D] px-3 text-gray-700 focus:border-[#6A7282] focus:outline-none font-worksans tracking-wider text-sm"
                  placeholder="Enter developer name"
                />
                <ErrorMessage
                  name="developer"
                  component="div"
                  className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Platform & Release Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Platform */}
                <div>
                  <Label className="text-base mb-2 block dark:text-white">
                    Platform
                  </Label>
                  <Field name="platform">
                    {({ field, form }: any) => (
                      <SearchableSelect
                        options={[
                          { value: 'Desktop', label: 'Desktop' },
                          { value: 'Mobile', label: 'Mobile' },
                          { value: 'Tablet', label: 'Tablet' },
                        ]}
                        value={field.value}
                        onValueChange={(value) => form.setFieldValue('platform', value)}
                        placeholder="Select platforms..."
                        isMulti={true}
                      />
                    )}
                  </Field>
                  <ErrorMessage
                    name="platform"
                    component="div"
                    className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                  />
                </div>

                {/* Release Date */}
                <div>
                  <Label
                    htmlFor="releaseDate"
                    className="text-base mb-2 block dark:text-white"
                  >
                    Release Date (Optional)
                  </Label>
                  <Field
                    as={Input}
                    type="date"
                    id="releaseDate"
                    name="releaseDate"
                    className="w-full h-12 rounded-md border border-[#CBD5E0] dark:text-white bg-[#F1F5F9] dark:bg-[#121C2D] px-3 text-gray-700 focus:border-[#6A7282] focus:outline-none font-worksans tracking-wider text-sm"
                  />
                  <ErrorMessage
                    name="releaseDate"
                    component="div"
                    className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <Label
                  htmlFor="description"
                  className="text-base mb-2 block dark:text-white"
                >
                  Game Description (Optional)
                </Label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-worksans">
                  Rich text editor - supports formatting, lists, and links
                </p>
                <RichTextEditor
                  content={values.description}
                  onChange={(html) => setFieldValue('description', html)}
                  placeholder="Enter game description with formatting..."
                />
                <ErrorMessage
                  name="description"
                  component="div"
                  className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* How To Play (SEO Metadata) */}
              <div>
                <Label
                  htmlFor="metadata.howToPlay"
                  className="text-base mb-2 block dark:text-white"
                >
                  How To Play (Optional)
                </Label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-worksans">
                  Instructions on how to play - helps with SEO
                </p>
                <RichTextEditor
                  content={values.metadata?.howToPlay || ''}
                  onChange={(html) => setFieldValue('metadata.howToPlay', html)}
                  placeholder="Explain how to play this game..."
                />
              </div>



              {/* Tags (SEO Metadata) */}
              <div>
                <Label className="text-base mb-2 block dark:text-white">Tags (Optional)</Label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const currentTags = values.metadata?.tags || [];
                        if (newTag.trim() && !currentTags.includes(newTag.trim())) {
                          setFieldValue('metadata.tags', [...currentTags, newTag.trim()]);
                          setNewTag('');
                        }
                      }
                    }}
                    placeholder="Add a tag..."
                    className="bg-[#F1F5F9] dark:bg-[#121C2D]"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      const currentTags = values.metadata?.tags || [];
                      if (newTag.trim() && !currentTags.includes(newTag.trim())) {
                        setFieldValue('metadata.tags', [...currentTags, newTag.trim()]);
                        setNewTag('');
                      }
                    }}
                    variant="outline"
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(values.metadata?.tags || []).map((tag, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => {
                          const currentTags = values.metadata?.tags || [];
                          setFieldValue('metadata.tags', currentTags.filter((_, i) => i !== index));
                        }}
                        className="ml-1 hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-worksans">
                  SEO tags/keywords
                </p>
              </div>

              {/* Game Upload */}
              <div>
                <Label className="text-base mb-2 block">Game Upload .zip</Label>
                <UppyUpload
                  fileType="game"
                  accept={['.zip']}
                  onFileUploaded={handleGameUploaded}
                  onFileReplaced={handleGameReplaced}
                  onUploadStart={handleGameUploadStart}
                  onUploadError={handleGameUploadError}
                />
                {uploadedFiles.game && (
                  <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-worksans">
                      <span className="font-medium">
                        {uploadedFiles.game.name}
                      </span>
                      <span className="text-xs bg-green-100 dark:bg-green-800 px-2 py-1 rounded-full">
                        Uploaded
                      </span>
                    </div>
                  </div>
                )}
                {isUploading.game && (
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                    <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 font-worksans">
                      <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span>Uploading game file...</span>
                    </div>
                  </div>
                )}
                <ErrorMessage
                  name="gameFile"
                  component="div"
                  className="text-red-500  mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Category Dropdown */}
              <div>
                <Label className="text-base mb-2 block dark:text-white">
                  Game Category
                </Label>
                <Field name="categoryId">
                  {({ field, form }: any) => (
                    <SearchableSelect
                      value={field.value}
                      onValueChange={(value: string | string[]) =>
                        form.setFieldValue('categoryId', value as string)
                      }
                      options={
                        categories?.map((category) => ({
                          value: category.id,
                          label: category.name,
                        })) || []
                      }
                      placeholder="Select category (optional)"
                      searchPlaceholder="Search categories..."
                      emptyText="No categories found"
                    />
                  )}
                </Field>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-worksans">
                  Leave empty to auto-assign to default category
                </p>
                <ErrorMessage
                  name="categoryId"
                  component="div"
                  className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              {/* Config Input */}
              <div>
                <Label
                  htmlFor="config"
                  className="text-base mb-2 block dark:text-white"
                >
                  Free Game Time (mins)
                </Label>
                <Field
                  as={Input}
                  type="number"
                  id="config"
                  name="config"
                  min="1"
                  className="w-full h-12 rounded-md border border-[#CBD5E0] dark:text-white dark:bg-[#121C2D] bg-[#F1F5F9] px-3 font-worksans text-sm tracking-wider  text-gray-700 focus:border-[#6A7282] focus:outline-none"
                  placeholder="Enter config number eg. (1)"
                />
                <ErrorMessage
                  name="config"
                  component="div"
                  className="text-red-500  mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              <div className="flex gap-3 justify-end px-2 mt-4">
                <Button
                  type="button"
                  className="w-24 h-12 text-[#334154] bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#E2E8F0] dark:text-gray-300 dark:bg-[#1E293B] dark:border-[#334155] dark:hover:bg-[#334155] cursor-pointer"
                  onClick={() => {
                    formikRef.current?.resetForm();
                    setUploadedFiles({ thumbnail: null, game: null });
                    setShowProgress(false);
                    setProgress(0);
                    setCurrentStep('');
                    setIsOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    !isValid ||
                    !dirty ||
                    !uploadedFiles.thumbnail ||
                    !uploadedFiles.game ||
                    isUploading.thumbnail ||
                    isUploading.game
                  }
                  className="w-24 h-12 bg-[#6A7282] text-white hover:bg-[#5A626F] dark:text-white dark:hover:bg-[#5A626F] cursor-pointer"
                >
                  {isSubmitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </Form>
          )}
        </Formik>

        {/* Progress Bar */}
        {showProgress && (
          <GameCreationProgress
            progress={progress}
            currentStep={currentStep}
            isComplete={progress === 100}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
