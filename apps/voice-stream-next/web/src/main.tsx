import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react';
import QRCode from 'qrcode';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from '../../server/src/approval-code.js';
import {
  approvalRecognizerOptions,
  VOICE_APPROVAL_SETTINGS_DEFAULT,
} from '../../server/src/voice-approval-settings.js';
import { createClerkClient, createDevClient, readDevUser } from './apiClient.js';
import type {
  ApiClient,
  AssistantApprovalRecord,
  AssistantArtifactRecord,
  AssistantMessage,
  AssistantQueuedPromptRecord,
  AssistantSnapshot,
  AssistantThread,
  AssistantThreadView,
  DashboardData,
  DashboardView,
  DesktopVoskStatus,
  DesktopVoskText,
  DeviceRecord,
  VoiceApprovalFormState,
  VoiceSettings,
} from './dashboardTypes.js';
import { timeLabel } from './time.js';
import { TranscriptPanel } from './TranscriptPanel.js';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const desktopDeviceStorageKey = 'voiceStreamNext.desktopDevice';

declare global {
  interface Window {
    voiceStreamDesktop?: {
      isDesktop?: boolean;
      writeClipboard?: (text: string) => void;
      voskStatus?: () => Promise<DesktopVoskStatus>;
      startVosk?: () => Promise<DesktopVoskStatus>;
      stopVosk?: () => Promise<DesktopVoskStatus>;
      resetVosk?: () => Promise<DesktopVoskStatus>;
      sendVoskFrame?: (frame: ArrayBuffer) => void;
      onVoskStatus?: (callback: (status: DesktopVoskStatus) => void) => () => void;
      onVoskText?: (callback: (result: DesktopVoskText) => void) => () => void;
    };
  }
}

function codeValue(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

function safeJsonText(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function messageRoleLabel(message: AssistantMessage): string {
  if (message.role === 'assistant') return 'Assistant';
  if (message.role === 'toolResult') return message.toolName ? `Tool: ${message.toolName}` : 'Tool';
  if (message.role === 'system') return 'System';
  return 'You';
}

function speakAssistantText(text: string): void {
  const clean = text.trim();
  if (!clean || typeof window.speechSynthesis === 'undefined' || typeof window.SpeechSynthesisUtterance === 'undefined') return;
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(clean);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function toolActivitySummary(message: AssistantMessage): { title: string; detail: string; block?: string; status?: string } | null {
  if (message.role === 'toolResult') {
    const result = safeJsonText(message.contentJson);
    return {
      title: message.isError ? 'Tool failed' : 'Tool completed',
      detail: message.toolName ?? 'tool',
      block: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      status: message.isError ? 'error' : 'done',
    };
  }
  const parsed = safeJsonText(message.contentJson);
  const calls = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && ['modelToolCall', 'toolCall'].includes(String((item as any).type))) : [];
  if (calls.length === 0) return null;
  const call = calls[0] as Record<string, unknown>;
  return {
    title: 'Tool requested',
    detail: String(call.name ?? 'tool'),
    block: JSON.stringify(call.arguments ?? {}, null, 2),
    status: 'pending',
  };
}

function ToolActivityMessage({ message }: { message: AssistantMessage }) {
  const summary = toolActivitySummary(message);
  if (!summary) {
    return (
      <article className={`assistant-message ${message.role}`}>
        <div className="assistant-message-role">{messageRoleLabel(message)}</div>
        <p>{message.content}</p>
        {message.spokenText ? <small>Spoken reply ready</small> : null}
      </article>
    );
  }
  return (
    <article className={`assistant-tool-activity ${summary.status ?? ''}`}>
      <div>
        <span className="assistant-tool-activity-dot" />
        <strong>{summary.title}</strong>
        <small>{summary.detail} · {timeLabel(message.createdAt)}</small>
      </div>
      {message.content ? <p>{message.content}</p> : null}
      {summary.block ? <pre>{summary.block}</pre> : null}
    </article>
  );
}

function approvalSummary(approval: AssistantApprovalRecord): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  blockLabel?: string;
  block?: string;
} {
  const args = (approval.args && typeof approval.args === 'object' ? approval.args : safeJsonText(approval.argsJson)) as Record<string, unknown>;
  if (approval.toolName === 'assistant_artifacts') {
    const action = String(args.action ?? '').trim();
    const artifactPath = String(args.path ?? '').trim();
    const content = String(args.content ?? '').trim();
    return {
      title: action === 'delete' ? 'Delete artifact' : action === 'read' ? 'Read artifact' : action === 'append' ? 'Append artifact' : 'Write artifact',
      rows: [
        ...(action ? [{ label: 'Action', value: action }] : []),
        ...(artifactPath ? [{ label: 'Path', value: artifactPath }] : []),
      ],
      blockLabel: content ? 'Content' : undefined,
      block: content,
    };
  }
  if (approval.toolName === 'speak') {
    return {
      title: 'Speak reply',
      rows: [],
      blockLabel: 'Text',
      block: String(args.text ?? '').trim(),
    };
  }
  if (approval.toolName === 'update_system_prompt') {
    return {
      title: 'Update system prompt',
      rows: [],
      blockLabel: 'Prompt',
      block: String(args.prompt ?? '').trim(),
    };
  }
  if (approval.toolName === 'set_thinking_level') {
    return {
      title: 'Set thinking level',
      rows: [{ label: 'Level', value: String(args.thinkingLevel ?? 'off') }],
    };
  }
  return {
    title: approval.label || 'Approval required',
    rows: [],
    blockLabel: 'Arguments',
    block: JSON.stringify(args, null, 2),
  };
}

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'delta'; delta: string }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'approval_pending'; snapshot: AssistantSnapshot }
  | { type: 'done'; snapshot: AssistantSnapshot }
  | { type: 'error'; error: string; snapshot?: AssistantSnapshot }
  | { type: string; [key: string]: unknown };

function upsertMessage(messages: AssistantMessage[], message: AssistantMessage): AssistantMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((entry) => entry.id === message.id ? message : entry);
}

