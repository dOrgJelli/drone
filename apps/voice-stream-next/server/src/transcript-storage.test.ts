import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('transcript storage', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('stores final transcripts with session and thread metadata', () => {
    const db = tempDb('transcript-meta');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_transcripts',
      displayName: 'Transcript User',
      email: 'transcripts@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desk mic' });
    const session = db.createVoiceSession(user.id, device.device.id, 'patch');
    db.addTranscript(user.id, session.id, 'Patch me in with this note.');
    db.endVoiceSession(user.id, session.id);

    const transcripts = db.listTranscripts(user.id);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.text).toBe('Patch me in with this note.');
    expect(transcripts[0]?.deviceName).toBe('Desk mic');
    expect(transcripts[0]?.mode).toBe('patch');
    expect(transcripts[0]?.assistantThreadId).toBe(session.assistantThreadId);
    expect(transcripts[0]?.sessionStartedAt).toBeTruthy();
    expect(transcripts[0]?.sessionEndedAt).toBeTruthy();
  });

  test('filters transcripts by device and voice session', () => {
    const db = tempDb('transcript-filters');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_filters',
      displayName: 'Filter User',
      email: 'filters@example.local',
      admin: false,
    });
    const phone = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const desktop = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    const phoneSession = db.createVoiceSession(user.id, phone.device.id, 'assistant');
    const desktopSession = db.createVoiceSession(user.id, desktop.device.id, 'clipboard');
    db.addTranscript(user.id, phoneSession.id, 'Phone transcript');
    db.addTranscript(user.id, desktopSession.id, 'Desktop transcript');

    expect(db.listTranscripts(user.id, 20, { deviceId: phone.device.id })).toHaveLength(1);
    expect(db.listTranscripts(user.id, 20, { deviceId: phone.device.id })[0]?.text).toBe('Phone transcript');
    expect(db.listTranscripts(user.id, 20, { voiceSessionId: desktopSession.id })).toHaveLength(1);
    expect(db.listTranscripts(user.id, 20, { voiceSessionId: desktopSession.id })[0]?.text).toBe('Desktop transcript');
  });

  test('ignores blank transcript text', () => {
    const db = tempDb('transcript-blank');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_blank',
      displayName: 'Blank User',
      email: 'blank@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desk' });
    const session = db.createVoiceSession(user.id, device.device.id, 'assistant');
    db.addTranscript(user.id, session.id, '   ');
    expect(db.listTranscripts(user.id)).toHaveLength(0);
  });
});
