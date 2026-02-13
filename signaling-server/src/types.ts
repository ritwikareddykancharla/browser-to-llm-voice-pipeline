export interface SDPMessage {
  type: "offer" | "answer";
  sdp: string;
  sessionId: string;
}

export interface ICECandidateMessage {
  type: "ice-candidate";
  candidate: RTCIceCandidateInit;
  sessionId: string;
}

export interface JoinMessage {
  type: "join";
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface LeaveMessage {
  type: "leave";
  sessionId: string;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type SignalingMessage =
  | SDPMessage
  | ICECandidateMessage
  | JoinMessage
  | LeaveMessage
  | ErrorMessage;

export interface Session {
  id: string;
  socket: WebSocket;
  createdAt: Date;
  lastActivity: Date;
  metadata?: Record<string, unknown>;
  partnerId?: string;
}

export interface Room {
  id: string;
  participants: Set<string>;
  createdAt: Date;
}

export interface ServerConfig {
  port: number;
  host: string;
  maxConnections: number;
  heartbeatInterval: number;
  connectionTimeout: number;
}

export const defaultConfig: ServerConfig = {
  port: parseInt(process.env.SIGNALING_PORT || "8080", 10),
  host: process.env.SIGNALING_HOST || "0.0.0.0",
  maxConnections: parseInt(process.env.MAX_CONNECTIONS || "1000", 10),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || "30000", 10),
  connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || "60000", 10),
};
