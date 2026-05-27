import path from 'node:path';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { VoiceStreamNextDb, type AssistantMessage } from './db.js';
import { requireAdmin, resolveRequestUser, type AuthContext } from './auth.js';
import { synthesizeSpeech, transcribePcm16 } from './assistant-runtime.js';
import {
  StreamingTranscriptionManager,
  buildStreamingTranscriptionConfigFromEnv,
  streamingTranscriptionEnabled,
  type TerminalCommand,
} from './streaming-transcription.js';
import { approvalCodeFromText } from './approval-code.js';
import { parseVoiceApprovalSettings, voiceApprovalSettingsResponse } from './voice-approval-settings.js';
import {
  assistantAvailableToolSummaries,
  assistantSnapshot,
  promptAssistantThread,
  resolveAssistantApproval,
  sanitizeArtifactPath,
  setAssistantExternalToolExecutor,
} from './assistant-parity.js';
import {
  cleanTargetKind,
  extensionToolName,
  parseAssistantExtensionManifest,
} from './assistant-extensions.js';
import { ExtensionBridgeRegistry, parseExtensionBridgeMessage } from './extension-bridge.js';
import {
  createCodexAuthorizationFlow,
  exchangeCodexAuthorizationCode,
  parseCodexAuthorizationInput,
} from './codex-auth.js';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_STREAM_BYTES,
  MAX_STREAM_DURATION_MS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceCloseCode,
  parseControlClientMessage,
  parseVoiceClientMessage,
  type ControlCommand,
} from './protocol.js';
import { buildPairingPayload, buildUpdatePayload, minClientVersion, pairingExpiresAt, parseClientVersion } from './pairing.js';
import { ControlChannelRegistry } from './control-channel.js';
import type { DeviceAuthResult } from './db.js';

type AppOptions = {
  logger?: boolean;
};

type AndroidApkInfo = {
  available: boolean;
  platform: 'android';
  app: string;
  variant: string | null;
  versionCode: number | null;
  versionName: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
  updatePayload: string | null;
};

type DesktopAppInfo = {
  available: boolean;
  platform: 'desktop';
  app: string;
  variant: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
};

