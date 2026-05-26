import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import {
  assistantSnapshot,
  promptAssistantThread,
  resolveAssistantApproval,
  sanitizeArtifactPath,
  setAssistantExternalToolExecutor,
} from './assistant-parity.js';
import { extensionToolName } from './assistant-extensions.js';
import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

function testUser(db: VoiceStreamNextDb) {
  return db.upsertUser({
    clerkUserId: `clerk_${crypto.randomUUID()}`,
    displayName: 'Assistant User',
    email: 'assistant@example.local',
    admin: false,
  });
}

describe('assistant parity runtime', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
    delete process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOICE_STREAM_NEXT_OPENAI_API_KEY;
    setAssistantExternalToolExecutor(null);
  });

  test('writes assistant artifacts without approval', async () => {
    const db = tempDb('assistant-artifacts');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Artifacts' });
    const events: unknown[] = [];

    const snapshot = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/artifact write notes/todo.md\n- first task' },
      (event) => events.push(event),
    );

    const artifact = db.readArtifact(user.id, thread.id, 'notes/todo.md');
    expect(artifact?.content).toBe('- first task');
    expect(snapshot.threads[0]?.artifactsCount).toBe(1);
    expect(db.listApprovals(user.id, thread.id)).toHaveLength(0);
    expect(events.some((event: any) => event.type === 'done')).toBe(true);
  });

  test('requires approval before changing a thread system prompt', async () => {
    const db = tempDb('assistant-approval');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Approvals' });

    const waiting = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/system-prompt Keep answers in bullet form.' },
      () => undefined,
    );

    expect(waiting.pendingApprovals).toHaveLength(1);
    expect(db.thread(user.id, thread.id)?.status).toBe('waiting_for_approval');
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBeNull();

    const approved = await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');

    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Keep answers in bullet form.');
    expect(approved.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listMessages(user.id, thread.id).some((message) => message.role === 'toolResult')).toBe(true);
  });

  test('persists thread model controls', () => {
    const db = tempDb('assistant-models');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Models' });

    const updated = db.updateThread(user.id, thread.id, {
      provider: 'codex',
      model: 'gpt-5.5',
      thinkingLevel: 'high',
      promptDeliveryMode: 'asap',
      voiceEnabled: true,
    });

    expect(updated?.provider).toBe('codex');
    expect(updated?.model).toBe('gpt-5.5');
    expect(updated?.thinkingLevel).toBe('high');
    expect(updated?.promptDeliveryMode).toBe('asap');
    expect(updated?.voiceEnabled).toBe(true);
  });

  test('exposes and executes configured extension tools', async () => {
    const db = tempDb('assistant-extension-tools');
    dbs.push(db);
    const user = testUser(db);
    const manifest = db.upsertAssistantExtensionManifest(user.id, {
      id: 'test-extension',
      name: 'Test Extension',
      version: '0.1.0',
      tools: [{
        name: 'echo',
        label: 'Echo',
        description: 'Echo test input through an extension runner.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        approval: 'never',
        supportedTargets: ['server', 'device', 'any_device'],
        defaultTarget: 'any_device',
      }],
    });
    const toolName = extensionToolName(manifest.extensionId, 'echo');
    db.upsertAssistantExtensionToolRoute(user.id, { toolName, enabled: true, targetKind: 'any_device' });
    const thread = db.createThread(user.id, { title: 'Extensions', enabledTools: ['assistant_artifacts', toolName] });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      { name: toolName, arguments: { text: 'hello extension' } },
    ]);
    setAssistantExternalToolExecutor(async (input) => ({ ok: true, toolName: input.toolName, args: input.args, targetKind: input.route?.targetKind }));

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Use the extension.' }, () => undefined);

    expect(assistantSnapshot(db, user.id).availableTools.some((tool) => tool.name === toolName)).toBe(true);
    expect(snapshot.threads[0]?.toolCalls.some((call) => call.toolName === toolName && call.status === 'completed')).toBe(true);
    const result = JSON.parse(db.listToolCalls(user.id, thread.id)[0]!.resultJson || '{}');
    expect(result.args.text).toBe('hello extension');
    expect(result.targetKind).toBe('any_device');
  });

  test('executes model-requested artifact tool calls without slash commands', async () => {
    const db = tempDb('assistant-model-tools');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Model tools' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'assistant_artifacts',
        arguments: { action: 'write', path: 'notes/model.md', content: 'Created by model tool call.' },
      },
    ]);
    const events: any[] = [];

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'Please save this as a note.' }, (event) => events.push(event));

    expect(db.readArtifact(user.id, thread.id, 'notes/model.md')?.content).toBe('Created by model tool call.');
    expect(db.listToolCalls(user.id, thread.id)[0]?.toolName).toBe('assistant_artifacts');
    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(db.listMessages(user.id, thread.id).some((message) => message.contentJson?.includes('modelToolCall'))).toBe(true);
  });

  test('pauses model-requested approval tools before execution', async () => {
    const db = tempDb('assistant-model-approval');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Model approval' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Use concise answers only.' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Tighten the system prompt.' }, () => undefined);

    expect(waiting.pendingApprovals).toHaveLength(1);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBeNull();
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('waiting_for_approval');
  });

  test('auto-approve skips pending approval and executes approval tools', async () => {
    const db = tempDb('assistant-auto-approve');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Auto approve', autoApprove: true });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Auto-approved prompt.' },
      },
    ]);

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Update without stopping.' }, () => undefined);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Auto-approved prompt.');
    expect(db.listToolCalls(user.id, thread.id)[0]?.status).toBe('completed');
  });

  test('denying a pending approval cancels the waiting run', async () => {
    const db = tempDb('assistant-approval-deny');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Deny approval' });

    const waiting = await promptAssistantThread(
      db,
      user.id,
      thread.id,
      { prompt: '/system-prompt Never use paragraphs.' },
      () => undefined,
    );
    const approval = waiting.pendingApprovals[0]!;
    const runId = db.listRuns(user.id, thread.id)[0]!.id;

    const snapshot = await resolveAssistantApproval(db, user.id, approval.id, false, 'test');

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.status).toBe('idle');
    expect(db.listRuns(user.id, thread.id).find((run) => run.id === runId)?.status).toBe('cancelled');
    expect(db.listMessages(user.id, thread.id).some((message) => message.isError && message.content.includes('denied'))).toBe(true);
  });

  test('continues a model-requested tool run after approval', async () => {
    const db = tempDb('assistant-approval-continue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Continue approval' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'update_system_prompt',
        arguments: { prompt: 'Continue after approved tools.' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Update the rules and keep going.' }, () => undefined);
    const runId = db.listRuns(user.id, thread.id)[0]!.id;
    const snapshot = await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');
    const messages = db.listMessages(user.id, thread.id);

    expect(snapshot.pendingApprovals).toHaveLength(0);
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Continue after approved tools.');
    expect(db.listRuns(user.id, thread.id).find((run) => run.id === runId)?.status).toBe('idle');
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.content).toContain('system prompt updated');
  });

  test('queues prompts while a queue-mode thread has an active run', async () => {
    const db = tempDb('assistant-queue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Queue mode', promptDeliveryMode: 'queue' });
    db.createRun(user.id, thread.id, { prompt: 'running', provider: 'openai', model: 'gpt-5.2', thinkingLevel: 'off' });
    const events: any[] = [];

    const snapshot = await promptAssistantThread(db, user.id, thread.id, { prompt: 'run after this', provider: 'openai' }, (event) => events.push(event));

    expect(snapshot.threads[0]?.queuedPrompts).toHaveLength(1);
    expect(db.listQueuedPrompts(user.id, thread.id)[0]?.prompt).toBe('run after this');
    expect(events.some((event) => event.type === 'queued')).toBe(true);
  });

  test('cancels queued prompts and deletes threads', () => {
    const db = tempDb('assistant-delete-queue');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Delete me' });
    const queued = db.enqueuePrompt(user.id, thread.id, {
      prompt: 'later',
      provider: 'openai',
      model: 'gpt-5.2',
      thinkingLevel: 'off',
    });

    expect(db.cancelQueuedPrompt(user.id, thread.id, queued.id)?.status).toBe('cancelled');
    expect(db.listQueuedPrompts(user.id, thread.id)).toHaveLength(0);
    expect(db.deleteThread(user.id, thread.id)).toBe(true);
    expect(db.thread(user.id, thread.id)).toBeNull();
  });

  test('errors visibly when OpenAI is selected without an API key', async () => {
    const db = tempDb('assistant-missing-openai-key');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'OpenAI', provider: 'openai', model: 'gpt-5.2' });
    const events: any[] = [];
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOICE_STREAM_NEXT_OPENAI_API_KEY;

    await promptAssistantThread(db, user.id, thread.id, { prompt: 'hello there', provider: 'openai' }, (event) => events.push(event));
    const assistantMessage = db.listMessages(user.id, thread.id).find((message) => message.role === 'assistant');

    expect(db.thread(user.id, thread.id)?.status).toBe('error');
    expect(assistantMessage?.isError).toBe(true);
    expect(assistantMessage?.content).toContain('OpenAI API key is not configured');
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  test('shows provider errors without local fallback replies', async () => {
    const db = tempDb('assistant-provider-error');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, {
      title: 'Provider failure',
      provider: 'openai',
      model: 'gpt-5.2',
      enabledTools: [],
    });
    const originalFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const events: any[] = [];
      await promptAssistantThread(db, user.id, thread.id, { prompt: 'hello', provider: 'openai' }, (event) => events.push(event));
      const assistantMessage = db.listMessages(user.id, thread.id).find((message) => message.role === 'assistant');

      expect(db.thread(user.id, thread.id)?.status).toBe('error');
      expect(assistantMessage?.isError).toBe(true);
      expect(assistantMessage?.content).toContain('quota exceeded');
      expect(assistantMessage?.content).not.toContain('I heard: hello');
      expect(events.some((event) => event.type === 'error')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('stores, updates, and deletes thread artifacts directly', () => {
    const db = tempDb('assistant-artifact-direct');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Direct artifacts' });

    const created = db.upsertArtifact(user.id, thread.id, { path: sanitizeArtifactPath('notes/direct.md'), content: 'one' });
    const updated = db.upsertArtifact(user.id, thread.id, { path: created.path, content: 'two' });

    expect(created.id).toBe(updated.id);
    expect(updated.content).toBe('two');
    expect(db.listArtifacts(user.id, thread.id)).toHaveLength(1);
    expect(db.deleteArtifact(user.id, thread.id, created.path)).toBe(true);
    expect(db.listArtifacts(user.id, thread.id)).toHaveLength(0);
  });

  test('rejects unsafe artifact paths', () => {
    expect(() => sanitizeArtifactPath('../secret.md')).toThrow();
    expect(() => sanitizeArtifactPath('notes/../secret.md')).toThrow();
    expect(() => sanitizeArtifactPath('')).toThrow();
    expect(sanitizeArtifactPath('/notes/safe.md')).toBe('notes/safe.md');
  });

  test('supports model tool parity for artifact list/patch and system prompt patches', async () => {
    const db = tempDb('assistant-tool-patches');
    dbs.push(db);
    const user = testUser(db);
    const thread = db.createThread(user.id, { title: 'Patch tools' });
    db.upsertArtifact(user.id, thread.id, { path: 'notes/patch.md', content: 'alpha beta gamma' });
    db.updateThread(user.id, thread.id, { systemPrompt: 'Keep answers short and plain.' });
    process.env.VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS = JSON.stringify([
      {
        name: 'assistant_artifacts',
        arguments: { action: 'list', path: '', content: '', oldText: '', newText: '', baseRevision: '' },
      },
      {
        name: 'assistant_artifacts',
        arguments: { action: 'patch', path: 'notes/patch.md', content: '', oldText: 'beta', newText: 'delta', baseRevision: '' },
      },
      {
        name: 'update_system_prompt',
        arguments: { prompt: '', oldText: 'plain', newText: 'direct' },
      },
    ]);

    const waiting = await promptAssistantThread(db, user.id, thread.id, { prompt: 'Patch the notes and prompt.' }, () => undefined);

    expect(db.readArtifact(user.id, thread.id, 'notes/patch.md')?.content).toBe('alpha delta gamma');
    expect(waiting.pendingApprovals).toHaveLength(1);
    await resolveAssistantApproval(db, user.id, waiting.pendingApprovals[0]!.id, true, 'test');
    expect(db.thread(user.id, thread.id)?.systemPrompt).toBe('Keep answers short and direct.');
  });
});
