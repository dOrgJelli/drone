export const FLEET_API_VERSION = '2026-03-19';
export const FLEET_CAPABILITY_CREATE = 'drone:create';
export const FLEET_CAPABILITY_SEND = 'drone:message:send';
export const FLEET_CAPABILITY_READ = 'drone:message:read';

export const FLEET_DEFAULT_LIMITS = {
  maxChildren: 5,
  maxCreationsPerHour: 10,
  maxPendingCreationsGlobal: 50,
  maxMessagesPerMinute: 30,
  maxMessageSizeBytes: 8 * 1024,
  maxReadPageSize: 50,
  defaultReadPageSize: 20,
  maxReadChars: 32_000,
};

export type FleetRequestState = 'queued' | 'running' | 'done' | 'failed';
export type FleetRequestType = 'create_child' | 'send_message' | 'read_messages' | 'stop_chat';

export type FleetRequestRecord = {
  id: string;
  idempotencyKey?: string;
  type: FleetRequestType;
  payload: Record<string, unknown>;
  state: FleetRequestState;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
};

export type FleetRequestIndex = {
  order: string[];
  idempotency: Record<string, string>;
};

export type FleetPolicySnapshot = {
  apiVersion: string;
  enabled: boolean;
  actor: {
    id: string | null;
    name: string | null;
  };
  capabilities: string[];
  readScopes: string[];
  sendScopes: string[];
  limits: Record<string, number>;
  updatedAt: string;
};