function parsePort(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function jsonBody(req: FastifyRequest): any {
  return req.body && typeof req.body === 'object' ? (req.body as any) : {};
}

function cleanText(raw: unknown, fallback = ''): string {
  return String(raw ?? fallback).trim();
}

function cleanCode(raw: unknown, label: string): string {
  const value = String(raw ?? '').replace(/\D/g, '');
  if (!value || value.length > 12) throw Object.assign(new Error(`${label} must be 1-12 digits`), { statusCode: 400 });
  return value;
}

function cleanVoiceStreamMode(raw: string): 'assistant' | 'patch' | 'clipboard' {
  return raw === 'patch' || raw === 'clipboard' ? raw : 'assistant';
}

function cleanDeviceMode(raw: unknown): string {
  const mode = cleanText(raw, 'off').toLowerCase();
  return ['off', 'awake', 'sleeping', 'recording', 'transcribing', 'error'].includes(mode) ? mode : 'error';
}

function desktopAuthExpiresAt(from = Date.now()): string {
  const raw = Number(process.env.VOICE_STREAM_NEXT_DESKTOP_AUTH_TTL_MS ?? 10 * 60 * 1000);
  const ttlMs = Number.isInteger(raw) && raw > 0 ? raw : 10 * 60 * 1000;
  return new Date(from + ttlMs).toISOString();
}

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function voiceStreamDataDir(): string {
  return path.resolve(
    process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim() ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
      path.join(process.cwd(), 'server', 'data'),
  );
}

function androidApkDir(): string {
  return path.join(voiceStreamDataDir(), 'mobile', 'Android');
}

function androidApkDownloadPath(): string {
  return '/api/mobile/android/apk';
}

function desktopAppDir(): string {
  return process.env.VOICE_STREAM_NEXT_DESKTOP_DOWNLOAD_DIR?.trim() || path.join(voiceStreamDataDir(), 'desktop');
}

function desktopAppDownloadPath(): string {
  return '/api/desktop/download';
}

function publicUrlForPath(req: FastifyRequest, urlPath: string): string {
  return `${serverPublicUrl(req)}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
}

function readAndroidApkInfo(req: FastifyRequest): AndroidApkInfo {
  const metadataFile = path.join(androidApkDir(), 'latest.json');
  const fallback = {
    available: false,
    platform: 'android' as const,
    app: 'voice-stream-next',
    variant: null,
    versionCode: null,
    versionName: null,
    fileName: null,
    size: null,
    builtAt: null,
    downloadUrl: null,
    updatePayload: null,
  };
  if (!existsSync(metadataFile)) return fallback;

  let metadata: any = null;
  try {
    metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  } catch {
    return fallback;
  }

  const fileName = path.basename(cleanText(metadata.fileName, 'voice-stream-next-android-latest.apk'));
  const apkFile = path.join(androidApkDir(), fileName);
  if (!existsSync(apkFile)) return fallback;

  const stat = statSync(apkFile);
  const versionCode = parseClientVersion(metadata.versionCode, null);
  const downloadUrl = publicUrlForPath(req, androidApkDownloadPath());
  return {
    available: true,
    platform: 'android',
    app: cleanText(metadata.app, 'voice-stream-next') || 'voice-stream-next',
    variant: cleanText(metadata.variant) || null,
    versionCode,
    versionName: cleanText(metadata.versionName) || null,
    fileName,
    size: stat.size,
    builtAt: cleanText(metadata.builtAt) || null,
    downloadUrl,
    updatePayload: versionCode ? buildUpdatePayload({ versionCode, apkUrl: downloadUrl }) : null,
  };
}

function newestDesktopArtifact(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((fileName) => /\.(zip|dmg|exe|appimage|tar\.gz)$/i.test(fileName))
    .map((fileName) => ({ fileName, stat: statSync(path.join(dir, fileName)) }))
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return candidates[0]?.fileName ?? null;
}

function readDesktopAppInfo(req: FastifyRequest): DesktopAppInfo {
  const dir = desktopAppDir();
  const fallback = {
    available: false,
    platform: 'desktop' as const,
    app: 'voice-stream-next',
    variant: null,
    fileName: null,
    size: null,
    builtAt: null,
    downloadUrl: null,
  };

  let metadata: any = null;
  const metadataFile = path.join(dir, 'latest.json');
  if (existsSync(metadataFile)) {
    try {
      metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    } catch {
      metadata = null;
    }
  }

  const fileName = path.basename(cleanText(metadata?.fileName) || newestDesktopArtifact(dir) || '');
  if (!fileName) return fallback;
  const artifactFile = path.join(dir, fileName);
  if (!existsSync(artifactFile)) return fallback;
  const stat = statSync(artifactFile);
  if (!stat.isFile()) return fallback;

  return {
    available: true,
    platform: 'desktop',
    app: cleanText(metadata?.app, 'voice-stream-next') || 'voice-stream-next',
    variant: cleanText(metadata?.variant) || null,
    fileName,
    size: stat.size,
    builtAt: cleanText(metadata?.builtAt) || stat.mtime.toISOString(),
    downloadUrl: publicUrlForPath(req, desktopAppDownloadPath()),
  };
}

function desktopContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.appimage')) return 'application/octet-stream';
  if (lower.endsWith('.tar.gz')) return 'application/gzip';
  return 'application/octet-stream';
}

function binarySize(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, item) => total + binarySize(item), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

function binaryChunk(data: unknown): Uint8Array | null {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function serverPublicUrl(req: FastifyRequest): string {
  const configured = process.env.VOICE_STREAM_NEXT_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const origin = originUrl(req.headers.origin);
  if (origin) return origin;
  const proto = forwardedProto || String((req as any).protocol ?? 'http');
  const host = forwardedHost || firstHeaderValue(req.headers.host);
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function firstHeaderValue(raw: unknown): string {
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',')[0].trim();
}

function originUrl(raw: unknown): string {
  const value = firstHeaderValue(raw);
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function deviceAuthFailureMessage(result: Extract<DeviceAuthResult, { ok: false }>): string {
  switch (result.reason) {
    case 'revoked':
      return 'device revoked';
    case 'pairing_expired':
      return 'pairing payload expired';
    case 'client_too_old':
      return `client version below minimum ${result.minClientVersion ?? minClientVersion()}`;
    case 'invalid_token':
      return 'invalid device token';
    default:
      return 'unknown device';
  }
}

function deviceAuthCloseCode(result: Extract<DeviceAuthResult, { ok: false }>): number {
  switch (result.reason) {
    case 'revoked':
      return VoiceCloseCode.Revoked;
    case 'pairing_expired':
      return VoiceCloseCode.PairingExpired;
    case 'client_too_old':
      return VoiceCloseCode.ClientTooOld;
    default:
      return VoiceCloseCode.Unauthorized;
  }
}

function setupFailureStatus(reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed'): number {
  if (reason === 'expired' || reason === 'claimed') return 409;
  if (reason === 'invalid_secret') return 401;
  return 404;
}

function setupFailureMessage(reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed'): string {
  switch (reason) {
    case 'expired':
      return 'Android setup QR expired';
    case 'claimed':
      return 'Android setup QR was already used';
    case 'invalid_secret':
      return 'invalid Android setup QR';
    default:
      return 'unknown Android setup QR';
  }
}

function verifyDeviceAuth(
  db: VoiceStreamNextDb,
  deviceId: string,
  token: string,
  clientVersion?: number | null,
): DeviceAuthResult {
  return db.verifyDeviceToken(deviceId, token, {
    clientVersion,
    minClientVersion: minClientVersion(),
  });
}

function cleanControlCommand(raw: unknown): ControlCommand {
  const value = cleanText(raw).toLowerCase();
  if (value === 'sleep' || value === 'off' || value === 'awake' || value === 'query_status') return value;
  throw Object.assign(new Error('command must be sleep, off, awake, or query_status'), { statusCode: 400 });
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function withUser<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  db: VoiceStreamNextDb,
  clerkEnabled: boolean,
  fn: (ctx: AuthContext) => Promise<T> | T,
): Promise<T | undefined> {
  try {
    const ctx = await resolveRequestUser(req, db, clerkEnabled);
    return await fn(ctx);
  } catch (error: any) {
    const status = Number(error?.statusCode ?? 0) || 500;
    reply.code(status).send({ ok: false, error: error?.message ?? String(error) });
    return undefined;
  }
}

export async function buildApp(options: AppOptions = {}): Promise<{ app: FastifyInstance; db: VoiceStreamNextDb; port: number }> {
  const app = Fastify({ logger: options.logger ?? true });
  const db = new VoiceStreamNextDb();
  const controlChannels = new ControlChannelRegistry();
  const extensionBridges = new ExtensionBridgeRegistry();
  const assistantEventClients = new Set<{ res: any; userId: string }>();
  let assistantChangeSequence = 0;
  const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY?.trim());
  const port = parsePort(process.env.VOICE_STREAM_NEXT_API_PORT ?? process.env.PORT, 3299);

  db.clearAssistantExtensionManifests();

  setAssistantExternalToolExecutor(async (input) => {
    if (input.route?.targetKind === 'server') {
      throw Object.assign(new Error(`${input.toolName} is configured for server execution, but no server-side extension runner is installed`), { statusCode: 501 });
    }
    return extensionBridges.executeTool({
      userId: input.userId,
      toolName: input.toolName,
      args: input.args,
      route: input.route,
      threadId: input.thread.id,
      runId: input.runId,
      toolCallId: input.toolCallId,
    });
  });

  const writeAssistantSseEvent = (res: any, event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const emitAssistantChange = (reason: string, threadId?: string) => {
    const event = {
      type: 'assistant_changed',
      sequence: ++assistantChangeSequence,
      reason,
      ...(threadId ? { threadId } : {}),
      at: new Date().toISOString(),
    };
    for (const client of [...assistantEventClients]) {
      if (client.res.destroyed || client.res.writableEnded) {
        assistantEventClients.delete(client);
        continue;
      }
      writeAssistantSseEvent(client.res, 'assistant_change', event);
    }
  };
  const emitAssistantSpeak = (userId: string, threadId: string, message: AssistantMessage) => {
    const text = String(message.spokenText ?? '').trim();
    if (!text) return;
    const event = {
      type: 'assistant_speak',
      threadId,
      messageId: message.id,
      text,
      at: new Date().toISOString(),
    };
    for (const client of [...assistantEventClients]) {
      if (client.res.destroyed || client.res.writableEnded) {
        assistantEventClients.delete(client);
        continue;
      }
      if (client.userId !== userId) continue;
      writeAssistantSseEvent(client.res, 'assistant_speak', event);
    }
  };
  app.addHook('onClose', async () => {
    setAssistantExternalToolExecutor(null);
  });
  const handleAssistantPromptEvent = (userId: string, threadId: string, event: any) => {
    if (event?.type === 'message' && event.message?.spokenText) {
      emitAssistantSpeak(userId, threadId, event.message as AssistantMessage);
    }
    if (['snapshot', 'message', 'queued', 'tool_call', 'tool_result', 'approval_pending', 'done', 'error'].includes(String(event?.type ?? ''))) {
      emitAssistantChange(`assistant_${String(event.type)}`, threadId);
    }
  };
  const emitNewSpokenMessages = (userId: string, threadId: string, beforeIds: Set<string>) => {
    for (const message of db.listMessages(userId, threadId)) {
      if (!message.spokenText || beforeIds.has(message.id)) continue;
      emitAssistantSpeak(userId, threadId, message);
    }
  };

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(websocket);

  if (clerkEnabled) {
    await app.register(clerkPlugin);
  }

  app.get('/api/health', async () => ({
    ok: true,
    app: 'voice-stream-next',
    clerk: clerkEnabled ? 'enabled' : 'dev-fallback',
    dbPath: db.path,
  }));

  app.get('/api/mobile/android', async (req) => ({
    ok: true,
    android: readAndroidApkInfo(req),
  }));

  app.get('/api/desktop', async (req) => ({
    ok: true,
    desktop: readDesktopAppInfo(req),
  }));

  app.post('/api/mobile/android/setup', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const expiresAt = pairingExpiresAt();
      const created = db.createAndroidSetupSession(ctx.user.id, expiresAt);
      const setupPath = `/api/mobile/android/setup/${encodeURIComponent(created.session.id)}?secret=${encodeURIComponent(created.secret)}`;
      return {
        ok: true,
        android: readAndroidApkInfo(req),
        setup: {
          id: created.session.id,
          expiresAt: created.session.expiresAt,
          setupUrl: publicUrlForPath(req, setupPath),
        },
      };
    }),
  );

  app.get('/api/mobile/android/setup/:setupId', async (req, reply) => {
    const setupId = cleanText((req.params as any).setupId);
    const secret = queryValue((req.query as any).secret).trim();
    const checked = db.androidSetupSession(setupId, secret);
    if (!checked.ok) {
      reply.code(setupFailureStatus(checked.reason)).type('text/plain').send(setupFailureMessage(checked.reason));
      return;
    }
    const android = readAndroidApkInfo(req);
    if (!android.available || !android.downloadUrl) {
      reply.code(404).type('text/plain').send('Android APK has not been built yet');
      return;
    }
    reply.redirect(android.downloadUrl);
  });

  app.post('/api/mobile/android/setup/:setupId/redeem', async (req, reply) => {
    const setupId = cleanText((req.params as any).setupId);
    const body = jsonBody(req);
    const secret = cleanText(body.secret || (req.query as any).secret);
    const checked = db.androidSetupSession(setupId, secret);
    if (!checked.ok) {
      reply.code(setupFailureStatus(checked.reason)).send({ ok: false, error: setupFailureMessage(checked.reason), reason: checked.reason });
      return;
    }

    const android = readAndroidApkInfo(req);
    const clientVersion = parseClientVersion(body.clientVersion, null);
    if (android.available && android.versionCode != null && clientVersion != null && clientVersion < android.versionCode) {
      return {
        ok: true,
        paired: false,
        updateAvailable: true,
        currentVersionCode: clientVersion,
        android,
      };
    }

    const expiresAt = pairingExpiresAt();
    const claimed = db.claimAndroidSetupSession(setupId, secret, {
      displayName: cleanText(body.displayName, 'Android voice client') || 'Android voice client',
      expiresAt,
    });
    if (!claimed.ok) {
      reply.code(setupFailureStatus(claimed.reason)).send({ ok: false, error: setupFailureMessage(claimed.reason), reason: claimed.reason });
      return;
    }

    const payload = buildPairingPayload({
      serverUrl: serverPublicUrl(req),
      deviceId: claimed.device.id,
      token: claimed.token,
      deviceType: 'android',
      displayName: claimed.device.displayName,
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      expiresAt,
      pairingSessionId: claimed.pairingSession.id,
      apkUrl: android.downloadUrl,
    });
    db.addLog(claimed.device.userId, {
      deviceId: claimed.device.id,
      source: 'android',
      level: 'info',
      message: `Android setup QR paired: ${claimed.device.displayName}`,
      detailsJson: JSON.stringify({ androidSetupSessionId: claimed.session.id, expiresAt }),
    });
    return {
      ok: true,
      paired: true,
      updateAvailable: false,
      currentVersionCode: clientVersion,
      device: claimed.device,
      pairingSession: claimed.pairingSession,
      expiresAt,
      android,
      minClientVersion: minClientVersion(),
      ...payload,
    };
  });

  app.get('/api/mobile/android/apk', async (req, reply) => {
    const info = readAndroidApkInfo(req);
    if (!info.available || !info.fileName) {
      reply.code(404).send({ ok: false, error: 'Android APK has not been built yet' });
      return;
    }
    const apkFile = path.join(androidApkDir(), info.fileName);
    reply
      .type('application/vnd.android.package-archive')
      .header('content-disposition', `attachment; filename="${info.fileName}"`)
      .header('content-length', String(info.size ?? statSync(apkFile).size));
    return reply.send(createReadStream(apkFile));
  });

  app.get('/api/desktop/download', async (req, reply) => {
    const info = readDesktopAppInfo(req);
    if (!info.available || !info.fileName) {
      reply.code(404).send({ ok: false, error: 'Desktop app has not been built yet' });
      return;
    }
    const desktopFile = path.join(desktopAppDir(), info.fileName);
    reply
      .type(desktopContentType(info.fileName))
      .header('content-disposition', `attachment; filename="${info.fileName}"`)
      .header('content-length', String(info.size ?? statSync(desktopFile).size));
    return reply.send(createReadStream(desktopFile));
  });

  app.get('/api/assistant/events', async (req, reply) => {
    try {
      const ctx = await resolveRequestUser(req, db, clerkEnabled);
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      (req.raw.socket as any).setTimeout?.(0);
      const client = { res: reply.raw, userId: ctx.user.id };
      assistantEventClients.add(client);
      writeAssistantSseEvent(reply.raw, 'connected', { ok: true, at: new Date().toISOString() });
      const keepAlive = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(': keepalive\n\n');
      }, 25_000);
      (keepAlive as any).unref?.();
      const cleanup = () => {
        clearInterval(keepAlive);
        assistantEventClients.delete(client);
      };
      req.raw.on('close', cleanup);
      reply.raw.on('close', cleanup);
    } catch (error: any) {
      reply.code(Number(error?.statusCode ?? 401) || 401).send({ ok: false, error: error?.message ?? String(error) });
    }
  });

  app.get('/api/me', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      authMode: ctx.mode,
      user: ctx.user,
      settings: db.ensureVoiceSettings(ctx.user.id),
    })),
  );

  app.get('/api/dashboard', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      authMode: ctx.mode,
      ...db.dashboard(ctx.user),
    })),
  );

  app.patch('/api/settings/voice-codes', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const current = db.ensureVoiceSettings(ctx.user.id);
      const settings = db.updateVoiceSettings(ctx.user.id, {
        unlockCode: cleanCode(body.unlockCode, 'unlock code'),
        lockCode: cleanCode(body.lockCode, 'lock code'),
        lockedOffCode: cleanCode(body.offCode ?? body.lockedOffCode ?? current.lockedOffCode, 'off code'),
      });
      return { ok: true, settings };
    }),
  );

  app.get('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => voiceApprovalSettingsResponse(db.ensureVoiceSettings(ctx.user.id))),
  );

  app.post('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const payload = body.settings ?? body.voiceApproval ?? body;
      const parsed = parseVoiceApprovalSettings(payload);
      if (!parsed) {
        throw Object.assign(new Error('Invalid voice approval settings.'), { statusCode: 400 });
      }
      const settings = db.updateVoiceApprovalSettings(ctx.user.id, parsed);
      return voiceApprovalSettingsResponse(settings);
    }),
  );

  app.post('/api/desktop-auth/requests', async (req, reply) => {
    try {
      const body = jsonBody(req);
      const displayName = cleanText(body.displayName, 'Desktop voice client') || 'Desktop voice client';
      const expiresAt = desktopAuthExpiresAt();
      const { request, secret, deviceToken } = db.createDesktopAuthRequest({ displayName, expiresAt });
      return {
        ok: true,
        requestId: request.id,
        secret,
        deviceToken,
        expiresAt: request.expiresAt,
        minClientVersion: minClientVersion(),
      };
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? String(error) });
      return undefined;
    }
  });

  app.post('/api/desktop-auth/claim', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const requestId = cleanText(body.requestId);
      const secret = cleanText(body.secret);
      if (!requestId || !secret) throw Object.assign(new Error('desktop auth request is missing'), { statusCode: 400 });
      const claimed = db.claimDesktopAuthRequest(ctx.user.id, requestId, secret);
      if (!claimed.ok && claimed.reason === 'claimed') {
        return { ok: true, alreadyClaimed: true, minClientVersion: minClientVersion() };
      }
      if (!claimed.ok) {
        const status = claimed.reason === 'expired' ? 409 : 404;
        throw Object.assign(new Error(`desktop auth request ${claimed.reason.replace('_', ' ')}`), { statusCode: status });
      }
      db.addLog(ctx.user.id, {
        deviceId: claimed.device.id,
        source: 'web',
        level: 'info',
        message: `Desktop auto-connected: ${claimed.device.displayName}`,
        detailsJson: JSON.stringify({ desktopAuthRequestId: claimed.request.id }),
      });
      return {
        ok: true,
        device: claimed.device,
        minClientVersion: minClientVersion(),
      };
    }),
  );

  app.post('/api/desktop-auth/result', async (req, reply) => {
    try {
      const body = jsonBody(req);
      const requestId = cleanText(body.requestId);
      const secret = cleanText(body.secret);
      if (!requestId || !secret) {
        reply.code(400).send({ ok: false, error: 'desktop auth request is missing' });
        return undefined;
      }
      const result = db.desktopAuthRequestResult(requestId, secret);
      if (!result.ok) {
        const status = result.reason === 'expired' ? 409 : 404;
        reply.code(status).send({ ok: false, error: `desktop auth request ${result.reason.replace('_', ' ')}` });
        return undefined;
      }
      return {
        ok: true,
        status: result.status,
        request: result.request,
        device: result.status === 'claimed' ? result.device : undefined,
        minClientVersion: minClientVersion(),
      };
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? String(error) });
      return undefined;
    }
  });

  app.post('/api/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceType = cleanText(body.deviceType, 'desktop') || 'desktop';
      const displayName = cleanText(body.displayName, deviceType) || deviceType;
      const result = db.registerDevice(ctx.user.id, { deviceType, displayName });
      db.addLog(ctx.user.id, {
        deviceId: result.device.id,
        source: deviceType,
        level: 'info',
        message: `Device paired: ${displayName}`,
        detailsJson: JSON.stringify({ deviceType }),
      });
      return { ok: true, ...result };
    }),
  );

  app.post('/api/pairing/payload', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceType = cleanText(body.deviceType, 'android') || 'android';
      const displayName = cleanText(body.displayName, deviceType === 'desktop' ? 'Desktop voice client' : 'Android voice client');
      const result = db.registerDevice(ctx.user.id, { deviceType, displayName });
      const expiresAt = pairingExpiresAt();
      const pairingSession = db.createPairingSession(ctx.user.id, result.device.id, expiresAt);
      const androidApk = readAndroidApkInfo(req);
      const payload = buildPairingPayload({
        serverUrl: serverPublicUrl(req),
        deviceId: result.device.id,
        token: result.token,
        deviceType,
        displayName,
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
        expiresAt,
        pairingSessionId: pairingSession.id,
        apkUrl: deviceType === 'android' ? androidApk.downloadUrl : null,
      });
      db.addLog(ctx.user.id, {
        deviceId: result.device.id,
        source: 'web',
        level: 'info',
        message: `Pairing payload created: ${displayName}`,
        detailsJson: JSON.stringify({ deviceType, expiresAt, pairingSessionId: pairingSession.id }),
      });
      return {
        ok: true,
        device: result.device,
        token: result.token,
        pairingSession,
        expiresAt,
        minClientVersion: minClientVersion(),
        androidApk,
        ...payload,
      };
    }),
  );

  app.get('/api/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      devices: db.listDevices(ctx.user.id),
      pairingSessions: db.listDevices(ctx.user.id).map((device) => db.pairingSessionForDevice(device.id)).filter(Boolean),
      clientStatuses: db.listClientStatuses(ctx.user.id),
      connectedDeviceIds: controlChannels.connectedDeviceIds().filter((deviceId) => Boolean(db.deviceForUser(ctx.user.id, deviceId))),
      extensionBridgeDevices: extensionBridges.connectedDevices(ctx.user.id),
    })),
  );

  app.get('/api/assistant/extensions', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const connectedDevices = extensionBridges.connectedDevices(ctx.user.id);
      const connectedExtensionIds = new Set(connectedDevices.flatMap((device) => device.manifests.map((manifest) => manifest.id)));
      return {
        ok: true,
        manifests: db.listAssistantExtensionManifests(ctx.user.id).filter((record) => connectedExtensionIds.has(record.extensionId)),
        routes: db.listAssistantExtensionToolRoutes(ctx.user.id),
        connectedDevices,
      };
    }),
  );

  app.patch('/api/assistant/extensions/tools/:toolName/route', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const toolName = String((req.params as any).toolName ?? '');
      const manifestTool = db.assistantExtensionToolManifest(ctx.user.id, toolName);
      if (!manifestTool) throw Object.assign(new Error('unknown extension tool'), { statusCode: 404 });
      const body = jsonBody(req);
      const targetKind = cleanTargetKind(body.targetKind ?? body.target);
      if (!manifestTool.tool.supportedTargets.includes(targetKind)) {
        throw Object.assign(new Error(`${toolName} does not support ${targetKind} execution`), { statusCode: 400 });
      }
      const targetDeviceId = cleanText(body.targetDeviceId ?? body.deviceId) || null;
      if (targetKind === 'device') {
        if (!targetDeviceId) throw Object.assign(new Error('targetDeviceId is required for device execution'), { statusCode: 400 });
        const device = db.deviceForUser(ctx.user.id, targetDeviceId);
        if (!device || device.revokedAt) throw Object.assign(new Error('unknown target device'), { statusCode: 404 });
      }
      const route = db.upsertAssistantExtensionToolRoute(ctx.user.id, {
        toolName,
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        targetKind,
        targetDeviceId,
      });
      emitAssistantChange('extension_route_updated');
      return { ok: true, route, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.post('/api/devices/:deviceId/revoke', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const device = db.revokeDevice(ctx.user.id, deviceId);
      if (!device) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      controlChannels.closeDevice(deviceId);
      extensionBridges.closeDevice(deviceId);
      db.upsertClientStatus(ctx.user.id, deviceId, {
        mode: 'off',
        status: 'Device revoked',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      db.addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: 'info',
        message: `Device revoked: ${device.displayName}`,
      });
      return { ok: true, device };
    }),
  );

  app.post('/api/devices/:deviceId/rotate-token', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const rotated = db.rotateDeviceToken(ctx.user.id, deviceId);
      if (!rotated) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      controlChannels.closeDevice(deviceId, VoiceCloseCode.Revoked, 'token rotated');
      extensionBridges.closeDevice(deviceId, VoiceCloseCode.Revoked, 'token rotated');
      const body = jsonBody(req);
      const includePayload = body.includePayload !== false;
      const deviceType = cleanText(body.deviceType, rotated.device.deviceType) || rotated.device.deviceType;
      const displayName = cleanText(body.displayName, rotated.device.displayName) || rotated.device.displayName;
      let payload: ReturnType<typeof buildPairingPayload> | null = null;
      let pairingSession: ReturnType<VoiceStreamNextDb['createPairingSession']> | null = null;
      let expiresAt: string | null = null;
      if (includePayload) {
        expiresAt = pairingExpiresAt();
        pairingSession = db.createPairingSession(ctx.user.id, rotated.device.id, expiresAt);
        const androidApk = readAndroidApkInfo(req);
        payload = buildPairingPayload({
          serverUrl: serverPublicUrl(req),
          deviceId: rotated.device.id,
          token: rotated.token,
          deviceType,
          displayName,
          protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          expiresAt,
          pairingSessionId: pairingSession.id,
          apkUrl: deviceType === 'android' ? androidApk.downloadUrl : null,
        });
      }
      db.addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: 'info',
        message: `Device token rotated: ${rotated.device.displayName}`,
      });
      return {
        ok: true,
        device: rotated.device,
        token: rotated.token,
        pairingSession,
        expiresAt,
        minClientVersion: minClientVersion(),
        ...(payload ?? {}),
      };
    }),
  );

  app.post('/api/devices/:deviceId/command', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deviceId = String((req.params as any).deviceId ?? '');
      const device = db.deviceForUser(ctx.user.id, deviceId);
      if (!device || device.revokedAt) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      const body = jsonBody(req);
      const command = cleanControlCommand(body.command);
      const reason = cleanText(body.reason, 'dashboard') || 'dashboard';
      const result = await controlChannels.sendCommand(deviceId, command, reason);
      db.addLog(ctx.user.id, {
        deviceId,
        source: 'web',
        level: result.delivered ? 'info' : 'warn',
        message: result.delivered ? `Remote command sent: ${command}` : `Remote command not delivered: ${command}`,
        detailsJson: JSON.stringify(result),
      });
      return { ok: true, ...result };
    }),
  );

  app.get('/api/admin/devices', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      requireAdmin(ctx);
      return { ok: true, devices: db.listDevices() };
    }),
  );

  app.get('/api/logs', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      logs: db.listLogs(ctx.user.id, 200),
    })),
  );

  app.post('/api/logs', async (req, reply) =>
    {
      const body = jsonBody(req);
      const detailsJson = body.details == null ? null : JSON.stringify(body.details);
      const deviceId = cleanText(body.deviceId) || null;
      const token = cleanText(body.token || req.headers['x-voice-device-token']);
      if (deviceId && token) {
        const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
        if (!auth.ok) {
          reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
            ok: false,
            error: deviceAuthFailureMessage(auth),
            reason: auth.reason,
            minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
          });
          return;
        }
        const log = db.addLog(auth.device.userId, {
          deviceId: auth.device.id,
          source: cleanText(body.source, auth.device.deviceType) || auth.device.deviceType,
          level: cleanText(body.level, 'info') || 'info',
          message: cleanText(body.message, 'Log event') || 'Log event',
          detailsJson,
        });
        return { ok: true, log };
      }
      return withUser(req, reply, db, clerkEnabled, async (ctx) => {
        const log = db.addLog(ctx.user.id, {
          deviceId,
          source: cleanText(body.source, 'web') || 'web',
          level: cleanText(body.level, 'info') || 'info',
          message: cleanText(body.message, 'Log event') || 'Log event',
          detailsJson,
        });
        return { ok: true, log };
      });
    },
  );

  app.get('/api/transcripts', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const deviceId = cleanText(query.deviceId) || undefined;
      const voiceSessionId = cleanText(query.voiceSessionId) || undefined;
      return {
        ok: true,
        transcripts: db.listTranscripts(ctx.user.id, 200, { deviceId, voiceSessionId }),
      };
    }),
  );

  app.post('/api/devices/:deviceId/status', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const body = jsonBody(req);
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    const clientVersion = parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    const device = auth.device;
    const status = db.upsertClientStatus(device.userId, device.id, {
      mode: cleanDeviceMode(body.mode),
      status: cleanText(body.status, 'No status') || 'No status',
      microphone: cleanText(body.microphone),
      protocolVersion: Number.isInteger(body.protocolVersion) ? body.protocolVersion : null,
      appVersion: cleanText(body.appVersion) || null,
      lastError: cleanText(body.lastError) || null,
      reportedAt: cleanText(body.reportedAt) || null,
    });
    return { ok: true, status };
  });

  app.get('/api/devices/:deviceId/bootstrap', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const query = (req.query ?? {}) as Record<string, unknown>;
    const token = cleanText(req.headers['x-voice-device-token'] || query.token);
    const clientVersion = parseClientVersion(req.headers['x-voice-client-version'], parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    return {
      ok: true,
      device: auth.device,
      settings: voiceApprovalSettingsResponse(db.ensureVoiceSettings(auth.device.userId)).settings,
      minClientVersion: minClientVersion(),
    };
  });

  app.get('/api/devices/:deviceId/control', { websocket: true }, (socket, req) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const token = queryValue((req.query as any)?.token);
    const clientVersion = parseClientVersion((req.query as any)?.clientVersion, parseClientVersion((req.query as any)?.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      socket.close(deviceAuthCloseCode(auth), deviceAuthFailureMessage(auth));
      return;
    }
    const device = auth.device;
    controlChannels.register(deviceId, socket);
    socket.send(JSON.stringify({
      type: 'control_hello',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      minClientVersion: minClientVersion(),
      commands: ['sleep', 'off', 'awake', 'query_status'],
    }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    socket.on('message', (data) => {
      const parsed = parseControlClientMessage(String(data));
      if (!parsed) {
        socket.close(VoiceCloseCode.InvalidMessage, 'invalid control message');
        return;
      }
      if (parsed.type === 'client_ping') {
        socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
        return;
      }
      if (parsed.type === 'client_status') {
        db.upsertClientStatus(device.userId, device.id, {
          mode: cleanDeviceMode(parsed.mode),
          status: cleanText(parsed.status, 'No status') || 'No status',
          microphone: cleanText(parsed.microphone),
          protocolVersion: parsed.protocolVersion ?? null,
          appVersion: cleanText(parsed.appVersion) || null,
          lastError: cleanText(parsed.lastError) || null,
          reportedAt: cleanText(parsed.reportedAt) || null,
        });
        return;
      }
      if (parsed.type === 'command_ack') {
        controlChannels.handleCommandAck(device.id, parsed);
        return;
      }
      socket.close(VoiceCloseCode.InvalidMessage, 'unknown control message');
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      controlChannels.unregister(deviceId, socket);
      db.upsertClientStatus(device.userId, device.id, {
        mode: 'off',
        status: 'Control channel closed',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
    });
  });

  app.get('/api/devices/:deviceId/extensions', { websocket: true }, (socket, req) => {
    const deviceId = String((req.params as any).deviceId ?? '');
    const token = queryValue((req.query as any)?.token);
    const clientVersion = parseClientVersion((req.query as any)?.clientVersion, parseClientVersion((req.query as any)?.protocolVersion, null));
    const auth = verifyDeviceAuth(db, deviceId, token, clientVersion);
    if (!auth.ok) {
      socket.close(deviceAuthCloseCode(auth), deviceAuthFailureMessage(auth));
      return;
    }
    const device = auth.device;
    let registered = false;
    socket.send(JSON.stringify({
      type: 'extension_bridge_hello',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      minClientVersion: minClientVersion(),
    }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    socket.on('message', (data) => {
      try {
        const parsed = parseExtensionBridgeMessage(String(data));
        if (!parsed) {
          socket.close(VoiceCloseCode.InvalidMessage, 'invalid extension bridge message');
          return;
        }
        if (parsed.type === 'client_ping') {
          socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
          return;
        }
        if (parsed.type === 'extension_hello') {
          const manifests = parsed.manifests.map((manifest) => parseAssistantExtensionManifest(manifest));
          for (const manifest of manifests) {
            db.upsertAssistantExtensionManifest(device.userId, manifest);
            for (const tool of manifest.tools) {
              const toolName = extensionToolName(manifest.id, tool.name);
              if (!db.assistantExtensionToolRoute(device.userId, toolName)) {
                db.upsertAssistantExtensionToolRoute(device.userId, {
                  toolName,
                  enabled: false,
                  targetKind: tool.defaultTarget,
                  targetDeviceId: tool.defaultTarget === 'device' ? device.id : null,
                });
              }
            }
          }
          extensionBridges.register(socket, {
            userId: device.userId,
            deviceId: device.id,
            deviceType: device.deviceType,
            displayName: device.displayName,
            manifests,
          });
          registered = true;
          db.upsertClientStatus(device.userId, device.id, {
            mode: 'awake',
            status: manifests.length > 0 ? 'Extension bridge connected' : 'Extension bridge connected without tools',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          emitAssistantChange('extension_bridge_connected');
          socket.send(JSON.stringify({
            type: 'extension_bridge_registered',
            manifests: manifests.map((manifest) => manifest.id),
            toolNames: manifests.flatMap((manifest) => manifest.tools.map((tool) => extensionToolName(manifest.id, tool.name))),
          }));
          return;
        }
        if (parsed.type === 'extension_tool_result') {
          if (!registered) {
            socket.close(VoiceCloseCode.InvalidMessage, 'extension bridge must send hello before results');
            return;
          }
          extensionBridges.handleClientMessage(device.id, String(data));
          return;
        }
        socket.close(VoiceCloseCode.InvalidMessage, 'unknown extension bridge message');
      } catch (error: any) {
        socket.close(VoiceCloseCode.InvalidMessage, error?.message ?? 'invalid extension bridge message');
      }
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      const registration = extensionBridges.unregister(socket);
      if (registration) {
        for (const manifest of registration.manifests) {
          if (!extensionBridges.hasConnectedExtension(registration.userId, manifest.id)) {
            db.deleteAssistantExtensionManifest(registration.userId, manifest.id);
          }
        }
      }
      if (registered) emitAssistantChange('extension_bridge_disconnected');
    });
  });

  app.post('/api/voice/approval-codes', async (req, reply) =>
    {
      const body = jsonBody(req);
      const deviceId = cleanText(body.deviceId);
      const token = cleanText(body.token || req.headers['x-voice-device-token']);
      if (deviceId && token) {
        const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
        if (!auth.ok) {
          reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
            ok: false,
            error: deviceAuthFailureMessage(auth),
            reason: auth.reason,
            minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
          });
          return;
        }
        const code = cleanCode(body.code, 'approval code');
        const approvalCode = db.addApprovalCode(auth.device.userId, {
          voiceSessionId: cleanText(body.voiceSessionId) || null,
          code,
          source: cleanText(body.source, auth.device.deviceType) || auth.device.deviceType,
        });
        return { ok: true, approvalCode };
      }
      return withUser(req, reply, db, clerkEnabled, async (ctx) => {
        const code = cleanCode(body.code, 'approval code');
        const approvalCode = db.addApprovalCode(ctx.user.id, {
          voiceSessionId: cleanText(body.voiceSessionId) || null,
          code,
          source: cleanText(body.source, 'client') || 'client',
        });
        return { ok: true, approvalCode };
      });
    },
  );

  app.post('/api/devices/:deviceId/assistant/threads/:threadId/prompt', async (req, reply) => {
    const body = jsonBody(req);
    const deviceId = String((req.params as any).deviceId ?? '');
    const threadId = String((req.params as any).threadId ?? '');
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
    if (!auth.ok) {
      reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
        ok: false,
        error: deviceAuthFailureMessage(auth),
        reason: auth.reason,
        minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
      });
      return;
    }
    if (!db.thread(auth.device.userId, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
    const prompt = cleanText(body.prompt ?? body.content);
    if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
    const events: unknown[] = [];
    const snapshot = await promptAssistantThread(db, auth.device.userId, threadId, {
      prompt,
      provider: cleanText(body.provider) || undefined,
      model: cleanText(body.model) || undefined,
      thinkingLevel: cleanText(body.thinkingLevel) || undefined,
    }, (event) => {
      events.push(event);
      handleAssistantPromptEvent(auth.device.userId, threadId, event);
    });
    emitAssistantChange('device_thread_prompted', threadId);
    return { ok: true, events, snapshot };
  });

  app.get('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      return assistantSnapshot(db, ctx.user.id, cleanText(query.activeThreadId) || null);
    }),
  );

  app.post('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const source = cleanText(body.source) === 'voice' || Boolean(body.voiceEnabled) ? 'voice' : 'web';
      const codexConnected = db.codexConnectionView(ctx.user.id).connected;
      const requestedProvider = cleanText(body.provider);
      const thread = db.createThread(ctx.user.id, {
        title: cleanText(body.title, 'Assistant thread') || 'Assistant thread',
        source,
        voiceEnabled: Boolean(body.voiceEnabled) || source === 'voice',
        provider: requestedProvider || (codexConnected ? 'codex' : undefined),
        model: cleanText(body.model) || (!requestedProvider && codexConnected ? 'gpt-5.5' : undefined),
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
        promptDeliveryMode: body.promptDeliveryMode === 'asap' ? 'asap' : 'queue',
      });
      emitAssistantChange('thread_created', thread.id);
      return { ok: true, thread, snapshot: assistantSnapshot(db, ctx.user.id, thread.id) };
    }),
  );

  app.patch('/api/assistant/threads/:threadId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const patch: Parameters<VoiceStreamNextDb['updateThread']>[2] = {};
      if (body.title !== undefined) patch.title = cleanText(body.title, 'Assistant thread') || 'Assistant thread';
      if (body.provider !== undefined) patch.provider = cleanText(body.provider, 'openai') || 'openai';
      if (body.model !== undefined) patch.model = cleanText(body.model, 'gpt-5.5') || 'gpt-5.5';
      if (body.thinkingLevel !== undefined) patch.thinkingLevel = cleanText(body.thinkingLevel, 'off') || 'off';
      if (body.voiceEnabled !== undefined) patch.voiceEnabled = Boolean(body.voiceEnabled);
      if (body.autoApprove !== undefined) patch.autoApprove = Boolean(body.autoApprove);
      if (body.systemPrompt !== undefined) patch.systemPrompt = cleanText(body.systemPrompt) || null;
      if (Array.isArray(body.enabledTools)) patch.enabledTools = body.enabledTools.map((tool: unknown) => cleanText(tool)).filter(Boolean);
      if (body.promptDeliveryMode !== undefined) patch.promptDeliveryMode = body.promptDeliveryMode === 'asap' ? 'asap' : 'queue';
      const thread = db.updateThread(ctx.user.id, threadId, patch);
      emitAssistantChange('thread_updated', threadId);
      return { ok: true, thread, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const deleted = db.deleteThread(ctx.user.id, threadId);
      if (!deleted) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      emitAssistantChange('thread_deleted', threadId);
      return { ok: true, deleted, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.get('/api/assistant/threads/:threadId/messages', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      return { ok: true, messages: db.listMessages(ctx.user.id, threadId) };
    }),
  );

  app.post('/api/assistant/threads/:threadId/messages', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const content = cleanText(body.content ?? body.prompt);
      if (!content) throw Object.assign(new Error('message content is required'), { statusCode: 400 });
      const events: unknown[] = [];
      const snapshot = await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt: content,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        events.push(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId);
      return { ok: true, events, snapshot, messages: db.listMessages(ctx.user.id, threadId) };
    }),
  );

  app.post('/api/assistant/threads/:threadId/prompt', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const prompt = cleanText(body.prompt ?? body.content);
      if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
      const events: unknown[] = [];
      const snapshot = await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        events.push(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId);
      return { ok: true, events, snapshot };
    }),
  );

  app.post('/api/assistant/threads/:threadId/stream', async (req, reply) => {
    const writeEvent = (event: unknown) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const ctx = await resolveRequestUser(req, db, clerkEnabled);
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const prompt = cleanText(body.prompt ?? body.content);
      if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      await promptAssistantThread(db, ctx.user.id, threadId, {
        prompt,
        provider: cleanText(body.provider) || undefined,
        model: cleanText(body.model) || undefined,
        thinkingLevel: cleanText(body.thinkingLevel) || undefined,
      }, (event) => {
        writeEvent(event);
        handleAssistantPromptEvent(ctx.user.id, threadId, event);
      });
      emitAssistantChange('thread_prompted', threadId);
      reply.raw.end();
    } catch (error: any) {
      const status = Number(error?.statusCode ?? 0) || 500;
      if (!reply.raw.headersSent) {
        reply.code(status).send({ ok: false, error: error?.message ?? String(error) });
        return;
      }
      writeEvent({ type: 'error', error: error?.message ?? String(error) });
      reply.raw.end();
    }
  });

  app.post('/api/assistant/threads/:threadId/stop', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const run = db.activeRun(ctx.user.id, threadId);
      const pendingApprovals = db.listApprovals(ctx.user.id, threadId).filter((approval) => approval.status === 'pending');
      for (const approval of pendingApprovals) {
        await resolveAssistantApproval(db, ctx.user.id, approval.id, false, ctx.user.email || ctx.user.displayName || 'user');
      }
      if (!run) {
        if (pendingApprovals.length > 0) emitAssistantChange('thread_stopped', threadId);
        return { ok: true, stopped: pendingApprovals.length > 0, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
      }
      const at = new Date().toISOString();
      db.updateRun(ctx.user.id, run.id, { status: 'cancelled', cancelledAt: at, error: 'Cancelled by user' });
      db.updateThread(ctx.user.id, threadId, { status: 'idle', error: null });
      emitAssistantChange('thread_stopped', threadId);
      return { ok: true, stopped: true, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId/queued/:queuedPromptId', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      const queuedPromptId = String((req.params as any).queuedPromptId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const queuedPrompt = db.cancelQueuedPrompt(ctx.user.id, threadId, queuedPromptId);
      if (!queuedPrompt) throw Object.assign(new Error('unknown queued prompt'), { statusCode: 404 });
      emitAssistantChange('queued_prompt_cancelled', threadId);
      return { ok: true, queuedPrompt, snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.get('/api/assistant/tools', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      tools: assistantAvailableToolSummaries(db, ctx.user.id),
    })),
  );

  app.get('/api/assistant/settings', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      settings: db.ensureAssistantSettings(ctx.user.id),
    })),
  );

  app.get('/api/assistant/codex/status', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      codexConnection: db.codexConnectionView(ctx.user.id),
    })),
  );

  app.post('/api/assistant/codex/connect', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const flow = await createCodexAuthorizationFlow();
      db.createCodexOAuthState(ctx.user.id, {
        state: flow.state,
        codeVerifier: flow.verifier,
        redirectUri: flow.redirectUri,
        expiresAt: flow.expiresAt,
      });
      return {
        ok: true,
        state: flow.state,
        authorizationUrl: flow.authorizationUrl,
        redirectUri: flow.redirectUri,
        expiresAt: flow.expiresAt,
      };
    }),
  );

  app.post('/api/assistant/codex/complete', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const parsed = parseCodexAuthorizationInput(cleanText(body.codeOrUrl ?? body.code));
      const state = cleanText(body.state) || parsed.state || '';
      const code = parsed.code || '';
      if (!state || !code) throw Object.assign(new Error('Codex authorization code and state are required'), { statusCode: 400 });
      const oauthState = db.codexOAuthState(state);
      if (!oauthState || oauthState.userId !== ctx.user.id) throw Object.assign(new Error('Unknown Codex authorization state'), { statusCode: 404 });
      if (Date.parse(oauthState.expiresAt) <= Date.now()) {
        db.deleteCodexOAuthState(state);
        throw Object.assign(new Error('Codex authorization state expired'), { statusCode: 400 });
      }
      const tokenSet = await exchangeCodexAuthorizationCode({
        code,
        verifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
      });
      db.upsertCodexConnection(ctx.user.id, tokenSet);
      db.deleteCodexOAuthState(state);
      db.updateAssistantSettings(ctx.user.id, {
        defaultProvider: 'codex',
        defaultModel: 'gpt-5.5',
        defaultThinkingLevel: 'medium',
      });
      for (const thread of db.listThreads(ctx.user.id)) {
        if (thread.provider === 'openai' && thread.model === 'gpt-5.2') {
          db.updateThread(ctx.user.id, thread.id, {
            provider: 'codex',
            model: 'gpt-5.5',
            thinkingLevel: thread.thinkingLevel === 'off' ? 'medium' : thread.thinkingLevel,
            status: thread.status === 'error' ? 'idle' : thread.status,
            error: null,
          });
        }
      }
      emitAssistantChange('codex_connected');
      return {
        ok: true,
        codexConnection: db.codexConnectionView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.delete('/api/assistant/codex/connection', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const deleted = db.deleteCodexConnection(ctx.user.id);
      emitAssistantChange('codex_disconnected');
      return {
        ok: true,
        deleted,
        codexConnection: db.codexConnectionView(ctx.user.id),
        snapshot: assistantSnapshot(db, ctx.user.id),
      };
    }),
  );

  app.patch('/api/assistant/settings', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const settings = db.updateAssistantSettings(ctx.user.id, {
        normalSystemPrompt: body.normalSystemPrompt === undefined ? undefined : cleanText(body.normalSystemPrompt),
        voiceSystemPrompt: body.voiceSystemPrompt === undefined ? undefined : cleanText(body.voiceSystemPrompt),
        defaultProvider: body.defaultProvider === undefined ? undefined : cleanText(body.defaultProvider, 'openai'),
        defaultModel: body.defaultModel === undefined ? undefined : cleanText(body.defaultModel, 'gpt-5.5'),
        defaultThinkingLevel: body.defaultThinkingLevel === undefined ? undefined : cleanText(body.defaultThinkingLevel, 'off'),
      });
      emitAssistantChange('assistant_settings_updated');
      return { ok: true, settings, snapshot: assistantSnapshot(db, ctx.user.id) };
    }),
  );

  app.post('/api/assistant/approvals/:approvalId/approve', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const approvalId = String((req.params as any).approvalId ?? '');
      const pending = db.pendingApproval(ctx.user.id, approvalId);
      const beforeSpokenIds = new Set(
        pending ? db.listMessages(ctx.user.id, pending.threadId).filter((message) => message.spokenText).map((message) => message.id) : [],
      );
      const snapshot = await resolveAssistantApproval(db, ctx.user.id, approvalId, true, ctx.user.email || ctx.user.displayName || 'user');
      if (pending) emitNewSpokenMessages(ctx.user.id, pending.threadId, beforeSpokenIds);
      emitAssistantChange('approval_resolved', snapshot.activeThreadId ?? undefined);
      return { ok: true, snapshot };
    }),
  );

  app.post('/api/assistant/approvals/:approvalId/deny', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const approvalId = String((req.params as any).approvalId ?? '');
      const pending = db.pendingApproval(ctx.user.id, approvalId);
      const beforeSpokenIds = new Set(
        pending ? db.listMessages(ctx.user.id, pending.threadId).filter((message) => message.spokenText).map((message) => message.id) : [],
      );
      const snapshot = await resolveAssistantApproval(db, ctx.user.id, approvalId, false, ctx.user.email || ctx.user.displayName || 'user');
      if (pending) emitNewSpokenMessages(ctx.user.id, pending.threadId, beforeSpokenIds);
      emitAssistantChange('approval_resolved', snapshot.activeThreadId ?? undefined);
      return { ok: true, snapshot };
    }),
  );

  app.get('/api/assistant/threads/:threadId/artifacts', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      return { ok: true, artifacts: db.listArtifacts(ctx.user.id, threadId) };
    }),
  );

  app.get('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const artifactPath = sanitizeArtifactPath(queryValue((req.query as any)?.path));
      const artifact = db.readArtifact(ctx.user.id, threadId, artifactPath);
      if (!artifact) throw Object.assign(new Error('unknown artifact'), { statusCode: 404 });
      return { ok: true, artifact };
    }),
  );

  app.put('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const artifactPath = sanitizeArtifactPath(body.path);
      const content = String(body.content ?? '');
      if (Buffer.byteLength(content, 'utf8') > 256 * 1024) {
        throw Object.assign(new Error('artifact content is too large'), { statusCode: 413 });
      }
      const artifact = db.upsertArtifact(ctx.user.id, threadId, { path: artifactPath, content });
      emitAssistantChange('artifact_saved', threadId);
      return { ok: true, artifact, artifacts: db.listArtifacts(ctx.user.id, threadId), snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.delete('/api/assistant/threads/:threadId/artifacts/file', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const threadId = String((req.params as any).threadId ?? '');
      if (!db.thread(ctx.user.id, threadId)) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
      const body = jsonBody(req);
      const artifactPath = sanitizeArtifactPath(body.path ?? queryValue((req.query as any)?.path));
      const deleted = db.deleteArtifact(ctx.user.id, threadId, artifactPath);
      emitAssistantChange('artifact_deleted', threadId);
      return { ok: true, deleted, artifacts: db.listArtifacts(ctx.user.id, threadId), snapshot: assistantSnapshot(db, ctx.user.id, threadId) };
    }),
  );

  app.post('/api/assistant/speech', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async () => {
      const body = jsonBody(req);
      const text = cleanText(body.text);
      if (!text) throw Object.assign(new Error('text is required'), { statusCode: 400 });
      const speech = await synthesizeSpeech(text);
      if (!speech.audio) throw Object.assign(new Error('TTS is not configured'), { statusCode: 501 });
      reply.header('content-type', 'audio/wav').send(Buffer.from(speech.audio));
      return undefined;
    }),
  );

  app.post('/api/voice/sessions', async (req, reply) => {
    const body = jsonBody(req);
    const deviceId = cleanText(body.deviceId);
    const mode = cleanVoiceStreamMode(cleanText(body.mode));
    if (!deviceId) throw Object.assign(new Error('deviceId is required'), { statusCode: 400 });
    const token = cleanText(body.token || req.headers['x-voice-device-token']);
    if (token) {
      const auth = verifyDeviceAuth(db, deviceId, token, parseClientVersion(body.clientVersion, parseClientVersion(body.protocolVersion, null)));
      if (!auth.ok) {
        reply.code(auth.reason === 'client_too_old' ? 426 : 401).send({
          ok: false,
          error: deviceAuthFailureMessage(auth),
          reason: auth.reason,
          minClientVersion: auth.reason === 'client_too_old' ? auth.minClientVersion : undefined,
        });
        return;
      }
      const session = db.createVoiceSession(auth.device.userId, auth.device.id, mode);
      return { ok: true, session };
    }
    return withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const device = db.deviceForUser(ctx.user.id, deviceId);
      if (!device || device.revokedAt) throw Object.assign(new Error('unknown device'), { statusCode: 404 });
      const session = db.createVoiceSession(ctx.user.id, deviceId, mode);
      return { ok: true, session };
    });
  },
  );

  app.get('/api/voice/stream', { websocket: true }, (socket, req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId = queryValue(query.deviceId);
    const token = queryValue(query.token);
    const requestedSessionId = queryValue(query.sessionId);
    const streamMode = cleanVoiceStreamMode(queryValue(query.mode));
    const verifiedDevice = verifyDeviceAuth(db, deviceId, token, parseClientVersion(query.clientVersion, parseClientVersion(query.protocolVersion, null)));
    if (!verifiedDevice.ok) {
      socket.close(deviceAuthCloseCode(verifiedDevice), deviceAuthFailureMessage(verifiedDevice));
      return;
    }
    const device = verifiedDevice.device;

    let frames = 0;
    let bytes = 0;
    let storedBytes = 0;
    let finalized = false;
    let terminalFinalize: TerminalCommand | null = null;
    const chunks: Uint8Array[] = [];
    const startedAt = Date.now();
    const streamingEnabled = streamingTranscriptionEnabled();
    const transcriptionConfig = buildStreamingTranscriptionConfigFromEnv();
    const streamingManager = streamingEnabled
      ? new StreamingTranscriptionManager(transcriptionConfig, (command) => {
          if (finalized || terminalFinalize) return;
          terminalFinalize = command;
          if ((socket as any).readyState === 1) {
            socket.send(
              JSON.stringify({
                type: command.type,
                phrase: command.phrase,
                detectedAt: command.detectedAt,
                transcriptText: command.transcriptText,
                mode: streamMode,
              }),
            );
          }
          db.upsertClientStatus(device.userId, device.id, {
            mode: 'transcribing',
            status: command.type === 'abort' ? 'Voice command cancelled' : 'Voice command detected',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          db.addLog(device.userId, {
            deviceId: device.id,
            source: device.deviceType,
            level: 'info',
            message: command.type === 'abort' ? 'Voice stop command detected' : 'Voice finish command detected',
            detailsJson: JSON.stringify({
              phrase: command.phrase,
              transcriptChars: command.transcriptText.length,
              mode: streamMode,
              detectedAt: command.detectedAt,
            }),
          });
          void finalizeVoiceStream();
        }, (detection) => {
          if (finalized || terminalFinalize) return;
          if ((socket as any).readyState === 1) {
            socket.send(
              JSON.stringify({
                type: 'terminal_detected',
                commandType: detection.type,
                phrase: detection.phrase,
                detectedAt: detection.detectedAt,
                partialTranscriptChars: detection.partialTranscriptText.length,
                mode: streamMode,
              }),
            );
          }
          db.upsertClientStatus(device.userId, device.id, {
            mode: 'transcribing',
            status: detection.type === 'abort' ? 'Voice stop phrase detected' : 'Voice finish phrase detected',
            protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
          });
          db.addLog(device.userId, {
            deviceId: device.id,
            source: device.deviceType,
            level: 'info',
            message: detection.type === 'abort' ? 'Voice stop phrase detected' : 'Voice finish phrase detected',
            detailsJson: JSON.stringify({
              phrase: detection.phrase,
              partialTranscriptChars: detection.partialTranscriptText.length,
              mode: streamMode,
              segmentSequence: detection.segmentSequence,
              segmentReason: detection.segmentReason,
              finalTranscriptionMode: detection.finalTranscriptionMode,
              detectedAt: detection.detectedAt,
            }),
          });
        })
      : null;
    socket.send(JSON.stringify({ type: 'server_hello', protocolVersion: VOICE_STREAM_PROTOCOL_VERSION, maxBytes: MAX_STREAM_BYTES, maxDurationMs: MAX_STREAM_DURATION_MS }));
    const heartbeat = setInterval(() => {
      if ((socket as any).readyState === 1) {
        socket.send(JSON.stringify({ type: 'server_ping', sentAt: new Date().toISOString() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    const durationLimit = setTimeout(() => {
      if ((socket as any).readyState === 1) {
        socket.close(VoiceCloseCode.TooLong, 'stream duration limit exceeded');
      }
    }, MAX_STREAM_DURATION_MS);
    db.addLog(device.userId, {
      deviceId: device.id,
      source: device.deviceType,
      level: streamingEnabled ? 'info' : 'warn',
      message: 'Voice stream connected',
      detailsJson: JSON.stringify({
        deviceId: device.id,
        streamingTranscriptionEnabled: streamingEnabled,
        commandDetection: streamingEnabled ? 'enabled' : 'disabled: missing speech transcription runtime',
      }),
    });
    db.upsertClientStatus(device.userId, device.id, {
      mode: 'recording',
      status: 'Voice stream connected',
      protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
    });

    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        const parsed = parseVoiceClientMessage(String(data));
        if (!parsed) {
          socket.close(VoiceCloseCode.InvalidMessage, 'invalid protocol message');
          return;
        }
        if (parsed.type === 'client_ping') {
          socket.send(JSON.stringify({ type: 'server_pong', sentAt: new Date().toISOString(), clientSentAt: parsed.sentAt }));
          return;
        }
        if (parsed.type === 'end') {
          void finalizeVoiceStream();
        }
        return;
      }
      frames += 1;
      const size = binarySize(data);
      bytes += size;
      if (bytes > MAX_STREAM_BYTES) {
        socket.close(VoiceCloseCode.TooLarge, 'stream byte limit exceeded');
        return;
      }
      const chunk = binaryChunk(data);
      if (chunk) {
        const copy = new Uint8Array(chunk);
        chunks.push(copy);
        storedBytes += copy.byteLength;
        streamingManager?.appendPcm(copy);
      }
    });

    socket.on('close', () => {
      streamingManager?.flushPending();
      void finalizeVoiceStream();
    });

    async function finalizeVoiceStream(): Promise<void> {
      if (finalized) return;
      finalized = true;
      streamingManager?.stop();
      clearInterval(heartbeat);
      clearTimeout(durationLimit);
      const session =
        (requestedSessionId ? db.voiceSessionForDevice(device.userId, device.id, requestedSessionId) : null) ??
        db.latestVoiceSessionForDevice(device.userId, device.id) ??
        db.createVoiceSession(device.userId, device.id, streamMode);
      let transcript = '';
      let assistantText = '';
      let runtime = 'fallback';
      try {
        if (terminalFinalize?.type === 'abort') {
          transcript = '';
        } else if (terminalFinalize?.transcriptText) {
          transcript = terminalFinalize.transcriptText.trim();
        } else {
          const transcription = await transcribePcm16(concatChunks(chunks, storedBytes));
          transcript = transcription.text;
          runtime = transcription.provider;
        }
        if (transcript) {
          db.addTranscript(device.userId, session.id, transcript);
          const approvalCode = approvalCodeFromText(transcript);
          if (approvalCode) {
            db.addApprovalCode(device.userId, { voiceSessionId: session.id, code: approvalCode, source: device.deviceType });
          }
          if (streamMode === 'clipboard') {
            if ((socket as any).readyState === 1) {
              socket.send(JSON.stringify({ type: 'sleep', mode: streamMode, transcriptText: transcript }));
            }
          } else {
            if (streamMode === 'patch') {
              db.addMessage(device.userId, session.assistantThreadId, { role: 'user', content: transcript });
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'transcript_result', mode: streamMode, transcript, status: 'Transcript patched into chat.' }));
              }
            } else {
              let assistantError = '';
              let pendingStatus = '';
              await promptAssistantThread(db, device.userId, session.assistantThreadId, { prompt: transcript }, (event) => {
                handleAssistantPromptEvent(device.userId, session.assistantThreadId, event);
                if ((event as any)?.type === 'queued') {
                  pendingStatus = 'Queued voice prompt.';
                }
                if ((event as any)?.type === 'approval_pending') {
                  pendingStatus = 'Assistant is waiting for approval.';
                }
                if ((event as any)?.type === 'message' && (event as any).message?.role === 'assistant') {
                  const message = (event as any).message as AssistantMessage;
                  if (message.isError) {
                    assistantError = String(message.content ?? 'Voice assistant failed.').trim();
                    return;
                  }
                  assistantText = String(message.spokenText ?? message.content ?? '').trim();
                }
                if ((event as any)?.type === 'error') {
                  assistantError = String((event as any).error ?? 'Voice assistant failed.');
                }
              });
              const thread = db.thread(device.userId, session.assistantThreadId);
              runtime = thread ? `${thread.provider}:${thread.model}` : 'assistant';
              emitAssistantChange('voice_thread_prompted', session.assistantThreadId);
              if (!assistantText && assistantError) {
                throw new Error(assistantError);
              }
              if (!assistantText && pendingStatus) {
                if ((socket as any).readyState === 1) {
                  socket.send(JSON.stringify({ type: 'transcript_result', mode: streamMode, transcript, status: pendingStatus }));
                }
                return;
              }
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'assistant_result', transcript, assistantText, runtime }));
                if (assistantText) {
                  const speech = await synthesizeSpeech(assistantText);
                  if (speech.audio && (socket as any).readyState === 1) {
                    socket.send(Buffer.from(speech.audio));
                  }
                }
              }
            }
          }
        } else if (terminalFinalize?.type === 'abort' && (socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'abort', mode: streamMode, transcriptText: '' }));
        } else if (streamMode === 'clipboard' && (socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'sleep', mode: streamMode, transcriptText: '' }));
        }
      } catch (error: any) {
        db.addLog(device.userId, {
          deviceId: device.id,
          source: device.deviceType,
          level: 'error',
          message: 'Voice runtime failed',
          detailsJson: JSON.stringify({ error: error?.message ?? String(error) }),
        });
        if ((socket as any).readyState === 1) {
          socket.send(JSON.stringify({ type: 'assistant_error', error: error?.message ?? String(error) }));
        }
      } finally {
        db.endVoiceSession(device.userId, session.id);
      }
      db.upsertClientStatus(device.userId, device.id, {
        mode: 'awake',
        status: 'Voice stream disconnected',
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
      });
      db.addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'info',
        message: 'Voice stream disconnected',
        detailsJson: JSON.stringify({ frames, bytes, durationMs: Date.now() - startedAt, transcriptChars: transcript.length, assistantChars: assistantText.length, runtime, mode: streamMode }),
      });
      if ((socket as any).readyState === 1) {
        setTimeout(() => {
          if ((socket as any).readyState === 1) {
            socket.close(1000, 'finalized');
          }
        }, 150);
      }
    }
  });

  const webDist = path.resolve(process.cwd(), 'dist', 'web');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ ok: false, error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return { app, db, port };
}
