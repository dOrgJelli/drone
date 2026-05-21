import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth, useUser } from '@clerk/clerk-react';
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

type DashboardData = {
  ok: true;
  authMode: 'clerk' | 'dev';
  user: UserProfile;
  settings: VoiceSettings;
  threads: AssistantThread[];
  logs: LogRecord[];
  devices: DeviceRecord[];
  adminDevices: DeviceRecord[];
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
      const data = await client.request<{ ok: true; device: DeviceRecord; token: string }>('/api/devices', {
        method: 'POST',
        body: JSON.stringify({ deviceType, displayName: deviceName }),
      });
      await navigator.clipboard?.writeText(data.token).catch(() => undefined);
      await loadDashboard();
      setNotice(`Created ${data.device.displayName}. Pairing token copied when clipboard access was available.`);
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
                Create Token
              </button>
            </form>
          </section>
        </aside>
      </section>

      <section className="lower-grid">
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
