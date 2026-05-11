import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { droneRootPath } from '../host/paths';
import { loadRegistry, withRegistryLock } from '../host/registry';
import {
  providerDisplayName,
  resolveEffectiveProviderApiKeySettings,
  type LlmProviderId,
} from './hub-settings';
import {
  deleteAssistantArtifactsForThread,
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  type AssistantArtifactActionInput,
} from './assistant-artifacts';

type AssistantThreadStatus = 'idle' | 'running' | 'waiting_for_approval' | 'waiting_for_chats_idle' | 'error';
type AssistantThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type AssistantDroneSummary = {
  id: string;
  name: string;
  group: string | null;
  runtime: string;
  repoPath: string;
  status: string;
  chats: string[];
};

export type AssistantMessageDroneResult = {
  promptId: string;
  pendingState?: string | null;
  blockedByAutomation?: boolean;
};

export type AssistantCreateDroneResult = {
  id: string;
  name: string;
  runtime: string;
  phase: string;
  request: any;
};

export type AssistantSetDroneGroupResult = {
  group: string | null;
  moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
  rejected: Array<{ id: string; error: string }>;
  total: number;
};

type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: LlmProviderId;
  thinkingLevel: AssistantThinkingLevel;
  systemPrompt: string;
  accessScope: AssistantAccessScope;
  autoApprove: boolean;
  promptDeliveryMode: AssistantPromptDeliveryMode;
  messages: any[];
  queuedPrompts: AssistantQueuedPrompt[];
  status: AssistantThreadStatus;
  error: string | null;
};

type AssistantQueuedPrompt = {
  id: string;
  prompt: string;
  createdAt: string;
  provider: LlmProviderId;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
  deliveryMode: AssistantPromptDeliveryMode;
};

type AssistantPromptDeliveryMode = 'queue' | 'asap';

type AssistantChatIdleSubscriptionStatus = 'active' | 'fired' | 'cancelled' | 'expired';

export type AssistantChatIdleSubscription = {
  id: string;
  threadId: string;
  toolCallId: string | null;
  targets: AssistantChatIdleTarget[];
  createdAt: string;
  expiresAt: string;
  idleForMs: number;
  status: AssistantChatIdleSubscriptionStatus;
  idleSince: string | null;
  firedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  lastResult: AssistantChatIdleWaitResult | null;
};

type AssistantRunModel = {
  provider: LlmProviderId;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
  promptId: string;
  startedAt: string;
};

type AssistantApproval = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  label: string;
  args: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

type StoredAssistantState = {
  activeThreadId?: string | null;
  threads?: AssistantThread[];
  chatIdleSubscriptions?: AssistantChatIdleSubscription[];
  systemPrompt?: string;
  systemPromptUpdatedAt?: string;
  updatedAt?: string;
};

type AssistantRuntime = {
  Agent: any;
  Type: any;
  getModel: (provider: string, model: string) => any;
  getModels: (provider: string) => any[];
  getSupportedThinkingLevels: (model: any) => AssistantThinkingLevel[];
};

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'agent_event'; threadId: string; event: any }
  | { type: 'approval_pending'; approval: AssistantApproval; snapshot: AssistantSnapshot }
  | { type: 'error'; threadId?: string; error: string };

type AssistantToolCallbacks = {
  listDrones: () => Promise<AssistantDroneSummary[]>;
  createDrone: (opts: any) => Promise<AssistantCreateDroneResult>;
  setDroneGroup: (opts: { droneIds: string[]; group: string | null }) => Promise<AssistantSetDroneGroupResult>;
  messageDrone: (opts: {
    droneId: string;
    chatName: string;
    prompt: string;
  }) => Promise<AssistantMessageDroneResult>;
  listDroneFiles?: (opts: { droneId: string; path?: string }) => Promise<AssistantDroneFileListResult>;
  readDroneFile?: (opts: { droneId: string; path: string }) => Promise<AssistantDroneFileReadResult>;
  writeDroneFile?: (opts: { droneId: string; path: string; content: string }) => Promise<AssistantDroneFileWriteResult>;
  deleteDroneFile?: (opts: { droneId: string; path: string }) => Promise<AssistantDroneFileMutationResult>;
  moveDroneFile?: (opts: { droneId: string; fromPath: string; toPath: string }) => Promise<AssistantDroneFileMutationResult>;
  searchDroneFiles?: (opts: { droneId: string; path?: string; query: string; limit?: number }) => Promise<AssistantDroneFileSearchResult>;
  findDroneFiles?: (opts: { droneId: string; path?: string; pattern?: string; limit?: number }) => Promise<AssistantDroneFileFindResult>;
  statDronePath?: (opts: { droneId: string; path: string }) => Promise<AssistantDronePathStatResult>;
  runDroneBash?: (opts: { droneId: string; command: string; cwd?: string; timeoutMs?: number }) => Promise<AssistantDroneBashResult>;
};

type AssistantDroneFileEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  size?: number | null;
  mtimeMs?: number | null;
};

type AssistantDroneFileListResult = {
  droneId: string;
  path: string;
  entries: AssistantDroneFileEntry[];
};

type AssistantDroneFileReadResult = {
  droneId: string;
  path: string;
  kind: 'text';
  content: string;
  size?: number | null;
  mtimeMs?: number | null;
};

type AssistantDroneFileWriteResult = {
  droneId: string;
  path: string;
  size?: number | null;
  mtimeMs?: number | null;
};

type AssistantDroneFileMutationResult = {
  droneId: string;
  path: string;
  deleted?: boolean;
  movedTo?: string;
};

type AssistantDronePathStatResult = {
  droneId: string;
  path: string;
  exists: boolean;
  kind?: 'directory' | 'file' | 'other';
  size?: number | null;
  mtimeMs?: number | null;
};

type AssistantDroneFileSearchMatch = {
  path: string;
  line?: number | null;
  text: string;
};

type AssistantDroneFileSearchResult = {
  droneId: string;
  path: string;
  query: string;
  matches: AssistantDroneFileSearchMatch[];
  limit: number;
};

type AssistantDroneFileFindResult = {
  droneId: string;
  path: string;
  pattern: string;
  matches: AssistantDroneFileEntry[];
  limit: number;
};

type AssistantPatchOperation =
  | { kind: 'add'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: AssistantPatchHunk[] };

type AssistantPatchHunk = {
  oldText: string;
  newText: string;
};

type AssistantApplyPatchResult = {
  ok: true;
  droneId: string;
  operations: Array<{ kind: AssistantPatchOperation['kind']; path: string; movedTo?: string; size?: number | null }>;
};

type AssistantDroneBashResult = {
  ok: true;
  droneId: string;
  cwd: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  timeoutMs: number;
  timedOut: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

type AssistantPatchStagedFile = {
  path: string;
  existsBefore: boolean;
  content: string | null;
  deleted: boolean;
  moveFrom?: string;
};

type AssistantAppContext = {
  activeDroneId: string | null;
  activeDroneName: string | null;
  activeChatName: string | null;
  appView: string | null;
  updatedAt: string;
};

type AssistantAccessScope = {
  readMode: 'all' | 'selected';
  writeMode: 'all' | 'selected';
  droneIds: string[];
  updatedAt: string;
};

type ChatTimelineMessage = {
  id: string;
  role: 'user' | 'agent';
  status: 'queued' | 'sending' | 'sent' | 'completed' | 'failed';
  text: string;
  at: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
  droneId: string;
  chatName: string;
  turnId?: string;
  userMessageId?: string;
};

type ChatMessagePage = {
  droneId: string;
  chatName: string;
  messages: ChatTimelineMessage[];
  total: number;
  limit: number;
  pageStart: number;
  pageEnd: number;
  olderCursor: string | null;
  newerCursor: string | null;
};

export type AssistantChatIdleTarget = {
  droneId: string;
  chatName: string;
};

export type AssistantChatIdleStatus = {
  droneId: string;
  chatName: string;
  idle: boolean;
  reason: 'no_messages' | 'active_user_messages' | 'latest_agent_message' | 'latest_user_failed' | 'latest_user_message';
  activeUserMessages: number;
  queuedUserMessages: number;
  failedUserMessages: number;
  latest: null | Pick<ChatTimelineMessage, 'id' | 'role' | 'status' | 'at' | 'text' | 'turnId'>;
};

export type AssistantChatIdleWaitResult = {
  ok: boolean;
  timedOut: boolean;
  elapsedMs: number;
  timeoutMs: number;
  idleForMs: number;
  targets: AssistantChatIdleStatus[];
};

export type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  chatIdleSubscriptions: AssistantChatIdleSubscription[];
  pendingApprovals: AssistantApproval[];
  models: AssistantModelOption[];
  accessScope: AssistantAccessScope;
  runningModels: Record<string, AssistantRunModel>;
  streamingMessage?: any;
};

export type AssistantModelOption = {
  provider: LlmProviderId;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: AssistantThinkingLevel;
};

export type AssistantSystemPromptSettings = {
  ok: true;
  assistantSystemPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
};

const ASSISTANT_THREAD_MESSAGE_LIMIT = 80;
const ASSISTANT_REGISTRY_MAX_THREADS = 24;
const ASSISTANT_STATE_FILE_NAME = 'assistant.json';
const ASSISTANT_SYSTEM_PROMPT_MAX_CHARS = 20_000;
const CHAT_MESSAGE_DEFAULT_LIMIT = 10;
const CHAT_MESSAGE_MAX_LIMIT = 50;
const CHAT_MESSAGE_RESPONSE_MAX_BYTES = 500_000;
const CHAT_IDLE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const CHAT_IDLE_MAX_TIMEOUT_MS = 30 * 60 * 1000;
const CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS = 1000;
const CHAT_IDLE_DEFAULT_IDLE_FOR_MS = 1000;
const CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;
const CHAT_IDLE_MAX_SUBSCRIPTIONS = 200;
const CHAT_IDLE_MAX_TARGETS = 20;
const ASSISTANT_BASH_DEFAULT_TIMEOUT_MS = 30_000;
const ASSISTANT_BASH_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_THREAD_TITLE = 'New thread';
const ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX =
  'Current access scope is appended at run time. The assistant must not claim read or write access outside that scope.';
const ASSISTANT_SYSTEM_PROMPT_DEFAULT = [
  'You are Drone Hub Assistant, a concise operator assistant embedded in the Drone Hub app.',
  'You help the user understand available drones and coordinate work across drone chats.',
  'Use get_current_context when the user asks about the current, active, selected, or open drone/chat, or before acting on phrases like "this drone".',
  'Use list_drones before referring to specific drones unless the user already provided an exact drone id.',
  'Use get_chat_overview before reading chat details, then read_chat_messages in pages when you need conversation context.',
  'Use assistant_files to maintain private, thread-scoped Markdown notes when tracking work, decisions, plans, questions, or handoff details. These files are for the user-facing Artifacts UI and are not visible to drones.',
  'Use list_files, find_files, search_files, read_file, write_file, and apply_patch to inspect and modify files in drones you can access. Prefer apply_patch for coordinated code edits.',
  'Use bash only when a command is the right tool for inspection, tests, builds, or small scripted checks in an accessible container drone. Bash is approval-gated, non-interactive, and not for background processes.',
  'File paths are interpreted by drone id plus path. Relative paths resolve inside the target drone workspace, usually the repo root for repo-backed drones.',
  'Chat timelines contain user messages and agent messages. Queued or pending user messages appear in the same timeline with a non-completed status.',
  'When you send a drone chat message and need the result later, call subscribe_to_chats_idle on the target chat. This returns immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscribed chats become idle.',
  'Do not load more chat pages than needed. Start with the latest page.',
  'Creating drones, changing drone groups, sending a user message to a drone, and running bash in a drone are actions that require user approval; explain briefly what you intend to do.',
  'File write tools require write access to the target drone and should be used carefully for concrete code or content edits.',
  'If an approval-gated write tool returns successfully, the user already approved that action. Do not ask for the same approval again.',
  'When creating a drone, omit fields you want inherited from the current open drone. Only set repoBranchSource=remote when the user asked for a remote branch and you have a remoteBranch value.',
  'Do not claim a drone completed work unless the drone transcript or user says so.',
  'Keep responses practical and short.',
].join('\n');
let assistantStateWriteQueue: Promise<void> = Promise.resolve();
const ASSISTANT_MODEL_OPTIONS: Array<{
  provider: LlmProviderId;
  id: string;
  name: string;
  thinkingLevel: AssistantThinkingLevel;
}> = [
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'gemini', id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', thinkingLevel: 'medium' },
];

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

function nowIso(): string {
  return new Date().toISOString();
}

function makeAssistantId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeProvider(raw: unknown): LlmProviderId {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'gemini') return 'gemini';
  if (value === 'codex' || value === 'openai-codex' || value === 'chatgpt-codex') return 'codex';
  return 'openai';
}

function providerToPiProvider(provider: LlmProviderId): 'openai' | 'google' | 'openai-codex' {
  if (provider === 'codex') return 'openai-codex';
  return provider === 'gemini' ? 'google' : 'openai';
}

async function defaultAssistantProvider(): Promise<LlmProviderId> {
  const codex = await resolveEffectiveProviderApiKeySettings('codex');
  return codex.apiKey ? 'codex' : 'openai';
}

function defaultModelForProvider(provider: LlmProviderId): string {
  if (provider === 'codex') return DEFAULT_CODEX_MODEL;
  return provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL;
}