async function readAssistantEventStream(response: Response, handleEvent: (event: AssistantPromptEvent) => void): Promise<void> {
  if (!response.body) throw new Error('Assistant stream did not include a response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) handleEvent(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const line = buffer.trim();
  if (line) handleEvent(JSON.parse(line));
}

function AppShell({ client, identitySlot }: { client: ApiClient; identitySlot: React.ReactNode }) {
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [assistantSnapshotData, setAssistantSnapshotData] = React.useState<AssistantSnapshot | null>(null);
  const [activeView, setActiveView] = React.useState<DashboardView>('threads');
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(true);
  const [threadFilter, setThreadFilter] = React.useState<'all' | 'normal' | 'voice'>('all');
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [streamingReply, setStreamingReply] = React.useState('');
  const [artifacts, setArtifacts] = React.useState<AssistantArtifactRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = React.useState<AssistantArtifactRecord | null>(null);
  const [artifactPathDraft, setArtifactPathDraft] = React.useState('');
  const [artifactContentDraft, setArtifactContentDraft] = React.useState('');
  const [artifactDirty, setArtifactDirty] = React.useState(false);
  const [overviewModalOpen, setOverviewModalOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [threadTitleDraft, setThreadTitleDraft] = React.useState('');
  const [deviceName, setDeviceName] = React.useState('Desktop dev client');
  const [deviceType, setDeviceType] = React.useState('desktop');
  const [pairingText, setPairingText] = React.useState('');
  const [pairingQr, setPairingQr] = React.useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = React.useState<string | null>(null);
  const [pairingDeviceId, setPairingDeviceId] = React.useState<string | null>(null);
  const [approvalSettings, setApprovalSettings] = React.useState<VoiceApprovalFormState>(VOICE_APPROVAL_SETTINGS_DEFAULT);
  const settingsHydratedRef = React.useRef(false);
  const assistantEventRefreshTimerRef = React.useRef<number | null>(null);

  const assistantThreads = assistantSnapshotData?.threads ?? dashboard?.threads ?? [];
  const activeThread =
    assistantThreads.find((thread) => thread.id === activeThreadId) ??
    assistantThreads[0] ??
    null;
  React.useEffect(() => {
    setThreadTitleDraft(activeThread?.title ?? '');
  }, [activeThread?.id, activeThread?.title]);
  const hydrateArtifactDraft = React.useCallback((artifact: AssistantArtifactRecord | null) => {
    setSelectedArtifact(artifact);
    setArtifactPathDraft(artifact?.path ?? '');
    setArtifactContentDraft(artifact?.content ?? '');
    setArtifactDirty(false);
  }, []);

  const loadAssistantSnapshot = React.useCallback(
    async (preferredThreadId?: string | null) => {
      const query = preferredThreadId ? `?activeThreadId=${encodeURIComponent(preferredThreadId)}` : '';
      const snapshot = await client.request<AssistantSnapshot>(`/api/assistant/threads${query}`);
      setAssistantSnapshotData(snapshot);
      const nextThreadId = snapshot.activeThreadId ?? snapshot.threads[0]?.id ?? null;
      if (!activeThreadId && nextThreadId) setActiveThreadId(nextThreadId);
      const visibleThreadId = preferredThreadId ?? activeThreadId ?? nextThreadId;
      const visibleThread = snapshot.threads.find((thread) => thread.id === visibleThreadId) ?? snapshot.threads[0] ?? null;
      if (visibleThread) setMessages(visibleThread.messages);
      return snapshot;
    },
    [activeThreadId, client],
  );

  const loadDashboard = React.useCallback(async () => {
    setError(null);
    try {
      const data = await client.request<DashboardData>('/api/dashboard');
      setDashboard(data);
      await loadAssistantSnapshot(activeThreadId);
      if (!settingsHydratedRef.current) {
        setApprovalSettings({
          triggerPhrase: data.settings.triggerPhrase,
          unlockCode: data.settings.unlockCode,
          lockCode: data.settings.lockCode,
          lockedOffCode: data.settings.lockedOffCode,
          minDigits: data.settings.minDigits,
          maxDigits: data.settings.maxDigits,
          stableMs: data.settings.stableMs,
          collectTimeoutMs: data.settings.collectTimeoutMs,
          duplicateCooldownMs: data.settings.duplicateCooldownMs,
          finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
          postPromptCommandSuppressionMs: data.settings.postPromptCommandSuppressionMs,
        });
        settingsHydratedRef.current = true;
      }
      if (!activeThreadId && data.threads[0]) setActiveThreadId(data.threads[0].id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [activeThreadId, client, loadAssistantSnapshot]);

  const scheduleAssistantEventRefresh = React.useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    if (assistantEventRefreshTimerRef.current !== null) window.clearTimeout(assistantEventRefreshTimerRef.current);
    assistantEventRefreshTimerRef.current = window.setTimeout(() => {
      assistantEventRefreshTimerRef.current = null;
      void loadDashboard();
    }, 160);
  }, [loadDashboard]);

  const loadMessages = React.useCallback(
    async (threadId: string | null) => {
      if (!threadId) {
        setMessages([]);
        return;
      }
      try {
        const data = await client.request<{ ok: true; messages: AssistantMessage[] }>(
          `/api/assistant/threads/${encodeURIComponent(threadId)}/messages`,
        );
        setMessages(data.messages);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    },
    [client],
  );

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  React.useEffect(() => {
    void loadMessages(activeThread?.id ?? null);
  }, [activeThread?.id, loadMessages]);

  React.useEffect(() => {
    void loadArtifacts(activeThread?.id ?? null);
  }, [activeThread?.id]);

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void loadDashboard();
    };
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [loadDashboard]);

  React.useEffect(() => {
    if (typeof window.EventSource === 'undefined') return undefined;
    let closed = false;
    const source = new window.EventSource('/api/assistant/events');
    const refresh = () => {
      if (closed) return;
      scheduleAssistantEventRefresh();
    };
    source.onopen = refresh;
    source.onmessage = refresh;
    source.addEventListener('connected', refresh);
    source.addEventListener('assistant_change', refresh);
    source.addEventListener('assistant_speak', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (text) speakAssistantText(text);
        refresh();
      } catch {
        // Ignore malformed assistant speech events.
      }
    });
    source.onerror = () => {
      if (closed) return;
      source.close();
    };
    return () => {
      closed = true;
      source.close();
      if (assistantEventRefreshTimerRef.current !== null) {
        window.clearTimeout(assistantEventRefreshTimerRef.current);
        assistantEventRefreshTimerRef.current = null;
      }
    };
  }, [scheduleAssistantEventRefresh]);

  React.useEffect(() => {
    const threadId = activeThread?.id ?? null;
    if (!threadId) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void loadMessages(threadId);
    };
    const timer = window.setInterval(refresh, 2500);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [activeThread?.id, loadMessages]);

  async function createThread(options: { voiceEnabled?: boolean } = {}) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>('/api/assistant/threads', {
        method: 'POST',
        body: JSON.stringify({
          title: options.voiceEnabled ? 'Voice thread' : 'Assistant thread',
          source: options.voiceEnabled ? 'voice' : 'web',
          voiceEnabled: Boolean(options.voiceEnabled),
        }),
      });
      setActiveThreadId(data.thread.id);
      setAssistantSnapshotData(data.snapshot);
      if (options.voiceEnabled) setThreadFilter('voice');
      await loadDashboard();
      setNotice(options.voiceEnabled ? 'Created voice assistant thread.' : 'Created assistant thread.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = messageDraft.trim();
    if (!activeThread || !content) return;
    setBusy(true);
    setError(null);
    setStreamingReply('');
    try {
      const response = await client.stream(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stream`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: content }),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { error: text };
        }
        throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
      }
      setMessageDraft('');
      await readAssistantEventStream(response, (promptEvent) => {
        if (promptEvent.type === 'delta') {
          setStreamingReply((current) => `${current}${String(promptEvent.delta ?? '')}`);
          return;
        }
        if (promptEvent.type === 'message' && promptEvent.message) {
          setMessages((current) => upsertMessage(current, promptEvent.message as AssistantMessage));
          return;
        }
        if ((promptEvent.type === 'snapshot' || promptEvent.type === 'approval_pending' || promptEvent.type === 'queued' || promptEvent.type === 'done') && promptEvent.snapshot) {
          const snapshot = promptEvent.snapshot as AssistantSnapshot;
          setAssistantSnapshotData(snapshot);
          const visibleThread = snapshot.threads.find((thread) => thread.id === activeThread.id);
          if (visibleThread) setMessages(visibleThread.messages);
          if (promptEvent.type === 'done') setStreamingReply('');
          return;
        }
        if (promptEvent.type === 'error') {
          throw new Error(String(promptEvent.error ?? 'Assistant stream failed'));
        }
      });
      await Promise.all([loadAssistantSnapshot(activeThread.id), loadDashboard()]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setStreamingReply('');
      setBusy(false);
    }
  }

  async function updateThreadSettings(patch: Partial<AssistantThread>) {
    if (!activeThread) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Updated assistant thread.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function renameActiveThread() {
    const nextTitle = threadTitleDraft.trim();
    if (!activeThread || !nextTitle || nextTitle === activeThread.title) return;
    await updateThreadSettings({ title: nextTitle });
  }

  async function deleteThread(threadId: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}`,
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      const nextThreadId = data.snapshot.activeThreadId ?? data.snapshot.threads[0]?.id ?? null;
      setActiveThreadId(nextThreadId);
      const visibleThread = data.snapshot.threads.find((thread) => thread.id === nextThreadId) ?? null;
      setMessages(visibleThread?.messages ?? []);
      setNotice('Deleted assistant thread.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueuedPrompt(queuedPrompt: AssistantQueuedPromptRecord) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(queuedPrompt.threadId)}/queued/${encodeURIComponent(queuedPrompt.id)}`,
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Cancelled queued prompt.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(approvalId: string, approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/approvals/${encodeURIComponent(approvalId)}/${approved ? 'approve' : 'deny'}`,
        { method: 'POST', body: '{}' },
      );
      setAssistantSnapshotData(data.snapshot);
      const visibleThread = data.snapshot.threads.find((thread) => thread.id === activeThread?.id);
      if (visibleThread) setMessages(visibleThread.messages);
      await loadDashboard();
      setNotice(approved ? 'Approved assistant tool call.' : 'Denied assistant tool call.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function generateOverview(force = true) {
    if (!activeThread) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/overview`,
        { method: 'POST', body: JSON.stringify({ force }) },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice(force ? 'Regenerated thread overview.' : 'Loaded cached thread overview when possible.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopActiveRun() {
    if (!activeThread) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stop`,
        { method: 'POST', body: '{}' },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Stopped active assistant run.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadArtifacts(threadId: string | null) {
    if (!threadId) {
      setArtifacts([]);
      hydrateArtifactDraft(null);
      return;
    }
    try {
      const data = await client.request<{ ok: true; artifacts: AssistantArtifactRecord[] }>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/artifacts`,
      );
      setArtifacts(data.artifacts);
      const nextSelected = data.artifacts.find((artifact) => artifact.path === selectedArtifact?.path) ?? data.artifacts[0] ?? null;
      if (!artifactDirty) hydrateArtifactDraft(nextSelected);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  function newArtifactDraft() {
    hydrateArtifactDraft(null);
    setArtifactPathDraft('notes/new-artifact.md');
    setArtifactContentDraft('');
    setArtifactDirty(true);
  }

  async function saveArtifact() {
    if (!activeThread) return;
    const artifactPath = artifactPathDraft.trim();
    if (!artifactPath) {
      setError('Artifact path is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        artifact: AssistantArtifactRecord;
        artifacts: AssistantArtifactRecord[];
        snapshot: AssistantSnapshot;
      }>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts/file`, {
        method: 'PUT',
        body: JSON.stringify({ path: artifactPath, content: artifactContentDraft }),
      });
      setArtifacts(data.artifacts);
      setAssistantSnapshotData(data.snapshot);
      hydrateArtifactDraft(data.artifact);
      setNotice('Saved assistant artifact.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteArtifact() {
    if (!activeThread || !artifactPathDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; artifacts: AssistantArtifactRecord[]; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts/file`,
        {
          method: 'DELETE',
          body: JSON.stringify({ path: artifactPathDraft.trim() }),
        },
      );
      setArtifacts(data.artifacts);
      setAssistantSnapshotData(data.snapshot);
      hydrateArtifactDraft(data.artifacts[0] ?? null);
      setNotice('Deleted assistant artifact.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyArtifact() {
    await navigator.clipboard?.writeText(artifactContentDraft);
    setNotice('Copied artifact content.');
  }

  function downloadArtifact() {
    const artifactPath = artifactPathDraft.trim() || 'assistant-artifact.txt';
    const blob = new Blob([artifactContentDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = artifactPath.split('/').filter(Boolean).pop() || 'assistant-artifact.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveApprovalSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: VoiceSettings }>('/api/settings/voice-approval', {
        method: 'POST',
        body: JSON.stringify({ settings: approvalSettings }),
      });
      setApprovalSettings({
        triggerPhrase: data.settings.triggerPhrase,
        unlockCode: data.settings.unlockCode,
        lockCode: data.settings.lockCode,
        lockedOffCode: data.settings.lockedOffCode,
        minDigits: data.settings.minDigits,
        maxDigits: data.settings.maxDigits,
        stableMs: data.settings.stableMs,
        collectTimeoutMs: data.settings.collectTimeoutMs,
        duplicateCooldownMs: data.settings.duplicateCooldownMs,
        finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
        postPromptCommandSuppressionMs: data.settings.postPromptCommandSuppressionMs,
      });
      await loadDashboard();
      setNotice('Saved voice approval settings.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateAssistantSettings(patch: Partial<NonNullable<AssistantSnapshot['assistantSettings']>>) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Saved assistant settings.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pairDevice(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        device: DeviceRecord;
        token: string;
        payloadUri: string;
        expiresAt: string;
      }>('/api/pairing/payload', {
        method: 'POST',
        body: JSON.stringify({ deviceType, displayName: deviceName }),
      });
      setPairingText(data.payloadUri);
      setPairingExpiresAt(data.expiresAt);
      setPairingDeviceId(data.device.id);
      setPairingQr(await QRCode.toDataURL(data.payloadUri, { margin: 1, width: 220 }));
      await navigator.clipboard?.writeText(data.payloadUri).catch(() => undefined);
      await loadDashboard();
      setNotice(`Created ${data.device.displayName}. Pairing payload copied when clipboard access was available.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingPayload() {
    if (!pairingText) return;
    await navigator.clipboard?.writeText(pairingText);
    setNotice('Copied pairing payload.');
  }

  async function sharePairingPayload() {
    if (!pairingText) return;
    if (navigator.share) {
      await navigator.share({
        title: 'VoiceStream pairing',
        text: 'Scan or open this VoiceStream pairing payload.',
        url: pairingText,
      });
      setNotice('Shared pairing payload.');
      return;
    }
    await copyPairingPayload();
  }

  async function revokeDevice(deviceId: string) {
    setBusy(true);
    setError(null);
    try {
      await client.request(`/api/devices/${encodeURIComponent(deviceId)}/revoke`, { method: 'POST', body: '{}' });
      if (pairingDeviceId === deviceId) {
        setPairingText('');
        setPairingQr('');
        setPairingExpiresAt(null);
        setPairingDeviceId(null);
      }
      await loadDashboard();
      setNotice('Device revoked.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rotateDeviceToken(deviceId: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        device: DeviceRecord;
        payloadUri?: string;
        expiresAt?: string;
      }>(`/api/devices/${encodeURIComponent(deviceId)}/rotate-token`, {
        method: 'POST',
        body: JSON.stringify({ includePayload: true }),
      });
      if (data.payloadUri) {
        setPairingText(data.payloadUri);
        setPairingExpiresAt(data.expiresAt ?? null);
        setPairingDeviceId(data.device.id);
        setPairingQr(await QRCode.toDataURL(data.payloadUri, { margin: 1, width: 220 }));
        await navigator.clipboard?.writeText(data.payloadUri).catch(() => undefined);
      }
      await loadDashboard();
      setNotice(`Rotated token for ${data.device.displayName}.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendDeviceCommand(deviceId: string, command: 'sleep' | 'off' | 'awake' | 'query_status') {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; delivered: boolean; ack?: { status?: string; mode?: string } }>(
        `/api/devices/${encodeURIComponent(deviceId)}/command`,
        {
          method: 'POST',
          body: JSON.stringify({ command }),
        },
      );
      const detail = data.ack?.status ? ` ${data.ack.status}` : '';
      setNotice(data.delivered ? `Sent ${command}.${detail}` : `Device is offline; ${command} was not delivered.`);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLogs() {
    const text = (dashboard?.logs ?? [])
      .map((log) => `[${log.createdAt}] ${log.level.toUpperCase()} ${log.source}: ${log.message}${log.detailsJson ? ` ${log.detailsJson}` : ''}`)
      .join('\n');
    await navigator.clipboard?.writeText(text);
    setNotice('Copied visible logs.');
  }

  function openThreadFromTranscript(threadId: string) {
    setActiveView('threads');
    setActiveThreadId(threadId);
    setNotice('Opened assistant thread from transcript session.');
  }

  if (loading) {
    return <div className="loading-screen">Loading Voice Stream...</div>;
  }

  if (window.voiceStreamDesktop?.isDesktop) {
    return (
      <main className="desktop-shell">
        <header className="desktop-topbar">
          <div>
            <div className="kicker">Voice Stream</div>
            <h1>Desktop voice</h1>
          </div>
          <div className="identity">{identitySlot}</div>
        </header>

        {error ? <div className="banner error">{error}</div> : null}
        {notice ? <div className="banner notice">{notice}</div> : null}

        <DesktopVoicePanel client={client} onRefresh={loadDashboard} />
      </main>
    );
  }

  const devices = dashboard?.devices ?? [];
  const threads = assistantThreads;
  const normalThreadCount = threads.filter((thread) => !thread.voiceEnabled && thread.source !== 'voice').length;
  const voiceThreadCount = threads.filter((thread) => thread.voiceEnabled || thread.source === 'voice').length;
  const visibleThreads = threads.filter((thread) => {
    if (threadFilter === 'voice') return Boolean(thread.voiceEnabled) || thread.source === 'voice';
    if (threadFilter === 'normal') return !thread.voiceEnabled && thread.source !== 'voice';
    return true;
  });
  const logs = dashboard?.logs ?? [];
  const transcripts = dashboard?.transcripts ?? [];
  const pendingApprovals = assistantSnapshotData?.pendingApprovals ?? [];
  const latestOverview = (activeThread as AssistantThreadView | null)?.latestOverview ?? null;
  const activeRuns = (activeThread as AssistantThreadView | null)?.runs?.filter((run) => run.status === 'running' || run.status === 'waiting_for_approval') ?? [];
  const queuedPrompts = (activeThread as AssistantThreadView | null)?.queuedPrompts ?? [];
  const enabledTools = new Set(activeThread?.enabledTools ?? []);
  const modelValue = `${activeThread?.provider ?? 'openai'}|${activeThread?.model ?? 'gpt-5.2'}|${activeThread?.thinkingLevel ?? 'off'}`;
  const connectedDeviceIds = new Set((dashboard?.clientStatuses ?? []).map((status) => status.deviceId));
  const navItems: Array<{ id: DashboardView; label: string; count?: number }> = [
    { id: 'threads', label: 'Chat', count: threads.length },
    { id: 'devices', label: 'Devices', count: devices.length },
    { id: 'settings', label: 'Settings' },
    { id: 'activity', label: 'Activity', count: transcripts.length + logs.length },
  ];

  return (
    <main className="assistant-dock-shell">
      {threadSidebarOpen ? <aside className="assistant-thread-sidebar">
        <div className="assistant-thread-sidebar-header">
          <div className="assistant-sidebar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 5h16v10H8l-4 4V5Z" />
            </svg>
          </div>
          <div className="assistant-sidebar-title">
            <span>Threads</span>
            <small>{threads.length} assistant</small>
          </div>
          <button
            type="button"
            className="assistant-sidebar-collapse-button"
            onClick={() => setThreadSidebarOpen(false)}
            title="Hide thread sidebar"
            aria-label="Hide thread sidebar"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
              <path d="M20 4v16" />
            </svg>
          </button>
        </div>

        <div className="assistant-thread-sidebar-create">
          <button type="button" onClick={() => void createThread()} disabled={busy}>
            + New Thread
          </button>
          <button type="button" onClick={() => void createThread({ voiceEnabled: true })} disabled={busy}>
            + Voice Thread
          </button>
        </div>

        <div className="assistant-thread-filter" role="group" aria-label="Thread filter">
          <button type="button" className={threadFilter === 'all' ? 'active' : ''} onClick={() => setThreadFilter('all')}>
            All <span>{threads.length}</span>
          </button>
          <button type="button" className={threadFilter === 'normal' ? 'active' : ''} onClick={() => setThreadFilter('normal')}>
            Normal <span>{normalThreadCount}</span>
          </button>
          <button type="button" className={threadFilter === 'voice' ? 'active' : ''} onClick={() => setThreadFilter('voice')}>
            Voice <span>{voiceThreadCount}</span>
          </button>
        </div>

        <div className="assistant-thread-list">
          {visibleThreads.map((thread) => {
            const active = thread.id === activeThread?.id;
            const messageCount = active ? messages.length : 0;
            const queuedCount = (thread as AssistantThreadView).queuedPrompts?.length ?? 0;
            return (
              <button
                key={thread.id}
                type="button"
                className={active ? 'assistant-thread-item active' : 'assistant-thread-item'}
                onClick={() => {
                  setActiveView('threads');
                  setActiveThreadId(thread.id);
                }}
              >
                <div>
                  <span className="assistant-thread-dot" />
                  <strong>{thread.title || 'Untitled thread'}</strong>
                </div>
                <small>
                  {thread.voiceEnabled || thread.source === 'voice' ? 'voice' : 'normal'} · {timeLabel(thread.updatedAt)}
                  {messageCount ? ` · ${messageCount}` : ''}
                  {queuedCount ? ` · ${queuedCount} queued` : ''}
                </small>
              </button>
            );
          })}
          {visibleThreads.length === 0 ? <div className="empty-note">No {threadFilter === 'all' ? 'assistant' : threadFilter} threads yet.</div> : null}
        </div>

        <div className="assistant-sidebar-footer">
          <span>Connected devices</span>
          <strong>{connectedDeviceIds.size}/{devices.length}</strong>
        </div>
      </aside> : null}

      <section className="assistant-dock-main">
        <header className="assistant-dock-toolbar">
          <button
            type="button"
            className={threadSidebarOpen ? 'assistant-sidebar-toggle active' : 'assistant-sidebar-toggle'}
            onClick={() => setThreadSidebarOpen((open) => !open)}
            title={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-label={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-pressed={threadSidebarOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {threadSidebarOpen ? (
                <>
                  <path d="M15 18l-6-6 6-6" />
                  <path d="M20 4v16" />
                </>
              ) : (
                <>
                  <path d="M9 18l6-6-6-6" />
                  <path d="M4 4v16" />
                </>
              )}
            </svg>
          </button>
          <div className="assistant-dock-title">
            <strong>{activeView === 'threads' ? activeThread?.title ?? 'Assistant' : navItems.find((item) => item.id === activeView)?.label}</strong>
            <span>
              <span className="assistant-status-dot" />
              {activeView === 'threads' ? (activeThread ? activeThread.status ?? 'idle' : 'no thread') : 'live'}
            </span>
          </div>

          <div className="assistant-toolbar-actions">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'assistant-toolbar-tab active' : 'assistant-toolbar-tab'}
                onClick={() => setActiveView(item.id)}
              >
                {item.label}
                {typeof item.count === 'number' ? <span>{item.count}</span> : null}
              </button>
            ))}
            {!threadSidebarOpen ? (
              <button
                type="button"
                className="assistant-toolbar-icon-button"
                onClick={() => void createThread()}
                disabled={busy}
                title="New assistant thread"
                aria-label="New assistant thread"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            ) : null}
            <span className="assistant-live-indicator">Live</span>
            {identitySlot ? <div className="assistant-identity">{identitySlot}</div> : null}
          </div>
        </header>

        {error ? <div className="banner error">{error}</div> : null}
        {notice ? <div className="banner notice">{notice}</div> : null}

        <section className="assistant-dock-content">
          {activeView === 'threads' ? (
            <section className="assistant-chat-pane">
              {activeThread ? (
                <div className="assistant-thread-controls">
                  <div className="assistant-control-row assistant-title-row">
                    <label>
                      Title
                      <input
                        value={threadTitleDraft}
                        disabled={busy}
                        onChange={(event) => setThreadTitleDraft(event.currentTarget.value)}
                        onBlur={() => void renameActiveThread()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => void deleteThread(activeThread.id)} disabled={busy}>
                      Delete Thread
                    </button>
                  </div>
                  <div className="assistant-control-row">
                    <label>
                      Model
                      <select
                        value={modelValue}
                        disabled={busy}
                        onChange={(event) => {
                          const [provider, model, thinkingLevel] = event.target.value.split('|');
                          void updateThreadSettings({ provider, model, thinkingLevel });
                        }}
                      >
                        {(assistantSnapshotData?.models ?? []).map((model) => (
                          <option key={`${model.provider}-${model.id}-${model.thinkingLevel}`} value={`${model.provider}|${model.id}|${model.thinkingLevel}`}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Delivery
                      <select
                        value={activeThread.promptDeliveryMode ?? 'queue'}
                        disabled={busy}
                        onChange={(event) => void updateThreadSettings({ promptDeliveryMode: event.target.value === 'asap' ? 'asap' : 'queue' })}
                      >
                        <option value="queue">Queue</option>
                        <option value="asap">ASAP</option>
                      </select>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={Boolean(activeThread.voiceEnabled)}
                        disabled={busy}
                        onChange={(event) => void updateThreadSettings({ voiceEnabled: event.target.checked })}
                      />
                      Spoken replies
                    </label>
                    {activeRuns.length > 0 ? (
                      <button type="button" onClick={() => void stopActiveRun()} disabled={busy}>
                        Stop Run
                      </button>
                    ) : null}
                  </div>

                  <details className="assistant-control-details">
                    <summary>Tools and prompt</summary>
                    <div className="assistant-tool-grid">
                      {(assistantSnapshotData?.availableTools ?? []).map((tool) => (
                        <label key={tool.name} className="assistant-tool-toggle" title={tool.description}>
                          <input
                            type="checkbox"
                            checked={enabledTools.has(tool.name)}
                            disabled={busy}
                            onChange={(event) => {
                              const next = new Set(enabledTools);
                              if (event.target.checked) next.add(tool.name);
                              else next.delete(tool.name);
                              void updateThreadSettings({ enabledTools: [...next] });
                            }}
                          />
                          <span>
                            <strong>{tool.label}</strong>
                            <small>{tool.approval === 'never' ? 'no approval' : tool.approval === 'always' ? 'approval required' : 'approval in normal threads'}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="assistant-system-prompt">
                      Thread system prompt
                      <textarea
                        value={activeThread.systemPrompt ?? ''}
                        disabled={busy}
                        placeholder={assistantSnapshotData?.assistantSettings.normalSystemPrompt ?? 'System prompt'}
                        onBlur={(event) => void updateThreadSettings({ systemPrompt: event.currentTarget.value })}
                        onChange={(event) => {
                          const next = event.currentTarget.value;
                          setAssistantSnapshotData((snapshot) => snapshot
                            ? {
                                ...snapshot,
                                threads: snapshot.threads.map((thread) => thread.id === activeThread.id ? { ...thread, systemPrompt: next } : thread),
                              }
                            : snapshot);
                        }}
                      />
                    </label>
                  </details>
                </div>
              ) : null}

              {activeThread?.error ? (
                <div className="assistant-thread-error">
                  <strong>Assistant error</strong>
                  <span>{activeThread.error}</span>
                </div>
              ) : null}

              {queuedPrompts.length > 0 ? (
                <div className="assistant-queue-strip">
                  <div className="assistant-queue-header">
                    <strong>Queued prompts</strong>
                    <small>{queuedPrompts.length} waiting</small>
                  </div>
                  {queuedPrompts.map((queuedPrompt) => (
                    <article key={queuedPrompt.id} className="assistant-queue-item">
                      <div>
                        <strong>{queuedPrompt.prompt}</strong>
                        <small>
                          {queuedPrompt.provider}/{queuedPrompt.model}
                          {queuedPrompt.thinkingLevel !== 'off' ? ` · ${queuedPrompt.thinkingLevel}` : ''}
                          {' · '}
                          {timeLabel(queuedPrompt.createdAt)}
                        </small>
                      </div>
                      <button type="button" disabled={busy} onClick={() => void cancelQueuedPrompt(queuedPrompt)}>
                        Cancel
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}

              {pendingApprovals.length > 0 ? (
                <div className="assistant-approval-strip">
                  {pendingApprovals.map((approval) => {
                    const summary = approvalSummary(approval);
                    return (
                      <article key={approval.id} className="assistant-approval-card">
                        <div>
                          <strong>{summary.title}</strong>
                          <small>{approval.toolName} · {timeLabel(approval.createdAt)}</small>
                        </div>
                        <div className="assistant-approval-detail">
                          {summary.rows.map((row) => (
                            <div key={row.label} className="assistant-approval-row">
                              <span>{row.label}</span>
                              <strong>{row.value}</strong>
                            </div>
                          ))}
                          {summary.block ? (
                            <pre>
                              {summary.blockLabel ? `${summary.blockLabel}\n` : ''}
                              {summary.block}
                            </pre>
                          ) : null}
                        </div>
                        <div>
                          <button type="button" disabled={busy} onClick={() => void resolveApproval(approval.id, true)}>
                            Approve
                          </button>
                          <button type="button" disabled={busy} onClick={() => void resolveApproval(approval.id, false)}>
                            Deny
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              <div className="assistant-messages">
                {messages.map((message) => (
                  <ToolActivityMessage key={message.id} message={message} />
                ))}
                {streamingReply ? (
                  <article className="assistant-message assistant streaming">
                    <div className="assistant-message-role">Assistant</div>
                    <p>{streamingReply}</p>
                  </article>
                ) : null}
                {activeThread && messages.length === 0 ? <div className="empty-note">This thread is empty.</div> : null}
                {!activeThread ? <div className="empty-note">Create a thread to start.</div> : null}
              </div>

              <form className="assistant-composer" onSubmit={(event) => void sendMessage(event)}>
                <textarea
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  placeholder="Ask the assistant..."
                  disabled={!activeThread || busy}
                />
                <button type="submit" disabled={!activeThread || !messageDraft.trim() || busy}>
                  Send
                </button>
              </form>

              {activeThread ? (
                <div className="assistant-thread-extras">
                  <section className="assistant-panel">
                    <div className="assistant-panel-header">
                      <div>
                        <span className="hub-kicker">Overview</span>
                        <h2>Thread Summary</h2>
                      </div>
                      <div className="assistant-overview-actions">
                        <button type="button" onClick={() => void generateOverview(false)} disabled={busy}>
                          Use Cache
                        </button>
                        <button type="button" onClick={() => void generateOverview(true)} disabled={busy}>
                          Regenerate
                        </button>
                        <button type="button" onClick={() => setOverviewModalOpen(true)} disabled={!latestOverview}>
                          Open
                        </button>
                      </div>
                    </div>
                    {latestOverview ? (
                      <div className="assistant-overview-meta">
                        <span>{latestOverview.cached ? 'cached copy' : 'fresh summary'}</span>
                        <span>{timeLabel(latestOverview.createdAt)}</span>
                      </div>
                    ) : null}
                    <pre className="assistant-overview">{latestOverview?.markdown ?? 'No overview generated yet.'}</pre>
                  </section>
                  <section className="assistant-panel">
                    <div className="assistant-panel-header">
                      <div>
                        <span className="hub-kicker">Artifacts</span>
                        <h2>Assistant Files</h2>
                      </div>
                      <div className="assistant-artifact-actions">
                        <button type="button" onClick={newArtifactDraft} disabled={busy}>
                          New
                        </button>
                        <button type="button" onClick={() => void loadArtifacts(activeThread.id)} disabled={busy}>
                          Refresh
                        </button>
                      </div>
                    </div>
                    <div className="assistant-artifact-layout">
                      <div className="assistant-artifact-list">
                        {artifacts.map((artifact) => (
                          <button
                            key={artifact.id}
                            type="button"
                            className={selectedArtifact?.path === artifact.path ? 'active' : ''}
                            onClick={() => hydrateArtifactDraft(artifact)}
                          >
                            <strong>{artifact.path}</strong>
                            <small>{artifact.size} bytes</small>
                          </button>
                        ))}
                        {artifacts.length === 0 ? <div className="empty-note">No assistant files yet.</div> : null}
                      </div>
                      <div className="assistant-artifact-editor">
                        <label>
                          Path
                          <input
                            value={artifactPathDraft}
                            onChange={(event) => {
                              setArtifactPathDraft(event.target.value);
                              setArtifactDirty(true);
                            }}
                            placeholder="notes/plan.md"
                            disabled={busy}
                          />
                        </label>
                        <textarea
                          value={artifactContentDraft}
                          onChange={(event) => {
                            setArtifactContentDraft(event.target.value);
                            setArtifactDirty(true);
                          }}
                          placeholder="Artifact content..."
                          disabled={busy}
                        />
                        <div className="assistant-artifact-editor-footer">
                          <span>{artifactDirty ? 'Unsaved changes' : selectedArtifact ? `${selectedArtifact.size} bytes` : 'Draft'}</span>
                          <div>
                            <button type="button" onClick={() => void copyArtifact()} disabled={!artifactContentDraft || busy}>
                              Copy
                            </button>
                            <button type="button" onClick={downloadArtifact} disabled={!artifactPathDraft.trim() || busy}>
                              Download
                            </button>
                            <button type="button" onClick={() => void deleteArtifact()} disabled={!selectedArtifact || busy}>
                              Delete
                            </button>
                            <button type="button" onClick={() => void saveArtifact()} disabled={!artifactPathDraft.trim() || busy}>
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === 'devices' ? (
            <section className="assistant-utility-grid">
              <section className="assistant-panel">
                <div className="assistant-panel-header">
                  <div>
                    <span className="hub-kicker">Pairing</span>
                    <h2>Pair Device</h2>
                  </div>
                </div>
                <form className="settings-form" onSubmit={(event) => void pairDevice(event)}>
                  <label>
                    Type
                    <select value={deviceType} onChange={(event) => setDeviceType(event.target.value)}>
                      <option value="desktop">Desktop</option>
                      <option value="android">Android</option>
                    </select>
                  </label>
                  <label>
                    Name
                    <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
                  </label>
                  <button type="submit" disabled={busy || !deviceName.trim()}>
                    Create QR Payload
                  </button>
                </form>
                {pairingText ? (
                  <div className="pairing-payload">
                    <small>Pairing payload</small>
                    {pairingExpiresAt ? <div className="pairing-meta">Expires {timeLabel(pairingExpiresAt)}</div> : null}
                    {pairingQr ? <img src={pairingQr} alt="Device pairing QR" /> : null}
                    <textarea readOnly value={pairingText} onFocus={(event) => event.currentTarget.select()} />
                    <div className="pairing-actions">
                      <button type="button" onClick={() => void copyPairingPayload()}>
                        Copy Payload
                      </button>
                      <button type="button" onClick={() => void sharePairingPayload()}>
                        Share
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="assistant-panel">
                <div className="assistant-panel-header">
                  <div>
                    <span className="hub-kicker">Fleet</span>
                    <h2>Devices</h2>
                  </div>
                </div>
                <div className="device-list">
                  {devices.map((device) => {
                    const status = dashboard?.clientStatuses.find((entry) => entry.deviceId === device.id);
                    const pairing = dashboard?.pairingSessions.find((entry) => entry.deviceId === device.id);
                    return (
                      <article key={device.id} className="device-row managed-device-row">
                        <div>
                          <strong>{device.displayName}</strong>
                          <span>{device.deviceType}</span>
                          <span>{status ? `${status.mode} / ${status.status}` : 'No live status'}</span>
                          {pairing && !pairing.claimedAt ? <span>Pairing expires {timeLabel(pairing.expiresAt)}</span> : null}
                        </div>
                        <div className="device-actions">
                          <button type="button" disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'query_status')}>
                            Query
                          </button>
                          <button type="button" disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'sleep')}>
                            Sleep
                          </button>
                          <button type="button" disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'off')}>
                            Off
                          </button>
                          <button type="button" disabled={busy} onClick={() => void rotateDeviceToken(device.id)}>
                            Rotate
                          </button>
                          <button type="button" disabled={busy} onClick={() => void revokeDevice(device.id)}>
                            Revoke
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {devices.length === 0 ? <div className="empty-note">No paired devices yet.</div> : null}
                </div>
              </section>
            </section>
          ) : null}

          {activeView === 'settings' ? (
            <section className="settings-stack">
              <section className="assistant-panel settings-section">
                <div className="assistant-panel-header">
                  <div>
                    <span className="hub-kicker">Assistant</span>
                    <h2>System Prompts</h2>
                  </div>
                </div>
                <div className="settings-form">
                  <label>
                    Normal assistant prompt
                    <textarea
                      value={assistantSnapshotData?.assistantSettings.normalSystemPrompt ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantSnapshotData((snapshot) => snapshot
                          ? { ...snapshot, assistantSettings: { ...snapshot.assistantSettings, normalSystemPrompt: value } }
                          : snapshot);
                      }}
                      onBlur={(event) => void updateAssistantSettings({ normalSystemPrompt: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Voice assistant prompt
                    <textarea
                      value={assistantSnapshotData?.assistantSettings.voiceSystemPrompt ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantSnapshotData((snapshot) => snapshot
                          ? { ...snapshot, assistantSettings: { ...snapshot.assistantSettings, voiceSystemPrompt: value } }
                          : snapshot);
                      }}
                      onBlur={(event) => void updateAssistantSettings({ voiceSystemPrompt: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Overview prompt
                    <textarea
                      value={assistantSnapshotData?.assistantSettings.overviewPrompt ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantSnapshotData((snapshot) => snapshot
                          ? { ...snapshot, assistantSettings: { ...snapshot.assistantSettings, overviewPrompt: value } }
                          : snapshot);
                      }}
                      onBlur={(event) => void updateAssistantSettings({ overviewPrompt: event.currentTarget.value })}
                    />
                  </label>
                </div>
              </section>

              <section className="assistant-panel settings-section">
                <div className="assistant-panel-header">
                  <div>
                    <span className="hub-kicker">Settings</span>
                    <h2>Voice Approval</h2>
                  </div>
                </div>
                <form className="settings-form settings-grid" onSubmit={(event) => void saveApprovalSettings(event)}>
                  <label>
                    Trigger phrase
                    <input
                      value={approvalSettings.triggerPhrase}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, triggerPhrase: event.target.value }))}
                    />
                  </label>
                  <label>
                    Unlock
                    <input
                      value={approvalSettings.unlockCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, unlockCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Lock
                    <input
                      value={approvalSettings.lockCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, lockCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Off
                    <input
                      value={approvalSettings.lockedOffCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, lockedOffCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Min digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.minDigits}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, minDigits: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Max digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.maxDigits}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, maxDigits: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Stable ms
                    <input
                      type="number"
                      min={250}
                      max={3000}
                      value={approvalSettings.stableMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, stableMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Collection timeout ms
                    <input
                      type="number"
                      min={1000}
                      max={15000}
                      value={approvalSettings.collectTimeoutMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, collectTimeoutMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Duplicate cooldown ms
                    <input
                      type="number"
                      min={0}
                      max={15000}
                      value={approvalSettings.duplicateCooldownMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, duplicateCooldownMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Finalize interval ms
                    <input
                      type="number"
                      min={100}
                      max={1000}
                      value={approvalSettings.finalizeCheckIntervalMs}
                      onChange={(event) =>
                        setApprovalSettings((prev) => ({ ...prev, finalizeCheckIntervalMs: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    Save Settings
                  </button>
                </form>
              </section>
            </section>
          ) : null}

          {activeView === 'activity' ? (
            <section className="activity-stack">
              <TranscriptPanel transcripts={transcripts} devices={devices} threads={threads} onOpenThread={openThreadFromTranscript} />

              <section className="assistant-panel">
                <div className="assistant-panel-header">
                  <div>
                    <span className="hub-kicker">Runtime</span>
                    <h2>Logs</h2>
                  </div>
                  <button type="button" onClick={() => void copyLogs()}>
                    Copy Logs
                  </button>
                </div>
                <div className="log-list">
                  {logs.map((log) => (
                    <article key={log.id} className="log-row">
                      <span className={`level ${log.level}`}>{log.level}</span>
                      <span>{log.source}</span>
                      <strong>{log.message}</strong>
                      <time>{timeLabel(log.createdAt)}</time>
                    </article>
                  ))}
                  {logs.length === 0 ? <div className="empty-note">No logs yet.</div> : null}
                </div>
              </section>

              {dashboard?.user.admin ? (
                <section className="assistant-panel">
                  <div className="assistant-panel-header">
                    <div>
                      <span className="hub-kicker">Admin</span>
                      <h2>Device Monitor</h2>
                    </div>
                  </div>
                  <div className="device-list">
                    {dashboard.adminDevices.map((device) => (
                      <article key={device.id} className="device-row">
                        <strong>{device.displayName}</strong>
                        <span>{device.deviceType}</span>
                        <span>token {device.tokenHint}...</span>
                        <time>{timeLabel(device.lastSeenAt)}</time>
                      </article>
                    ))}
                    {dashboard.adminClientStatuses.map((status) => (
                      <article key={`status-${status.deviceId}`} className="device-row status-row">
                        <strong>{status.displayName}</strong>
                        <span>{status.mode}</span>
                        <span>{status.microphone || status.status}</span>
                        <time>{timeLabel(status.updatedAt)}</time>
                      </article>
                    ))}
                    {dashboard.adminDevices.length === 0 ? <div className="empty-note">No connected devices yet.</div> : null}
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}
        </section>
      </section>
      {overviewModalOpen && latestOverview ? (
        <div className="assistant-modal-backdrop" role="dialog" aria-modal="true" aria-label="Thread overview">
          <section className="assistant-overview-modal">
            <header>
              <div>
                <span className="hub-kicker">Overview</span>
                <h2>{activeThread?.title ?? 'Assistant'} Summary</h2>
                <small>
                  {latestOverview.cached ? 'cached copy' : 'fresh summary'} · {timeLabel(latestOverview.createdAt)}
                </small>
              </div>
              <div>
                <button type="button" onClick={() => void generateOverview(false)} disabled={busy}>
                  Use Cache
                </button>
                <button type="button" onClick={() => void generateOverview(true)} disabled={busy}>
                  Regenerate
                </button>
                <button type="button" onClick={() => setOverviewModalOpen(false)}>
                  Close
                </button>
              </div>
            </header>
            <pre>{latestOverview.markdown}</pre>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function DesktopVoicePanel({ client, onRefresh }: { client: ApiClient; onRefresh: () => Promise<void> }) {
  const [deviceName, setDeviceName] = React.useState('Electron desktop');
  const [status, setStatus] = React.useState('Ready');
  const [mode, setMode] = React.useState<VoiceMode>('off');
  const [streaming, setStreaming] = React.useState(false);
  const [voiceSettings, setVoiceSettings] = React.useState<VoiceSettings | null>(null);
  const [device, setDevice] = React.useState<{ id: string; token: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(desktopDeviceStorageKey) || 'null');
    } catch {
      return null;
    }
  });
  const refs = React.useRef<{
    socket?: WebSocket;
    stream?: MediaStream;
    context?: AudioContext;
    processor?: ScriptProcessorNode;
    recognition?: any;
    wakeStream?: MediaStream;
    wakeContext?: AudioContext;
    wakeProcessor?: ScriptProcessorNode;
    wakeUnsubscribe?: () => void;
    wakeStarting?: boolean;
  }>({});
  const modeRef = React.useRef(mode);
  const streamingRef = React.useRef(streaming);
  const lastRecognizedRef = React.useRef({ text: '', at: 0 });
  const controlSocketRef = React.useRef<WebSocket | null>(null);
  const approvalRecognizerRef = React.useRef(new ApprovalCodeRecognizer());
  const approvalFinalizeTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    void loadVoiceSettings();
    return () => {
      if (approvalFinalizeTimerRef.current !== null) {
        window.clearTimeout(approvalFinalizeTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  React.useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  React.useEffect(() => {
    ensureControlSocket(device);
    return () => {
      controlSocketRef.current?.close();
      controlSocketRef.current = null;
    };
  }, [device?.id]);

  function resetApprovalCollection() {
    if (approvalFinalizeTimerRef.current !== null) {
      window.clearTimeout(approvalFinalizeTimerRef.current);
      approvalFinalizeTimerRef.current = null;
    }
    approvalRecognizerRef.current.reset();
  }

  function scheduleApprovalFinalize() {
    if (approvalFinalizeTimerRef.current !== null) {
      window.clearTimeout(approvalFinalizeTimerRef.current);
    }
    approvalFinalizeTimerRef.current = window.setTimeout(() => {
      approvalFinalizeTimerRef.current = null;
      handleApprovalUpdate(approvalRecognizerRef.current.flush(Date.now()));
      if (approvalRecognizerRef.current.isCollecting && modeRef.current !== 'off') {
        scheduleApprovalFinalize();
      }
    }, approvalRecognizerRef.current.finalizeCheckIntervalMs());
  }

  function showCollectingStatus(partialCode: string) {
    const nextStatus = partialCode
      ? (modeRef.current === 'sleeping' ? `Unlock: ${partialCode}` : `Approval: ${partialCode}`)
      : (modeRef.current === 'sleeping' ? 'Unlock code...' : 'Approval code...');
    setStatus(nextStatus);
    void reportDesktopStatus(modeRef.current, nextStatus);
  }

  function handleApprovalUpdate(update: ApprovalCodeUpdate): boolean {
    if (update.type === 'none') return false;
    if (update.type === 'collecting') {
      showCollectingStatus(update.partialCode);
      return true;
    }
    if (update.type === 'cancelled') {
      setStatus('Approval cancelled.');
      void reportDesktopStatus(modeRef.current, 'Approval cancelled.');
      return true;
    }
    void processApprovalCode(update.code);
    return true;
  }

  function acceptApprovalText(text: string, finalizeNow = false): boolean {
    const now = Date.now();
    let update = approvalRecognizerRef.current.accept(text, now);
    if (approvalRecognizerRef.current.isCollecting) {
      if (finalizeNow) {
        update = approvalRecognizerRef.current.flush(now + (voiceSettings?.stableMs ?? 900));
      } else {
        scheduleApprovalFinalize();
      }
    }
    if (update.type === 'none') {
      return approvalRecognizerRef.current.isCollecting;
    }
    return handleApprovalUpdate(update);
  }

  async function loadVoiceSettings(): Promise<VoiceSettings> {
    const data = await client.request<{ ok: true; settings: VoiceSettings }>('/api/settings/voice-approval');
    const next = data.settings;
    setVoiceSettings(next);
    approvalRecognizerRef.current.configure(approvalRecognizerOptions(next));
    return next;
  }

  async function pairDesktop() {
    const data = await client.request<{ ok: true; device: DeviceRecord; token: string }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ deviceType: 'desktop', displayName: deviceName }),
    });
    const next = { id: data.device.id, token: data.token };
    localStorage.setItem(desktopDeviceStorageKey, JSON.stringify(next));
    setDevice(next);
    ensureControlSocket(next);
    setStatus(`Paired ${data.device.displayName}.`);
    await onRefresh();
  }

  async function reportDesktopStatus(nextMode = modeRef.current, nextStatus = status) {
    const activeDevice = device;
    if (!activeDevice) return;
    if (controlSocketRef.current?.readyState === WebSocket.OPEN) {
      controlSocketRef.current.send(JSON.stringify({
        type: 'client_status',
        mode: nextMode,
        status: nextStatus,
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'electron',
        reportedAt: new Date().toISOString(),
      }));
      return;
    }
    ensureControlSocket(activeDevice);
    await client.request(`/api/devices/${encodeURIComponent(activeDevice.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({
        token: activeDevice.token,
        mode: nextMode,
        status: nextStatus,
        microphone: window.voiceStreamDesktop?.isDesktop ? 'Desktop microphone' : '',
        protocolVersion: 1,
        appVersion: 'electron',
      }),
    }).catch(() => undefined);
  }

  function ensureControlSocket(activeDevice = device) {
    if (!activeDevice || controlSocketRef.current?.readyState === WebSocket.OPEN || controlSocketRef.current?.readyState === WebSocket.CONNECTING) return;
    const url = new URL(`/api/devices/${encodeURIComponent(activeDevice.id)}/control`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', activeDevice.token);
    const socket = new WebSocket(url);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'client_status',
        mode: modeRef.current,
        status,
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'electron',
        reportedAt: new Date().toISOString(),
      }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = JSON.parse(event.data);
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
        return;
      }
      if (message.type === 'server_command') {
        void handleRemoteControlCommand(message, socket);
      }
    };
    socket.onclose = () => {
      if (controlSocketRef.current === socket) controlSocketRef.current = null;
    };
    socket.onerror = () => {
      if (controlSocketRef.current === socket) controlSocketRef.current = null;
    };
    controlSocketRef.current = socket;
  }

  async function handleRemoteControlCommand(message: any, socket: WebSocket) {
    const command = String(message?.command ?? '');
    const commandId = String(message?.commandId ?? '');
    const ack = (payload: Record<string, unknown>) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'command_ack', commandId, command, ...payload }));
    };
    try {
      if (command === 'query_status') {
        ack({ ok: true, mode: modeRef.current, status });
        void reportDesktopStatus(modeRef.current, status);
        return;
      }
      if (command === 'sleep') {
        enterSleep();
        ack({ ok: true, mode: 'sleeping', status: 'Sleeping.' });
        return;
      }
      if (command === 'off') {
        turnOff();
        ack({ ok: true, mode: 'off', status: 'Off.' });
        return;
      }
      if (command === 'awake') {
        enterAwake();
        ack({ ok: true, mode: 'awake', status: 'Awake.' });
        return;
      }
      ack({ ok: false, error: 'unknown command' });
    } catch (err: any) {
      ack({ ok: false, error: err?.message ?? String(err) });
    }
  }

  async function startVoice(target: VoiceStreamTarget = 'assistant') {
    stopWakeListener();
    let activeDevice = device;
    if (!activeDevice) {
      await pairDesktop();
      activeDevice = JSON.parse(localStorage.getItem(desktopDeviceStorageKey) || 'null');
    }
    if (!activeDevice) return;
    const session = await client.request<{ ok: true; session: { id: string } }>('/api/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId: activeDevice.id, mode: target }),
    });
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext({ sampleRate: 16_000 });
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const socket = openDesktopVoiceSocket(activeDevice, session.session.id, target);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-web', mode: target }));
    };
    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(floatToPcm16(event.inputBuffer.getChannelData(0)));
    };
    socket.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'assistant_result') {
            const nextStatus = `Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`;
            await finishVoiceFromServer(nextStatus);
            void onRefresh();
          } else if (message.type === 'transcript_result') {
            await finishVoiceFromServer(message.status || 'Transcript patched into chat.');
            void onRefresh();
          } else if (message.type === 'sleep') {
            let nextStatus = 'Awake. Waiting for voice command.';
            if (target === 'clipboard') {
              const copied = await copyText(message.transcriptText || '');
              nextStatus = copied ? 'Copied voice transcription.' : 'No voice transcription detected.';
            }
            await finishVoiceFromServer(nextStatus);
            void onRefresh();
          } else if (message.type === 'assistant_error') {
            await finishVoiceFromServer(message.error || 'Voice runtime failed.');
          } else if (message.type === 'server_ping') {
            socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
          }
        } catch {
          setStatus(event.data);
        }
        return;
      }
      const audio = new Audio(URL.createObjectURL(new Blob([event.data], { type: 'audio/wav' })));
      void audio.play().catch(() => undefined);
    };
    source.connect(processor);
    processor.connect(context.destination);
    refs.current = { socket, stream: media, context, processor };
    setStreaming(true);
    setMode('recording');
    setStatus(recordingStatus(target));
    void reportDesktopStatus('recording', recordingStatus(target));
  }

  async function stopVoice(nextMode: VoiceMode = 'awake') {
    const socket = refs.current.socket;
    socket?.send(JSON.stringify({ type: 'end' }));
    setTimeout(() => socket?.close(), 1200);
    refs.current.processor?.disconnect();
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    await refs.current.context?.close().catch(() => undefined);
    refs.current = {};
    setStreaming(false);
    setMode(nextMode);
    setStatus('Voice stream stopped.');
    void reportDesktopStatus(nextMode, 'Voice stream stopped.');
    if (nextMode !== 'off') startWakeListener();
  }

  async function finishVoiceFromServer(nextStatus: string) {
    refs.current.socket?.close();
    refs.current.processor?.disconnect();
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    await refs.current.context?.close().catch(() => undefined);
    refs.current = {};
    setStreaming(false);
    setMode('awake');
    setStatus(nextStatus);
    void reportDesktopStatus('awake', nextStatus);
    startWakeListener();
  }

  function enterAwake() {
    resetApprovalCollection();
    setMode('awake');
    void reportDesktopStatus('awake', 'Awake. Listening for voice commands.');
    startWakeListener();
  }

  function enterSleep() {
    if (streaming) void stopVoice('sleeping');
    resetApprovalCollection();
    setMode('sleeping');
    const settings = voiceSettings;
    setStatus(settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
    void reportDesktopStatus('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
    startWakeListener();
  }

  function turnOff() {
    if (streaming) void stopVoice('off');
    stopWakeListener();
    resetApprovalCollection();
    setMode('off');
    setStatus('Off.');
    void reportDesktopStatus('off', 'Off.');
  }

  async function processPhraseText(text: string, finalizeNow = false) {
    const currentMode = modeRef.current;
    if (acceptApprovalText(text, finalizeNow)) return;
    if (currentMode === 'recording') {
      setStatus('Recording. Voice commands are ignored until capture stops.');
      return;
    }
    const match = wakePhraseMatch(text);
    if (!match) {
      setStatus('No wake command matched.');
      return;
    }
    if (match === 'sleep') {
      enterSleep();
      return;
    }
    if (match === 'status') {
      setStatus(`Mode: ${currentMode}. Device: ${device?.id ? device.id.slice(0, 12) : 'unpaired'}.`);
      return;
    }
    if (currentMode === 'sleeping') {
      setStatus('Sleeping. Press Wake or say the unlock code.');
      return;
    }
    if (currentMode === 'off') enterAwake();
    await startVoice(match === 'patch' || match === 'clipboard' ? match : 'assistant');
  }

  function startWakeListener() {
    if (refs.current.wakeStarting || refs.current.wakeStream || refs.current.recognition) {
      setStatus('Awake. Listening for voice commands.');
      return;
    }
    if (window.voiceStreamDesktop?.startVosk && window.voiceStreamDesktop.sendVoskFrame && window.voiceStreamDesktop.onVoskText) {
      void startVoskWakeListener().then((started) => {
        if (!started) startSpeechWakeListener();
      });
      return;
    }
    startSpeechWakeListener();
  }

  async function startVoskWakeListener(): Promise<boolean> {
    const desktop = window.voiceStreamDesktop;
    if (!desktop?.startVosk || !desktop.sendVoskFrame || !desktop.onVoskText) return false;
    refs.current.wakeStarting = true;
    try {
      const status = await desktop.startVosk();
      if (!status.available) {
        setStatus(status.error ? `Vosk unavailable: ${status.error}` : 'Wake listener unavailable.');
        return false;
      }

      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext({ sampleRate: 16_000 });
      const source = context.createMediaStreamSource(media);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const unsubscribe = desktop.onVoskText((result) => {
        const text = result.text?.trim();
        if (!text) return;
        const now = Date.now();
        if (text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
        lastRecognizedRef.current = { text, at: now };
        void processPhraseText(text).catch((err) => setStatus(err?.message ?? String(err)));
      });

      processor.onaudioprocess = (event) => {
        desktop.sendVoskFrame?.(floatToPcm16(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      refs.current.wakeStream = media;
      refs.current.wakeContext = context;
      refs.current.wakeProcessor = processor;
      refs.current.wakeUnsubscribe = unsubscribe;
      setStatus('Awake. Listening with Vosk.');
      return true;
    } catch (err: any) {
      stopVoskWakeListener();
      setStatus(err?.message ? `Vosk listener failed: ${err.message}` : 'Vosk listener failed.');
      return false;
    } finally {
      refs.current.wakeStarting = false;
    }
  }

  function startSpeechWakeListener() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Awake. Wake recognition is unavailable in this runtime.');
      return;
    }
    if (refs.current.recognition) {
      setStatus('Awake. Listening for voice commands.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim();
      if (!text) return;
      const now = Date.now();
      if (text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
      lastRecognizedRef.current = { text, at: now };
      void processPhraseText(text);
    };
    recognition.onerror = () => setStatus('Wake listener paused.');
    recognition.onend = () => {
      refs.current.recognition = undefined;
      if (modeRef.current !== 'off' && !streamingRef.current) {
        window.setTimeout(() => startWakeListener(), 350);
      }
    };
    refs.current.recognition = recognition;
    try {
      recognition.start();
      setStatus('Awake. Listening for voice commands.');
    } catch {
      refs.current.recognition = undefined;
      setStatus('Awake. Wake recognition is unavailable in this runtime.');
    }
  }

  function stopWakeListener() {
    stopVoskWakeListener();
    const recognition = refs.current.recognition;
    if (!recognition) return;
    recognition.onend = null;
    refs.current.recognition = undefined;
    try {
      recognition.stop();
    } catch {
      // Ignore SpeechRecognition stop errors from already-ended sessions.
    }
  }

  function stopVoskWakeListener() {
    refs.current.wakeUnsubscribe?.();
    refs.current.wakeUnsubscribe = undefined;
    refs.current.wakeProcessor?.disconnect();
    refs.current.wakeProcessor = undefined;
    refs.current.wakeStream?.getTracks().forEach((track) => track.stop());
    refs.current.wakeStream = undefined;
    void refs.current.wakeContext?.close().catch(() => undefined);
    refs.current.wakeContext = undefined;
    void window.voiceStreamDesktop?.stopVosk?.();
  }

  async function processApprovalCode(code: string) {
    const settings = voiceSettings ?? await loadVoiceSettings();
    const currentMode = modeRef.current;
    if (currentMode === 'sleeping' && code === settings.unlockCode) {
      setMode('awake');
      setStatus('Unlocked.');
      return;
    }
    if (code === settings.lockedOffCode) {
      turnOff();
      return;
    }
    if (currentMode !== 'sleeping' && code === settings.lockCode) {
      enterSleep();
      return;
    }
    if (currentMode === 'sleeping') {
      setStatus(`Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.`);
      return;
    }
    await client.request('/api/voice/approval-codes', {
      method: 'POST',
      body: JSON.stringify({ code, source: 'desktop' }),
    });
    setStatus(`Approval sent: ${code}.`);
    await onRefresh();
  }

  async function togglePrimaryVoice() {
    if (streamingRef.current || modeRef.current === 'recording') {
      await stopVoice();
      return;
    }
    if (modeRef.current === 'awake') {
      enterSleep();
      return;
    }
    enterAwake();
  }

  const primaryLabel = mode === 'off'
    ? 'Off'
    : mode === 'awake'
      ? 'Awake'
      : mode === 'sleeping'
        ? 'Sleeping'
        : 'Recording';
  const primaryAction = mode === 'off'
    ? 'Start voice'
    : mode === 'awake'
      ? 'Sleep'
      : mode === 'sleeping'
        ? 'Wake'
        : 'Stop';

  return (
    <section className="desktop-voice-focus">
      <div className="desktop-voice-copy">
        <div className="kicker">Assistant microphone</div>
        <h2>Voice control</h2>
        <p>{device ? `${deviceName} connected` : 'Connect this desktop, then start voice.'}</p>
      </div>

      <button
        type="button"
        className={`desktop-voice-orb is-${mode}`}
        onClick={() => void togglePrimaryVoice()}
        aria-pressed={mode === 'awake' || mode === 'recording'}
        aria-label={`${primaryAction} desktop voice`}
      >
        <span className="desktop-orb-ring" />
        <span className="desktop-mic-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
            <path d="M8 21h8" />
          </svg>
        </span>
        <strong>{primaryLabel}</strong>
        <span>{primaryAction}</span>
      </button>

      <p className="desktop-runtime-status">{status}</p>

      <div className="desktop-connection-strip">
        <label>
          Desktop name
          <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={streaming} />
        </label>
        <button type="button" onClick={() => void pairDesktop()} disabled={streaming}>
          Connect desktop
        </button>
      </div>
    </section>
  );
}

type VoiceMode = 'off' | 'awake' | 'sleeping' | 'recording';
type VoiceStreamTarget = 'assistant' | 'patch' | 'clipboard';

function wakePhraseMatch(text: string): 'start' | 'patch' | 'clipboard' | 'sleep' | 'status' | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return 'sleep';
  if (words.some((word, index) => (word === 'hey' || word === 'hay') && words[index + 1] === 'sebastian')) return 'start';
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return 'patch';
  if (words.includes('transcribe')) return 'clipboard';
  if (words.includes('status') || compact === 'stateus' || compact === 'checkstatus') return 'status';
  return null;
}

function recordingStatus(target: VoiceStreamTarget): string {
  if (target === 'patch') return 'Patching voice transcript into chat.';
  if (target === 'clipboard') return 'Recording clipboard transcription.';
  return 'Streaming desktop microphone.';
}

async function copyText(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (window.voiceStreamDesktop?.writeClipboard) {
    window.voiceStreamDesktop.writeClipboard(trimmed);
    return true;
  }
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch {
    return false;
  }
}

function openDesktopVoiceSocket(device: { id: string; token: string }, sessionId: string, target: VoiceStreamTarget): WebSocket {
  const url = new URL('/api/voice/stream', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', device.id);
  url.searchParams.set('token', device.token);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('mode', target);
  return new WebSocket(url);
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function readDesktopAuthRequest(): { requestId: string; secret: string } | null {
  const params = new URLSearchParams(window.location.search);
  const requestId = String(params.get('desktopAuthRequest') ?? '').trim();
  const secret = String(params.get('desktopAuthSecret') ?? '').trim();
  return requestId && secret ? { requestId, secret } : null;
}

function closeDesktopAuthTab() {
  window.setTimeout(() => {
    window.close();
    window.open('', '_self');
    window.close();
  }, 350);
}

function DesktopAutoConnect({ client, children }: { client: ApiClient; children: React.ReactNode }) {
  const request = React.useMemo(readDesktopAuthRequest, []);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [closeAttempted, setCloseAttempted] = React.useState(false);

  React.useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    void client
      .request<{ ok: true }>('/api/desktop-auth/claim', {
        method: 'POST',
        body: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      })
      .then(() => {
        if (cancelled) return;
        setConnected(true);
        window.history.replaceState({}, document.title, window.location.pathname || '/');
        closeDesktopAuthTab();
        window.setTimeout(() => {
          if (!cancelled) setCloseAttempted(true);
        }, 1200);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, request]);

  if (!request) return <>{children}</>;

  return (
    <div className="signin-page">
      <div className="signin-copy">
        <div className="kicker">Drone</div>
        <h1>Connecting desktop</h1>
        <p>
          {error
            ? `Desktop connection failed: ${error}`
            : connected
              ? closeAttempted
                ? 'Desktop connected. You can close this tab.'
                : 'Desktop connected. Closing this tab.'
              : 'Finishing desktop sign in.'}
        </p>
        {error ? <button type="button" onClick={() => window.location.assign('/')}>Open dashboard</button> : null}
      </div>
    </div>
  );
}

function ClerkDashboard() {
  const { getToken } = useAuth();
  const client = React.useMemo(() => createClerkClient(getToken), [getToken]);
  return (
    <DesktopAutoConnect client={client}>
      <AppShell
        client={client}
        identitySlot={
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: {
                  width: '28px',
                  height: '28px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                },
                userButtonPopoverCard: {
                  backgroundColor: '#171B21',
                  border: '1px solid #2D3340',
                  boxShadow: '0 24px 80px rgba(0,0,0,.35)',
                },
                userButtonPopoverActionButton: {
                  color: '#B8BFD0',
                },
                userButtonPopoverActionButtonText: {
                  fontFamily: 'var(--sans)',
                },
              },
            }}
          />
        }
      />
    </DesktopAutoConnect>
  );
}

function DevDashboard() {
  const devUser = React.useMemo(readDevUser, []);
  const client = React.useMemo(() => createDevClient(devUser), [devUser]);
  return (
    <DesktopAutoConnect client={client}>
      <AppShell
        client={client}
        identitySlot={
          <div className="assistant-dev-profile" title="Dev auth is active. Configure VITE_CLERK_PUBLISHABLE_KEY to enable login and logout.">
            D
          </div>
        }
      />
    </DesktopAutoConnect>
  );
}

function Root() {
  if (!publishableKey) return <DevDashboard />;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={{
        variables: {
          colorBackground: '#171b21',
          colorText: '#dfe3ea',
          colorTextSecondary: '#8891a8',
          colorPrimary: '#a78bfa',
          colorInputBackground: 'rgba(255,255,255,.035)',
          colorInputText: '#dfe3ea',
          borderRadius: '8px',
        },
        elements: {
          card: {
            backgroundColor: '#171b21',
            border: '1px solid #2d3340',
            boxShadow: 'none',
          },
          headerTitle: { color: '#dfe3ea' },
          headerSubtitle: { color: '#8891a8' },
          socialButtonsBlockButton: {
            backgroundColor: 'rgba(255,255,255,.035)',
            borderColor: '#2d3340',
            color: '#dfe3ea',
          },
          formButtonPrimary: {
            backgroundColor: '#a78bfa',
            color: '#101216',
          },
        },
      }}
    >
      <SignedOut>
        <div className="signin-page">
          <div className="signin-copy">
            <div className="kicker">Drone</div>
            <h1>Sign in to Drone</h1>
            <p>Access assistant threads and paired devices from your workspace.</p>
          </div>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <ClerkDashboard />
      </SignedIn>
    </ClerkProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
