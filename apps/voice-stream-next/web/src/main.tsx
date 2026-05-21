import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth, useUser } from '@clerk/clerk-react';
import QRCode from 'qrcode';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from '../../server/src/approval-code.js';
import './styles.css';

type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
};

type VoiceSettings = {
  unlockCode: string;
  lockCode: string;
  offCode: string;
  updatedAt: string;
};

type DeviceRecord = {
  id: string;
  userId: string;
  deviceType: string;
  displayName: string;
  tokenHint: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string | null;
};

type PairingSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

type LogRecord = {
  id: string;
  deviceId: string | null;
  source: string;
  level: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
};

type AssistantThread = {
  id: string;
  title: string;
  source: string;
  deviceId: string | null;
  updatedAt: string;
  createdAt: string;
};

type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  spokenText: string | null;
  createdAt: string;
};

type TranscriptRecord = {
  id: string;
  voiceSessionId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  text: string;
  final: boolean;
  createdAt: string;
};

type ClientStatusRecord = {
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

type DashboardData = {
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
  stats: { threadCount: number; deviceCount: number; logCount: number };
  dbPath: string;
};

type ApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

type DevUser = {
  email: string;
  name: string;
  admin: boolean;
};

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const devUserStorageKey = 'voiceStreamNext.devUser';
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

type DesktopVoskStatus = {
  available: boolean;
  modelPath?: string;
  error?: string;
};

type DesktopVoskText = {
  text: string;
  final?: boolean;
};

function defaultDevUser(): DevUser {
  return { email: 'developer@example.local', name: 'Local Developer', admin: true };
}

function readDevUser(): DevUser {
  try {
    const parsed = JSON.parse(localStorage.getItem(devUserStorageKey) || 'null');
    return {
      email: String(parsed?.email ?? defaultDevUser().email),
      name: String(parsed?.name ?? defaultDevUser().name),
      admin: Boolean(parsed?.admin ?? true),
    };
  } catch {
    return defaultDevUser();
  }
}

function createDevClient(user: DevUser): ApiClient {
  return {
    async request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      headers.set('content-type', headers.get('content-type') || 'application/json');
      headers.set('x-voice-dev-user-email', user.email);
      headers.set('x-voice-dev-user-name', user.name);
      headers.set('x-voice-dev-admin', user.admin ? '1' : '0');
      return requestJson<T>(path, { ...init, headers });
    },
  };
}

