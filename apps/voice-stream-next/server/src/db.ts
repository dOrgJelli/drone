import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

import {
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  type VoiceApprovalSettings,
} from './voice-approval-settings.js';

export type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type VoiceSettings = VoiceApprovalSettings & {
  updatedAt: string;
};

export type DeviceRecord = {
  id: string;
  userId: string;
  deviceType: string;
  displayName: string;
  tokenHint: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
};

export type PairingSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

export type DesktopAuthRequestRecord = {
  id: string;
  displayName: string;
  expiresAt: string;
  claimedAt: string | null;
  userId: string | null;
  deviceId: string | null;
  createdAt: string;
};

export type DesktopAuthClaimResult =
  | { ok: true; request: DesktopAuthRequestRecord; device: DeviceRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed' };

export type DesktopAuthPollResult =
  | { ok: true; status: 'pending'; request: DesktopAuthRequestRecord }
  | { ok: true; status: 'claimed'; request: DesktopAuthRequestRecord; device: DeviceRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' };

export type DeviceAuthFailureReason = 'not_found' | 'invalid_token' | 'revoked' | 'pairing_expired' | 'client_too_old';

export type DeviceAuthResult =
  | { ok: true; device: DeviceRecord }
  | { ok: false; reason: DeviceAuthFailureReason; minClientVersion?: number };

export type LogRecord = {
  id: string;
  userId: string;
  deviceId: string | null;
  source: string;
  level: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
};

export type AssistantThread = {
  id: string;
  userId: string;
  deviceId: string | null;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  threadId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  spokenText: string | null;
  createdAt: string;
};

export type VoiceSession = {
  id: string;
  userId: string;
  deviceId: string;
  assistantThreadId: string;
  mode: string;
  startedAt: string;
  endedAt: string | null;
};

export type TranscriptRecord = {
  id: string;
  voiceSessionId: string;
  assistantThreadId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  text: string;
  final: boolean;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  createdAt: string;
};

export type ApprovalCodeRecord = {
  id: string;
  voiceSessionId: string | null;
  userId: string;
  code: string;
  source: string;
  createdAt: string;
};

export type ClientStatusRecord = {
  deviceId: string;
  userId: string;
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

type UpsertUserInput = {
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function newSecret(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function dataDir(): string {
  return path.resolve(process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim() || path.join(process.cwd(), 'server', 'data'));
}

function dbPath(): string {
  return path.join(dataDir(), 'voice-stream-next.sqlite');
}

function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function rowUser(row: any): UserProfile {
  return {
    id: String(row.id),
    clerkUserId: String(row.clerk_user_id),
    displayName: String(row.display_name ?? ''),
    email: String(row.email ?? ''),
    admin: asBool(row.admin),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

function rowVoiceSettings(row: any): VoiceSettings {
  return {
    triggerPhrase: String(row.trigger_phrase ?? VOICE_APPROVAL_SETTINGS_DEFAULT.triggerPhrase),
    unlockCode: String(row.unlock_code ?? VOICE_APPROVAL_SETTINGS_DEFAULT.unlockCode),
    lockCode: String(row.lock_code ?? VOICE_APPROVAL_SETTINGS_DEFAULT.lockCode),
    lockedOffCode: String(row.off_code ?? VOICE_APPROVAL_SETTINGS_DEFAULT.lockedOffCode),
    minDigits: Number(row.min_digits ?? VOICE_APPROVAL_SETTINGS_DEFAULT.minDigits),
    maxDigits: Number(row.max_digits ?? VOICE_APPROVAL_SETTINGS_DEFAULT.maxDigits),
    stableMs: Number(row.stable_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.stableMs),
    collectTimeoutMs: Number(row.collect_timeout_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.collectTimeoutMs),
    duplicateCooldownMs: Number(row.duplicate_cooldown_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.duplicateCooldownMs),
    finalizeCheckIntervalMs: Number(row.finalize_check_interval_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.finalizeCheckIntervalMs),
    postPromptCommandSuppressionMs: Number(
      row.post_prompt_command_suppression_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.postPromptCommandSuppressionMs,
    ),
    updatedAt: String(row.updated_at),
  };
}

function rowDevice(row: any): DeviceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceType: String(row.device_type),
    displayName: String(row.display_name),
    tokenHint: String(row.token_hint ?? ''),
    lastSeenAt: String(row.last_seen_at),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

function rowPairingSession(row: any): PairingSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    expiresAt: String(row.expires_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    createdAt: String(row.created_at),
  };
}

function rowDesktopAuthRequest(row: any): DesktopAuthRequestRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    expiresAt: String(row.expires_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    userId: row.user_id == null ? null : String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    createdAt: String(row.created_at),
  };
}

function rowLog(row: any): LogRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    source: String(row.source),
    level: String(row.level),
    message: String(row.message),
    detailsJson: row.details_json == null ? null : String(row.details_json),
    createdAt: String(row.created_at),
  };
}

function rowThread(row: any): AssistantThread {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    title: String(row.title),
    source: String(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowMessage(row: any): AssistantMessage {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    userId: String(row.user_id),
    role: String(row.role) === 'assistant' ? 'assistant' : 'user',
    content: String(row.content ?? ''),
    spokenText: row.spoken_text == null ? null : String(row.spoken_text),
    createdAt: String(row.created_at),
  };
}

function rowVoiceSession(row: any): VoiceSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    assistantThreadId: String(row.assistant_thread_id),
    mode: String(row.mode),
    startedAt: String(row.started_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at),
  };
}

function rowApprovalCode(row: any): ApprovalCodeRecord {
  return {
    id: String(row.id),
    voiceSessionId: row.voice_session_id == null ? null : String(row.voice_session_id),
    userId: String(row.user_id),
    code: String(row.code),
    source: String(row.source),
    createdAt: String(row.created_at),
  };
}

function rowTranscript(row: any): TranscriptRecord {
  return {
    id: String(row.id),
    voiceSessionId: String(row.voice_session_id),
    assistantThreadId: String(row.assistant_thread_id ?? ''),
    userId: String(row.user_id),
    deviceId: String(row.device_id ?? ''),
    deviceName: String(row.device_name ?? ''),
    mode: String(row.mode ?? ''),
    text: String(row.text ?? ''),
    final: asBool(row.final),
    sessionStartedAt: String(row.session_started_at ?? row.created_at),
    sessionEndedAt: row.session_ended_at == null ? null : String(row.session_ended_at),
    createdAt: String(row.created_at),
  };
}

function rowClientStatus(row: any): ClientStatusRecord {
  return {
    deviceId: String(row.device_id),
    userId: String(row.user_id),
    deviceType: String(row.device_type ?? ''),
    displayName: String(row.display_name ?? ''),
    mode: String(row.mode ?? 'off'),
    status: String(row.status ?? ''),
    microphone: String(row.microphone ?? ''),
    protocolVersion: row.protocol_version == null ? null : Number(row.protocol_version),
    appVersion: row.app_version == null ? null : String(row.app_version),
    lastError: row.last_error == null ? null : String(row.last_error),
    reportedAt: String(row.reported_at),
    updatedAt: String(row.updated_at),
  };
}

export class VoiceStreamNextDb {
  readonly db: Database;
  readonly path: string;

  constructor(filePath = dbPath()) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.path = filePath;
    this.db = new Database(filePath, { create: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        clerk_user_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS voice_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        unlock_code TEXT NOT NULL,
        lock_code TEXT NOT NULL,
        off_code TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_hint TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS client_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        source TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS assistant_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        spoken_text TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        assistant_thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        voice_session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        final INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS client_status (
        device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        microphone TEXT NOT NULL,
        protocol_version INTEGER,
        app_version TEXT,
        last_error TEXT,
        reported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS approval_codes (
        id TEXT PRIMARY KEY,
        voice_session_id TEXT REFERENCES voice_sessions(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pairing_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS desktop_auth_requests (
        id TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        device_token_hash TEXT,
        device_token_hint TEXT
      )
    `);
    this.ensureColumn('desktop_auth_requests', 'device_token_hash', 'TEXT');
    this.ensureColumn('desktop_auth_requests', 'device_token_hint', 'TEXT');
    this.ensureColumn('devices', 'revoked_at', 'TEXT');
    this.ensureColumn('voice_settings', 'trigger_phrase', 'TEXT');
    this.ensureColumn('voice_settings', 'min_digits', 'INTEGER');
    this.ensureColumn('voice_settings', 'max_digits', 'INTEGER');
    this.ensureColumn('voice_settings', 'stable_ms', 'INTEGER');
    this.ensureColumn('voice_settings', 'collect_timeout_ms', 'INTEGER');
    this.ensureColumn('voice_settings', 'duplicate_cooldown_ms', 'INTEGER');
    this.ensureColumn('voice_settings', 'finalize_check_interval_ms', 'INTEGER');
    this.ensureColumn('voice_settings', 'post_prompt_command_suppression_ms', 'INTEGER');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (rows.some((row) => String(row.name) === column)) return;
    this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  upsertUser(input: UpsertUserInput): UserProfile {
    const at = nowIso();
    const existing = this.db
      .query('SELECT * FROM users WHERE clerk_user_id = $clerkUserId')
      .get({ $clerkUserId: input.clerkUserId });
    if (existing) {
      const nextAdmin = input.admin || asBool((existing as any).admin);
      this.db
        .query(
          `
          UPDATE users
          SET display_name = $displayName,
              email = $email,
              admin = $admin,
              updated_at = $updatedAt,
              last_seen_at = $lastSeenAt
          WHERE clerk_user_id = $clerkUserId
        `,
        )
        .run({
          $displayName: input.displayName,
          $email: input.email,
          $admin: nextAdmin ? 1 : 0,
          $updatedAt: at,
          $lastSeenAt: at,
          $clerkUserId: input.clerkUserId,
        });
    } else {
      this.db
        .query(
          `
          INSERT INTO users (id, clerk_user_id, display_name, email, admin, created_at, updated_at, last_seen_at)
          VALUES ($id, $clerkUserId, $displayName, $email, $admin, $createdAt, $updatedAt, $lastSeenAt)
        `,
        )
        .run({
          $id: newId('usr'),
          $clerkUserId: input.clerkUserId,
          $displayName: input.displayName,
          $email: input.email,
          $admin: input.admin ? 1 : 0,
          $createdAt: at,
          $updatedAt: at,
          $lastSeenAt: at,
        });
    }
    const user = this.userByClerkId(input.clerkUserId);
    if (!user) throw new Error('failed to upsert user');
    this.ensureVoiceSettings(user.id);
    return user;
  }

  userByClerkId(clerkUserId: string): UserProfile | null {
    const row = this.db.query('SELECT * FROM users WHERE clerk_user_id = $clerkUserId').get({ $clerkUserId: clerkUserId });
    return row ? rowUser(row) : null;
  }

  ensureVoiceSettings(userId: string): VoiceSettings {
    const existing = this.db.query('SELECT * FROM voice_settings WHERE user_id = $userId').get({ $userId: userId });
    if (existing) return rowVoiceSettings(existing);
    const at = nowIso();
    const defaults = VOICE_APPROVAL_SETTINGS_DEFAULT;
    this.db
      .query(
        `
        INSERT INTO voice_settings (
          id,
          user_id,
          unlock_code,
          lock_code,
          off_code,
          trigger_phrase,
          min_digits,
          max_digits,
          stable_ms,
          collect_timeout_ms,
          duplicate_cooldown_ms,
          finalize_check_interval_ms,
          post_prompt_command_suppression_ms,
          updated_at
        )
        VALUES (
          $id,
          $userId,
          $unlockCode,
          $lockCode,
          $offCode,
          $triggerPhrase,
          $minDigits,
          $maxDigits,
          $stableMs,
          $collectTimeoutMs,
          $duplicateCooldownMs,
          $finalizeCheckIntervalMs,
          $postPromptCommandSuppressionMs,
          $updatedAt
        )
      `,
      )
      .run({
        $id: newId('vset'),
        $userId: userId,
        $unlockCode: defaults.unlockCode,
        $lockCode: defaults.lockCode,
        $offCode: defaults.lockedOffCode,
        $triggerPhrase: defaults.triggerPhrase,
        $minDigits: defaults.minDigits,
        $maxDigits: defaults.maxDigits,
        $stableMs: defaults.stableMs,
        $collectTimeoutMs: defaults.collectTimeoutMs,
        $duplicateCooldownMs: defaults.duplicateCooldownMs,
        $finalizeCheckIntervalMs: defaults.finalizeCheckIntervalMs,
        $postPromptCommandSuppressionMs: defaults.postPromptCommandSuppressionMs,
        $updatedAt: at,
      });
    return this.ensureVoiceSettings(userId);
  }

  updateVoiceSettings(
    userId: string,
    input: { unlockCode: string; lockCode: string; offCode?: string; lockedOffCode?: string },
  ): VoiceSettings {
    const current = this.ensureVoiceSettings(userId);
    return this.updateVoiceApprovalSettings(userId, {
      ...current,
      unlockCode: input.unlockCode,
      lockCode: input.lockCode,
      lockedOffCode: input.lockedOffCode ?? input.offCode ?? current.lockedOffCode,
    });
  }

  updateVoiceApprovalSettings(userId: string, input: VoiceApprovalSettings): VoiceSettings {
    const at = nowIso();
    this.ensureVoiceSettings(userId);
    this.db
      .query(
        `
        UPDATE voice_settings
        SET unlock_code = $unlockCode,
            lock_code = $lockCode,
            off_code = $lockedOffCode,
            trigger_phrase = $triggerPhrase,
            min_digits = $minDigits,
            max_digits = $maxDigits,
            stable_ms = $stableMs,
            collect_timeout_ms = $collectTimeoutMs,
            duplicate_cooldown_ms = $duplicateCooldownMs,
            finalize_check_interval_ms = $finalizeCheckIntervalMs,
            post_prompt_command_suppression_ms = $postPromptCommandSuppressionMs,
            updated_at = $updatedAt
        WHERE user_id = $userId
      `,
      )
      .run({
        $unlockCode: input.unlockCode,
        $lockCode: input.lockCode,
        $lockedOffCode: input.lockedOffCode,
        $triggerPhrase: input.triggerPhrase,
        $minDigits: input.minDigits,
        $maxDigits: input.maxDigits,
        $stableMs: input.stableMs,
        $collectTimeoutMs: input.collectTimeoutMs,
        $duplicateCooldownMs: input.duplicateCooldownMs,
        $finalizeCheckIntervalMs: input.finalizeCheckIntervalMs,
        $postPromptCommandSuppressionMs: input.postPromptCommandSuppressionMs,
        $updatedAt: at,
        $userId: userId,
      });
    return this.ensureVoiceSettings(userId);
  }

  createPairingSession(userId: string, deviceId: string, expiresAt: string): PairingSessionRecord {
    const at = nowIso();
    const id = newId('pair');
    this.db
      .query(
        `
        INSERT INTO pairing_sessions (id, user_id, device_id, expires_at, claimed_at, created_at)
        VALUES ($id, $userId, $deviceId, $expiresAt, NULL, $createdAt)
        ON CONFLICT(device_id) DO UPDATE SET
          expires_at = excluded.expires_at,
          claimed_at = NULL,
          created_at = excluded.created_at
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: deviceId,
        $expiresAt: expiresAt,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM pairing_sessions WHERE device_id = $deviceId').get({ $deviceId: deviceId });
    return rowPairingSession(row);
  }

  pairingSessionForDevice(deviceId: string): PairingSessionRecord | null {
    const row = this.db.query('SELECT * FROM pairing_sessions WHERE device_id = $deviceId').get({ $deviceId: deviceId });
    return row ? rowPairingSession(row) : null;
  }

  claimPairingSession(deviceId: string): void {
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE pairing_sessions
        SET claimed_at = COALESCE(claimed_at, $claimedAt)
        WHERE device_id = $deviceId
      `,
      )
      .run({ $deviceId: deviceId, $claimedAt: at });
  }

  createDesktopAuthRequest(input: { displayName: string; expiresAt: string }): { request: DesktopAuthRequestRecord; secret: string; deviceToken: string } {
    const at = nowIso();
    const id = newId('dauth');
    const secret = newSecret();
    const deviceToken = newSecret();
    this.db
      .query(
        `
        INSERT INTO desktop_auth_requests (
          id,
          secret_hash,
          display_name,
          expires_at,
          claimed_at,
          user_id,
          device_id,
          created_at,
          device_token_hash,
          device_token_hint
        )
        VALUES ($id, $secretHash, $displayName, $expiresAt, NULL, NULL, NULL, $createdAt, $deviceTokenHash, $deviceTokenHint)
      `,
      )
      .run({
        $id: id,
        $secretHash: sha256(secret),
        $displayName: input.displayName,
        $expiresAt: input.expiresAt,
        $createdAt: at,
        $deviceTokenHash: sha256(deviceToken),
        $deviceTokenHint: deviceToken.slice(0, 6),
      });
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: id });
    return { request: rowDesktopAuthRequest(row), secret, deviceToken };
  }

  claimDesktopAuthRequest(userId: string, requestId: string, secret: string): DesktopAuthClaimResult {
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: requestId });
    if (!row) return { ok: false, reason: 'not_found' };
    if (String((row as any).secret_hash) !== sha256(secret)) return { ok: false, reason: 'invalid_secret' };
    const request = rowDesktopAuthRequest(row);
    if (request.claimedAt) return { ok: false, reason: 'claimed' };
    if (Date.parse(request.expiresAt) < Date.now()) return { ok: false, reason: 'expired' };
    const tokenHash = String((row as any).device_token_hash ?? '');
    const tokenHint = String((row as any).device_token_hint ?? '');
    if (!tokenHash || !tokenHint) return { ok: false, reason: 'invalid_secret' };

    const registered = this.registerDeviceWithTokenHash(userId, {
      deviceType: 'desktop',
      displayName: request.displayName,
      tokenHash,
      tokenHint,
    });
    const claimedAt = nowIso();
    this.db
      .query(
        `
        UPDATE desktop_auth_requests
        SET claimed_at = $claimedAt,
            user_id = $userId,
            device_id = $deviceId
        WHERE id = $id AND claimed_at IS NULL
      `,
      )
      .run({
        $claimedAt: claimedAt,
        $userId: userId,
        $deviceId: registered.id,
        $id: request.id,
      });
    const claimed = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: request.id });
    return { ok: true, request: rowDesktopAuthRequest(claimed), device: registered };
  }

  desktopAuthRequestResult(requestId: string, secret: string): DesktopAuthPollResult {
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: requestId });
    if (!row) return { ok: false, reason: 'not_found' };
    if (String((row as any).secret_hash) !== sha256(secret)) return { ok: false, reason: 'invalid_secret' };
    const request = rowDesktopAuthRequest(row);
    if (Date.parse(request.expiresAt) < Date.now() && !request.claimedAt) return { ok: false, reason: 'expired' };
    if (!request.deviceId) return { ok: true, status: 'pending', request };
    const deviceRow = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: request.deviceId });
    if (!deviceRow) return { ok: true, status: 'pending', request };
    return { ok: true, status: 'claimed', request, device: rowDevice(deviceRow) };
  }

  registerDevice(userId: string, input: { deviceType: string; displayName: string }): { device: DeviceRecord; token: string } {
    const at = nowIso();
    const id = newId('dev');
    const token = newSecret();
    const tokenHash = sha256(token);
    const tokenHint = token.slice(0, 6);
    this.db
      .query(
        `
        INSERT INTO devices (id, user_id, device_type, display_name, token_hash, token_hint, last_seen_at, created_at)
        VALUES ($id, $userId, $deviceType, $displayName, $tokenHash, $tokenHint, $lastSeenAt, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceType: input.deviceType,
        $displayName: input.displayName,
        $tokenHash: tokenHash,
        $tokenHint: tokenHint,
        $lastSeenAt: at,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: id });
    if (!row) {
      throw new Error('Registered device was not found');
    }
    const device = rowDevice(row);
    return { device, token };
  }

  registerDeviceWithTokenHash(
    userId: string,
    input: { deviceType: string; displayName: string; tokenHash: string; tokenHint: string },
  ): DeviceRecord {
    const at = nowIso();
    const id = newId('dev');
    this.db
      .query(
        `
        INSERT INTO devices (id, user_id, device_type, display_name, token_hash, token_hint, last_seen_at, created_at)
        VALUES ($id, $userId, $deviceType, $displayName, $tokenHash, $tokenHint, $lastSeenAt, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceType: input.deviceType,
        $displayName: input.displayName,
        $tokenHash: input.tokenHash,
        $tokenHint: input.tokenHint,
        $lastSeenAt: at,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: id });
    if (!row) {
      throw new Error('Registered device was not found');
    }
    return rowDevice(row);
  }

  listDevices(userId?: string, includeRevoked = false): DeviceRecord[] {
    const rows = userId
      ? this.db
          .query(
            `
            SELECT * FROM devices
            WHERE user_id = $userId ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
            ORDER BY last_seen_at DESC, created_at DESC
          `,
          )
          .all({ $userId: userId })
      : this.db
          .query(
            `
            SELECT * FROM devices
            ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'}
            ORDER BY last_seen_at DESC, created_at DESC
          `,
          )
          .all();
    return rows.map(rowDevice);
  }

  deviceForUser(userId: string, deviceId: string): DeviceRecord | null {
    const row = this.db.query('SELECT * FROM devices WHERE user_id = $userId AND id = $deviceId').get({ $userId: userId, $deviceId: deviceId });
    return row ? rowDevice(row) : null;
  }

  verifyDeviceToken(deviceId: string, token: string, options: { clientVersion?: number | null; minClientVersion?: number } = {}): DeviceAuthResult {
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: deviceId });
    if (!row) return { ok: false, reason: 'not_found' };
    if ((row as any).revoked_at != null) return { ok: false, reason: 'revoked' };
    const tokenHash = sha256(token);
    if (String((row as any).token_hash) !== tokenHash) return { ok: false, reason: 'invalid_token' };

    const pairing = this.pairingSessionForDevice(deviceId);
    if (pairing && !pairing.claimedAt && Date.parse(pairing.expiresAt) < Date.now()) {
      return { ok: false, reason: 'pairing_expired' };
    }

    const minClientVersion = options.minClientVersion ?? 1;
    if (options.clientVersion != null && options.clientVersion < minClientVersion) {
      return { ok: false, reason: 'client_too_old', minClientVersion };
    }

    const at = nowIso();
    this.db.query('UPDATE devices SET last_seen_at = $lastSeenAt WHERE id = $id').run({ $lastSeenAt: at, $id: deviceId });
    if (pairing && !pairing.claimedAt) this.claimPairingSession(deviceId);
    return { ok: true, device: rowDevice({ ...(row as any), last_seen_at: at }) };
  }

  revokeDevice(userId: string, deviceId: string): DeviceRecord | null {
    const device = this.deviceForUser(userId, deviceId);
    if (!device || device.revokedAt) return null;
    const at = nowIso();
    this.db.query('UPDATE devices SET revoked_at = $revokedAt WHERE id = $deviceId AND user_id = $userId').run({
      $revokedAt: at,
      $deviceId: deviceId,
      $userId: userId,
    });
    this.db.query('DELETE FROM pairing_sessions WHERE device_id = $deviceId').run({ $deviceId: deviceId });
    return { ...device, revokedAt: at };
  }

  rotateDeviceToken(userId: string, deviceId: string): { device: DeviceRecord; token: string } | null {
    const device = this.deviceForUser(userId, deviceId);
    if (!device || device.revokedAt) return null;
    const token = newSecret();
    const tokenHash = sha256(token);
    const tokenHint = token.slice(0, 6);
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE devices
        SET token_hash = $tokenHash,
            token_hint = $tokenHint,
            last_seen_at = $lastSeenAt
        WHERE id = $deviceId AND user_id = $userId
      `,
      )
      .run({
        $tokenHash: tokenHash,
        $tokenHint: tokenHint,
        $lastSeenAt: at,
        $deviceId: deviceId,
        $userId: userId,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $deviceId').get({ $deviceId: deviceId });
    return row ? { device: rowDevice(row), token } : null;
  }

  addLog(userId: string, input: { deviceId?: string | null; source: string; level: string; message: string; detailsJson?: string | null }): LogRecord {
    const id = newId('log');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO client_logs (id, user_id, device_id, source, level, message, details_json, created_at)
        VALUES ($id, $userId, $deviceId, $source, $level, $message, $detailsJson, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: input.deviceId ?? null,
        $source: input.source,
        $level: input.level,
        $message: input.message,
        $detailsJson: input.detailsJson ?? null,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM client_logs WHERE id = $id').get({ $id: id });
    return rowLog(row);
  }

  listLogs(userId: string, limit = 100): LogRecord[] {
    const rows = this.db
      .query('SELECT * FROM client_logs WHERE user_id = $userId ORDER BY created_at DESC LIMIT $limit')
      .all({ $userId: userId, $limit: limit });
    return rows.map(rowLog);
  }

  createThread(userId: string, input: { title?: string; source?: string; deviceId?: string | null }): AssistantThread {
    const id = newId('thr');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_threads (id, user_id, device_id, title, source, created_at, updated_at)
        VALUES ($id, $userId, $deviceId, $title, $source, $createdAt, $updatedAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: input.deviceId ?? null,
        $title: input.title?.trim() || 'Assistant thread',
        $source: input.source?.trim() || 'web',
        $createdAt: at,
        $updatedAt: at,
      });
    const row = this.db.query('SELECT * FROM assistant_threads WHERE id = $id').get({ $id: id });
    return rowThread(row);
  }

  listThreads(userId: string): AssistantThread[] {
    return this.db
      .query('SELECT * FROM assistant_threads WHERE user_id = $userId ORDER BY updated_at DESC, created_at DESC')
      .all({ $userId: userId })
      .map(rowThread);
  }

  thread(userId: string, threadId: string): AssistantThread | null {
    const row = this.db
      .query('SELECT * FROM assistant_threads WHERE user_id = $userId AND id = $threadId')
      .get({ $userId: userId, $threadId: threadId });
    return row ? rowThread(row) : null;
  }

  latestVoiceThreadForDevice(userId: string, deviceId: string): AssistantThread {
    const row = this.db
      .query(
        `
        SELECT * FROM assistant_threads
        WHERE user_id = $userId AND device_id = $deviceId AND source = 'voice'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      )
      .get({ $userId: userId, $deviceId: deviceId });
    return row ? rowThread(row) : this.createThread(userId, { deviceId, source: 'voice', title: 'Voice thread' });
  }

  addMessage(userId: string, threadId: string, input: { role: 'user' | 'assistant'; content: string; spokenText?: string | null }): AssistantMessage {
    const id = newId('msg');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_messages (id, thread_id, user_id, role, content, spoken_text, created_at)
        VALUES ($id, $threadId, $userId, $role, $content, $spokenText, $createdAt)
      `,
      )
      .run({
        $id: id,
        $threadId: threadId,
        $userId: userId,
        $role: input.role,
        $content: input.content,
        $spokenText: input.spokenText ?? null,
        $createdAt: at,
      });
    this.db.query('UPDATE assistant_threads SET updated_at = $updatedAt WHERE id = $threadId').run({
      $updatedAt: at,
      $threadId: threadId,
    });
    const row = this.db.query('SELECT * FROM assistant_messages WHERE id = $id').get({ $id: id });
    return rowMessage(row);
  }

  listMessages(userId: string, threadId: string): AssistantMessage[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_messages
        WHERE user_id = $userId AND thread_id = $threadId
        ORDER BY created_at ASC
      `,
      )
      .all({ $userId: userId, $threadId: threadId })
      .map(rowMessage);
  }

  createVoiceSession(userId: string, deviceId: string, mode = 'recording'): VoiceSession {
    const thread = this.latestVoiceThreadForDevice(userId, deviceId);
    const id = newId('vsn');
    const at = nowIso();
    const cleanMode = mode.trim() || 'recording';
    this.db
      .query(
        `
        INSERT INTO voice_sessions (id, user_id, device_id, assistant_thread_id, mode, started_at)
        VALUES ($id, $userId, $deviceId, $assistantThreadId, $mode, $startedAt)
      `,
      )
      .run({ $id: id, $userId: userId, $deviceId: deviceId, $assistantThreadId: thread.id, $mode: cleanMode, $startedAt: at });
    const row = this.db.query('SELECT * FROM voice_sessions WHERE id = $id').get({ $id: id });
    return rowVoiceSession(row);
  }

  voiceSession(userId: string, sessionId: string): VoiceSession | null {
    const row = this.db
      .query('SELECT * FROM voice_sessions WHERE user_id = $userId AND id = $sessionId')
      .get({ $userId: userId, $sessionId: sessionId });
    return row ? rowVoiceSession(row) : null;
  }

  voiceSessionForDevice(userId: string, deviceId: string, sessionId: string): VoiceSession | null {
    const row = this.db
      .query('SELECT * FROM voice_sessions WHERE user_id = $userId AND device_id = $deviceId AND id = $sessionId')
      .get({ $userId: userId, $deviceId: deviceId, $sessionId: sessionId });
    return row ? rowVoiceSession(row) : null;
  }

  latestVoiceSessionForDevice(userId: string, deviceId: string): VoiceSession | null {
    const row = this.db
      .query(
        `
        SELECT * FROM voice_sessions
        WHERE user_id = $userId AND device_id = $deviceId
        ORDER BY started_at DESC
        LIMIT 1
      `,
      )
      .get({ $userId: userId, $deviceId: deviceId });
    return row ? rowVoiceSession(row) : null;
  }

  addTranscript(userId: string, voiceSessionId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.db
      .query(
        `
        INSERT INTO transcripts (id, voice_session_id, user_id, text, final, created_at)
        VALUES ($id, $voiceSessionId, $userId, $text, 1, $createdAt)
      `,
      )
      .run({ $id: newId('trn'), $voiceSessionId: voiceSessionId, $userId: userId, $text: trimmed, $createdAt: nowIso() });
  }

  listTranscripts(userId: string, limit = 100, options: { deviceId?: string; voiceSessionId?: string } = {}): TranscriptRecord[] {
    const filters = ['transcripts.user_id = $userId'];
    const params: { $userId: string; $limit: number; $deviceId?: string; $voiceSessionId?: string } = {
      $userId: userId,
      $limit: limit,
    };
    if (options.deviceId) {
      filters.push('voice_sessions.device_id = $deviceId');
      params.$deviceId = options.deviceId;
    }
    if (options.voiceSessionId) {
      filters.push('transcripts.voice_session_id = $voiceSessionId');
      params.$voiceSessionId = options.voiceSessionId;
    }
    return this.db
      .query(
        `
        SELECT transcripts.*,
               voice_sessions.device_id,
               voice_sessions.mode,
               voice_sessions.assistant_thread_id,
               voice_sessions.started_at AS session_started_at,
               voice_sessions.ended_at AS session_ended_at,
               devices.display_name AS device_name
        FROM transcripts
        JOIN voice_sessions ON voice_sessions.id = transcripts.voice_session_id
        LEFT JOIN devices ON devices.id = voice_sessions.device_id
        WHERE ${filters.join(' AND ')}
        ORDER BY transcripts.created_at DESC
        LIMIT $limit
      `,
      )
      .all(params)
      .map(rowTranscript);
  }

  upsertClientStatus(
    userId: string,
    deviceId: string,
    input: {
      mode: string;
      status: string;
      microphone?: string;
      protocolVersion?: number | null;
      appVersion?: string | null;
      lastError?: string | null;
      reportedAt?: string | null;
    },
  ): ClientStatusRecord {
    const at = nowIso();
    const reportedAt = input.reportedAt?.trim() || at;
    this.db
      .query(
        `
        INSERT INTO client_status (device_id, user_id, mode, status, microphone, protocol_version, app_version, last_error, reported_at, updated_at)
        VALUES ($deviceId, $userId, $mode, $status, $microphone, $protocolVersion, $appVersion, $lastError, $reportedAt, $updatedAt)
        ON CONFLICT(device_id) DO UPDATE SET
          mode = excluded.mode,
          status = excluded.status,
          microphone = excluded.microphone,
          protocol_version = excluded.protocol_version,
          app_version = excluded.app_version,
          last_error = excluded.last_error,
          reported_at = excluded.reported_at,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $deviceId: deviceId,
        $userId: userId,
        $mode: input.mode.trim() || 'off',
        $status: input.status.trim() || 'No status',
        $microphone: input.microphone?.trim() || '',
        $protocolVersion: input.protocolVersion ?? null,
        $appVersion: input.appVersion?.trim() || null,
        $lastError: input.lastError?.trim() || null,
        $reportedAt: reportedAt,
        $updatedAt: at,
      });
    const row = this.db
      .query(
        `
        SELECT client_status.*, devices.device_type, devices.display_name
        FROM client_status
        JOIN devices ON devices.id = client_status.device_id
        WHERE client_status.device_id = $deviceId
      `,
      )
      .get({ $deviceId: deviceId });
    return rowClientStatus(row);
  }

  listClientStatuses(userId?: string): ClientStatusRecord[] {
    const query = `
      SELECT client_status.*, devices.device_type, devices.display_name
      FROM client_status
      JOIN devices ON devices.id = client_status.device_id
      ${userId ? 'WHERE client_status.user_id = $userId' : ''}
      ORDER BY client_status.updated_at DESC
    `;
    const rows = userId ? this.db.query(query).all({ $userId: userId }) : this.db.query(query).all();
    return rows.map(rowClientStatus);
  }

  addApprovalCode(userId: string, input: { voiceSessionId?: string | null; code: string; source: string }): ApprovalCodeRecord {
    const id = newId('apv');
    this.db
      .query(
        `
        INSERT INTO approval_codes (id, voice_session_id, user_id, code, source, created_at)
        VALUES ($id, $voiceSessionId, $userId, $code, $source, $createdAt)
      `,
      )
      .run({
        $id: id,
        $voiceSessionId: input.voiceSessionId ?? null,
        $userId: userId,
        $code: input.code,
        $source: input.source,
        $createdAt: nowIso(),
      });
    const row = this.db.query('SELECT * FROM approval_codes WHERE id = $id').get({ $id: id });
    return rowApprovalCode(row);
  }

  listApprovalCodes(userId: string, limit = 40): ApprovalCodeRecord[] {
    return this.db
      .query('SELECT * FROM approval_codes WHERE user_id = $userId ORDER BY created_at DESC LIMIT $limit')
      .all({ $userId: userId, $limit: limit })
      .map(rowApprovalCode);
  }

  endVoiceSession(userId: string, sessionId: string): void {
    this.db
      .query('UPDATE voice_sessions SET ended_at = $endedAt WHERE user_id = $userId AND id = $sessionId AND ended_at IS NULL')
      .run({ $endedAt: nowIso(), $userId: userId, $sessionId: sessionId });
  }

  dashboard(user: UserProfile): any {
    const settings = this.ensureVoiceSettings(user.id);
    const threads = this.listThreads(user.id);
    const logs = this.listLogs(user.id, 60);
    const devices = this.listDevices(user.id);
    const pairingSessions = devices
      .map((device) => this.pairingSessionForDevice(device.id))
      .filter((session): session is PairingSessionRecord => session != null);
    return {
      user,
      settings,
      threads,
      logs,
      approvalCodes: this.listApprovalCodes(user.id, 40),
      devices,
      pairingSessions,
      transcripts: this.listTranscripts(user.id, 40),
      clientStatuses: this.listClientStatuses(user.id),
      adminDevices: user.admin ? this.listDevices() : [],
      adminClientStatuses: user.admin ? this.listClientStatuses() : [],
      stats: {
        threadCount: threads.length,
        deviceCount: devices.length,
        logCount: logs.length,
        transcriptCount: this.listTranscripts(user.id, 200).length,
      },
      dbPath: this.path,
    };
  }
}
