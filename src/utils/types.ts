export type ParticipantRole = 'host' | 'cohost' | 'viewer';

export type StreamCategory =
  | 'Just Chatting'
  | 'Live Coding'
  | 'Podcast & Talk'
  | 'Music & Audio'
  | 'Gaming';

export interface RoomParticipant {
  id: string;
  name: string;
  handle: string;
  role: ParticipantRole;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  avatarUrl?: string;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderHandle: string;
  role: ParticipantRole;
  text: string;
  timestamp: number;
  streamTimeSec: number;
  reactions?: Record<string, number>;
}

export interface ClipMarkerEvent {
  id: string;
  roomId: string;
  triggeredBy: string;
  source: 'manual' | 'voice';
  streamTimeSec: number;
  createdAt: number;
}

export interface RoomSummary {
  roomId: string;
  title: string;
  category: StreamCategory;
  isLive: boolean;
  streamStartedAt: number | null;
  broadcasterCount: number;
  viewerCount: number;
  hostName: string;
  hostAvatarUrl?: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface RecentRoomEntry {
  roomId: string;
  title: string;
  category: StreamCategory;
  lastRole: ParticipantRole;
  lastVisitedAt: number;
}

export interface RoomStatePayload {
  roomId: string;
  title: string;
  category: StreamCategory;
  isLive: boolean;
  streamStartedAt: number | null;
  slowModeSec: number;
  pinnedMessage: ChatMessage | null;
  participants: RoomParticipant[];
  chatHistory: ChatMessage[];
}
