import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useRunAgentSeo } from '../backend/games.service';
import { usePermissions } from './usePermissions';

const AGENT_SEO_COMPLETION_TIMEOUT_MS = 5 * 60 * 1000;

export type AgentSeoStatus = 'idle' | 'running' | 'completed' | 'failed';

interface UseAgentSeoTriggerOptions {
  gameId: string | null;
  /** When true, SEO cannot be triggered (e.g. proposal edit mode). */
  disabled?: boolean;
}

export function useAgentSeoTrigger({
  gameId,
  disabled = false,
}: UseAgentSeoTriggerOptions) {
  const permissions = usePermissions();
  const runAgentSeo = useRunAgentSeo();
  const [seoStatus, setSeoStatus] = useState<AgentSeoStatus>('idle');
  const [seoConfirmOpen, setSeoConfirmOpen] = useState(false);

  const canTrigger =
    !!gameId &&
    !disabled &&
    (permissions.isAdmin || permissions.isSuperAdmin);

  useEffect(() => {
    if (!gameId) return;

    const handleSeoComplete = (e: Event) => {
      const { gameId: completedGameId } = (e as CustomEvent<{ gameId: string }>)
        .detail;
      if (completedGameId !== gameId) return;
      setSeoStatus('completed');
      toast.success('SEO metadata ready — new proposal awaiting review');
    };

    window.addEventListener('agent-seo-complete', handleSeoComplete);
    return () =>
      window.removeEventListener('agent-seo-complete', handleSeoComplete);
  }, [gameId]);

  useEffect(() => {
    if (seoStatus !== 'running') return;

    const timeoutId = setTimeout(() => {
      setSeoStatus('idle');
      toast.warning(
        'Timed out waiting for SEO completion. The job may still finish — check proposals.'
      );
    }, AGENT_SEO_COMPLETION_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [seoStatus]);

  const handleGenerateSeo = async (targetGameId: string) => {
    setSeoStatus('running');
    try {
      await runAgentSeo.mutateAsync(targetGameId);
      toast.success('Agent SEO job triggered');
    } catch {
      setSeoStatus('failed');
      toast.error('Failed to trigger agent SEO');
    }
  };

  const openConfirm = () => {
    if (!canTrigger || !gameId) return;
    setSeoConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!gameId) return;
    setSeoConfirmOpen(false);
    await handleGenerateSeo(gameId);
  };

  const isTriggering = seoStatus === 'running' || runAgentSeo.isPending;

  return {
    canTrigger,
    seoStatus,
    seoConfirmOpen,
    setSeoConfirmOpen,
    openConfirm,
    handleConfirm,
    isTriggering,
    triggerForGameId: handleGenerateSeo,
  };
}
