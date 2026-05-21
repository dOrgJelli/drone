import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import { VoiceStreamNextDb } from './db.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'voice-integration@example.local',
  'x-voice-dev-user-name': 'Voice Integration',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', '.data', 'tests', crypto.randomUUID());
}

function samplePcmChunk(): ArrayBuffer {
  const samples = new Int16Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? 1200 : -1200;
  }
  return samples.buffer;
}

async function waitForCondition(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('voice integration', () => {
  let dataDir = '';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let db: VoiceStreamNextDb;
  let baseUrl = '';

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'finalize this transcript';
    const built = await buildApp({ logger: false });
    app = built.app;
    db = built.db;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    db.db.close();
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
  });

  test('accepts device status updates over HTTP', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'android', displayName: 'Status Phone' }),
    }).then((response) => response.json());

    const statusResponse = await fetch(`${baseUrl}/api/devices/${registered.device.id}/status`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        token: registered.token,
        mode: 'awake',
        status: 'Ready for commands',
        microphone: 'Built-in mic',
        protocolVersion: 1,
        appVersion: 'android-test',
      }),
    });
    expect(statusResponse.status).toBe(200);
    const statusBody = await statusResponse.json();
    expect(statusBody.ok).toBe(true);
    expect(statusBody.status.mode).toBe('awake');
    expect(statusBody.status.status).toBe('Ready for commands');

    const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: devHeaders }).then((response) => response.json());
    expect(dashboard.clientStatuses.some((entry: any) => entry.deviceId === registered.device.id && entry.status === 'Ready for commands')).toBe(true);
  });

  test('finalizes patch voice streams into stored transcripts and assistant threads', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'desktop', displayName: 'Patch Desktop' }),
    }).then((response) => response.json());

    const session = await fetch(`${baseUrl}/api/voice/sessions`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceId: registered.device.id, mode: 'patch' }),
    }).then((response) => response.json());

    const wsUrl = new URL('/api/voice/stream', baseUrl);
    wsUrl.protocol = 'ws:';
    wsUrl.searchParams.set('deviceId', registered.device.id);
    wsUrl.searchParams.set('token', registered.token);
    wsUrl.searchParams.set('sessionId', session.session.id);
    wsUrl.searchParams.set('mode', 'patch');

    const socket = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('websocket failed to open')));
      });
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'test', mode: 'patch' }));
      socket.send(samplePcmChunk());
      socket.send(JSON.stringify({ type: 'end' }));

      const user = db.userByClerkId('dev_voice_integration_example_local');
      expect(user).toBeTruthy();
      await waitForCondition('stored transcript', () => db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id }).length === 1);

      const transcripts = db.listTranscripts(user!.id, 20, { voiceSessionId: session.session.id });
      expect(transcripts[0]?.text).toBe('finalize this transcript');
      expect(transcripts[0]?.assistantThreadId).toBeTruthy();

      const messages = db.listMessages(user!.id, transcripts[0]!.assistantThreadId);
      expect(messages.some((message) => message.role === 'user' && message.content === 'finalize this transcript')).toBe(true);
    } finally {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  });

  test('exposes transcript filters on the transcripts API', async () => {
    const registered = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'android', displayName: 'Filter Phone' }),
    }).then((response) => response.json());
    const user = db.userByClerkId('dev_voice_integration_example_local');
    const session = db.createVoiceSession(user!.id, registered.device.id, 'assistant');
    db.addTranscript(user!.id, session.id, 'Filtered transcript line');

    const filtered = await fetch(`${baseUrl}/api/transcripts?deviceId=${encodeURIComponent(registered.device.id)}`, {
      headers: devHeaders,
    }).then((response) => response.json());
    expect(filtered.transcripts).toHaveLength(1);
    expect(filtered.transcripts[0]?.assistantThreadId).toBe(session.assistantThreadId);
    expect(filtered.transcripts[0]?.sessionStartedAt).toBeTruthy();
  });
});
