import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import type { VoiceStreamNextDb } from './db.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'assistant-api@example.local',
  'x-voice-dev-user-name': 'Assistant API',
  'x-voice-dev-admin': '0',
};
const devAuthHeaders = {
  'x-voice-dev-user-email': 'assistant-api@example.local',
  'x-voice-dev-user-name': 'Assistant API',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
}

describe('assistant API parity', () => {
  let dataDir = '';
  let built: Awaited<ReturnType<typeof buildApp>>;
  let db: VoiceStreamNextDb;

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    built = await buildApp({ logger: false });
    db = built.db;
  });

  afterEach(async () => {
    built.app.server.closeAllConnections?.();
    await built.app.close();
    db.db.close();
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('creates normal and voice threads, renames, and deletes through the API', async () => {
    const normal = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Normal API thread' }),
    }).then((response) => response.json());
    expect(normal.thread.source).toBe('web');
    expect(normal.thread.voiceEnabled).toBe(false);

    const voice = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Voice API thread', source: 'voice', voiceEnabled: true }),
    }).then((response) => response.json());
    expect(voice.thread.source).toBe('voice');
    expect(voice.thread.voiceEnabled).toBe(true);

    const renamed = await built.app.inject({
      method: 'PATCH',
      url: `/api/assistant/threads/${normal.thread.id}`,
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Renamed API thread' }),
    }).then((response) => response.json());
    expect(renamed.thread.title).toBe('Renamed API thread');

    const deleted = await built.app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${normal.thread.id}`,
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(deleted.deleted).toBe(true);
    expect(deleted.snapshot.threads.some((thread: any) => thread.id === normal.thread.id)).toBe(false);
  });

  test('queues and cancels prompts through assistant routes', async () => {
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Queued API thread' }),
    }).then((response) => response.json());
    db.createRun(created.thread.userId, created.thread.id, {
      prompt: 'already running',
      provider: 'fallback',
      model: 'fallback',
      thinkingLevel: 'off',
    });

    const queued = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/prompt`,
      headers: devHeaders,
      payload: JSON.stringify({ prompt: 'run this next', provider: 'fallback' }),
    }).then((response) => response.json());
    const queuedPrompt = queued.snapshot.threads.find((thread: any) => thread.id === created.thread.id).queuedPrompts[0];
    expect(queued.events.some((event: any) => event.type === 'queued')).toBe(true);
    expect(queuedPrompt.prompt).toBe('run this next');

    const cancelled = await built.app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${created.thread.id}/queued/${queuedPrompt.id}`,
      headers: devAuthHeaders,
    }).then((response) => response.json());
    expect(cancelled.queuedPrompt.status).toBe('cancelled');
    expect(cancelled.snapshot.threads.find((thread: any) => thread.id === created.thread.id).queuedPrompts).toHaveLength(0);
  });

  test('generates fresh and cached overviews through the API', async () => {
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Overview API thread' }),
    }).then((response) => response.json());
    db.addMessage(created.thread.userId, created.thread.id, { role: 'user', content: 'Need a parity overview.' });

    const fresh = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/overview`,
      headers: devHeaders,
      payload: JSON.stringify({ force: true }),
    }).then((response) => response.json());
    const freshOverview = fresh.snapshot.threads.find((thread: any) => thread.id === created.thread.id).latestOverview;
    expect(freshOverview.cached).toBe(false);
    expect(freshOverview.markdown).toContain('## Queue');
    expect(freshOverview.markdown).toContain('## Pending Approvals');

    const cached = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/overview`,
      headers: devHeaders,
      payload: JSON.stringify({ force: false }),
    }).then((response) => response.json());
    expect(cached.overview.cached).toBe(true);
  });

  test('returns and stores spoken replies for voice thread prompts', async () => {
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: devHeaders,
      payload: JSON.stringify({ title: 'Speak API thread', source: 'voice', voiceEnabled: true }),
    }).then((response) => response.json());

    const prompted = await built.app.inject({
      method: 'POST',
      url: `/api/assistant/threads/${created.thread.id}/prompt`,
      headers: devHeaders,
      payload: JSON.stringify({ prompt: '/speak Hello from assistant.' }),
    }).then((response) => response.json());

    const spokenMessage = prompted.events.find((event: any) => event.type === 'message' && event.message?.spokenText);
    expect(spokenMessage.message.spokenText).toBe('Hello from assistant.');
    expect(db.listMessages(created.thread.userId, created.thread.id).some((message) => message.spokenText === 'Hello from assistant.')).toBe(true);
  });
});
