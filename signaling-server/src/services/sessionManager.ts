import { v4 as uuidv4 } from 'uuid';
import { Session, ServerConfig } from '../types';
import logger from '../utils/logger';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  createSession(socket: WebSocket, existingId?: string): Session {
    const id = existingId || uuidv4();
    const session: Session = {
      id,
      socket,
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    this.sessions.set(id, session);
    logger.info({ sessionId: id }, 'Session created');
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  updateActivity(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  setMetadata(id: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(id);
    if (session) {
      session.metadata = { ...session.metadata, ...metadata };
    }
  }

  setPartner(sessionId: string, partnerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.partnerId = partnerId;
      logger.info({ sessionId, partnerId }, 'Partner set');
    }
  }

  clearPartner(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      delete session.partnerId;
      logger.info({ sessionId }, 'Partner cleared');
    }
  }

  removeSession(id: string): void {
    this.sessions.delete(id);
    logger.info({ sessionId: id }, 'Session removed');
  }

  getSessionsBySocket(socket: WebSocket): Session[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.socket === socket
    );
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  canAcceptConnection(): boolean {
    return this.sessions.size < this.config.maxConnections;
  }

  cleanupInactiveSessions(): void {
    const now = new Date();
    const timeout = this.config.connectionTimeout;
    
    for (const [id, session] of this.sessions) {
      const elapsed = now.getTime() - session.lastActivity.getTime();
      if (elapsed > timeout) {
        logger.warn({ sessionId: id, elapsed }, 'Session timed out');
        try {
          session.socket.close(1001, 'Connection timeout');
        } catch {
          // Socket may already be closed
        }
        this.sessions.delete(id);
      }
    }
  }

  broadcast(message: unknown, excludeSessionId?: string): void {
    const messageStr = JSON.stringify(message);
    for (const [id, session] of this.sessions) {
      if (id !== excludeSessionId) {
        try {
          session.socket.send(messageStr);
        } catch (error) {
          logger.error({ sessionId: id, error }, 'Failed to send message');
        }
      }
    }
  }
}

export default SessionManager;
