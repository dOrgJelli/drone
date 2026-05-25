import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'node:path';

import { VoiceStreamNextDb } from './db.js';

function tempDbPath(name: string): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', `${name}-${crypto.randomUUID()}.sqlite`);
}

function migrationRows(db: VoiceStreamNextDb): Array<{ version: number; name: string; checksum: string }> {
  return db.db
    .query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; name: string; checksum: string }>;
}

function columnNames(db: VoiceStreamNextDb, table: string): string[] {
  return (db.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('database migrations', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('applies the baseline migration for a fresh database', () => {
    const db = new VoiceStreamNextDb(tempDbPath('fresh-migration'));
    dbs.push(db);

    expect(migrationRows(db).map((row) => row.version)).toEqual([1]);
    expect(columnNames(db, 'devices')).toContain('revoked_at');
    expect(columnNames(db, 'assistant_threads')).toContain('enabled_tools_json');
  });

  test('does not rerun already applied migrations', () => {
    const filePath = tempDbPath('idempotent-migration');
    const first = new VoiceStreamNextDb(filePath);
    first.db.close();

    const second = new VoiceStreamNextDb(filePath);
    dbs.push(second);

    expect(migrationRows(second)).toHaveLength(1);
  });

  test('baselines an existing pre-migration database and applies compatibility columns', () => {
    const filePath = tempDbPath('legacy-baseline');
    const legacy = new Database(filePath, { create: true });
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        clerk_user_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE assistant_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const migrated = new VoiceStreamNextDb(filePath);
    dbs.push(migrated);

    expect(migrationRows(migrated).map((row) => row.version)).toEqual([1]);
    expect(columnNames(migrated, 'assistant_threads')).toContain('provider');
    expect(columnNames(migrated, 'devices')).toContain('revoked_at');
  });

  test('rejects changed migration checksums', () => {
    const filePath = tempDbPath('checksum-migration');
    const db = new VoiceStreamNextDb(filePath);
    db.db.query('UPDATE schema_migrations SET checksum = $checksum WHERE version = 1').run({ $checksum: 'changed' });
    db.db.close();

    expect(() => new VoiceStreamNextDb(filePath)).toThrow(/migration checksum mismatch/);
  });
});
