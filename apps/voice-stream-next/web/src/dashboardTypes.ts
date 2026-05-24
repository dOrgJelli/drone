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
  userId?: string;
  title: string;
  source: string;
  deviceId: string | null;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  status?: 'idle' | 'running' | 'waiting_for_approval' | 'cancelled' | 'error';
  error?: string | null;
  voiceEnabled?: boolean;
  systemPrompt?: string | null;
  enabledTools?: string[];
  capabilities?: {
    artifacts: boolean;
    speech: boolean;
    approvals: boolean;
    externalCalls: boolean;
    futureIntegrations: boolean;
  };
  promptDeliveryMode?: 'queue' | 'asap';
  updatedAt: string;
  createdAt: string;
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant' | 'toolResult' | 'system';
  content: string;
  contentJson?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  isError?: boolean;
  spokenText: string | null;
  createdAt: string;
};

export type AssistantRunRecord = {
  id: string;
  threadId: string;
  status: 'idle' | 'running' | 'waiting_for_approval' | 'cancelled' | 'error';
  provider: string;
  model: string;
  thinkingLevel: string;
  prompt: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantQueuedPromptRecord = {
  id: string;
  threadId: string;
  prompt: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantToolCallRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  toolName: string;
  status: string;
  argsJson: string;
  resultJson: string | null;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssistantApprovalRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  toolCallId: string;
  toolName: string;
  label: string;
  argsJson: string;
  args?: unknown;
  status: 'pending' | 'approved' | 'denied';
  requestedBy: string;
  resolvedBy: string | null;
  resultJson: string | null;
  failureReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AssistantArtifactRecord = {
  id: string;
  threadId: string;
  path: string;
  content: string;
  size: number;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantOverviewRecord = {
  id: string;
  threadId: string;
  markdown: string;
  prompt: string;
  inputHash: string;
  cached: boolean;
  createdAt: string;
};

export type AssistantSettingsRecord = {
  userId: string;
  normalSystemPrompt: string;
  voiceSystemPrompt: string;
  overviewPrompt: string;
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: string;
  updatedAt: string;
};

export type AssistantToolSummary = {
  name: string;
  label: string;
  category: string;
  description: string;
  approval: 'never' | 'normal_threads' | 'always';
};

export type AssistantModelOption = {
  provider: string;
  id: string;
  name: string;
  thinkingLevel: string;
};

export type AssistantThreadView = AssistantThread & {
  messages: AssistantMessage[];
  runs: AssistantRunRecord[];
  queuedPrompts: AssistantQueuedPromptRecord[];
  toolCalls: AssistantToolCallRecord[];
  artifactsCount: number;
  latestOverview: AssistantOverviewRecord | null;
};

export type AssistantSnapshot = {
  ok: true;
  userId: string;
  activeThreadId: string | null;
  threads: AssistantThreadView[];
  pendingApprovals: AssistantApprovalRecord[];
  models: AssistantModelOption[];
  availableTools: AssistantToolSummary[];
  assistantSettings: AssistantSettingsRecord;
  runningModels: Record<string, { provider: string; model: string; thinkingLevel: string; runId: string }>;
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
  assistantSettings?: AssistantSettingsRecord;
  threads: AssistantThread[];
  assistantApprovals?: AssistantApprovalRecord[];
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
  stream(path: string, init?: RequestInit): Promise<Response>;
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
