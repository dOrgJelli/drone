import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { clerkPlugin } from '@clerk/fastify';
import { VoiceStreamNextDb } from './db.js';
import { requireAdmin, resolveRequestUser, type AuthContext } from './auth.js';

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

function assistantReply(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return 'I need a message before I can respond.';
  return [
    'I captured that in this new Voice Stream thread.',
    '',
    `You said: "${trimmed}"`,
    '',
    'The assistant runtime is wired for thread storage now; model-backed responses can plug into this module next.',
  ].join('\n');
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
      const replyText = assistantReply(content);
      const assistantMessage = db.addMessage(ctx.user.id, threadId, {
        role: 'assistant',
        content: replyText,
        spokenText: replyText,
      });
      return { ok: true, messages: [userMessage, assistantMessage] };
    }),
  );

  app.post('/api/voice/sessions', async (req, reply) =>
    withUser(req, reply, db, clerkEnabled, async (ctx) => {
      const body = jsonBody(req);
      const deviceId = cleanText(body.deviceId);
      if (!deviceId) throw Object.assign(new Error('deviceId is required'), { statusCode: 400 });
      const session = db.createVoiceSession(ctx.user.id, deviceId);
      return { ok: true, session };
    }),
  );

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