function allowedModelForProvider(provider: LlmProviderId, raw: unknown): string {
  const model = String(raw ?? '').trim();
  return ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model)
    ? model
    : defaultModelForProvider(provider);
}

function allowedThinkingLevelForModel(provider: LlmProviderId, model: string, raw: unknown): AssistantThinkingLevel {
  const requested = normalizeThinkingLevel(raw);
  if (ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model && option.thinkingLevel === requested)) {
    return requested;
  }
  return ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === model)?.thinkingLevel ?? 'off';
}

function normalizeThinkingLevel(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return 'off';
}

function normalizeAssistantPromptDeliveryMode(raw: unknown): AssistantPromptDeliveryMode {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'asap' || value === 'steer' || value === 'steering' ? 'asap' : 'queue';
}

function normalizeAssistantAutoApprove(raw: unknown): boolean {
  return raw === true || raw === 1 || String(raw ?? '').trim().toLowerCase() === 'true' || String(raw ?? '').trim() === '1';
}

function makeAssistantUserMessage(prompt: string): any {
  return {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  };
}

function titleFromPrompt(prompt: string): string {
  const cleaned = String(prompt ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return DEFAULT_THREAD_TITLE;
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}...` : cleaned;
}

function textFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part?.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function stripAssistantReplayState(message: any): any {
  if (!message || typeof message !== 'object') return message;
  if (message.role !== 'assistant') return sanitizeMessage(message);
  const content = Array.isArray(message.content) ? message.content : [];
  return {
    ...sanitizeMessage(message),
    content: content.flatMap((block: any) => {
      if (!block || typeof block !== 'object') return [];
      if (block.type === 'thinking') return [];
      if (block.type === 'text') {
        const { textSignature: _textSignature, ...rest } = block;
        return [rest];
      }
      if (block.type === 'toolCall') {
        const { thoughtSignature: _thoughtSignature, ...rest } = block;
        return [rest];
      }
      return [block];
    }),
  };
}

function convertMessagesForOpenAi(messages: any[]): any[] {
  return messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant' || message?.role === 'toolResult')
    .map(stripAssistantReplayState)
    .filter((message) => message?.role !== 'assistant' || (Array.isArray(message.content) && message.content.length > 0));
}

function clampChatMessageLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CHAT_MESSAGE_DEFAULT_LIMIT;
  return Math.min(CHAT_MESSAGE_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function clampAssistantBashTimeout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return ASSISTANT_BASH_DEFAULT_TIMEOUT_MS;
  return Math.min(ASSISTANT_BASH_MAX_TIMEOUT_MS, Math.max(1000, Math.floor(n)));
}

function normalizeChatNameForAssistant(raw: unknown): string {
  const value = String(raw ?? '').trim();
  return value || 'default';
}

function safeMessageAt(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return value || fallback;
}

function messageResponseSizeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function ensureMessageResponseFits(value: unknown): void {
  const bytes = messageResponseSizeBytes(value);
  if (bytes > CHAT_MESSAGE_RESPONSE_MAX_BYTES) {
    throw new Error(`message page too large (${bytes} bytes); retry with a smaller limit`);
  }
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      reject(abortError());
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function droneEntryByAssistantId(regAny: any, droneIdRaw: unknown): { id: string; drone: any } {
  const droneId = String(droneIdRaw ?? '').trim();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const direct = drones[droneId];
  if (direct) return { id: droneId, drone: direct };
  for (const [id, drone] of Object.entries(drones) as any[]) {
    const stableId = String((drone as any)?.id ?? id).trim();
    const name = String((drone as any)?.name ?? '').trim();
    if (stableId === droneId || name === droneId) return { id: stableId || id, drone };
  }
  throw new Error(`unknown drone: ${droneId}`);
}

function droneIdByAssistantRef(regAny: any, droneIdRaw: unknown): string {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) throw new Error('missing drone id');
  for (const collection of [regAny?.drones, regAny?.pending]) {
    const drones = collection && typeof collection === 'object' ? collection : {};
    const direct = drones[droneId];
    if (direct) return String((direct as any)?.id ?? droneId).trim() || droneId;
    for (const [id, drone] of Object.entries(drones) as any[]) {
      const stableId = String((drone as any)?.id ?? id).trim();
      const name = String((drone as any)?.name ?? '').trim();
      if (stableId === droneId || name === droneId) return stableId || id;
    }
  }
  throw new Error(`unknown drone: ${droneId}`);
}

function normalizeAssistantRuntime(raw: unknown, fallbackRaw: unknown): 'container' | 'host' {
  const value = String(raw ?? fallbackRaw ?? '').trim().toLowerCase();
  return value === 'host' ? 'host' : 'container';
}

function normalizeAssistantRepoBranchSource(raw: unknown): 'host' | 'remote' {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'remote' || value === 'remote-branch' ? 'remote' : 'host';
}

function cleanOptionalString(raw: unknown): string {
  return String(raw ?? '').trim();
}

function normalizeAssistantDroneFilePath(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('missing file path');
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error(`invalid file path: ${value}`);
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!normalized || normalized === '.') throw new Error('missing file path');
  const withoutLeading = normalized.replace(/^\/+/, '');
  if (withoutLeading === '..' || withoutLeading.startsWith('../')) throw new Error(`invalid file path: ${value}`);
  return value.startsWith('/') ? `/${withoutLeading}` : withoutLeading;
}

function normalizeAssistantPatchText(raw: unknown): string {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) throw new Error('missing patch');
  return text;
}

function collectPatchContent(lines: string[], startIndex: number): { content: string; nextIndex: number } {
  const out: string[] = [];
  let i = startIndex;
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('*** ')) break;
    if (!line.startsWith('+')) throw new Error(`invalid add file line: ${line}`);
    out.push(line.slice(1));
  }
  return { content: out.length > 0 ? `${out.join('\n')}\n` : '', nextIndex: i };
}

function collectPatchHunks(lines: string[], startIndex: number): { moveTo?: string; hunks: AssistantPatchHunk[]; nextIndex: number } {
  let moveTo: string | undefined;
  const hunks: AssistantPatchHunk[] = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let sawHunk = false;
  let i = startIndex;

  const flush = () => {
    if (!sawHunk && oldLines.length === 0 && newLines.length === 0) return;
    hunks.push({
      oldText: oldLines.length > 0 ? `${oldLines.join('\n')}\n` : '',
      newText: newLines.length > 0 ? `${newLines.join('\n')}\n` : '',
    });
    oldLines = [];
    newLines = [];
    sawHunk = false;
  };

  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('*** Move to: ')) {
      moveTo = normalizeAssistantDroneFilePath(line.slice('*** Move to: '.length));
      continue;
    }
    if (line.startsWith('*** ')) break;
    if (line.startsWith('@@')) {
      flush();
      sawHunk = true;
      continue;
    }
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
      sawHunk = true;
      continue;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
      sawHunk = true;
      continue;
    }
    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
      sawHunk = true;
      continue;
    }
    if (line === '') {
      oldLines.push('');
      newLines.push('');
      sawHunk = true;
      continue;
    }
    throw new Error(`invalid patch line: ${line}`);
  }

  flush();
  return { moveTo, hunks, nextIndex: i };
}

function parseAssistantApplyPatch(raw: unknown): AssistantPatchOperation[] {
  const text = normalizeAssistantPatchText(raw);
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== '*** Begin Patch') throw new Error('patch must start with "*** Begin Patch"');
  if (lines[lines.length - 1] !== '*** End Patch') throw new Error('patch must end with "*** End Patch"');

  const operations: AssistantPatchOperation[] = [];
  let i = 1;
  while (i < lines.length - 1) {
    const line = lines[i] ?? '';
    if (line === '*** End of File') {
      i += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const filePath = normalizeAssistantDroneFilePath(line.slice('*** Add File: '.length));
      const collected = collectPatchContent(lines, i + 1);
      operations.push({ kind: 'add', path: filePath, content: collected.content });
      i = collected.nextIndex;
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      operations.push({ kind: 'delete', path: normalizeAssistantDroneFilePath(line.slice('*** Delete File: '.length)) });
      i += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const filePath = normalizeAssistantDroneFilePath(line.slice('*** Update File: '.length));
      const collected = collectPatchHunks(lines, i + 1);
      operations.push({ kind: 'update', path: filePath, ...(collected.moveTo ? { moveTo: collected.moveTo } : {}), hunks: collected.hunks });
      i = collected.nextIndex;
      continue;
    }
    throw new Error(`invalid patch operation: ${line}`);
  }

  if (operations.length === 0) throw new Error('patch has no operations');
  return operations;
}

function replaceTextOnce(content: string, oldText: string, newText: string, filePath: string): string {
  if (!oldText) throw new Error(`empty patch hunk for ${filePath}`);
  const first = content.indexOf(oldText);
  if (first < 0) throw new Error(`patch context not found in ${filePath}`);
  const second = content.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`patch context is ambiguous in ${filePath}`);
  return `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`;
}

function normalizeAssistantSystemPrompt(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  return text.length > ASSISTANT_SYSTEM_PROMPT_MAX_CHARS
    ? text.slice(0, ASSISTANT_SYSTEM_PROMPT_MAX_CHARS).trim()
    : text;
}

function clampChatIdleTimeoutMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(CHAT_IDLE_MAX_TIMEOUT_MS, Math.floor(value)));
}

function clampChatIdlePollIntervalMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS;
  return Math.max(250, Math.min(5000, Math.floor(value)));
}

function clampChatIdleForMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_IDLE_FOR_MS;
  return Math.max(0, Math.min(10_000, Math.floor(value)));
}

function buildChatTimelineMessages(
  regAny: any,
  opts: { droneId: string; chatName: string },
  options?: { requireChat?: boolean },
): ChatTimelineMessage[] {
  const { id: droneId, drone } = droneEntryByAssistantId(regAny, opts.droneId);
  const chatName = normalizeChatNameForAssistant(opts.chatName);
  const chat = drone?.chats?.[chatName] ?? (chatName === 'default' ? drone?.chats?.default : null);
  if (!chat) {
    if (options?.requireChat) throw new Error(`unknown chat: ${droneId}/${chatName}`);
    return [];
  }

  const out: ChatTimelineMessage[] = [];
  const turns = Array.isArray(chat.turns) ? chat.turns : [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i] as any;
    const turnId = String(turn?.id ?? `turn-${i + 1}`).trim() || `turn-${i + 1}`;
    const promptAt = safeMessageAt(turn?.promptAt ?? turn?.at, nowIso());
    const completedAt = typeof turn?.completedAt === 'string' && turn.completedAt.trim() ? turn.completedAt.trim() : undefined;
    const ok = turn?.ok !== false;
    const userMessageId = `user:${turnId}`;
    out.push({
      id: userMessageId,
      role: 'user',
      status: 'completed',
      text: String(turn?.prompt ?? ''),
      at: promptAt,
      ...(completedAt ? { completedAt } : {}),
      droneId,
      chatName,
      turnId,
    });
    out.push({
      id: `agent:${turnId}`,
      role: 'agent',
      status: ok ? 'completed' : 'failed',
      text: String(turn?.output ?? ''),
      at: safeMessageAt(completedAt ?? turn?.at ?? promptAt, promptAt),
      ...(completedAt ? { completedAt } : {}),
      ...(turn?.error ? { error: String(turn.error) } : {}),
      droneId,
      chatName,
      turnId,
      userMessageId,
    });
  }

  const pending = Array.isArray(chat.pendingPrompts) ? chat.pendingPrompts : [];
  const completedTurnIds = new Set(turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean));
  for (const item of pending as any[]) {
    const id = String(item?.id ?? '').trim();
    if (!id || completedTurnIds.has(id)) continue;
    const state = String(item?.state ?? '').trim();
    const status: ChatTimelineMessage['status'] =
      state === 'queued' || state === 'sending' || state === 'sent' || state === 'failed' ? state : 'queued';
    out.push({
      id: `user:${id}`,
      role: 'user',
      status,
      text: String(item?.prompt ?? ''),
      at: safeMessageAt(item?.at, nowIso()),
      ...(typeof item?.updatedAt === 'string' && item.updatedAt.trim() ? { updatedAt: item.updatedAt.trim() } : {}),
      ...(item?.error ? { error: String(item.error) } : {}),
      droneId,
      chatName,
      turnId: id,
    });
  }

  return out.sort((a, b) => {
    const aMs = Date.parse(a.at);
    const bMs = Date.parse(b.at);
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
    if (a.turnId && a.turnId === b.turnId && a.role !== b.role) return a.role === 'user' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

export function summarizeAssistantChatIdle(
  regAny: any,
  target: AssistantChatIdleTarget,
  options?: { requireChat?: boolean },
): AssistantChatIdleStatus {
  const messages = buildChatTimelineMessages(regAny, target, options);
  const activeUserMessages = messages.filter(
    (message) => message.role === 'user' && (message.status === 'queued' || message.status === 'sending' || message.status === 'sent'),
  ).length;
  const queuedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'queued').length;
  const failedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'failed').length;
  const latest = messages[messages.length - 1] ?? null;
  const reason: AssistantChatIdleStatus['reason'] =
    activeUserMessages > 0
      ? 'active_user_messages'
      : !latest
        ? 'no_messages'
        : latest.role === 'agent'
          ? 'latest_agent_message'
          : latest.status === 'failed'
            ? 'latest_user_failed'
            : 'latest_user_message';
  const idle = activeUserMessages === 0 && (reason === 'no_messages' || reason === 'latest_agent_message' || reason === 'latest_user_failed');
  return {
    droneId: target.droneId,
    chatName: normalizeChatNameForAssistant(target.chatName),
    idle,
    reason,
    activeUserMessages,
    queuedUserMessages,
    failedUserMessages,
    latest: latest
      ? {
          id: latest.id,
          role: latest.role,
          status: latest.status,
          at: latest.at,
          text: latest.text,
          ...(latest.turnId ? { turnId: latest.turnId } : {}),
        }
      : null,
  };
}

export async function waitForAssistantChatIdle(opts: {
  targets: AssistantChatIdleTarget[];
  timeoutMs?: unknown;
  pollIntervalMs?: unknown;
  idleForMs?: unknown;
  signal?: AbortSignal;
}): Promise<AssistantChatIdleWaitResult> {
  const targets = opts.targets
    .map((target) => ({
      droneId: String(target?.droneId ?? '').trim(),
      chatName: normalizeChatNameForAssistant(target?.chatName),
    }))
    .filter((target) => target.droneId)
    .slice(0, CHAT_IDLE_MAX_TARGETS);
  if (targets.length === 0) throw new Error('missing chat targets');
  const timeoutMs = clampChatIdleTimeoutMs(opts.timeoutMs);
  const pollIntervalMs = clampChatIdlePollIntervalMs(opts.pollIntervalMs);
  const idleForMs = clampChatIdleForMs(opts.idleForMs);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let idleSince: number | null = null;
  let lastStatuses: AssistantChatIdleStatus[] = [];

  while (true) {
    throwIfAborted(opts.signal);
    const now = Date.now();
    const regAny: any = await loadRegistry();
    lastStatuses = targets.map((target) => summarizeAssistantChatIdle(regAny, target, { requireChat: true }));
    const allIdle = lastStatuses.every((status) => status.idle);
    if (allIdle) {
      idleSince ??= now;
      if (now - idleSince >= idleForMs) {
        return {
          ok: true,
          timedOut: false,
          elapsedMs: now - startedAt,
          timeoutMs,
          idleForMs,
          targets: lastStatuses,
        };
      }
    } else {
      idleSince = null;
    }

    if (now >= deadline) {
      return {
        ok: false,
        timedOut: true,
        elapsedMs: now - startedAt,
        timeoutMs,
        idleForMs,
        targets: lastStatuses,
      };
    }
    const idleRemainingMs = allIdle && idleSince != null ? Math.max(0, idleForMs - (now - idleSince)) : pollIntervalMs;
    await sleep(Math.max(1, Math.min(pollIntervalMs, idleRemainingMs || pollIntervalMs, deadline - now)), opts.signal);
  }
}

async function readChatMessagePage(opts: {
  droneId: string;
  chatName: string;
  cursor?: unknown;
  direction?: unknown;
  limit?: unknown;
}): Promise<ChatMessagePage> {
  const regAny: any = await loadRegistry();
  const messages = buildChatTimelineMessages(regAny, {
    droneId: String(opts.droneId ?? '').trim(),
    chatName: normalizeChatNameForAssistant(opts.chatName),
  });
  const limit = clampChatMessageLimit(opts.limit);
  const total = messages.length;
  const cursorRaw = Number(opts.cursor);
  const cursor = Number.isFinite(cursorRaw) ? Math.min(total, Math.max(0, Math.floor(cursorRaw))) : null;
  const direction = String(opts.direction ?? '').trim().toLowerCase();

  let start = Math.max(0, total - limit);
  let end = total;
  if (cursor != null && direction === 'older') {
    end = cursor;
    start = Math.max(0, end - limit);
  } else if (cursor != null && direction === 'newer') {
    start = cursor;
    end = Math.min(total, start + limit);
  } else if (cursor != null) {
    start = cursor;
    end = Math.min(total, start + limit);
  }

  const page: ChatMessagePage = {
    droneId: String(opts.droneId ?? '').trim(),
    chatName: normalizeChatNameForAssistant(opts.chatName),
    messages: messages.slice(start, end),
    total,
    limit,
    pageStart: start,
    pageEnd: end,
    olderCursor: start > 0 ? String(start) : null,
    newerCursor: end < total ? String(end) : null,
  };
  ensureMessageResponseFits(page);
  return page;
}

async function getChatOverview(opts: { droneId?: unknown; chatName?: unknown }): Promise<any> {
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const requestedDroneId = String(opts.droneId ?? '').trim();
  const rows: any[] = [];

  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    if (requestedDroneId && droneId !== requestedDroneId && droneName !== requestedDroneId) continue;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      if (opts.chatName != null && normalizeChatNameForAssistant(opts.chatName) !== chatName) continue;
      const messages = buildChatTimelineMessages(regAny, { droneId, chatName });
      const latest = messages[messages.length - 1] ?? null;
      rows.push({
        droneId,
        droneName,
        chatName,
        messageCount: messages.length,
        queuedUserMessages: messages.filter((message) => message.role === 'user' && message.status === 'queued').length,
        activeUserMessages: messages.filter((message) => message.role === 'user' && (message.status === 'sending' || message.status === 'sent')).length,
        failedMessages: messages.filter((message) => message.status === 'failed').length,
        latest: latest
          ? {
              id: latest.id,
              role: latest.role,
              status: latest.status,
              at: latest.at,
              text: latest.text,
            }
          : null,
      });
    }
  }

  const overview = { chats: rows };
  ensureMessageResponseFits(overview);
  return overview;
}

async function searchChatMessages(opts: { droneId?: unknown; chatName?: unknown; query: unknown; limit?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const query = String(opts.query ?? '').trim().toLowerCase();
  if (!query) throw new Error('missing query');
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const limit = clampChatMessageLimit(opts.limit);
  const requestedDroneId = String(opts.droneId ?? '').trim();
  const requestedChatName = opts.chatName == null ? '' : normalizeChatNameForAssistant(opts.chatName);
  const matches: ChatTimelineMessage[] = [];

  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    if (opts.allowedDroneIds && !opts.allowedDroneIds.has(droneId)) continue;
    if (requestedDroneId && droneId !== requestedDroneId && droneName !== requestedDroneId) continue;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      if (requestedChatName && requestedChatName !== chatName) continue;
      for (const message of buildChatTimelineMessages(regAny, { droneId, chatName })) {
        if (!message.text.toLowerCase().includes(query)) continue;
        matches.push(message);
        if (matches.length >= limit) break;
      }
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  const result = { query, matches, limit };
  ensureMessageResponseFits(result);
  return result;
}

async function getChatOverviewScoped(opts: { droneId?: unknown; chatName?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const overview = await getChatOverview(opts);
  const allowed = opts.allowedDroneIds ?? null;
  if (!allowed) return overview;
  return { chats: (overview.chats ?? []).filter((chat: any) => allowed.has(String(chat?.droneId ?? '').trim())) };
}

async function searchChatMessagesScoped(opts: { droneId?: unknown; chatName?: unknown; query: unknown; limit?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const allowed = opts.allowedDroneIds ?? null;
  if (allowed && opts.droneId != null) {
    const regAny: any = await loadRegistry();
    const resolved = droneIdByAssistantRef(regAny, opts.droneId);
    if (!allowed.has(resolved)) throw new Error(`assistant scope does not include drone: ${opts.droneId}`);
  }
  const result = await searchChatMessages(opts);
  return result;
}

async function recentChatActivity(limit: number = 8, allowedDroneIds?: Set<string> | null): Promise<any[]> {
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const rows: any[] = [];
  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    if (allowedDroneIds && !allowedDroneIds.has(droneId)) continue;
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      const messages = buildChatTimelineMessages(regAny, { droneId, chatName });
      const latest = messages[messages.length - 1] ?? null;
      if (!latest) continue;
      rows.push({
        droneId,
        droneName,
        chatName,
        latestAt: latest.at,
        latestRole: latest.role,
        latestStatus: latest.status,
        latestText: latest.text,
      });
    }
  }
  return rows
    .sort((a, b) => {
      const aMs = Date.parse(a.latestAt);
      const bMs = Date.parse(b.latestAt);
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    })
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
}

function sanitizeMessage(message: any): any {
  if (!message || typeof message !== 'object') return message;
  return JSON.parse(JSON.stringify(message));
}

function makeAssistantAccessScope(input?: { readMode?: unknown; writeMode?: unknown; droneIds?: unknown; updatedAt?: unknown }): AssistantAccessScope {
  const readMode = String(input?.readMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const writeMode = String(input?.writeMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const rawIds = Array.isArray(input?.droneIds) ? input.droneIds : [];
  const droneIds = Array.from(new Set(rawIds.map((item) => cleanOptionalString(item)).filter(Boolean))).slice(0, 100);
  const selected = droneIds.length > 0;
  return {
    readMode: readMode === 'selected' && selected ? 'selected' : 'all',
    writeMode: writeMode === 'selected' && selected ? 'selected' : 'all',
    droneIds: selected && (readMode === 'selected' || writeMode === 'selected') ? droneIds : [],
    updatedAt: String(input?.updatedAt ?? '').trim() || nowIso(),
  };
}

function normalizeQueuedPrompt(raw: any, fallback: { provider: LlmProviderId; model: string; thinkingLevel?: AssistantThinkingLevel }): AssistantQueuedPrompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanOptionalString(raw.id);
  const prompt = cleanOptionalString(raw.prompt);
  if (!id || !prompt) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  return {
    id,
    prompt,
    createdAt: cleanOptionalString(raw.createdAt) || nowIso(),
    provider,
    model,
    thinkingLevel: allowedThinkingLevelForModel(provider, model, raw.thinkingLevel ?? fallback.thinkingLevel ?? 'off'),
    deliveryMode: normalizeAssistantPromptDeliveryMode(raw.deliveryMode),
  };
}

function normalizeChatIdleSubscriptionStatus(raw: unknown): AssistantChatIdleSubscriptionStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'fired' || value === 'cancelled' || value === 'expired') return value;
  return 'active';
}

function normalizeChatIdleSubscription(raw: any): AssistantChatIdleSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanOptionalString(raw.id);
  const threadId = cleanOptionalString(raw.threadId);
  if (!id || !threadId) return null;
  const targets = Array.isArray(raw.targets)
    ? raw.targets
        .map((target: any) => ({
          droneId: cleanOptionalString(target?.droneId),
          chatName: normalizeChatNameForAssistant(target?.chatName),
        }))
        .filter((target: AssistantChatIdleTarget) => target.droneId)
        .slice(0, CHAT_IDLE_MAX_TARGETS)
    : [];
  if (targets.length === 0) return null;
  const createdAt = cleanOptionalString(raw.createdAt) || nowIso();
  const createdMs = Date.parse(createdAt);
  const expiresAt =
    cleanOptionalString(raw.expiresAt) ||
    new Date((Number.isFinite(createdMs) ? createdMs : Date.now()) + CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS).toISOString();
  const idleForMs = clampChatIdleForMs(raw.idleForMs);
  const lastResult = raw.lastResult && typeof raw.lastResult === 'object' ? sanitizeMessage(raw.lastResult) as AssistantChatIdleWaitResult : null;
  return {
    id,
    threadId,
    toolCallId: cleanOptionalString(raw.toolCallId) || null,
    targets,
    createdAt,
    expiresAt,
    idleForMs,
    status: normalizeChatIdleSubscriptionStatus(raw.status),
    idleSince: cleanOptionalString(raw.idleSince) || null,
    firedAt: cleanOptionalString(raw.firedAt) || null,
    cancelledAt: cleanOptionalString(raw.cancelledAt) || null,
    expiredAt: cleanOptionalString(raw.expiredAt) || null,
    lastResult,
  };
}

function sanitizeChatIdleSubscription(subscription: AssistantChatIdleSubscription): AssistantChatIdleSubscription {
  return {
    ...subscription,
    targets: subscription.targets.map((target) => ({ droneId: target.droneId, chatName: normalizeChatNameForAssistant(target.chatName) })),
    lastResult: subscription.lastResult ? sanitizeMessage(subscription.lastResult) : null,
  };
}

function sanitizeThread(thread: AssistantThread): AssistantThread {
  return {
    ...thread,
    messages: thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT).map(sanitizeMessage),
    queuedPrompts: thread.queuedPrompts.map(sanitizeMessage),
    status: thread.status === 'running' || thread.status === 'waiting_for_approval' ? 'idle' : thread.status,
  };
}

function normalizeThread(raw: any, fallback: { provider: LlmProviderId; model: string; systemPrompt?: string }): AssistantThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  const createdAt = String(raw.createdAt ?? '').trim() || nowIso();
  const updatedAt = String(raw.updatedAt ?? '').trim() || createdAt;
  const messages = Array.isArray(raw.messages) ? raw.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT) : [];
  const thinkingLevel = allowedThinkingLevelForModel(provider, model, raw.thinkingLevel);
  const queuedPrompts = Array.isArray(raw.queuedPrompts)
    ? raw.queuedPrompts
        .map((item: any) => normalizeQueuedPrompt(item, { provider, model, thinkingLevel }))
        .filter(Boolean) as AssistantQueuedPrompt[]
    : [];
  return {
    id,
    title: String(raw.title ?? '').trim() || DEFAULT_THREAD_TITLE,
    createdAt,
    updatedAt,
    model,
    provider,
    thinkingLevel,
    systemPrompt: normalizeAssistantSystemPrompt(raw.systemPrompt) || fallback.systemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    accessScope: makeAssistantAccessScope(raw.accessScope),
    autoApprove: normalizeAssistantAutoApprove(raw.autoApprove),
    promptDeliveryMode: normalizeAssistantPromptDeliveryMode(raw.promptDeliveryMode),
    messages,
    queuedPrompts,
    status: raw.status === 'error' ? 'error' : 'idle',
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
  };
}

function serializeState(input: {
  activeThreadId: string;
  threads: AssistantThread[];
  chatIdleSubscriptions: AssistantChatIdleSubscription[];
  systemPrompt: string;
  systemPromptUpdatedAt: string | null;
}): StoredAssistantState {
  const systemPrompt = normalizeAssistantSystemPrompt(input.systemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  const chatIdleSubscriptions = input.chatIdleSubscriptions
    .slice(-CHAT_IDLE_MAX_SUBSCRIPTIONS)
    .map(sanitizeChatIdleSubscription);
  return {
    activeThreadId: input.activeThreadId,
    threads: input.threads.slice(0, ASSISTANT_REGISTRY_MAX_THREADS).map(sanitizeThread),
    ...(chatIdleSubscriptions.length > 0 ? { chatIdleSubscriptions } : {}),
    ...(systemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT
      ? {
          systemPrompt,
          systemPromptUpdatedAt: input.systemPromptUpdatedAt ?? nowIso(),
        }
      : {}),
    updatedAt: nowIso(),
  };
}

function assistantStatePath(): string {
  return droneRootPath(ASSISTANT_STATE_FILE_NAME);
}

async function readAssistantStateFile(): Promise<StoredAssistantState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(assistantStatePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as StoredAssistantState) : null;
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return null;
    throw error;
  }
}

async function writeAssistantStateFile(state: StoredAssistantState): Promise<void> {
  const filePath = assistantStatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.assistant.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.chmod(tmpPath, 0o600).catch(() => {});
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function enqueueWriteAssistantStateFile(state: StoredAssistantState): Promise<void> {
  const write = assistantStateWriteQueue.catch(() => {}).then(() => withRegistryLock(() => writeAssistantStateFile(state)));
  assistantStateWriteQueue = write;
  await write;
}

function firstThread(threads: AssistantThread[], id: string): AssistantThread {
  const found = threads.find((thread) => thread.id === id) ?? threads[0];
  if (!found) throw new Error('assistant has no threads');
  return found;
}

export class HubAssistantService {
  private threads: AssistantThread[] = [];
  private activeThreadId = '';
  private loaded = false;
  private runtimePromise: Promise<AssistantRuntime> | null = null;
  private activeAgents = new Map<string, any>();
  private queuePumpPromises = new Map<string, Promise<void>>();
  private streamingMessages = new Map<string, any>();
  private runningModels = new Map<string, AssistantRunModel>();
  private chatIdleSubscriptions: AssistantChatIdleSubscription[] = [];
  private chatIdleSubscriptionTimer: ReturnType<typeof setInterval> | null = null;
  private chatIdleSubscriptionCheck: Promise<void> | null = null;
  private defaultSystemPrompt = ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  private defaultSystemPromptUpdatedAt: string | null = null;
  private appContext: AssistantAppContext = {
    activeDroneId: null,
    activeDroneName: null,
    activeChatName: null,
    appView: null,
    updatedAt: nowIso(),
  };
  private readonly approvals = new Map<
    string,
    AssistantApproval & {
      resolve: (approved: boolean) => void;
    }
  >();

  constructor(private readonly tools: AssistantToolCallbacks) {}

  private activeChatIdleSubscriptions(threadId?: string): AssistantChatIdleSubscription[] {
    const id = cleanOptionalString(threadId);
    return this.chatIdleSubscriptions.filter((subscription) => {
      if (subscription.status !== 'active') return false;
      if (id && subscription.threadId !== id) return false;
      return this.threads.some((thread) => thread.id === subscription.threadId);
    });
  }

  private updateWaitingThreadStatuses(): void {
    const activeByThread = new Set(this.activeChatIdleSubscriptions().map((subscription) => subscription.threadId));
    for (const thread of this.threads) {
      if (thread.status === 'running' || thread.status === 'waiting_for_approval' || thread.status === 'error') continue;
      thread.status = activeByThread.has(thread.id) ? 'waiting_for_chats_idle' : 'idle';
    }
  }

  private ensureChatIdleSubscriptionMonitor(): void {
    if (this.chatIdleSubscriptionTimer || this.activeChatIdleSubscriptions().length === 0) return;
    this.chatIdleSubscriptionTimer = setInterval(() => {
      void this.checkChatIdleSubscriptions();
    }, CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS);
    (this.chatIdleSubscriptionTimer as any).unref?.();
  }

  private stopChatIdleSubscriptionMonitorIfIdle(): void {
    if (!this.chatIdleSubscriptionTimer || this.activeChatIdleSubscriptions().length > 0) return;
    clearInterval(this.chatIdleSubscriptionTimer);
    this.chatIdleSubscriptionTimer = null;
  }

  private makeChatIdleSubscriptionPrompt(subscription: AssistantChatIdleSubscription, result: AssistantChatIdleWaitResult): string {
    const targets = result.targets
      .map((target) => `${target.droneId}/${target.chatName}: ${target.reason}`)
      .join('\n');
    return [
      `Subscription ${subscription.id} fired: all subscribed chats are idle.`,
      `Subscribed at: ${subscription.createdAt}`,
      `Fired at: ${subscription.firedAt ?? nowIso()}`,
      'Targets:',
      targets || '(none)',
      '',
      'Continue from this event. Read the relevant chat messages if you need details before reporting results.',
    ].join('\n');
  }

  private enqueueChatIdleSubscriptionContinuation(subscription: AssistantChatIdleSubscription, result: AssistantChatIdleWaitResult): void {
    const thread = this.threads.find((item) => item.id === subscription.threadId);
    if (!thread || thread.status === 'error') return;
    const prompt = this.makeChatIdleSubscriptionPrompt(subscription, result);
    thread.queuedPrompts.push({
      id: makeAssistantId('queued'),
      prompt,
      createdAt: nowIso(),
      provider: thread.provider,
      model: thread.model,
      thinkingLevel: thread.thinkingLevel,
      deliveryMode: 'queue',
    });
    thread.updatedAt = nowIso();
    if (this.activeAgents.has(thread.id) || this.queuePumpPromises.has(thread.id)) return;
    const pump = this.drainQueuedPrompts(thread.id).finally(() => {
      this.queuePumpPromises.delete(thread.id);
    });
    this.queuePumpPromises.set(thread.id, pump);
  }

  private async checkChatIdleSubscriptions(): Promise<void> {
    if (this.chatIdleSubscriptionCheck) return await this.chatIdleSubscriptionCheck;
    this.chatIdleSubscriptionCheck = (async () => {
      await this.ensureLoaded();
      const active = this.activeChatIdleSubscriptions();
      if (active.length === 0) {
        this.stopChatIdleSubscriptionMonitorIfIdle();
        return;
      }
      const now = Date.now();
      const nowIsoValue = new Date(now).toISOString();
      let regAny: any | null = null;
      let changed = false;
      for (const subscription of active) {
        const expiresMs = Date.parse(subscription.expiresAt);
        if (Number.isFinite(expiresMs) && now >= expiresMs) {
          subscription.status = 'expired';
          subscription.expiredAt = nowIsoValue;
          subscription.idleSince = null;
          changed = true;
          continue;
        }
        regAny ??= await loadRegistry();
        let statuses: AssistantChatIdleStatus[];
        try {
          statuses = subscription.targets.map((target) => summarizeAssistantChatIdle(regAny, target, { requireChat: true }));
        } catch {
          subscription.idleSince = null;
          changed = true;
          continue;
        }
        const allIdle = statuses.every((status) => status.idle);
        if (!allIdle) {
          if (subscription.idleSince) {
            subscription.idleSince = null;
            changed = true;
          }
          continue;
        }
        const idleSinceMs = subscription.idleSince ? Date.parse(subscription.idleSince) : now;
        if (!subscription.idleSince || !Number.isFinite(idleSinceMs)) {
          subscription.idleSince = nowIsoValue;
          changed = true;
          if (subscription.idleForMs > 0) continue;
        }
        const effectiveIdleSinceMs = Number.isFinite(idleSinceMs) ? idleSinceMs : now;
        if (now - effectiveIdleSinceMs < subscription.idleForMs) continue;
        const result: AssistantChatIdleWaitResult = {
          ok: true,
          timedOut: false,
          elapsedMs: now - (Date.parse(subscription.createdAt) || now),
          timeoutMs: CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS,
          idleForMs: subscription.idleForMs,
          targets: statuses,
        };
        subscription.status = 'fired';
        subscription.firedAt = nowIsoValue;
        subscription.lastResult = result;
        changed = true;
        this.enqueueChatIdleSubscriptionContinuation(subscription, result);
      }
      this.updateWaitingThreadStatuses();
      this.stopChatIdleSubscriptionMonitorIfIdle();
      if (changed) await this.persist();
    })().finally(() => {
      this.chatIdleSubscriptionCheck = null;
    });
    return await this.chatIdleSubscriptionCheck;
  }

  updateAppContext(input: {
    activeDroneId?: unknown;
    activeDroneName?: unknown;
    activeChatName?: unknown;
    appView?: unknown;
  }): void {
    this.appContext = {
      activeDroneId: String(input.activeDroneId ?? '').trim() || null,
      activeDroneName: String(input.activeDroneName ?? '').trim() || null,
      activeChatName: String(input.activeChatName ?? '').trim() || null,
      appView: String(input.appView ?? '').trim() || null,
      updatedAt: nowIso(),
    };
  }

  async updateAccessScope(input: { threadId?: unknown; mode?: unknown; readMode?: unknown; writeMode?: unknown; droneIds?: unknown }): Promise<void> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId) || this.activeThreadId;
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    thread.accessScope = makeAssistantAccessScope({
      readMode: (input as any).readMode ?? input.mode,
      writeMode: (input as any).writeMode ?? input.mode,
      droneIds: input.droneIds,
      updatedAt: nowIso(),
    });
    thread.updatedAt = nowIso();
    await this.persist();
  }

  private activeAccessScope(threadId?: string): AssistantAccessScope {
    const id = cleanOptionalString(threadId);
    if (id) {
      const thread = this.threads.find((item) => item.id === id);
      if (!thread) throw new Error(`unknown assistant thread: ${id}`);
      return thread.accessScope;
    }
    return firstThread(this.threads, this.activeThreadId).accessScope;
  }

  private allowedDroneIdSet(kind: 'read' | 'write' = 'read', threadId?: string): Set<string> | null {
    const accessScope = this.activeAccessScope(threadId);
    const mode = kind === 'write' ? accessScope.writeMode : accessScope.readMode;
    if (mode !== 'selected') return null;
    return new Set(accessScope.droneIds);
  }

  private async requireDroneInScope(droneRef: unknown, kind: 'read' | 'write' = 'read', threadId?: string): Promise<string> {
    const regAny: any = await loadRegistry();
    const droneId = droneIdByAssistantRef(regAny, droneRef);
    const allowed = this.allowedDroneIdSet(kind, threadId);
    if (allowed && !allowed.has(droneId)) throw new Error(`assistant scope does not include drone: ${droneRef}`);
    return droneId;
  }

  private filterDronesForScope(drones: AssistantDroneSummary[], threadId?: string): AssistantDroneSummary[] {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return drones;
    return drones.filter((drone) => allowed.has(drone.id));
  }

  private requireFileCallback<K extends keyof AssistantToolCallbacks>(name: K): NonNullable<AssistantToolCallbacks[K]> {
    const callback = this.tools[name];
    if (typeof callback !== 'function') throw new Error(`assistant file tool unavailable: ${String(name)}`);
    return callback as NonNullable<AssistantToolCallbacks[K]>;
  }

  private async applyDronePatch(threadId: string, params: any): Promise<AssistantApplyPatchResult> {
    const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
    const operations = parseAssistantApplyPatch(params?.patch);
    const readFile = this.requireFileCallback('readDroneFile');
    const writeFile = this.requireFileCallback('writeDroneFile');
    const deleteFile = this.requireFileCallback('deleteDroneFile');
    const moveFile = this.requireFileCallback('moveDroneFile');
    const statPath = this.requireFileCallback('statDronePath');
    const staged = new Map<string, AssistantPatchStagedFile>();
    const applied: AssistantApplyPatchResult['operations'] = [];

    const getStaged = async (filePath: string): Promise<AssistantPatchStagedFile> => {
      const existing = staged.get(filePath);
      if (existing) return existing;
      const read = await readFile({ droneId, path: filePath });
      const next: AssistantPatchStagedFile = {
        path: filePath,
        existsBefore: true,
        content: read.content,
        deleted: false,
      };
      staged.set(filePath, next);
      return next;
    };

    const pathExists = async (filePath: string): Promise<boolean> => {
      const existing = staged.get(filePath);
      if (existing) return !existing.deleted && (existing.content != null || Boolean(existing.moveFrom));
      const stat = await statPath({ droneId, path: filePath });
      return Boolean(stat.exists);
    };

    for (const operation of operations) {
      if (operation.kind === 'add') {
        if (await pathExists(operation.path)) throw new Error(`file already exists: ${operation.path}`);
        staged.set(operation.path, {
          path: operation.path,
          existsBefore: false,
          content: operation.content,
          deleted: false,
        });
        applied.push({ kind: 'add', path: operation.path, size: Buffer.byteLength(operation.content, 'utf8') });
        continue;
      }

      if (operation.kind === 'delete') {
        const current = staged.get(operation.path);
        if (current) {
          current.content = null;
          current.deleted = true;
          delete current.moveFrom;
        } else {
          const stat = await statPath({ droneId, path: operation.path });
          if (!stat.exists) throw new Error(`file not found: ${operation.path}`);
          if (stat.kind === 'directory') throw new Error(`path is a directory: ${operation.path}`);
          staged.set(operation.path, {
            path: operation.path,
            existsBefore: true,
            content: null,
            deleted: true,
          });
        }
        applied.push({ kind: 'delete', path: operation.path });
        continue;
      }

      let current = staged.get(operation.path);
      if (operation.moveTo && operation.hunks.length === 0 && !current) {
        const stat = await statPath({ droneId, path: operation.path });
        if (!stat.exists) throw new Error(`file not found: ${operation.path}`);
        if (stat.kind === 'directory') throw new Error(`path is a directory: ${operation.path}`);
        current = {
          path: operation.path,
          existsBefore: true,
          content: null,
          deleted: false,
        };
        staged.set(operation.path, current);
      } else {
        current = await getStaged(operation.path);
      }
      if (current.deleted) throw new Error(`file not found: ${operation.path}`);
      let content = current.content;
      if (current.moveFrom && content == null && operation.hunks.length > 0) {
        const read = await readFile({ droneId, path: current.moveFrom });
        content = read.content;
        current.content = content;
        delete current.moveFrom;
      }
      if (operation.hunks.length > 0) {
        if (content == null) throw new Error(`file not found: ${operation.path}`);
        for (const hunk of operation.hunks) {
          content = replaceTextOnce(content, hunk.oldText, hunk.newText, operation.path);
        }
      }
      if (operation.moveTo) {
        if (operation.moveTo === operation.path) throw new Error(`move target matches source: ${operation.path}`);
        if (await pathExists(operation.moveTo)) throw new Error(`move target already exists: ${operation.moveTo}`);
        current.content = null;
        current.deleted = true;
        delete current.moveFrom;
        staged.set(operation.moveTo, {
          path: operation.moveTo,
          existsBefore: false,
          content,
          deleted: false,
          ...(content == null ? { moveFrom: operation.path } : {}),
        });
        applied.push({ kind: 'update', path: operation.path, movedTo: operation.moveTo });
        continue;
      }
      if (content == null) throw new Error(`file not found: ${operation.path}`);
      current.content = content;
      current.deleted = false;
      delete current.moveFrom;
      applied.push({ kind: 'update', path: operation.path, size: Buffer.byteLength(content, 'utf8') });
    }

    const movedSources = new Set<string>();
    for (const file of staged.values()) {
      if (!file.deleted && file.moveFrom) {
        await moveFile({ droneId, fromPath: file.moveFrom, toPath: file.path });
        movedSources.add(file.moveFrom);
      }
    }
    for (const file of staged.values()) {
      if (!file.deleted && file.content != null) {
        await writeFile({ droneId, path: file.path, content: file.content });
      }
    }
    for (const file of staged.values()) {
      if (!file.deleted || !file.existsBefore) continue;
      if (movedSources.has(file.path)) continue;
      await deleteFile({ droneId, path: file.path });
    }

    return { ok: true, droneId, operations: applied };
  }

  private scopedAppContext(threadId: string): AssistantAppContext {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return { ...this.appContext };
    const activeDroneId = cleanOptionalString(this.appContext.activeDroneId);
    if (activeDroneId && allowed.has(activeDroneId)) return { ...this.appContext };
    return {
      ...this.appContext,
      activeDroneId: null,
      activeDroneName: null,
      activeChatName: null,
    };
  }

  private async buildCreateDroneRequest(params: any, threadId?: string): Promise<any> {
    const regAny: any = await loadRegistry();
    const hasParam = (key: string) => Object.prototype.hasOwnProperty.call(params ?? {}, key);
    const explicitSourceRef = cleanOptionalString(params?.sourceDroneId);
    const sourceRef =
      explicitSourceRef ||
      cleanOptionalString(this.appContext.activeDroneId) ||
      cleanOptionalString(this.appContext.activeDroneName);
    let source: { id: string; drone: any } | null = null;
    if (sourceRef) {
      try {
        const id = droneIdByAssistantRef(regAny, sourceRef);
        const allowed = this.allowedDroneIdSet('read', threadId);
        if (allowed && !allowed.has(id)) throw new Error(`assistant scope does not include source drone: ${sourceRef}`);
        source = droneEntryByAssistantId(regAny, id);
      } catch (e) {
        if (explicitSourceRef) throw e;
        source = null;
      }
    }

    const name = cleanOptionalString(params?.name);
    if (!name) throw new Error('missing name');
    const runtime = normalizeAssistantRuntime(params?.runtime, source?.drone?.runtime);
    const sourceGroup = cleanOptionalString(source?.drone?.group);
    const group = hasParam('group') ? cleanOptionalString(params?.group) : sourceGroup;
    const sourceRepoPath = cleanOptionalString(source?.drone?.repoPath);
    const repoPath = hasParam('repoPath') ? cleanOptionalString(params?.repoPath) : sourceRepoPath;
    const activeChatName = normalizeChatNameForAssistant(this.appContext.activeChatName);
    const sourceChats = source?.drone?.chats && typeof source.drone.chats === 'object' ? source.drone.chats : {};
    const sourceChat = sourceChats[activeChatName] ?? sourceChats.default ?? null;
    const seedAgent = sourceChat?.agent && typeof sourceChat.agent === 'object' ? sourceChat.agent : null;
    const seedModel = cleanOptionalString(sourceChat?.model);
    const repoBranchSource = normalizeAssistantRepoBranchSource(params?.repoBranchSource);
    const remoteBranch = cleanOptionalString(params?.remoteBranch);
    const initialMessage = cleanOptionalString(params?.initialMessage ?? params?.seedPrompt ?? params?.message);
    const request = {
      name,
      runtime,
      ...(group ? { group } : {}),
      ...(repoPath ? { repoPath } : {}),
      ...(repoPath ? { repoBranchSource } : {}),
      ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
      ...(params?.pullHostBranchBeforeCreate != null ? { pullHostBranchBeforeCreate: Boolean(params.pullHostBranchBeforeCreate) } : {}),
      seedChat: 'default',
      ...(seedAgent ? { seedAgent } : {}),
      ...(seedModel ? { seedModel } : {}),
      ...(initialMessage ? { seedPrompt: initialMessage } : {}),
    };
    return request;
  }

  async snapshot(): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.updateWaitingThreadStatuses();
    this.ensureChatIdleSubscriptionMonitor();
    const streamingMessage = this.streamingMessages.get(this.activeThreadId);
    return {
      ok: true,
      activeThreadId: this.activeThreadId,
      threads: this.threads.map((thread) => ({ ...thread, messages: thread.messages.map(sanitizeMessage) })),
      chatIdleSubscriptions: this.chatIdleSubscriptions.map(sanitizeChatIdleSubscription),
      pendingApprovals: this.pendingApprovals(),
      models: await this.modelOptions(),
      accessScope: sanitizeMessage(this.activeAccessScope()),
      runningModels: Object.fromEntries([...this.runningModels.entries()].map(([threadId, model]) => [threadId, sanitizeMessage(model)])),
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage) } : {}),
    };
  }

  async createThread(input?: { title?: unknown; model?: unknown; provider?: unknown; activeDroneId?: unknown; activeChatName?: unknown }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const explicitProvider = String(input?.provider ?? '').trim();
    const provider = explicitProvider ? normalizeProvider(explicitProvider) : await defaultAssistantProvider();
    const thread = this.makeThread({
      provider,
      model: String(input?.model ?? '').trim() || defaultModelForProvider(provider),
      title: String(input?.title ?? '').trim() || DEFAULT_THREAD_TITLE,
      accessScope: this.defaultAccessScopeForNewThread(input),
    });
    this.threads = [thread, ...this.threads].slice(0, ASSISTANT_REGISTRY_MAX_THREADS);
    this.activeThreadId = thread.id;
    await this.persist();
    return await this.snapshot();
  }

  async systemPromptSettings(): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    return this.systemPromptSettingsSync();
  }

  async updateSystemPrompt(input: { prompt?: unknown }): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    const prompt = normalizeAssistantSystemPrompt(input.prompt);
    if (!prompt) throw new Error('missing system prompt');
    this.defaultSystemPrompt = prompt;
    this.defaultSystemPromptUpdatedAt = prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    await this.persist();
    return this.systemPromptSettingsSync();
  }

  async updateThread(threadId: string, patch: { title?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown; autoApprove?: unknown; promptDeliveryMode?: unknown }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    this.activeThreadId = thread.id;
    const title = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (title) thread.title = title.slice(0, 80);
    if (patch.provider != null) thread.provider = normalizeProvider(patch.provider);
    if (patch.model != null || patch.provider != null) thread.model = allowedModelForProvider(thread.provider, patch.model ?? thread.model);
    if (patch.thinkingLevel != null || patch.model != null || patch.provider != null) {
      thread.thinkingLevel = allowedThinkingLevelForModel(thread.provider, thread.model, patch.thinkingLevel ?? thread.thinkingLevel);
    }
    if (patch.autoApprove != null) {
      thread.autoApprove = normalizeAssistantAutoApprove(patch.autoApprove);
      if (thread.autoApprove) this.resolvePendingApprovalsForThread(thread.id, true);
    }
    if (patch.promptDeliveryMode != null) thread.promptDeliveryMode = normalizeAssistantPromptDeliveryMode(patch.promptDeliveryMode);
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.snapshot();
  }

  async deleteThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.activeAgents.get(threadId)?.abort?.();
    this.activeAgents.delete(threadId);
    this.queuePumpPromises.delete(threadId);
    this.streamingMessages.delete(threadId);
    this.chatIdleSubscriptions = this.chatIdleSubscriptions.filter((subscription) => subscription.threadId !== threadId);
    await deleteAssistantArtifactsForThread(threadId);
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    if (this.threads.length === 0) {
      const provider = await defaultAssistantProvider();
      this.threads = [this.makeThread({ provider, model: defaultModelForProvider(provider) })];
    }
    if (!this.threads.some((thread) => thread.id === this.activeThreadId)) {
      this.activeThreadId = this.threads[0].id;
    }
    await this.persist();
    this.stopChatIdleSubscriptionMonitorIfIdle();
    return await this.snapshot();
  }

  async stopThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.activeAgents.get(threadId)?.abort?.();
    const now = nowIso();
    for (const subscription of this.chatIdleSubscriptions) {
      if (subscription.threadId !== threadId || subscription.status !== 'active') continue;
      subscription.status = 'cancelled';
      subscription.cancelledAt = now;
      subscription.idleSince = null;
    }
    this.updateWaitingThreadStatuses();
    await this.persist();
    this.stopChatIdleSubscriptionMonitorIfIdle();
    return await this.snapshot();
  }

  async listArtifactFiles(threadId: string) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await listAssistantArtifactFiles(threadId);
  }

  async readArtifactFile(threadId: string, artifactPath: unknown) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await readAssistantArtifactFile(threadId, artifactPath);
  }

  async runArtifactAction(threadId: string, input: AssistantArtifactActionInput) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await runAssistantArtifactAction(threadId, input);
  }

  async subscribeToChatsIdle(input: {
    threadId: string;
    toolCallId?: unknown;
    targets: AssistantChatIdleTarget[];
    idleForMs?: unknown;
  }): Promise<AssistantChatIdleSubscription> {
    await this.ensureLoaded();
    const thread = this.getThread(input.threadId);
    const targets = input.targets
      .map((target) => ({
        droneId: cleanOptionalString(target?.droneId),
        chatName: normalizeChatNameForAssistant(target?.chatName),
      }))
      .filter((target) => target.droneId)
      .slice(0, CHAT_IDLE_MAX_TARGETS);
    if (targets.length === 0) throw new Error('missing chat targets');
    const regAny: any = await loadRegistry();
    for (const target of targets) {
      summarizeAssistantChatIdle(regAny, target, { requireChat: true });
    }
    const now = Date.now();
    const subscription: AssistantChatIdleSubscription = {
      id: makeAssistantId('chat_idle_sub'),
      threadId: thread.id,
      toolCallId: cleanOptionalString(input.toolCallId) || null,
      targets,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS).toISOString(),
      idleForMs: clampChatIdleForMs(input.idleForMs),
      status: 'active',
      idleSince: null,
      firedAt: null,
      cancelledAt: null,
      expiredAt: null,
      lastResult: null,
    };
    this.chatIdleSubscriptions.push(subscription);
    this.chatIdleSubscriptions = this.chatIdleSubscriptions.slice(-CHAT_IDLE_MAX_SUBSCRIPTIONS);
    if (thread.status !== 'running' && thread.status !== 'waiting_for_approval' && thread.status !== 'error') {
      thread.status = 'waiting_for_chats_idle';
    }
    thread.updatedAt = nowIso();
    await this.persist();
    this.ensureChatIdleSubscriptionMonitor();
    void this.checkChatIdleSubscriptions();
    return sanitizeChatIdleSubscription(subscription);
  }

  async cancelQueuedPrompt(threadId: string, queuedPromptId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.threads.find((item) => item.id === String(threadId ?? '').trim());
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    const id = String(queuedPromptId ?? '').trim();
    const next = thread.queuedPrompts.filter((item) => item.id !== id);
    if (next.length === thread.queuedPrompts.length) throw new Error(`unknown queued assistant message: ${queuedPromptId}`);
    thread.queuedPrompts = next;
    thread.updatedAt = nowIso();
    this.syncActiveSteeringQueue(thread);
    await this.persist();
    return await this.snapshot();
  }

  async approve(approvalId: string, approved: boolean): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`unknown approval: ${approvalId}`);
    approval.status = approved ? 'approved' : 'denied';
    this.approvals.delete(approvalId);
    approval.resolve(approved);
    return await this.snapshot();
  }

  private resolvePendingApprovalsForThread(threadId: string, approved: boolean): void {
    for (const [id, approval] of [...this.approvals]) {
      if (approval.threadId !== threadId || approval.status !== 'pending') continue;
      approval.status = approved ? 'approved' : 'denied';
      this.approvals.delete(id);
      approval.resolve(approved);
    }
  }

  async promptThread(
    threadId: string,
    input: { prompt?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown; deliveryMode?: unknown },
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    this.activeThreadId = thread.id;
    const queuedPrompt = this.makeQueuedPrompt(thread, { ...input, deliveryMode: input.deliveryMode ?? thread.promptDeliveryMode });
    const activeAgent = this.activeAgents.get(thread.id);
    const runningModel = this.runningModels.get(thread.id);
    const canSteerActiveThread = Boolean(activeAgent);
    if (canSteerActiveThread && queuedPrompt.deliveryMode === 'asap') {
      if (runningModel) {
        queuedPrompt.provider = runningModel.provider;
        queuedPrompt.model = runningModel.model;
        queuedPrompt.thinkingLevel = runningModel.thinkingLevel;
      }
      thread.queuedPrompts.push(queuedPrompt);
      activeAgent?.steer?.(makeAssistantUserMessage(queuedPrompt.prompt));
      thread.updatedAt = nowIso();
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      return;
    }

    if (this.activeAgents.has(thread.id) || this.queuePumpPromises.has(thread.id) || this.hasQueuedPrompts(thread.id)) {
      if (!canSteerActiveThread) queuedPrompt.deliveryMode = 'queue';
      thread.queuedPrompts.push(queuedPrompt);
      thread.updatedAt = nowIso();
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      if (!this.activeAgents.has(thread.id) && !this.queuePumpPromises.has(thread.id)) {
        const pump = this.drainQueuedPrompts(thread.id, onEvent).finally(() => {
          this.queuePumpPromises.delete(thread.id);
        });
        this.queuePumpPromises.set(thread.id, pump);
        await pump;
      }
      return;
    }

    const pump = (async () => {
      await this.runQueuedPrompt(thread, queuedPrompt, onEvent);
      await this.drainQueuedPrompts(thread.id, onEvent);
    })().finally(() => {
      this.queuePumpPromises.delete(thread.id);
    });
    this.queuePumpPromises.set(thread.id, pump);
    await pump;
  }

  private hasQueuedPrompts(threadId: string): boolean {
    return this.threads.some((thread) => thread.id === threadId && thread.queuedPrompts.length > 0);
  }

  private makeQueuedPrompt(
    thread: AssistantThread,
    input: { prompt?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown; deliveryMode?: unknown },
  ): AssistantQueuedPrompt {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('missing prompt');
    const provider = normalizeProvider(input.provider ?? thread.provider);
    const model = allowedModelForProvider(provider, input.model ?? thread.model);
    return {
      id: makeAssistantId('queued'),
      prompt,
      createdAt: nowIso(),
      provider,
      model,
      thinkingLevel: allowedThinkingLevelForModel(provider, model, input.thinkingLevel ?? thread.thinkingLevel),
      deliveryMode: normalizeAssistantPromptDeliveryMode(input.deliveryMode),
    };
  }

  private syncActiveSteeringQueue(thread: AssistantThread): void {
    const activeAgent = this.activeAgents.get(thread.id);
    if (!activeAgent) return;
    activeAgent.clearSteeringQueue?.();
    for (const queuedPrompt of thread.queuedPrompts) {
      if (queuedPrompt.deliveryMode !== 'asap') continue;
      activeAgent.steer?.(makeAssistantUserMessage(queuedPrompt.prompt));
    }
  }

  private removeDeliveredSteeringPrompt(thread: AssistantThread, message: any): boolean {
    if (message?.role !== 'user') return false;
    const prompt = textFromMessage(message).trim();
    if (!prompt) return false;
    const index = thread.queuedPrompts.findIndex(
      (queuedPrompt) => queuedPrompt.deliveryMode === 'asap' && queuedPrompt.prompt.trim() === prompt,
    );
    if (index < 0) return false;
    thread.queuedPrompts.splice(index, 1);
    return true;
  }

  private shiftNextQueuedPrompt(threadId: string): { thread: AssistantThread; queuedPrompt: AssistantQueuedPrompt } | null {
    let selected: { thread: AssistantThread; queuedPrompt: AssistantQueuedPrompt; index: number; ms: number } | null = null;
    for (const thread of this.threads) {
      if (thread.id !== threadId) continue;
      for (let index = 0; index < thread.queuedPrompts.length; index += 1) {
        const queuedPrompt = thread.queuedPrompts[index];
        const ms = Date.parse(queuedPrompt.createdAt);
        const normalizedMs = Number.isFinite(ms) ? ms : 0;
        if (!selected || normalizedMs < selected.ms) selected = { thread, queuedPrompt, index, ms: normalizedMs };
      }
    }
    if (!selected) return null;
    selected.thread.queuedPrompts.splice(selected.index, 1);
    selected.thread.updatedAt = nowIso();
    return { thread: selected.thread, queuedPrompt: selected.queuedPrompt };
  }

  private async drainQueuedPrompts(threadId: string, onEvent?: (event: AssistantPromptEvent) => void | Promise<void>): Promise<void> {
    while (!this.activeAgents.has(threadId)) {
      const next = this.shiftNextQueuedPrompt(threadId);
      if (!next) return;
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      await this.runQueuedPrompt(next.thread, next.queuedPrompt, onEvent);
    }
  }

  private async runQueuedPrompt(
    thread: AssistantThread,
    queuedPrompt: AssistantQueuedPrompt,
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    const runProvider = queuedPrompt.provider;
    const runModel = queuedPrompt.model;
    const runThinkingLevel = queuedPrompt.thinkingLevel;
    let agent: any = null;

    try {
      const runtime = await this.runtime();
      const model = this.resolveModel(runtime, runProvider, runModel);
      const tools = this.buildTools(runtime, thread.id, onEvent);
      const providerSettings = await resolveEffectiveProviderApiKeySettings(runProvider);
      if (!providerSettings.apiKey) {
        throw new Error(`Missing ${providerDisplayName(runProvider)} API key. Configure it in Settings.`);
      }

      agent = new runtime.Agent({
        initialState: {
          systemPrompt: this.systemPrompt(thread.id),
          model,
          thinkingLevel: runThinkingLevel,
          tools,
          messages: thread.messages.map(sanitizeMessage),
        },
        ...(runProvider === 'openai' || runProvider === 'codex' ? { convertToLlm: convertMessagesForOpenAi } : {}),
        getApiKey: async (provider: string) => {
          if (provider === 'google') {
            const resolved = await resolveEffectiveProviderApiKeySettings('gemini');
            return resolved.apiKey;
          }
          if (provider === 'openai-codex') {
            const resolved = await resolveEffectiveProviderApiKeySettings('codex');
            return resolved.apiKey;
          }
          if (provider === 'openai') {
            const resolved = await resolveEffectiveProviderApiKeySettings('openai');
            return resolved.apiKey;
          }
          return providerSettings.apiKey;
        },
        beforeToolCall: async (ctx: any, signal?: AbortSignal) => await this.beforeToolCall(thread.id, ctx, onEvent, signal),
        toolExecution: 'sequential',
      });

      this.activeAgents.set(thread.id, agent);
      this.runningModels.set(thread.id, {
        provider: runProvider,
        model: runModel,
        thinkingLevel: runThinkingLevel,
        promptId: queuedPrompt.id,
        startedAt: nowIso(),
      });
      thread.status = 'running';
      thread.error = null;
      thread.updatedAt = nowIso();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });

      agent.subscribe(async (event: any) => {
        if (event.type === 'message_update') {
          this.streamingMessages.set(thread.id, sanitizeMessage(event.message));
        }
        if (event.type === 'message_start' && this.removeDeliveredSteeringPrompt(thread, event.message)) {
          thread.updatedAt = nowIso();
          await this.persist();
        }
        if (event.type === 'message_end' || event.type === 'agent_end' || event.type === 'turn_end') {
          thread.messages = agent.state.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
          if (agent.state.streamingMessage) {
            this.streamingMessages.set(thread.id, sanitizeMessage(agent.state.streamingMessage));
          } else {
            this.streamingMessages.delete(thread.id);
          }
          const firstUser = thread.messages.find((message) => message?.role === 'user');
          if (thread.title === DEFAULT_THREAD_TITLE && firstUser) thread.title = titleFromPrompt(textFromMessage(firstUser));
          thread.updatedAt = nowIso();
        }
        if (event.type === 'turn_end' && event.message?.role === 'assistant' && event.message?.errorMessage) {
          thread.error = String(event.message.errorMessage);
          thread.status = 'error';
        }
        await onEvent?.({ type: 'agent_event', threadId: thread.id, event });
        await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      });

      await agent.prompt(queuedPrompt.prompt);
      if ((thread.status as AssistantThreadStatus) !== 'error') {
        thread.status = this.activeChatIdleSubscriptions(thread.id).length > 0 ? 'waiting_for_chats_idle' : 'idle';
      }
    } catch (e: any) {
      thread.status = 'error';
      thread.error = e?.message ?? String(e);
      await onEvent?.({ type: 'error', threadId: thread.id, error: thread.error ?? 'Assistant failed.' });
    } finally {
      if (agent) thread.messages = agent.state.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
      thread.updatedAt = nowIso();
      this.streamingMessages.delete(thread.id);
      const runningModel = this.runningModels.get(thread.id);
      if (runningModel?.promptId === queuedPrompt.id) this.runningModels.delete(thread.id);
      if (this.activeAgents.get(thread.id) === agent) this.activeAgents.delete(thread.id);
      for (const [id, approval] of [...this.approvals]) {
        if (approval.threadId !== thread.id) continue;
        this.approvals.delete(id);
        approval.resolve(false);
      }
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await readAssistantStateFile() ?? undefined;
    const storedSystemPrompt = normalizeAssistantSystemPrompt(stored?.systemPrompt);
    this.defaultSystemPrompt = storedSystemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    this.defaultSystemPromptUpdatedAt =
      storedSystemPrompt && typeof stored?.systemPromptUpdatedAt === 'string' && stored.systemPromptUpdatedAt.trim()
        ? stored.systemPromptUpdatedAt.trim()
        : null;
    const storedThreads = Array.isArray(stored?.threads) ? stored.threads : [];
    const storedFallbackProvider = normalizeProvider(storedThreads.find((thread: any) => thread && typeof thread === 'object')?.provider);
    const storedFallback = {
      provider: storedFallbackProvider,
      model: defaultModelForProvider(storedFallbackProvider),
      systemPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    };
    const threads = storedThreads.map((thread) => normalizeThread(thread, storedFallback)).filter(Boolean) as AssistantThread[];
    if (threads.length > 0) {
      this.threads = threads;
    } else {
      const provider = await defaultAssistantProvider();
      this.threads = [this.makeThread({ provider, model: defaultModelForProvider(provider), systemPrompt: this.defaultSystemPrompt })];
    }
    const threadIds = new Set(this.threads.map((thread) => thread.id));
    this.chatIdleSubscriptions = (Array.isArray(stored?.chatIdleSubscriptions) ? stored.chatIdleSubscriptions : [])
      .map(normalizeChatIdleSubscription)
      .filter((subscription): subscription is AssistantChatIdleSubscription => subscription !== null && threadIds.has(subscription.threadId))
      .slice(-CHAT_IDLE_MAX_SUBSCRIPTIONS);
    const activeThreadId = String(stored?.activeThreadId ?? '').trim();
    this.activeThreadId = this.threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : this.threads[0].id;
    this.loaded = true;
    this.updateWaitingThreadStatuses();
    this.ensureChatIdleSubscriptionMonitor();
  }

  private defaultAccessScopeForNewThread(input?: { activeDroneId?: unknown; activeChatName?: unknown }): AssistantAccessScope {
    const hasInputDrone = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeDroneId');
    const hasInputChat = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeChatName');
    const activeDroneId = hasInputDrone ? cleanOptionalString(input?.activeDroneId) : cleanOptionalString(this.appContext.activeDroneId);
    const activeChatName = hasInputChat ? cleanOptionalString(input?.activeChatName) : cleanOptionalString(this.appContext.activeChatName);
    if (!activeDroneId || !activeChatName) return makeAssistantAccessScope();
    return makeAssistantAccessScope({ readMode: 'all', writeMode: 'selected', droneIds: [activeDroneId] });
  }

  private makeThread(input?: { provider?: LlmProviderId; model?: string; title?: string; accessScope?: AssistantAccessScope; systemPrompt?: string }): AssistantThread {
    const provider = normalizeProvider(input?.provider);
    const at = nowIso();
    return {
      id: makeAssistantId('thread'),
      title: input?.title?.trim() || DEFAULT_THREAD_TITLE,
      createdAt: at,
      updatedAt: at,
      provider,
      model: allowedModelForProvider(provider, input?.model),
      thinkingLevel: allowedThinkingLevelForModel(provider, allowedModelForProvider(provider, input?.model), 'off'),
      systemPrompt: normalizeAssistantSystemPrompt(input?.systemPrompt) || this.defaultSystemPrompt,
      accessScope: input?.accessScope ?? makeAssistantAccessScope(),
      autoApprove: false,
      promptDeliveryMode: 'queue',
      messages: [],
      queuedPrompts: [],
      status: 'idle',
      error: null,
    };
  }

  private getThread(threadId: string): AssistantThread {
    const id = String(threadId ?? '').trim();
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    return thread;
  }

  private async persist(): Promise<void> {
    const activeThread = firstThread(this.threads, this.activeThreadId);
    const state = serializeState({
      activeThreadId: activeThread.id,
      threads: this.threads,
      chatIdleSubscriptions: this.chatIdleSubscriptions,
      systemPrompt: this.defaultSystemPrompt,
      systemPromptUpdatedAt: this.defaultSystemPromptUpdatedAt,
    });
    await enqueueWriteAssistantStateFile(state);
  }

  private async runtime(): Promise<AssistantRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = Promise.all([
        dynamicImport('@mariozechner/pi-agent-core'),
        dynamicImport('@mariozechner/pi-ai'),
      ]).then(([agentCore, ai]) => ({
        Agent: agentCore.Agent,
        Type: ai.Type,
        getModel: ai.getModel,
        getModels: ai.getModels,
        getSupportedThinkingLevels: ai.getSupportedThinkingLevels,
      }));
    }
    return await this.runtimePromise;
  }

  private resolveModel(runtime: AssistantRuntime, provider: LlmProviderId, modelId: string): any {
    const piProvider = providerToPiProvider(provider);
    const model = runtime.getModel(piProvider, modelId) ?? runtime.getModel(piProvider, defaultModelForProvider(provider));
    if (!model) throw new Error(`Unknown assistant model: ${provider}/${modelId}`);
    return model;
  }

  private async modelOptions(): Promise<AssistantModelOption[]> {
    try {
      const runtime = await this.runtime();
      return ASSISTANT_MODEL_OPTIONS.map((option) => {
        const model = runtime.getModel(providerToPiProvider(option.provider), option.id);
        return {
          provider: option.provider,
          id: option.id,
          name: option.name,
          reasoning: Boolean(model?.reasoning),
          thinkingLevel: option.thinkingLevel,
        };
      });
    } catch {
      const provider = await defaultAssistantProvider();
      return [
        {
          provider,
          id: defaultModelForProvider(provider),
          name: defaultModelForProvider(provider),
          reasoning: false,
          thinkingLevel: ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === defaultModelForProvider(provider))?.thinkingLevel ?? 'off',
        },
      ];
    }
  }

  private buildTools(runtime: AssistantRuntime, threadId: string, onEvent?: (event: AssistantPromptEvent) => void | Promise<void>): any[] {
    const Type = runtime.Type;
    return [
      {
        name: 'list_drones',
        label: 'List drones',
        description: 'List all drones visible to the hub, including their ids, names, groups, status, repos, and chats.',
        parameters: Type.Object({}),
        execute: async () => {
          const drones = this.filterDronesForScope(await this.tools.listDrones(), threadId);
          return {
            content: [{ type: 'text', text: JSON.stringify({ drones }, null, 2) }],
            details: { drones },
          };
        },
      },
      {
        name: 'get_current_context',
        label: 'Get current context',
        description:
          'Read current Drone Hub UI context, including the active/open drone and chat plus recently active drone chats.',
        parameters: Type.Object({}),
        execute: async () => {
          const context = {
            app: this.scopedAppContext(threadId),
            accessScope: this.activeAccessScope(threadId),
            recentChats: await recentChatActivity(8, this.allowedDroneIdSet('read', threadId)),
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
            details: context,
          };
        },
      },
      {
        name: 'assistant_files',
        label: 'Assistant files',
        description:
          'Maintain private Markdown or text artifacts for this assistant thread. Drones cannot read or write these files. Use action=list/read/write/append/patch/delete. Patch applies exact oldText to newText replacements and can include baseRevision from read.',
        parameters: Type.Object({
          action: Type.String({ description: 'One of: list, read, write, append, patch, delete.' }),
          path: Type.Optional(Type.String({ description: 'Thread-local artifact path, such as status.md or notes/architecture.md.' })),
          content: Type.Optional(Type.String({ description: 'File content for write or text to append for append.' })),
          baseRevision: Type.Optional(Type.String({ description: 'Optional revision from read/list. When provided, stale writes or patches are rejected.' })),
          patches: Type.Optional(
            Type.Array(
              Type.Object({
                oldText: Type.String({ description: 'Exact text to replace. Must occur exactly once.' }),
                newText: Type.String({ description: 'Replacement text.' }),
              }),
            ),
          ),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const result = await runAssistantArtifactAction(threadId, params ?? {});
          const action = String(params?.action ?? '').trim().toLowerCase();
          const file = (result as any)?.file;
          const files = Array.isArray((result as any)?.files) ? (result as any).files : null;
          const summary = files
            ? `${files.length} assistant artifact file${files.length === 1 ? '' : 's'}.`
            : file
              ? `${action || 'Updated'} ${file.path} (${file.size} bytes, revision ${file.revision}).`
              : action === 'delete'
                ? `${(result as any)?.deleted ? 'Deleted' : 'No existing file at'} ${(result as any)?.path ?? params?.path ?? ''}.`
                : 'Assistant artifact action completed.';
          return {
            content: [{ type: 'text', text: summary }],
            details: result,
          };
        },
      },
      {
        name: 'inspect_drone',
        label: 'Inspect drone',
        description: 'Inspect one drone by id or name from the hub drone list.',
        parameters: Type.Object({
          drone: Type.String({ description: 'Drone id or visible name.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const needle = String(params?.drone ?? '').trim().toLowerCase();
          const drones = this.filterDronesForScope(await this.tools.listDrones(), threadId);
          const drone =
            drones.find((item) => item.id.toLowerCase() === needle) ??
            drones.find((item) => item.name.toLowerCase() === needle);
          if (!drone) throw new Error(`Unknown drone: ${params?.drone ?? ''}`);
          return {
            content: [{ type: 'text', text: JSON.stringify({ drone }, null, 2) }],
            details: { drone },
          };
        },
      },
      {
        name: 'list_files',
        label: 'List files',
        description: 'List files and folders in one drone. Requires assistant read access to that drone.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          path: Type.Optional(Type.String({ description: 'Directory path. Relative paths resolve inside the drone workspace.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const listFiles = this.requireFileCallback('listDroneFiles');
          const rawPath = cleanOptionalString(params?.path);
          const result = await listFiles({ droneId, path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'read_file',
        label: 'Read file',
        description: 'Read a UTF-8 text file from one drone. Requires assistant read access to that drone.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          path: Type.String({ description: 'File path. Relative paths resolve inside the drone workspace.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const filePath = normalizeAssistantDroneFilePath(params?.path);
          const readFile = this.requireFileCallback('readDroneFile');
          const result = await readFile({ droneId, path: filePath });
          return {
            content: [{ type: 'text', text: result.content }],
            details: result,
          };
        },
      },
      {
        name: 'search_files',
        label: 'Search files',
        description: 'Search text files in one drone without reading whole files. Requires assistant read access to that drone.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          query: Type.String({ description: 'Text to search for.' }),
          path: Type.Optional(Type.String({ description: 'Directory path to search. Relative paths resolve inside the drone workspace.' })),
          limit: Type.Optional(Type.Number({ description: 'Maximum matches. Defaults to 20, max 100.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const query = cleanOptionalString(params?.query);
          if (!query) throw new Error('missing query');
          const searchFiles = this.requireFileCallback('searchDroneFiles');
          const limitRaw = Number(params?.limit);
          const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
          const rawPath = cleanOptionalString(params?.path);
          const result = await searchFiles({
            droneId,
            query,
            path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined,
            limit,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'find_files',
        label: 'Find files',
        description:
          'Find file and directory paths in one drone by glob-like pattern or substring. Requires assistant read access to that drone.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          pattern: Type.Optional(Type.String({ description: 'Glob-like pattern or substring, such as *.ts, src/**/*.tsx, or package.json. Defaults to *.' })),
          path: Type.Optional(Type.String({ description: 'Directory path to search. Relative paths resolve inside the drone workspace.' })),
          limit: Type.Optional(Type.Number({ description: 'Maximum matches. Defaults to 100, max 500.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const findFiles = this.requireFileCallback('findDroneFiles');
          const limitRaw = Number(params?.limit);
          const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
          const rawPath = cleanOptionalString(params?.path);
          const pattern = cleanOptionalString(params?.pattern) || '*';
          const result = await findFiles({
            droneId,
            pattern,
            path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined,
            limit,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'write_file',
        label: 'Write file',
        description:
          'Create or overwrite a UTF-8 text file in one drone. Requires assistant write access to that drone. Prefer apply_patch for code edits.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          path: Type.String({ description: 'File path. Relative paths resolve inside the drone workspace.' }),
          content: Type.String({ description: 'Full UTF-8 text content to write.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
          const filePath = normalizeAssistantDroneFilePath(params?.path);
          const writeFile = this.requireFileCallback('writeDroneFile');
          const result = await writeFile({ droneId, path: filePath, content: String(params?.content ?? '') });
          return {
            content: [{ type: 'text', text: `Wrote ${result.path} (${result.size ?? 0} bytes).` }],
            details: result,
          };
        },
      },
      {
        name: 'bash',
        label: 'Run bash',
        description:
          'Run a non-interactive bash command in one container drone. Requires assistant write access and user approval. Use for tests, builds, and command-line inspection.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          command: Type.String({ description: 'Bash command to run. Do not use for interactive or background processes.' }),
          cwd: Type.Optional(Type.String({ description: 'Working directory. Relative paths resolve inside the drone workspace.' })),
          timeoutMs: Type.Optional(Type.Number({ description: `Timeout in milliseconds. Defaults to ${ASSISTANT_BASH_DEFAULT_TIMEOUT_MS}, max ${ASSISTANT_BASH_MAX_TIMEOUT_MS}.` })),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
          const command = String(params?.command ?? '');
          if (!command.trim()) throw new Error('missing command');
          const rawCwd = cleanOptionalString(params?.cwd);
          const runBash = this.requireFileCallback('runDroneBash');
          const result = await runBash({
            droneId,
            command,
            cwd: rawCwd ? normalizeAssistantDroneFilePath(rawCwd) : undefined,
            timeoutMs: clampAssistantBashTimeout(params?.timeoutMs),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'apply_patch',
        label: 'Apply patch',
        description:
          'Apply an OpenCode-style patch envelope to files in one drone. Supports Add File, Update File, Delete File, and Move to. Requires assistant write access to that drone.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          patch: Type.String({ description: 'Patch envelope beginning with *** Begin Patch and ending with *** End Patch.' }),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId: string, params: any) => {
          const result = await this.applyDronePatch(threadId, params ?? {});
          return {
            content: [{ type: 'text', text: `Applied ${result.operations.length} patch operation${result.operations.length === 1 ? '' : 's'} to ${result.droneId}.` }],
            details: result,
          };
        },
      },
      {
        name: 'get_chat_overview',
        label: 'Get chat overview',
        description:
          'Read a lightweight overview of drone chats, including message counts, queued/running user messages, failed messages, and latest message text.',
        parameters: Type.Object({
          droneId: Type.Optional(Type.String({ description: 'Optional drone id or visible name.' })),
          chatName: Type.Optional(Type.String({ description: 'Optional chat name.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const overview = await getChatOverviewScoped({ ...(params ?? {}), allowedDroneIds: this.allowedDroneIdSet('read', threadId) });
          return {
            content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }],
            details: overview,
          };
        },
      },
      {
        name: 'read_chat_messages',
        label: 'Read chat messages',
        description:
          'Read a paginated unified timeline of user and agent messages for a drone chat. Pending or queued user messages are included in the same timeline with their status.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          chatName: Type.Optional(Type.String({ description: 'Chat name. Defaults to default.' })),
          cursor: Type.Optional(Type.String({ description: 'Cursor returned by an earlier page.' })),
          direction: Type.Optional(Type.String({ description: 'older or newer. Defaults to latest page when cursor is omitted.' })),
          limit: Type.Optional(Type.Number({ description: `Messages to read. Defaults to ${CHAT_MESSAGE_DEFAULT_LIMIT}, max ${CHAT_MESSAGE_MAX_LIMIT}.` })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const page = await readChatMessagePage({
            droneId,
            chatName: normalizeChatNameForAssistant(params?.chatName),
            cursor: params?.cursor,
            direction: params?.direction,
            limit: params?.limit,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
            details: page,
          };
        },
      },
      {
        name: 'search_chat_messages',
        label: 'Search chat messages',
        description: 'Search user and agent messages across drone chats without reading full chat histories.',
        parameters: Type.Object({
          query: Type.String({ description: 'Text to search for.' }),
          droneId: Type.Optional(Type.String({ description: 'Optional drone id or visible name.' })),
          chatName: Type.Optional(Type.String({ description: 'Optional chat name.' })),
          limit: Type.Optional(Type.Number({ description: `Maximum matches. Defaults to ${CHAT_MESSAGE_DEFAULT_LIMIT}, max ${CHAT_MESSAGE_MAX_LIMIT}.` })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const result = await searchChatMessagesScoped({ ...(params ?? {}), allowedDroneIds: this.allowedDroneIdSet('read', threadId) });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'subscribe_to_chats_idle',
        label: 'Subscribe to chats idle',
        description:
          'Subscribe to one or more drone chats becoming idle. This returns immediately so you can continue other work; if you end your turn, the system will resume this assistant thread when all targets are idle.',
        parameters: Type.Object({
          targets: Type.Array(
            Type.Object({
              droneId: Type.String({ description: 'Drone id or visible name.' }),
              chatName: Type.Optional(Type.String({ description: 'Chat name. Defaults to default.' })),
            }),
            { minItems: 1, maxItems: CHAT_IDLE_MAX_TARGETS },
          ),
          idleForMs: Type.Optional(Type.Number({ description: `Require all targets to remain idle for this long before returning. Defaults to ${CHAT_IDLE_DEFAULT_IDLE_FOR_MS}.` })),
        }),
        execute: async (toolCallId: string, params: any) => {
          const rawTargets = Array.isArray(params?.targets) ? params.targets : [];
          if (rawTargets.length === 0) throw new Error('missing targets');
          const targets: AssistantChatIdleTarget[] = [];
          const seen = new Set<string>();
          for (const rawTarget of rawTargets.slice(0, CHAT_IDLE_MAX_TARGETS)) {
            const droneId = await this.requireDroneInScope(rawTarget?.droneId, 'read', threadId);
            const chatName = normalizeChatNameForAssistant(rawTarget?.chatName);
            const key = `${droneId}\u0000${chatName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            targets.push({ droneId, chatName });
          }
          if (targets.length === 0) throw new Error('missing targets');
          const subscription = await this.subscribeToChatsIdle({
            threadId,
            toolCallId,
            targets,
            idleForMs: params?.idleForMs,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Subscribed to ${subscription.targets.length} chat${subscription.targets.length === 1 ? '' : 's'} becoming idle. Subscription ${subscription.id} expires at ${subscription.expiresAt}.`,
              },
            ],
            details: { ok: true, subscription },
          };
        },
      },
      {
        name: 'create_drone',
        label: 'Create drone',
        description:
          'Create a new drone. This requires user approval. By default it inherits runtime, repo path, group, agent, and model from the current/open drone and chat; repoBranchSource and remoteBranch can override branch seeding.',
        parameters: Type.Object({
          name: Type.String({ description: 'Display name for the new drone.' }),
          sourceDroneId: Type.Optional(Type.String({ description: 'Optional source drone id or name for inherited defaults. Defaults to the currently open drone.' })),
          group: Type.Optional(Type.String({ description: 'Optional group override. Omit to inherit the source drone group; pass an empty string for no group.' })),
          runtime: Type.Optional(Type.String({ description: 'Optional runtime override: container or host. Omit to inherit from the source drone.' })),
          repoPath: Type.Optional(Type.String({ description: 'Optional repo path override. Omit to inherit source repo path; pass an empty string for a non-repo drone.' })),
          repoBranchSource: Type.Optional(Type.String({ description: 'host or remote. Defaults to host when repoPath is set.' })),
          remoteBranch: Type.Optional(Type.String({ description: 'Remote branch name when repoBranchSource is remote.' })),
          pullHostBranchBeforeCreate: Type.Optional(Type.Boolean({ description: 'Whether to pull the host branch before creating from host branch. Defaults to hub behavior.' })),
          initialMessage: Type.Optional(Type.String({ description: 'Optional first user message to seed into the new drone default chat.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const request = await this.buildCreateDroneRequest(params ?? {}, threadId);
          const result = await this.tools.createDrone(request);
          return {
            content: [
              {
                type: 'text',
                text: `Approved and queued drone ${result.name} (${result.id}) with ${result.runtime} runtime.`,
              },
            ],
            details: result,
          };
        },
      },
      {
        name: 'set_drone_group',
        label: 'Set drone group',
        description: 'Move one or more existing drones to a group, or clear their group. This requires user approval.',
        parameters: Type.Object({
          droneIds: Type.Array(Type.String({ description: 'Drone id or visible name.' }), { minItems: 1 }),
          group: Type.Optional(Type.String({ description: 'Group name. Omit or pass an empty string to clear group.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const regAny: any = await loadRegistry();
          const rawList = Array.isArray(params?.droneIds) ? params.droneIds : [];
          if (rawList.length === 0) throw new Error('missing droneIds');
          const droneIds: string[] = Array.from(new Set(rawList.map((item: any) => droneIdByAssistantRef(regAny, item))));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = droneIds.filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          const group = cleanOptionalString(params?.group) || null;
          const result = await this.tools.setDroneGroup({ droneIds, group });
          return {
            content: [
              {
                type: 'text',
                text: `Approved and updated group for ${result.moved.length} drone${result.moved.length === 1 ? '' : 's'}.`,
              },
            ],
            details: result,
          };
        },
      },
      {
        name: 'message_drone',
        label: 'Send user message to drone',
        description: 'Send a user message to a drone chat. This requires user approval before it runs.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Target drone id.' }),
          chatName: Type.Optional(Type.String({ description: 'Target chat name. Defaults to default.' })),
          message: Type.String({ description: 'User message to send to the target drone chat.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
          const chatName = String(params?.chatName ?? '').trim() || 'default';
          const prompt = String(params?.message ?? params?.prompt ?? '').trim();
          if (!droneId) throw new Error('missing droneId');
          if (!prompt) throw new Error('missing message');
          const result = await this.tools.messageDrone({ droneId, chatName, prompt });
          return {
            content: [
              {
                type: 'text',
                text: `Approved and sent user message to ${droneId}/${chatName}. Message id: ${result.promptId}`,
              },
            ],
            details: { droneId, chatName, messageId: result.promptId, ...result },
          };
        },
      },
    ];
  }

  private async beforeToolCall(
    threadId: string,
    ctx: any,
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string } | undefined> {
    const toolName = String(ctx?.toolCall?.name ?? '').trim();
    if (toolName !== 'message_drone' && toolName !== 'create_drone' && toolName !== 'set_drone_group' && toolName !== 'bash') return undefined;
    if (this.getThread(threadId).autoApprove) return undefined;
    const label =
      toolName === 'create_drone'
        ? 'Create drone'
        : toolName === 'set_drone_group'
          ? 'Set drone group'
          : toolName === 'bash'
            ? 'Run bash in drone'
            : 'Send message to drone';
    let approvalArgs = ctx?.args ?? {};
    if (toolName === 'bash') {
      const drones = await this.tools.listDrones();
      const rawDroneId = cleanOptionalString(ctx?.args?.droneId);
      const scopedDroneId = await this.requireDroneInScope(rawDroneId, 'write', threadId);
      const drone =
        drones.find((item) => item.id === scopedDroneId) ??
        drones.find((item) => item.name === rawDroneId) ??
        null;
      if (drone && String(drone.runtime ?? '').trim() !== 'container') {
        return { block: true, reason: `bash is only supported for container drones: ${drone.name}` };
      }
      const cwd = cleanOptionalString(ctx?.args?.cwd);
      approvalArgs = {
        requested: ctx?.args ?? {},
        resolved: {
          droneId: drone?.id ?? scopedDroneId,
          droneName: drone?.name ?? scopedDroneId,
          command: String(ctx?.args?.command ?? ''),
          ...(cwd ? { cwd: normalizeAssistantDroneFilePath(cwd) } : {}),
          timeoutMs: clampAssistantBashTimeout(ctx?.args?.timeoutMs),
        },
      };
    } else {
      try {
        if (toolName === 'create_drone') {
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolvedRequest: await this.buildCreateDroneRequest(ctx?.args ?? {}, threadId),
          };
        } else if (toolName === 'set_drone_group') {
          const regAny: any = await loadRegistry();
          const rawList = Array.isArray(ctx?.args?.droneIds) ? ctx.args.droneIds : [];
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const droneIds: string[] = Array.from(new Set(rawList.map((item: any) => droneIdByAssistantRef(regAny, item))));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = droneIds.filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: {
              drones: droneIds.map((id) => ({ id, name: droneNameById.get(id) ?? id })),
              group: cleanOptionalString(ctx?.args?.group) || null,
            },
          };
        } else if (toolName === 'message_drone') {
          const drones = await this.tools.listDrones();
          const rawDroneId = cleanOptionalString(ctx?.args?.droneId);
          const scopedDroneId = await this.requireDroneInScope(rawDroneId, 'write', threadId);
          const drone =
            drones.find((item) => item.id === scopedDroneId) ??
            drones.find((item) => item.name === rawDroneId) ??
            null;
          const droneId = drone?.id ?? scopedDroneId;
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: {
              droneId,
              droneName: drone?.name ?? droneId,
              chatName: normalizeChatNameForAssistant(ctx?.args?.chatName),
              message: cleanOptionalString(ctx?.args?.message ?? ctx?.args?.prompt),
            },
          };
        }
      } catch {
        approvalArgs = ctx?.args ?? {};
      }
    }
    const approval = await this.requestApproval({
      threadId,
      toolCallId: String(ctx?.toolCall?.id ?? '').trim(),
      toolName,
      label,
      args: approvalArgs,
      onEvent,
      signal,
    });
    if (approval) return undefined;
    return { block: true, reason: `User denied ${toolName}.` };
  }

  private async requestApproval(input: {
    threadId: string;
    toolCallId: string;
    toolName: string;
    label: string;
    args: any;
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const approvalId = makeAssistantId('approval');
    const approval: AssistantApproval = {
      id: approvalId,
      threadId: input.threadId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      label: input.label,
      args: sanitizeMessage(input.args),
      createdAt: nowIso(),
      status: 'pending',
    };
    const thread = this.getThread(input.threadId);
    thread.status = 'waiting_for_approval';
    await new Promise<void>((resolve) => {
      const entry = {
        ...approval,
        resolve: (approved: boolean) => {
          approval.status = approved ? 'approved' : 'denied';
          thread.status = 'running';
          resolve();
        },
      };
      this.approvals.set(approvalId, entry);
      void input.onEvent?.({ type: 'approval_pending', approval, snapshot: this.snapshotSyncFallback() });
      if (input.signal) {
        input.signal.addEventListener(
          'abort',
          () => {
            if (!this.approvals.has(approvalId)) return;
            this.approvals.delete(approvalId);
            entry.resolve(false);
          },
          { once: true },
        );
      }
    });
    return approval.status === 'approved';
  }

  private snapshotSyncFallback(): AssistantSnapshot {
    const streamingMessage = this.streamingMessages.get(this.activeThreadId);
    return {
      ok: true,
      activeThreadId: this.activeThreadId,
      threads: this.threads.map((thread) => ({ ...thread, messages: thread.messages.map(sanitizeMessage) })),
      chatIdleSubscriptions: this.chatIdleSubscriptions.map(sanitizeChatIdleSubscription),
      pendingApprovals: this.pendingApprovals(),
      models: [],
      accessScope: sanitizeMessage(this.activeAccessScope()),
      runningModels: Object.fromEntries([...this.runningModels.entries()].map(([threadId, model]) => [threadId, sanitizeMessage(model)])),
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage) } : {}),
    };
  }

  private pendingApprovals(): AssistantApproval[] {
    return [...this.approvals.values()].map((approval) => ({
      id: approval.id,
      threadId: approval.threadId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      label: approval.label,
      args: sanitizeMessage(approval.args),
      createdAt: approval.createdAt,
      status: approval.status,
    }));
  }

  private systemPromptSettingsSync(): AssistantSystemPromptSettings {
    const prompt = normalizeAssistantSystemPrompt(this.defaultSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    return {
      ok: true,
      assistantSystemPrompt: {
        prompt,
        promptSource: prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings',
        updatedAt: prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : this.defaultSystemPromptUpdatedAt,
        defaultPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
        maxPromptChars: ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
        runtimeAppendix: ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX,
      },
    };
  }

  private systemPrompt(threadId?: string): string {
    const thread = threadId ? this.threads.find((item) => item.id === threadId) : null;
    const accessScope = this.activeAccessScope(threadId);
    const readScope = accessScope.readMode === 'selected' ? `selected drones (${accessScope.droneIds.join(', ')})` : 'all drones';
    const writeScope = accessScope.writeMode === 'selected' ? `selected drones (${accessScope.droneIds.join(', ')})` : 'all drones';
    const scopeText = `Current access scope: read=${readScope}; write=${writeScope}. Do not claim read or write access outside those scopes.`;
    const basePrompt = normalizeAssistantSystemPrompt(thread?.systemPrompt) || this.defaultSystemPrompt;
    return [basePrompt, scopeText].join('\n\n');
  }
}
