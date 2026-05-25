import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('user admin bootstrap', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('makes the first user admin', () => {
    const db = tempDb('first-admin');
    dbs.push(db);

    const user = db.upsertUser({
      clerkUserId: 'clerk_first',
      displayName: 'First User',
      email: 'first@example.local',
      admin: false,
    });

    expect(user.admin).toBe(true);
  });

  test('keeps later users non-admin unless explicitly granted', () => {
    const db = tempDb('later-admin');
    dbs.push(db);

    db.upsertUser({
      clerkUserId: 'clerk_first',
      displayName: 'First User',
      email: 'first@example.local',
      admin: false,
    });
    const second = db.upsertUser({
      clerkUserId: 'clerk_second',
      displayName: 'Second User',
      email: 'second@example.local',
      admin: false,
    });
    const third = db.upsertUser({
      clerkUserId: 'clerk_third',
      displayName: 'Third User',
      email: 'third@example.local',
      admin: true,
    });

    expect(second.admin).toBe(false);
    expect(third.admin).toBe(true);
  });
});

describe('data directory defaults', () => {
  afterEach(() => {
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('uses the Railway volume mount path when no explicit data directory is set', () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.RAILWAY_VOLUME_MOUNT_PATH = dataDir;

    const db = new VoiceStreamNextDb();
    try {
      expect(db.path).toBe(path.join(dataDir, 'voice-stream-next.sqlite'));
    } finally {
      db.db.close();
    }
  });
});
