import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

describe('registry hourly snapshots', () => {
  test('captures the prior registry state at most once per hour', async () => {
    await withTempDroneDataDir('drone-registry-snapshots-', async (droneDataDir) => {
      const writeAutomationLabel = async (label: string) => {
        await updateRegistry((reg: any) => {
          reg.settings ??= {};
          reg.settings.uiPreferences = {
            sidebarGroupingMode: 'groups',
            sidebarDensityMode: 'default',
            sidebarGroupOrder: [],
            sidebarDroneOrderByGroup: {},
            sidebarNodeOrderByParent: {},
            sidebarChatOrderByDrone: {},
            hiddenSidebarGroups: [],
            autoDelete: false,
            automations: [
              {
                id: 'automation-1',
                label,
                prompt: `prompt:${label}`,
                onFailurePrompt: '',
                runs: 1,
                sleepAmount: 0,
                sleepUnit: 'seconds',
                stopPhrase: '<DONE>',
                stopPhraseCaseSensitive: true,
              },
            ],
            updatedAt: new Date().toISOString(),
          };
        });
      };

      const snapshotFiles = () =>
        fs.readdirSync(droneDataDir)
          .filter((name) => /^registry\.snapshot-.*\.json$/.test(name))
          .sort();

      await writeAutomationLabel('first');
      expect(snapshotFiles()).toEqual([]);

      await writeAutomationLabel('second');
      const [snapshotName] = snapshotFiles();
      expect(snapshotName).toBeTruthy();
      expect(snapshotFiles()).toHaveLength(1);

      const snapshotPath = path.join(droneDataDir, snapshotName);
      const snapshotAfterSecondWrite = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshotAfterSecondWrite?.settings?.uiPreferences?.automations?.[0]?.label).toBe('first');

      await writeAutomationLabel('third');
      expect(snapshotFiles()).toHaveLength(1);

      const snapshotAfterThirdWrite = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshotAfterThirdWrite?.settings?.uiPreferences?.automations?.[0]?.label).toBe('first');
    });
  });
});
