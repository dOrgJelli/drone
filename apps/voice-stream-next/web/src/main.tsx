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
  AssistantMessage,
  AssistantThread,
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

function AppShell({ client, identitySlot }: { client: ApiClient; identitySlot: React.ReactNode }) {
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [activeView, setActiveView] = React.useState<DashboardView>('threads');
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(true);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [deviceName, setDeviceName] = React.useState('Desktop dev client');
  const [deviceType, setDeviceType] = React.useState('desktop');
  const [pairingText, setPairingText] = React.useState('');
  const [pairingQr, setPairingQr] = React.useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = React.useState<string | null>(null);
  const [pairingDeviceId, setPairingDeviceId] = React.useState<string | null>(null);
  const [approvalSettings, setApprovalSettings] = React.useState<VoiceApprovalFormState>(VOICE_APPROVAL_SETTINGS_DEFAULT);
  const settingsHydratedRef = React.useRef(false);

  const activeThread = dashboard?.threads.find((thread) => thread.id === activeThreadId) ?? dashboard?.threads[0] ?? null;

  const loadDashboard = React.useCallback(async () => {
    setError(null);
    try {
      const data = await client.request<DashboardData>('/api/dashboard');
      setDashboard(data);
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
  }, [activeThreadId, client]);

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

  async function createThread() {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread }>('/api/assistant/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Assistant thread' }),
      });
      setActiveThreadId(data.thread.id);
      await loadDashboard();
      setNotice('Created assistant thread.');
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
    try {
      await client.request(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setMessageDraft('');
      await Promise.all([loadMessages(activeThread.id), loadDashboard()]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
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
  const threads = dashboard?.threads ?? [];
  const logs = dashboard?.logs ?? [];
  const transcripts = dashboard?.transcripts ?? [];
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
        </div>

        <div className="assistant-thread-list">
          {threads.map((thread) => {
            const active = thread.id === activeThread?.id;
            const messageCount = active ? messages.length : 0;
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
                  {thread.source} · {timeLabel(thread.updatedAt)}
                  {messageCount ? ` · ${messageCount}` : ''}
                </small>
              </button>
            );
          })}
          {threads.length === 0 ? <div className="empty-note">No assistant threads yet.</div> : null}
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
              {activeView === 'threads' ? (activeThread ? 'idle' : 'no thread') : 'live'}
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
              <div className="assistant-messages">
                {messages.map((message) => (
                  <article key={message.id} className={`assistant-message ${message.role}`}>
                    <div className="assistant-message-role">{message.role === 'assistant' ? 'Assistant' : 'You'}</div>
                    <p>{message.content}</p>
                  </article>
                ))}
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

function ClerkDashboard() {
  const { getToken } = useAuth();
  const client = React.useMemo(() => createClerkClient(getToken), [getToken]);
  return (
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
  );
}

function DevDashboard() {
  const devUser = React.useMemo(readDevUser, []);
  const client = React.useMemo(() => createDevClient(devUser), [devUser]);
  return (
    <AppShell
      client={client}
      identitySlot={
        <div className="assistant-dev-profile" title="Dev auth is active. Configure VITE_CLERK_PUBLISHABLE_KEY to enable login and logout.">
          D
        </div>
      }
    />
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
            <div className="kicker">Voice Stream</div>
            <h1>Sign in to Assistant Hub</h1>
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
