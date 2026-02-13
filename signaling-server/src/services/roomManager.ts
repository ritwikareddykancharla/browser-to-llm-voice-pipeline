import { v4 as uuidv4 } from 'uuid';
import { Room } from '../types';
import logger from '../utils/logger';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private sessionToRoom: Map<string, string> = new Map();

  createRoom(): Room {
    const id = uuidv4();
    const room: Room = {
      id,
      participants: new Set(),
      createdAt: new Date(),
    };
    this.rooms.set(id, room);
    logger.info({ roomId: id }, 'Room created');
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  joinRoom(roomId: string, sessionId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      logger.warn({ roomId, sessionId }, 'Room not found');
      return false;
    }

    const existingRoom = this.sessionToRoom.get(sessionId);
    if (existingRoom) {
      this.leaveRoom(sessionId);
    }

    room.participants.add(sessionId);
    this.sessionToRoom.set(sessionId, roomId);
    logger.info({ roomId, sessionId, participantCount: room.participants.size }, 'Session joined room');
    return true;
  }

  leaveRoom(sessionId: string): string | undefined {
    const roomId = this.sessionToRoom.get(sessionId);
    if (!roomId) return undefined;

    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.delete(sessionId);
      logger.info({ roomId, sessionId, participantCount: room.participants.size }, 'Session left room');

      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
        logger.info({ roomId }, 'Room deleted (empty)');
      }
    }

    this.sessionToRoom.delete(sessionId);
    return roomId;
  }

  getRoomParticipants(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.participants) : [];
  }

  getSessionRoom(sessionId: string): string | undefined {
    return this.sessionToRoom.get(sessionId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getOrCreateRoomForSession(sessionId: string): Room {
    const existingRoomId = this.sessionToRoom.get(sessionId);
    if (existingRoomId) {
      const existingRoom = this.rooms.get(existingRoomId);
      if (existingRoom) return existingRoom;
    }

    const waitingRoom = this.findWaitingRoom();
    if (waitingRoom) {
      this.joinRoom(waitingRoom.id, sessionId);
      return waitingRoom;
    }

    const newRoom = this.createRoom();
    this.joinRoom(newRoom.id, sessionId);
    return newRoom;
  }

  private findWaitingRoom(): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.participants.size === 1) {
        return room;
      }
    }
    return undefined;
  }
}

export default RoomManager;
