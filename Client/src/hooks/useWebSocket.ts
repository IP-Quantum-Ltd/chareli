import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { BackendRoute } from '../backend/constants';
import { setGameProgress, clearGameProgress } from '../utils/gameProgress';

import type { GameProposal } from '../backend/types';

interface GameStatusUpdate {
  gameId: string;
  processingStatus: string;
  processingError?: string;
  status?: string;
  jobId?: string;
  timestamp: string;
}

interface GameProcessingProgress {
  gameId: string;
  progress: number;
  timestamp: string;
}

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const useWebSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      return;
    }

    console.log('🔌 [WebSocket] Connecting to:', BACKEND_URL);

    socketRef.current = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: maxReconnectAttempts,
    });

    socketRef.current.on('connect', () => {
      console.log('✅ [WebSocket] Connected successfully, Socket ID:', socketRef.current?.id);
      reconnectAttempts.current = 0;
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ [WebSocket] Disconnected, reason:', reason);

      // Attempt manual reconnection if needed
      if (reason === 'io server disconnect' || reason === 'transport close') {
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          console.log(`🔄 [WebSocket] Attempting reconnection ${reconnectAttempts.current}/${maxReconnectAttempts} in ${delay}ms...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      }
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('❌ [WebSocket] Connection error:', error.message);
    });

    socketRef.current.on('game-status-update', (data: GameStatusUpdate) => {
      console.log('📡 [WebSocket] Game status update received:', data);

      // Clear progress when game completes or fails
      if (data.processingStatus === 'completed' || data.processingStatus === 'failed') {
        clearGameProgress(data.gameId);
      }

      // Invalidate relevant queries to trigger refetch
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS]
      });
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.GAMES]
      });
      queryClient.invalidateQueries({
        queryKey: ['game-processing-status', data.gameId]
      });

      // ALSO invalidate proposal lists if this game update affects them (e.g. status change)
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSALS] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });

      // Update the specific game query cache if it exists
      queryClient.setQueryData(
        ['game-processing-status', data.gameId],
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            data: {
              ...oldData.data,
              processingStatus: data.processingStatus,
              processingError: data.processingError,
              jobId: data.jobId,
            }
          };
        }
      );
    });

    socketRef.current.on('proposal-update', (data: { action: string; proposal: GameProposal }) => {
        console.log('📡 [WebSocket] Proposal update received:', data);

        // Invalidate all proposal-related queries to ensure lists are fresh
        queryClient.invalidateQueries({ queryKey: [BackendRoute.MY_PROPOSALS] });
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSALS] });
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAME_PROPOSAL_BY_ID] });
        // Also invalidate games list as some proposals create/update games
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
    });

    socketRef.current.on('game-processing-progress', (data: GameProcessingProgress) => {
      console.log('📊 [WebSocket] Processing progress:', data);

      // Store progress globally so it persists across renders
      setGameProgress(data.gameId, data.progress);

      // Invalidate query to trigger re-render with new progress
      queryClient.invalidateQueries({
        queryKey: [BackendRoute.ADMIN_GAMES_ANALYTICS]
      });
    });
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      console.log('🔌 [WebSocket] Disconnecting...');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    socket: socketRef.current,
    isConnected: socketRef.current?.connected || false,
    connect,
    disconnect,
  };
};
