import { WebSocketServer, WebSocket, RawData } from 'ws';
import { createServer } from 'http';
import {
  SignalingMessage,
  ServerConfig,
  defaultConfig,
  JoinMessage,
  SDPMessage,
  ICECandidateMessage,
} from './types';
import { SessionManager } from './services/sessionManager';
import { RoomManager } from './services/roomManager';
import logger from './utils/logger';

export class SignalingServer {
  private config: ServerConfig;
  private wss: WebSocketServer;
  private sessionManager: SessionManager;
  private roomManager: RoomManager;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(config: ServerConfig = defaultConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config);
    this.roomManager = new RoomManager();
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.wss.on('error', (error) => {
      logger.error({ error }, 'WebSocket server error');
    });
  }

  private handleConnection(ws: WebSocket): void {
    if (!this.sessionManager.canAcceptConnection()) {
      ws.close(1013, 'Server at capacity');
      return;
    }

    const session = this.sessionManager.createSession(ws);
    const room = this.roomManager.getOrCreateRoomForSession(session.id);

    ws.on('message', (data: RawData) => {
      this.handleMessage(ws, session.id, data);
    });

    ws.on('close', () => {
      this.handleDisconnect(session.id);
    });

    ws.on('error', (error) => {
      logger.error({ sessionId: session.id, error }, 'WebSocket error');
      this.handleDisconnect(session.id);
    });

    ws.on('pong', () => {
      this.sessionManager.updateActivity(session.id);
    });

    this.send(ws, {
      type: 'join',
      sessionId: session.id,
      metadata: { roomId: room.id },
    });
  }

  private handleMessage(ws: WebSocket, sessionId: string, data: RawData): void {
    this.sessionManager.updateActivity(sessionId);

    let message: SignalingMessage;
    try {
      const str = data.toString();
      message = JSON.parse(str);
    } catch {
      this.sendError(ws, 'PARSE_ERROR', 'Invalid JSON message');
      return;
    }

    logger.debug({ sessionId, messageType: message.type }, 'Message received');

    switch (message.type) {
      case 'join':
        this.handleJoin(ws, sessionId, message);
        break;
      case 'offer':
        this.handleOffer(message);
        break;
      case 'answer':
        this.handleAnswer(message);
        break;
      case 'ice-candidate':
        this.handleICECandidate(message);
        break;
      case 'leave':
        this.handleLeave(sessionId);
        break;
      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type`);
    }
  }

  private handleJoin(ws: WebSocket, sessionId: string, message: JoinMessage): void {
    if (message.metadata) {
      this.sessionManager.setMetadata(sessionId, message.metadata);
    }

    const roomId = this.roomManager.getSessionRoom(sessionId);
    const participants = roomId ? this.roomManager.getRoomParticipants(roomId) : [];

    this.send(ws, {
      type: 'join',
      sessionId,
      metadata: {
        roomId,
        participants,
      },
    });
  }

  private handleOffer(message: SDPMessage): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.warn({ sessionId: message.sessionId }, 'Offer from unknown session');
      return;
    }

    const roomId = this.roomManager.getSessionRoom(message.sessionId);
    if (!roomId) return;

    const participants = this.roomManager.getRoomParticipants(roomId);
    for (const participantId of participants) {
      if (participantId !== message.sessionId) {
        const participant = this.sessionManager.getSession(participantId);
        if (participant) {
          this.sessionManager.setPartner(message.sessionId, participantId);
          this.sessionManager.setPartner(participantId, message.sessionId);
          this.send(participant.socket, message);
        }
      }
    }
  }

  private handleAnswer(message: SDPMessage): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.warn({ sessionId: message.sessionId }, 'Answer from unknown session');
      return;
    }

    if (session.partnerId) {
      const partner = this.sessionManager.getSession(session.partnerId);
      if (partner) {
        this.send(partner.socket, message);
      }
    }
  }

  private handleICECandidate(message: ICECandidateMessage): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.warn({ sessionId: message.sessionId }, 'ICE candidate from unknown session');
      return;
    }

    if (session.partnerId) {
      const partner = this.sessionManager.getSession(session.partnerId);
      if (partner) {
        this.send(partner.socket, message);
      }
    }
  }

  private handleLeave(sessionId: string): void {
    this.handleDisconnect(sessionId);
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (session?.partnerId) {
      const partner = this.sessionManager.getSession(session.partnerId);
      if (partner) {
        this.send(partner.socket, { type: 'leave', sessionId });
        this.sessionManager.clearPartner(session.partnerId);
      }
    }

    this.roomManager.leaveRoom(sessionId);
    this.sessionManager.removeSession(sessionId);
    logger.info({ sessionId }, 'Session disconnected');
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', code, message });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const sessions = this.sessionManager.getSessionsBySocket(ws);
        if (sessions.length === 0) {
          ws.terminate();
          return;
        }
        ws.ping();
      });
      this.sessionManager.cleanupInactiveSessions();
    }, this.config.heartbeatInterval);
  }

  start(): void {
    const server = createServer();
    
    server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    server.listen(this.config.port, this.config.host, () => {
      logger.info(
        { host: this.config.host, port: this.config.port },
        'Signaling server started'
      );
    });

    this.startHeartbeat();

    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.wss.close(() => {
      logger.info('Signaling server stopped');
    });
  }
}

export default SignalingServer;
