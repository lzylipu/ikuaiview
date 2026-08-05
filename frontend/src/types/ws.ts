// WebSocket message envelope types
import type { DashboardSnapshot, DashboardUpdate } from './dashboard';

export type ServerMessageType = 'snapshot' | 'update' | 'connection_status';

export interface WsSnapshotMessage {
  type: 'snapshot';
  data: DashboardSnapshot;
}

export interface WsUpdateMessage {
  type: 'update';
  data: DashboardUpdate;
}

export interface WsConnectionStatusMessage {
  type: 'connection_status';
  connected: boolean;
  lastPoll: string | null;
}

export type WsServerMessage =
  | WsSnapshotMessage
  | WsUpdateMessage
  | WsConnectionStatusMessage;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';
