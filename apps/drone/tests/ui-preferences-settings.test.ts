import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  resolveUiPreferencesSettingsResponse,
  upsertStoredUiPreferencesSettings,
} from '../src/hub/hub-settings';

async function withTempDroneDataDir<T>(fn: (droneDataDir: string) => Promise<T>): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-ui-preferences-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  fs.mkdirSync(droneDataDir, { recursive: true });
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = droneDataDir;
  resetDroneRootDirForTests();

  try {
    return await fn(droneDataDir);
  } finally {
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('ui preferences settings persistence', () => {
  test('returns defaults before anything is stored', async () => {
    await withTempDroneDataDir(async () => {
      const resolved = await resolveUiPreferencesSettingsResponse();
      expect(resolved.updatedAt).toBeNull();
      expect(resolved.uiPreferences.sidebarGroupingMode).toBe('groups');
      expect(resolved.uiPreferences.sidebarGroupOrder).toEqual([]);
      expect(resolved.uiPreferences.autoDelete).toBe(false);
      expect(resolved.uiPreferences.automations).toEqual([]);
    });
  });

  test('round-trips backend ui preferences and sanitizes invalid values', async () => {
    await withTempDroneDataDir(async (droneDataDir) => {
      await upsertStoredUiPreferencesSettings({
        sidebarGroupingMode: 'repos',
        sidebarGroupOrder: ['alpha', 'beta', 'alpha', '', '  '],
        sidebarDroneOrderByGroup: {
          alpha: ['drone-a', 'drone-b', 'drone-a'],
          '': ['ignored'],
        },
        sidebarChatOrderByDrone: {
          'drone-a': ['default', 'review', 'default'],
        },
        hiddenSidebarGroups: ['archive', 'archive', ''],
        autoDelete: true,
        automations: [
          {
            id: 'automation-a',
            label: '  Nightly build  ',
            prompt: 'ship it',
            runs: 999,
            sleepAmount: 5,
            sleepUnit: 'hours',
            stopPhrase: 'done',
            stopPhraseCaseSensitive: true,
          },
          {
            id: 'automation-a',
            label: 'duplicate id should be dropped',
          },
        ],
      });

      const resolved = await resolveUiPreferencesSettingsResponse();
      expect(resolved.updatedAt).not.toBeNull();
      expect(resolved.uiPreferences.sidebarGroupingMode).toBe('repos');
      expect(resolved.uiPreferences.sidebarGroupOrder).toEqual(['alpha', 'beta']);
      expect(resolved.uiPreferences.sidebarDroneOrderByGroup).toEqual({
        alpha: ['drone-a', 'drone-b'],
      });
      expect(resolved.uiPreferences.sidebarChatOrderByDrone).toEqual({
        'drone-a': ['default', 'review'],
      });
      expect(resolved.uiPreferences.hiddenSidebarGroups).toEqual(['archive']);
      expect(resolved.uiPreferences.autoDelete).toBe(true);
      expect(resolved.uiPreferences.automations).toHaveLength(1);
      expect(resolved.uiPreferences.automations[0]).toMatchObject({
        id: 'automation-a',
        label: 'Nightly build',
        prompt: 'ship it',
        runs: 20,
        sleepAmount: 5,
        sleepUnit: 'hours',
        stopPhrase: 'done',
        stopPhraseCaseSensitive: true,
      });

      const registryPath = path.join(droneDataDir, 'registry.json');
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      expect(registry?.settings?.uiPreferences?.autoDelete).toBe(true);
      expect(registry?.settings?.uiPreferences?.automations).toHaveLength(1);
    });
  });
});
