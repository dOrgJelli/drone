import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

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
});