function createClerkClient(getToken: () => Promise<string | null>): ApiClient {
  return {
    async request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      headers.set('content-type', headers.get('content-type') || 'application/json');
      const token = await getToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
      return requestJson<T>(path, { ...init, headers });
    },
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${path}`);
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

function codeValue(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

function AppShell({ client, identitySlot, devMode }: { client: ApiClient; identitySlot: React.ReactNode; devMode?: boolean }) {
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
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
  const [codes, setCodes] = React.useState({ unlockCode: '1234', lockCode: '4321', offCode: '0000' });

  const activeThread = dashboard?.threads.find((thread) => thread.id === activeThreadId) ?? dashboard?.threads[0] ?? null;

  const loadDashboard = React.useCallback(async () => {
    setError(null);
    try {
      const data = await client.request<DashboardData>('/api/dashboard');
      setDashboard(data);
      setCodes({
        unlockCode: data.settings.unlockCode,
        lockCode: data.settings.lockCode,
        offCode: data.settings.offCode,
      });
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

  async function saveCodes(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: VoiceSettings }>('/api/settings/voice-codes', {
        method: 'PATCH',
        body: JSON.stringify(codes),
      });
      setCodes(data.settings);
      await loadDashboard();
      setNotice('Saved voice codes.');
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

  async function copyTranscripts() {
    const text = (dashboard?.transcripts ?? [])
      .map((transcript) => `[${transcript.createdAt}] ${transcript.deviceName || transcript.deviceId} ${transcript.mode}: ${transcript.text}`)
      .join('\n');
    await navigator.clipboard?.writeText(text);
    setNotice('Copied visible transcripts.');
  }

  if (loading) {
    return <div className="loading-screen">Loading Voice Stream...</div>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="kicker">Voice Stream Next</div>
          <h1>Voice and assistant control room</h1>
        </div>
        <div className="identity">
          {devMode ? <span className="dev-pill">Dev auth</span> : null}
          {identitySlot}
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner notice">{notice}</div> : null}

      <section className="status-grid">
        <Metric label="Threads" value={dashboard?.stats.threadCount ?? 0} />
        <Metric label="Devices" value={dashboard?.stats.deviceCount ?? 0} />
        <Metric label="Logs" value={dashboard?.stats.logCount ?? 0} />
        <Metric label="Role" value={dashboard?.user.admin ? 'Admin' : 'User'} />
      </section>

      {window.voiceStreamDesktop?.isDesktop ? <DesktopVoicePanel client={client} onRefresh={loadDashboard} /> : null}

      <section className="dashboard-grid">
        <section className="panel assistant-panel">
          <div className="panel-heading">
            <div>
              <h2>Assistant Threads</h2>
              <p>{activeThread ? activeThread.title : 'Create a thread to start.'}</p>
            </div>
            <button type="button" onClick={() => void createThread()} disabled={busy}>
              New Thread
            </button>
          </div>

          <div className="thread-layout">
            <aside className="thread-list">
              {(dashboard?.threads ?? []).map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={thread.id === activeThread?.id ? 'thread-item active' : 'thread-item'}
                  onClick={() => setActiveThreadId(thread.id)}
                >
                  <span>{thread.title}</span>
                  <small>{thread.source} / {timeLabel(thread.updatedAt)}</small>
                </button>
              ))}
              {dashboard?.threads.length === 0 ? <div className="empty-note">No assistant threads yet.</div> : null}
            </aside>

            <div className="conversation">
              <div className="messages">
                {messages.map((message) => (
                  <article key={message.id} className={`message ${message.role}`}>
                    <div className="message-role">{message.role}</div>
                    <p>{message.content}</p>
                  </article>
                ))}
                {activeThread && messages.length === 0 ? <div className="empty-note">This thread is empty.</div> : null}
              </div>
              <form className="composer" onSubmit={(event) => void sendMessage(event)}>
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
            </div>
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel">
            <h2>Profile</h2>
            <dl className="profile-list">
              <div>
                <dt>Name</dt>
                <dd>{dashboard?.user.displayName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{dashboard?.user.email}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{dashboard?.dbPath}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2>Voice Codes</h2>
            <form className="settings-form" onSubmit={(event) => void saveCodes(event)}>
              <label>
                Unlock
                <input value={codes.unlockCode} onChange={(event) => setCodes((prev) => ({ ...prev, unlockCode: codeValue(event.target.value) }))} />
              </label>
              <label>
                Lock
                <input value={codes.lockCode} onChange={(event) => setCodes((prev) => ({ ...prev, lockCode: codeValue(event.target.value) }))} />
              </label>
              <label>
                Off
                <input value={codes.offCode} onChange={(event) => setCodes((prev) => ({ ...prev, offCode: codeValue(event.target.value) }))} />
              </label>
              <button type="submit" disabled={busy}>
                Save Codes
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Pair Device</h2>
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
                <small>QR / pairing payload</small>
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

          <section className="panel">
            <h2>Your Devices</h2>
            <div className="device-list">
              {(dashboard?.devices ?? []).map((device) => {
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
              {dashboard?.devices.length === 0 ? <div className="empty-note">No paired devices yet.</div> : null}
            </div>
          </section>
        </aside>
      </section>

      <section className="lower-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Transcripts</h2>
              <p>Recent final voice transcripts stored for this user.</p>
            </div>
            <button type="button" onClick={() => void copyTranscripts()}>
              Copy Transcripts
            </button>
          </div>
          <div className="transcript-list">
            {(dashboard?.transcripts ?? []).map((transcript) => (
              <article key={transcript.id} className="transcript-row">
                <div>
                  <strong>{transcript.deviceName || transcript.deviceId}</strong>
                  <span>{transcript.mode} / {timeLabel(transcript.createdAt)}</span>
                </div>
                <p>{transcript.text}</p>
              </article>
            ))}
            {dashboard?.transcripts.length === 0 ? <div className="empty-note">No transcripts yet.</div> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Logs</h2>
              <p>Stored as database rows. Copy visible rows for debugging.</p>
            </div>
            <button type="button" onClick={() => void copyLogs()}>
              Copy Logs
            </button>
          </div>
          <div className="log-list">
            {(dashboard?.logs ?? []).map((log) => (
              <article key={log.id} className="log-row">
                <span className={`level ${log.level}`}>{log.level}</span>
                <span>{log.source}</span>
                <strong>{log.message}</strong>
                <time>{timeLabel(log.createdAt)}</time>
              </article>
            ))}
            {dashboard?.logs.length === 0 ? <div className="empty-note">No logs yet.</div> : null}
          </div>
        </section>

        <section className="panel">
          <h2>{dashboard?.user.admin ? 'Admin Device Monitor' : 'Device Monitor'}</h2>
          {dashboard?.user.admin ? (
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
          ) : (
            <div className="locked-panel">Admin access required.</div>
          )}
        </section>
      </section>
    </main>
  );
}

function DesktopVoicePanel({ client, onRefresh }: { client: ApiClient; onRefresh: () => Promise<void> }) {
  const [deviceName, setDeviceName] = React.useState('Electron desktop');
  const [status, setStatus] = React.useState('Ready');
  const [mode, setMode] = React.useState<VoiceMode>('off');
  const [phrase, setPhrase] = React.useState('');
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
        update = approvalRecognizerRef.current.flush(now + 900);
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
    const data = await client.request<{ ok: true; settings: { unlockCode: string; lockCode: string; lockedOffCode: string } }>('/api/settings/voice-approval');
    const next = {
      unlockCode: data.settings.unlockCode,
      lockCode: data.settings.lockCode,
      offCode: data.settings.lockedOffCode,
      updatedAt: '',
    };
    setVoiceSettings(next);
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
            let nextStatus = 'Awake. Waiting for wake phrase.';
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
    void reportDesktopStatus('awake', 'Awake. Listening for wake phrases.');
    startWakeListener();
  }

  function enterSleep() {
    if (streaming) void stopVoice('sleeping');
    resetApprovalCollection();
    setMode('sleeping');
    const settings = voiceSettings;
    setStatus(settings ? `Sleep: ${settings.unlockCode} awake, ${settings.offCode} off.` : 'Sleeping.');
    void reportDesktopStatus('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.offCode} off.` : 'Sleeping.');
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

  async function processWakePhrase() {
    const text = phrase;
    setPhrase('');
    await processPhraseText(text, true);
  }

  async function processPhraseText(text: string, finalizeNow = false) {
    const currentMode = modeRef.current;
    if (acceptApprovalText(text, finalizeNow)) return;
    if (currentMode === 'recording') {
      setStatus('Recording. Wake commands are ignored until capture stops.');
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
      setStatus('Sleeping. Wake the app manually first.');
      return;
    }
    if (currentMode === 'off') enterAwake();
    await startVoice(match === 'patch' || match === 'clipboard' ? match : 'assistant');
  }

  function startWakeListener() {
    if (refs.current.wakeStarting || refs.current.wakeStream || refs.current.recognition) {
      setStatus('Awake. Listening for wake phrases.');
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
        setStatus(status.error ? `Vosk unavailable: ${status.error}` : 'Vosk unavailable. Type a wake phrase if needed.');
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
      setStatus(err?.message ? `Vosk listener failed: ${err.message}` : 'Vosk listener failed. Type a wake phrase if needed.');
      return false;
    } finally {
      refs.current.wakeStarting = false;
    }
  }

  function startSpeechWakeListener() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Awake. Type a wake phrase for this desktop runtime.');
      return;
    }
    if (refs.current.recognition) {
      setStatus('Awake. Listening for wake phrases.');
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
    recognition.onerror = () => setStatus('Wake listener paused. Type a wake phrase if needed.');
    recognition.onend = () => {
      refs.current.recognition = undefined;
      if (modeRef.current !== 'off' && !streamingRef.current) {
        window.setTimeout(() => startWakeListener(), 350);
      }
    };
    refs.current.recognition = recognition;
    try {
      recognition.start();
      setStatus('Awake. Listening for wake phrases.');
    } catch {
      refs.current.recognition = undefined;
      setStatus('Awake. Type a wake phrase for this desktop runtime.');
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
    if (code === settings.offCode) {
      turnOff();
      return;
    }
    if (currentMode !== 'sleeping' && code === settings.lockCode) {
      enterSleep();
      return;
    }
    if (currentMode === 'sleeping') {
      setStatus(`Sleep: ${settings.unlockCode} awake, ${settings.offCode} off.`);
      return;
    }
    await client.request('/api/voice/approval-codes', {
      method: 'POST',
      body: JSON.stringify({ code, source: 'desktop' }),
    });
    setStatus(`Approval sent: ${code}.`);
    await onRefresh();
  }

  return (
    <section className="panel desktop-voice-panel">
      <div className="panel-heading">
        <div>
          <h2>Desktop Voice</h2>
          <p>Mode: {mode}. Wake phrases: hey sebastian, patch me in, can you transcribe, go to sleep, status.</p>
        </div>
        <div className="voice-actions">
          <button type="button" onClick={() => void pairDesktop()} disabled={streaming}>
            Pair
          </button>
          <button type="button" onClick={enterAwake} disabled={streaming}>
            Awake
          </button>
          <button type="button" onClick={enterSleep}>
            Sleep
          </button>
          <button type="button" onClick={() => void startVoice()} disabled={streaming || mode === 'sleeping'}>
            Record
          </button>
          <button type="button" onClick={() => void stopVoice()} disabled={!streaming}>
            Stop
          </button>
          <button type="button" onClick={turnOff}>
            Off
          </button>
        </div>
      </div>
      <label>
        Desktop name
        <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={streaming} />
      </label>
      <form className="desktop-phrase-row" onSubmit={(event) => { event.preventDefault(); void processWakePhrase(); }}>
        <input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Type a wake phrase for desktop testing" />
        <button type="submit">Run Phrase</button>
      </form>
      <p className="runtime-status">{status}</p>
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
  const { user } = useUser();
  const client = React.useMemo(() => createClerkClient(getToken), [getToken]);
  return <AppShell client={client} identitySlot={<><span>{user?.primaryEmailAddress?.emailAddress}</span><UserButton /></>} />;
}

function DevDashboard() {
  const [devUser, setDevUser] = React.useState(readDevUser);
  const [draft, setDraft] = React.useState(devUser);
  const client = React.useMemo(() => createDevClient(devUser), [devUser]);

  function saveDevUser(event: React.FormEvent) {
    event.preventDefault();
    localStorage.setItem(devUserStorageKey, JSON.stringify(draft));
    setDevUser(draft);
  }

  return (
    <>
      <form className="dev-auth" onSubmit={saveDevUser}>
        <span>Local dev auth</span>
        <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
        <input value={draft.email} onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))} />
        <label>
          <input type="checkbox" checked={draft.admin} onChange={(event) => setDraft((prev) => ({ ...prev, admin: event.target.checked }))} />
          Admin
        </label>
        <button type="submit">Apply</button>
      </form>
      <AppShell client={client} identitySlot={<span>{devUser.email}</span>} devMode />
    </>
  );
}

function Root() {
  if (!publishableKey) return <DevDashboard />;
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <SignedOut>
        <div className="signin-page">
          <div className="signin-copy">
            <div className="kicker">Voice Stream</div>
            <h1>Sign in to your voice workspace</h1>
            <p>Use Clerk to access assistant threads, device pairing, voice codes, and logs.</p>
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
