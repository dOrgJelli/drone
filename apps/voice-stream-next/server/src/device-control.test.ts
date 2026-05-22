import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { ControlChannelRegistry } from './control-channel.js';
import { VoiceStreamNextDb } from './db.js';
import { buildPairingPayload, pairingExpiresAt } from './pairing.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', '.data', 'tests');
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
