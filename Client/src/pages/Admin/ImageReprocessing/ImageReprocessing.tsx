import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  useReprocessingStatus,
  useStartReprocessing,
  usePauseReprocessing,
  useResumeReprocessing,
  useResetReprocessing,
} from '../../../backend/imageReprocessing.service';
import { toast } from 'sonner';
import { AlertCircle, ImageIcon, Play, Pause, RotateCcw, RefreshCw } from 'lucide-react';
import { usePermissions } from '../../../hooks/usePermissions';

export default function ImageReprocessing() {
  const permissions = usePermissions();
  const { data, isLoading, error, refetch } = useReprocessingStatus();
  const startMutation = useStartReprocessing();
  const pauseMutation = usePauseReprocessing();
  const resumeMutation = useResumeReprocessing();
  const resetMutation = useResetReprocessing();

  const [batchSize, setBatchSize] = useState(10);

  // Access control: same as cache dashboard (superadmin in dev/test)
  if (!permissions.canAccessCacheDashboard) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-100">
              Access Denied
            </h2>
            <p className="text-red-700 dark:text-red-300 max-w-md">
              This feature is only accessible to superadmin users in dev/test environments.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const status = data?.data;
  const progress = status ? Math.round((status.processed / status.total) * 100) : 0;
  const imagesPerSecond = status?.processed && status?.startedAt
    ? (status.processed / ((Date.now() - new Date(status.startedAt).getTime()) / 1000)).toFixed(2)
    : '0';

  const handleStart = async () => {
    try {
      const result = await startMutation.mutateAsync({ batchSize });
      toast.success(result.message || 'Image reprocessing started');
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error?.response?.data?.message || 'Failed to start reprocessing');
    }
  };

  const handlePause = async () => {
    try {
      const result = await pauseMutation.mutateAsync();
      toast.success(result.message || 'Reprocessing paused');
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error?.response?.data?.message || 'Failed to pause reprocessing');
    }
  };

  const handleResume = async () => {
    try {
      const result = await resumeMutation.mutateAsync();
      toast.success(result.message || 'Reprocessing resumed');
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error?.response?.data?.message || 'Failed to resume reprocessing');
    }
  };

  const handleReset = async () => {
    try {
      const result = await resetMutation.mutateAsync();
      toast.success(result.message || 'Status reset');
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error?.response?.data?.message || 'Failed to reset status');
    }
  };

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-100">
              Failed to Load Status
            </h2>
            <p className="text-red-700 dark:text-red-300">
              {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                'An error occurred while loading reprocessing status.'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-[#F1F5F9] dark:bg-[#121C2D] p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Image Reprocessing
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Generate Sharp WebP variants for existing images
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Status Card */}
      {isLoading ? (
        <Card className="animate-pulse bg-gray-200 dark:bg-gray-800 h-48" />
      ) : (
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] border-none shadow-none">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <ImageIcon className="h-5 w-5 text-gray-700 dark:text-gray-300" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Processing Status
              </h2>
            </div>

            <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] border-none shadow-none p-6">
              <div className="space-y-6">
                {/* Progress Bar */}
                {status?.isRunning && (
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Progress
                      </span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {progress}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                      <div
                        className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Status</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {status?.isRunning
                        ? status.paused
                          ? '⏸️ Paused'
                          : '▶️ Running'
                        : '⏹️ Stopped'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Processed</p>
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {status?.processed || 0} / {status?.total || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Failed</p>
                    <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                      {status?.failed || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Speed</p>
                    <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                      {imagesPerSecond} img/s
                    </p>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap gap-3">
                  {!status?.isRunning ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="batchSize" className="text-sm">Batch Size:</Label>
                        <Input
                          id="batchSize"
                          type="number"
                          min="1"
                          max="50"
                          value={batchSize}
                          onChange={(e) => setBatchSize(parseInt(e.target.value) || 10)}
                          className="w-20"
                        />
                      </div>
                      <Button
                        onClick={handleStart}
                        disabled={startMutation.isPending}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Start Reprocessing
                      </Button>
                    </>
                  ) : status.paused ? (
                    <Button
                      onClick={handleResume}
                      disabled={resumeMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      onClick={handlePause}
                      disabled={pauseMutation.isPending}
                      variant="outline"
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </Button>
                  )}

                  {!status?.isRunning && (
                    <Button
                      onClick={handleReset}
                      disabled={resetMutation.isPending}
                      variant="outline"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset Status
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </Card>
      )}

      {/* Errors Card */}
      {status?.errors && status.errors.length > 0 && (
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] border-none shadow-none">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Processing Errors ({status.errors.length})
              </h2>
            </div>
            <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] border-none shadow-none p-4">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {status.errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
                  >
                    <p className="text-sm font-medium text-red-900 dark:text-red-100 break-all">
                      {err.s3Key}
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                      {err.error}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {new Date(err.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Card>
      )}
    </div>
  );
}
