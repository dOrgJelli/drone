import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

const Type = {
  Object: (value: unknown) => value,
  String: (value?: unknown) => value,
  Optional: (value: unknown) => value,
  Number: (value?: unknown) => value,
  Boolean: (value?: unknown) => value,
  Array: (value: unknown) => value,
};

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({
    listDrones: async () => [],
    createDrone: async () => ({
      id: 'drone-a',
      name: 'Drone A',
      runtime: 'container',
      phase: 'starting',
      request: {},
    }),
    setDroneGroup: async () => ({ group: null, moved: [], rejected: [], total: 0 }),
    messageDrone: async () => ({ promptId: 'prompt-a' }),
  });
}

describe('assistant system prompt settings', () => {
  test('persists the editable default to assistant state and snapshots it onto new threads', async () => {
    await withTempDroneDataDir('assistant-system-prompt-', async (droneDataDir) => {
      const service = makeAssistantService();
      const initial = await service.snapshot();
      const initialThread = initial.threads[0] as any;

      const settings = await service.updateSystemPrompt({ prompt: 'Custom DroneHub assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Custom DroneHub assistant prompt.');
      expect(settings.assistantSystemPrompt.promptSource).toBe('settings');

      const next = await service.createThread({});
      const newThread = next.threads.find((thread) => thread.id === next.activeThreadId) as any;
      const oldThread = next.threads.find((thread) => thread.id === initialThread.id) as any;
      expect(newThread.systemPrompt).toBe('Custom DroneHub assistant prompt.');
      expect(oldThread.systemPrompt).toBe(initialThread.systemPrompt);

      const assistantState = JSON.parse(await fs.readFile(path.join(droneDataDir, 'assistant.json'), 'utf8'));
      expect(assistantState.systemPrompt).toBe('Custom DroneHub assistant prompt.');
    });
  });

  test('updates thread prompts independently and can promote one to the global prompt', async () => {
    await withTempDroneDataDir('assistant-thread-system-prompt-', async () => {
      const service = makeAssistantService();
      const initial = await service.snapshot();
      const firstThreadId = initial.activeThreadId;
      const secondSnapshot = await service.createThread({ title: 'second' });
      const secondThreadId = secondSnapshot.activeThreadId;

      await service.updateThreadSystemPrompt(firstThreadId, { prompt: 'Thread-only prompt.' });
      let snapshot = await service.snapshot();
      expect((snapshot.threads.find((thread) => thread.id === firstThreadId) as any).systemPrompt).toBe('Thread-only prompt.');
      expect((snapshot.threads.find((thread) => thread.id === secondThreadId) as any).systemPrompt).not.toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId);
      const settings = await service.systemPromptSettings();
      expect(settings.assistantSystemPrompt.prompt).toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId, { prompt: 'Draft prompt promoted.' });
      const draftPromotedSettings = await service.systemPromptSettings();
      expect(draftPromotedSettings.assistantSystemPrompt.prompt).toBe('Draft prompt promoted.');

      snapshot = await service.createThread({ title: 'third' });
      const thirdThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) as any;
      expect(thirdThread.systemPrompt).toBe('Draft prompt promoted.');
    });
  });

  test('exposes prompt tools and respects per-thread tool toggles', async () => {
    await withTempDroneDataDir('assistant-system-prompt-tools-', async () => {
      const service = makeAssistantService();
      const snapshot = await service.createThread({ title: 'tools' });
      const threadId = snapshot.activeThreadId;
      let tools = (service as any).buildTools({ Type }, threadId);
      expect(snapshot.availableTools.some((tool) => tool.name === 'get_system_prompt')).toBe(true);
      expect(snapshot.availableTools.some((tool) => tool.name === 'update_system_prompt')).toBe(true);
      expect(tools.some((tool: any) => tool.name === 'get_system_prompt')).toBe(false);
      expect(tools.some((tool: any) => tool.name === 'update_system_prompt')).toBe(false);

      await service.updateThread(threadId, { enabledTools: ['get_system_prompt', 'update_system_prompt'] });
      tools = (service as any).buildTools({ Type }, threadId);
      const updatePrompt = tools.find((tool: any) => tool.name === 'update_system_prompt');
      await updatePrompt.execute('call-a', { prompt: 'Updated by tool.' });
      let next = await service.snapshot();
      expect((next.threads.find((thread) => thread.id === threadId) as any).systemPrompt).toBe('Updated by tool.');

      await updatePrompt.execute('call-b', { patches: [{ oldText: 'Updated', newText: 'Patched' }] });
      next = await service.snapshot();
      expect((next.threads.find((thread) => thread.id === threadId) as any).systemPrompt).toBe('Patched by tool.');

      await service.updateThread(threadId, { enabledTools: ['get_system_prompt'] });
      tools = (service as any).buildTools({ Type }, threadId);
      expect(tools.map((tool: any) => tool.name)).toEqual(['get_system_prompt']);
    });
  });
});
