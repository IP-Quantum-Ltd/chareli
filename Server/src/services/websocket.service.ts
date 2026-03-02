import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import logger from '../utils/logger';
import config from '../config/config';

class WebSocketService {
  private io: SocketIOServer | null = null;

  /**
   * Initialize Socket.io server
   */
  initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.app.clientUrl || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      socket.on('disconnect', (reason) => {
        logger.info(`WebSocket client disconnected: ${socket.id}, reason: ${reason}`);
      });

      socket.on('error', (error) => {
        logger.error(`WebSocket error for client ${socket.id}:`, error);
      });
    });

    logger.info('WebSocket service initialized successfully');
  }

  /**
   * Emit game status update to all connected clients
   */
  emitGameStatusUpdate(gameId: string, data: {
    processingStatus: string;
    processingError?: string;
    status?: string;
    jobId?: string;
  }): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized, cannot emit game status update');
      return;
    }

    this.io.emit('game-status-update', {
      gameId,
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Emitted game status update for game ${gameId}:`, data);
  }

  /**
   * Emit game processing progress update
   */
  emitGameProcessingProgress(gameId: string, progress: number): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized, cannot emit progress update');
      return;
    }

    this.io.emit('game-processing-progress', {
      gameId,
      progress,
      timestamp: new Date().toISOString(),
    });

    logger.debug(`Emitted progress update for game ${gameId}: ${progress}%`);
  }

  /**
   * Emit proposal update event
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitProposalUpdate(action: string, proposal: any): void {
    if (!this.io) {
      return;
    }

    this.io.emit('proposal-update', {
      action,
      proposal,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Emitted proposal update: ${action} for ${proposal.id}`);
  }

  /**
   * Get Socket.io server instance
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Check if WebSocket service is initialized
   */
  isInitialized(): boolean {
    return this.io !== null;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
