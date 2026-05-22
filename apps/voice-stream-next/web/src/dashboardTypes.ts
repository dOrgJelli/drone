import type { VoiceApprovalSettings } from '../../server/src/voice-approval-settings.js';

export type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
};

export type VoiceSettings = VoiceApprovalSettings & {
  updatedAt: string;
};

export type VoiceApprovalFormState = VoiceApprovalSettings;

export type DeviceRecord = {
  id: string;
  userId: string;
  deviceType: string;
  displayName: string;
  tokenHint: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string | null;
};

export type PairingSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

export type LogRecord = {
  id: string;
  deviceId: string | null;
  source: string;
  level: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
};

export type AssistantThread = {
  id: string;
  title: string;
  source: string;
  deviceId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  spokenText: string | null;
  createdAt: string;
};

export type TranscriptRecord = {
  id: string;
  voiceSessionId: string;
  assistantThreadId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  text: string;
  final: boolean;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  createdAt: string;
};

export type TranscriptSessionGroup = {
  voiceSessionId: string;
  assistantThreadId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  transcripts: TranscriptRecord[];
};

export type ClientStatusRecord = {
  deviceId: string;
  deviceType: string;
  displayName: string;
  mode: string;
  status: string;
  microphone: string;
  protocolVersion: number | null;
  appVersion: string | null;
  lastError: string | null;
  reportedAt: string;
  updatedAt: string;
};

export type DashboardData = {
  ok: true;
  authMode: 'clerk' | 'dev';
  user: UserProfile;
  settings: VoiceSettings;
  threads: AssistantThread[];
  logs: LogRecord[];
  transcripts: TranscriptRecord[];
  clientStatuses: ClientStatusRecord[];
  approvalCodes: { id: string; code: string; source: string; createdAt: string }[];
  devices: DeviceRecord[];
  pairingSessions: PairingSessionRecord[];
  adminDevices: DeviceRecord[];
  adminClientStatuses: ClientStatusRecord[];
  stats: { threadCount: number; deviceCount: number; logCount: number; transcriptCount: number };
  dbPath: string;
};

export type ApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

export type DevUser = {
  email: string;
  name: string;
  admin: boolean;
};

export type DashboardView = 'threads' | 'devices' | 'settings' | 'activity';

export type DesktopVoskStatus = {
  available: boolean;
  modelPath?: string;
  error?: string;
};

export type DesktopVoskText = {
  text: string;
  final?: boolean;
};
