import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { VoiceStreamNextDb } from './db.js';
import { requireAdmin, resolveRequestUser, type AuthContext } from './auth.js';
import { generateAssistantReply, synthesizeSpeech, transcribePcm16 } from './assistant-runtime.js';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_STREAM_BYTES,
  MAX_STREAM_DURATION_MS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceCloseCode,
  parseVoiceClientMessage,
} from './protocol.js';

type AppOptions = {
  logger?: boolean;
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

function approvalCodeFromText(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const phraseIndex = words.findIndex((word, index) => word === 'approval' && words[index + 1] === 'code');
  if (phraseIndex < 0) return null;
  const digits = words
    .slice(phraseIndex + 2)
    .map((word) => {
      if (/^\d$/.test(word)) return word;
      return ({ zero: '0', oh: '0', o: '0', one: '1', won: '1', two: '2', too: '2', to: '2', three: '3', tree: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9', niner: '9' } as Record<string, string>)[word] ?? '';
    })
    .join('')
    .slice(0, 8);
  return digits.length >= 4 ? digits : null;
}

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
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
  const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY?.trim());
  const port = parsePort(process.env.VOICE_STREAM_NEXT_API_PORT ?? process.env.PORT, 3299);

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
      const settings = db.updateVoiceSettings(ctx.user.id, {
        unlockCode: cleanCode(body.unlockCode, 'unlock code'),
        lockCode: cleanCode(body.lockCode, 'lock code'),
        offCode: cleanCode(body.offCode, 'off code'),
      });
      return { ok: true, settings };
    }),
  );

  app.get('/api/settings/voice-approval', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const settings = db.ensureVoiceSettings(ctx.user.id);
      return {
        ok: true,
        settings: {
          triggerPhrase: 'approval code',
          unlockCode: settings.unlockCode,
          lockCode: settings.lockCode,
          lockedOffCode: settings.offCode,
          minDigits: 4,
          maxDigits: 8,
          stableMs: 900,
          collectTimeoutMs: 5000,
          duplicateCooldownMs: 4000,
          finalizeCheckIntervalMs: 250,
        },
      };
    }),
  );

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
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const detailsJson = body.details == null ? null : JSON.stringify(body.details);
      const log = db.addLog(ctx.user.id, {
        deviceId: cleanText(body.deviceId) || null,
        source: cleanText(body.source, 'web') || 'web',
        level: cleanText(body.level, 'info') || 'info',
        message: cleanText(body.message, 'Log event') || 'Log event',
        detailsJson,
      });
      return { ok: true, log };
    }),
  );

  app.post('/api/voice/approval-codes', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const code = cleanCode(body.code, 'approval code');
      const approvalCode = db.addApprovalCode(ctx.user.id, {
        voiceSessionId: cleanText(body.voiceSessionId) || null,
        code,
        source: cleanText(body.source, 'client') || 'client',
      });
      return { ok: true, approvalCode };
    }),
  );

  app.get('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => ({
      ok: true,
      threads: db.listThreads(ctx.user.id),
    })),
  );

  app.post('/api/assistant/threads', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const thread = db.createThread(ctx.user.id, {
        title: cleanText(body.title, 'Assistant thread') || 'Assistant thread',
        source: 'web',
      });
      return { ok: true, thread };
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
      const content = cleanText(body.content);
      if (!content) throw Object.assign(new Error('message content is required'), { statusCode: 400 });
      const userMessage = db.addMessage(ctx.user.id, threadId, { role: 'user', content });
      const history = db.listMessages(ctx.user.id, threadId).map((message) => ({ role: message.role, content: message.content }));
      const reply = await generateAssistantReply(history);
      const replyText = reply.text;
      const assistantMessage = db.addMessage(ctx.user.id, threadId, {
        role: 'assistant',
        content: replyText,
        spokenText: replyText,
      });
      return { ok: true, runtime: reply.provider, messages: [userMessage, assistantMessage] };
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

  app.post('/api/voice/sessions', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceId = cleanText(body.deviceId);
      const mode = cleanVoiceStreamMode(cleanText(body.mode));
      if (!deviceId) throw Object.assign(new Error('deviceId is required'), { statusCode: 400 });
      const session = db.createVoiceSession(ctx.user.id, deviceId, mode);
      return { ok: true, session };
    }),
  );

  app.get('/api/voice/stream', { websocket: true }, (socket, req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId = queryValue(query.deviceId);
    const token = queryValue(query.token);
    const requestedSessionId = queryValue(query.sessionId);
    const streamMode = cleanVoiceStreamMode(queryValue(query.mode));
    const verifiedDevice = db.verifyDeviceToken(deviceId, token);
    if (!verifiedDevice) {
      socket.close(VoiceCloseCode.Unauthorized, 'invalid device token');
      return;
    }
    const device = verifiedDevice;

    let frames = 0;
    let bytes = 0;
    let storedBytes = 0;
    let finalized = false;
    const chunks: Uint8Array[] = [];
    const startedAt = Date.now();
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
      level: 'info',
      message: 'Voice stream connected',
      detailsJson: JSON.stringify({ deviceId: device.id }),
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
        chunks.push(new Uint8Array(chunk));
        storedBytes += chunk.byteLength;
      }
    });

    socket.on('close', () => {
      void finalizeVoiceStream();
    });

    async function finalizeVoiceStream(): Promise<void> {
      if (finalized) return;
      finalized = true;
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
        const transcription = await transcribePcm16(concatChunks(chunks, storedBytes));
        transcript = transcription.text;
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
            db.addMessage(device.userId, session.assistantThreadId, { role: 'user', content: transcript });
            if (streamMode === 'patch') {
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'transcript_result', mode: streamMode, transcript, status: 'Transcript patched into chat.' }));
              }
            } else {
              const history = db.listMessages(device.userId, session.assistantThreadId).map((message) => ({
                role: message.role,
                content: message.content,
              }));
              const assistant = await generateAssistantReply(history);
              runtime = assistant.provider;
              assistantText = assistant.text;
              db.addMessage(device.userId, session.assistantThreadId, {
                role: 'assistant',
                content: assistantText,
                spokenText: assistantText,
              });
              if ((socket as any).readyState === 1) {
                socket.send(JSON.stringify({ type: 'assistant_result', transcript, assistantText, runtime }));
                const speech = await synthesizeSpeech(assistantText);
                if (speech.audio && (socket as any).readyState === 1) {
                  socket.send(Buffer.from(speech.audio));
                }
              }
            }
          }
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
      db.addLog(device.userId, {
        deviceId: device.id,
        source: device.deviceType,
        level: 'info',
        message: 'Voice stream disconnected',
        detailsJson: JSON.stringify({ frames, bytes, durationMs: Date.now() - startedAt, transcriptChars: transcript.length, assistantChars: assistantText.length, runtime, mode: streamMode }),
      });
      if ((socket as any).readyState === 1) {
        socket.close(1000, 'finalized');
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
