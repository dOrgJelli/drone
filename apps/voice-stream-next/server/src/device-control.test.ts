import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { buildApp } from './app.js';
import { ControlChannelRegistry } from './control-channel.js';
import { VoiceStreamNextDb } from './db.js';
import { buildPairingPayload, pairingExpiresAt } from './pairing.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('device lifecycle', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('rejects expired unclaimed pairing tokens and accepts after claim', () => {
    const db = tempDb('pairing-expiry');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_pairing',
      displayName: 'Pairing User',
      email: 'pairing@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.createPairingSession(user.id, registered.device.id, expiredAt);

    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(false);

    const fresh = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone 2' });
    const future = pairingExpiresAt();
    db.createPairingSession(user.id, fresh.device.id, future);
    const first = db.verifyDeviceToken(fresh.device.id, fresh.token, { clientVersion: 1, minClientVersion: 1 });
    expect(first.ok).toBe(true);
    const second = db.verifyDeviceToken(fresh.device.id, fresh.token, { clientVersion: 1, minClientVersion: 1 });
    expect(second.ok).toBe(true);
  });

  test('revokes devices and rotates tokens independently', () => {
    const db = tempDb('device-mgmt');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_devices',
      displayName: 'Device User',
      email: 'devices@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(true);

    const rotated = db.rotateDeviceToken(user.id, registered.device.id);
    expect(rotated?.token).not.toBe(registered.token);
    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(false);
    expect(db.verifyDeviceToken(registered.device.id, rotated!.token).ok).toBe(true);

    const revoked = db.revokeDevice(user.id, registered.device.id);
    expect(revoked?.revokedAt).toBeTruthy();
    expect(db.verifyDeviceToken(registered.device.id, rotated!.token).ok).toBe(false);
  });

  test('rejects clients below the configured minimum version', () => {
    const db = tempDb('client-version');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_version',
      displayName: 'Version User',
      email: 'version@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const result = db.verifyDeviceToken(registered.device.id, registered.token, { clientVersion: 0, minClientVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('client_too_old');
  });
});

describe('control channel registry', () => {
  test('delivers commands and resolves pending acks', async () => {
    const registry = new ControlChannelRegistry();
    const messages: string[] = [];
    const socket = {
      readyState: 1,
      send(data: string) {
        messages.push(data);
      },
    };
    registry.register('dev_1', socket);
    const pending = registry.sendCommand('dev_1', 'query_status', 'test');
    expect(messages).toHaveLength(1);
    const payload = JSON.parse(messages[0]!);
    registry.handleCommandAck('dev_1', {
      type: 'command_ack',
      commandId: payload.commandId,
      ok: true,
      command: 'query_status',
      mode: 'awake',
      status: 'Ready',
    });
    const result = await pending;
    expect(result.delivered).toBe(true);
    expect(result.ack?.status).toBe('Ready');
  });
});

describe('pairing payload integration', () => {
  test('includes rotated token details for refreshed QR payloads', () => {
    const built = buildPairingPayload({
      serverUrl: 'http://127.0.0.1:3299',
      deviceId: 'dev_rotated',
      token: 'rotated-token',
      deviceType: 'android',
      displayName: 'Android',
      protocolVersion: 1,
      expiresAt: pairingExpiresAt(),
      pairingSessionId: 'pair_rotated',
    });
    expect(built.payload.token).toBe('rotated-token');
    expect(built.payload.minClientVersion).toBeGreaterThan(0);
  });
});

describe('voice session device validation', () => {
  test('allows paired devices to create sessions and logs with device tokens', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const headers = {
        'content-type': 'application/json',
        'x-voice-dev-user-email': 'device-token@example.local',
        'x-voice-dev-user-name': 'Device Token',
        'x-voice-dev-admin': '0',
      };
      const registered = await built.app.inject({
        method: 'POST',
        url: '/api/devices',
        headers,
        payload: JSON.stringify({ deviceType: 'desktop', displayName: 'Token Desktop' }),
      }).then((response) => response.json());

      const sessionResponse = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: registered.device.id, token: registered.token, mode: 'assistant' }),
      });
      expect(sessionResponse.statusCode).toBe(200);
      expect(sessionResponse.json().session.deviceId).toBe(registered.device.id);

      const logResponse = await built.app.inject({
        method: 'POST',
        url: '/api/logs',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: registered.device.id, token: registered.token, source: 'desktop', level: 'info', message: 'Device token log' }),
      });
      expect(logResponse.statusCode).toBe(200);
      expect(logResponse.json().log.message).toBe('Device token log');
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('returns unknown device for stale desktop pairing', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const response = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'stale-desktop@example.local',
          'x-voice-dev-user-name': 'Stale Desktop',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ deviceId: 'dev_missing', mode: 'assistant' }),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('unknown device');
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('auto-connects desktop through browser-auth claim flow', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const requestResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Browser Desktop' }),
      });
      expect(requestResponse.statusCode).toBe(200);
      const request = requestResponse.json();
      expect(String(request.requestId).startsWith('dauth_')).toBe(true);
      expect(request.secret).toBeTruthy();
      expect(request.deviceToken).toBeTruthy();

      const claimResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/claim',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'browser-desktop@example.local',
          'x-voice-dev-user-name': 'Browser Desktop User',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      });
      expect(claimResponse.statusCode).toBe(200);
      const claimed = claimResponse.json();
      expect(claimed.device.deviceType).toBe('desktop');
      expect(claimed.device.displayName).toBe('Browser Desktop');

      const resultResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/result',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      });
      expect(resultResponse.statusCode).toBe(200);
      expect(resultResponse.json().status).toBe('claimed');

      const sessionResponse = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: claimed.device.id, token: request.deviceToken, mode: 'assistant' }),
      });
      expect(sessionResponse.statusCode).toBe(200);
      expect(sessionResponse.json().session.deviceId).toBe(claimed.device.id);

      const bootstrapResponse = await built.app.inject({
        method: 'GET',
        url: `/api/devices/${encodeURIComponent(claimed.device.id)}/bootstrap`,
        headers: { 'x-voice-device-token': request.deviceToken },
      });
      expect(bootstrapResponse.statusCode).toBe(200);
      expect(bootstrapResponse.json().device.id).toBe(claimed.device.id);
      expect(bootstrapResponse.json().settings.unlockCode).toBeTruthy();
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });
});

describe('desktop app downloads', () => {
  afterEach(() => {
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('serves the published desktop archive metadata and file', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    const desktopDir = path.join(dataDir, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'voice-stream-next-desktop-latest.tar.gz'), 'desktop archive');
    fs.writeFileSync(path.join(desktopDir, 'latest.json'), JSON.stringify({
      app: 'voice-stream-next',
      platform: 'desktop',
      variant: 'linux-x64',
      fileName: 'voice-stream-next-desktop-latest.tar.gz',
      builtAt: '2026-05-25T00:00:00.000Z',
    }));
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const metadata = await built.app.inject({ method: 'GET', url: '/api/desktop' });
      expect(metadata.statusCode).toBe(200);
      expect(metadata.json().desktop.available).toBe(true);
      expect(metadata.json().desktop.downloadUrl).toContain('/api/desktop/download');

      expect(metadata.json().desktop.fileName).toBe('voice-stream-next-desktop-latest.tar.gz');
      expect(metadata.json().desktop.size).toBe('desktop archive'.length);
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });
});
