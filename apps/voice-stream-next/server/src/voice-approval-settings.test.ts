import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import { VoiceStreamNextDb } from './db.js';
import {
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  parseVoiceApprovalSettings,
} from './voice-approval-settings.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'approval-settings@example.local',
  'x-voice-dev-user-name': 'Approval Settings',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
}

describe('parseVoiceApprovalSettings', () => {
  test('rejects duplicate approval codes', () => {
    expect(
      parseVoiceApprovalSettings({
        ...VOICE_APPROVAL_SETTINGS_DEFAULT,
        unlockCode: '1234',
        lockCode: '1234',
      }),
    ).toBeNull();
  });

  test('accepts custom timing and trigger phrase settings', () => {
    const parsed = parseVoiceApprovalSettings({
      triggerPhrase: 'access code',
      unlockCode: '1111',
      lockCode: '2222',
      lockedOffCode: '3333',
      minDigits: 3,
      maxDigits: 6,
      stableMs: 500,
      collectTimeoutMs: 2000,
      duplicateCooldownMs: 1000,
      finalizeCheckIntervalMs: 400,
      postPromptCommandSuppressionMs: 900,
    });
    expect(parsed).toEqual({
      triggerPhrase: 'access code',
      unlockCode: '1111',
      lockCode: '2222',
      lockedOffCode: '3333',
      minDigits: 3,
      maxDigits: 6,
      stableMs: 500,
      collectTimeoutMs: 2000,
      duplicateCooldownMs: 1000,
      finalizeCheckIntervalMs: 400,
      postPromptCommandSuppressionMs: 900,
    });
  });
});

describe('voice approval settings API', () => {
  let dataDir = '';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let db: VoiceStreamNextDb;
  let baseUrl = '';

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
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
  });

  test('returns persisted defaults for new users', async () => {
    const response = await fetch(`${baseUrl}/api/settings/voice-approval`, { headers: devHeaders });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.settings).toMatchObject(VOICE_APPROVAL_SETTINGS_DEFAULT);
    expect(data.defaults).toEqual(VOICE_APPROVAL_SETTINGS_DEFAULT);
    expect(data.limits.minDigitsMax).toBe(8);
  });

  test('persists custom settings via POST and reloads them on GET', async () => {
    const custom = {
      triggerPhrase: 'gate code',
      unlockCode: '5678',
      lockCode: '8765',
      lockedOffCode: '9999',
      minDigits: 4,
      maxDigits: 6,
      stableMs: 700,
      collectTimeoutMs: 4000,
      duplicateCooldownMs: 2000,
      finalizeCheckIntervalMs: 300,
      postPromptCommandSuppressionMs: 1200,
    };

    const saved = await fetch(`${baseUrl}/api/settings/voice-approval`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ settings: custom }),
    }).then((response) => response.json());
    expect(saved.settings).toMatchObject(custom);

    const loaded = await fetch(`${baseUrl}/api/settings/voice-approval`, { headers: devHeaders }).then((response) =>
      response.json(),
    );
    expect(loaded.settings).toMatchObject(custom);
  });

  test('rejects invalid POST payloads', async () => {
    const response = await fetch(`${baseUrl}/api/settings/voice-approval`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ settings: { triggerPhrase: '', unlockCode: '1' } }),
    });
    expect(response.status).toBe(400);
  });
});
