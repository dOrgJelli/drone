import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { ensureDefaultProfileForFirstRun } from '../src/host/profile-manager';
import {
  defaultProfileDroneRootDir,
  defaultProfileDvmRootDir,
  legacyDefaultDroneRootDir,
  legacyDefaultDvmRootDir,
  readActiveProfileName,
  writeActiveProfileName,
} from '../src/host/profiles';
import { withTempRepoDataRoot } from './test-helpers';

describe('legacy repo profile migration', () => {
  test('bootstraps the default profile from legacy repo data', async () => {
    await withTempRepoDataRoot('drone-profile-migration-', async () => {
      fs.mkdirSync(legacyDefaultDroneRootDir(), { recursive: true });
      fs.mkdirSync(legacyDefaultDvmRootDir(), { recursive: true });
      fs.writeFileSync(path.join(legacyDefaultDroneRootDir(), 'registry.json'), JSON.stringify({ drones: { legacy: { id: 'legacy' } } }, null, 2));
      fs.writeFileSync(path.join(legacyDefaultDvmRootDir(), 'base.json'), JSON.stringify({ baseContainer: 'legacy-base' }, null, 2));

      const result = await ensureDefaultProfileForFirstRun();

      expect(result).toEqual({ bootstrapped: true, activeProfile: 'default' });
      expect(await readActiveProfileName()).toBe('default');
      expect(fs.existsSync(path.join(defaultProfileDroneRootDir(), 'registry.json'))).toBe(true);
      expect(fs.existsSync(path.join(defaultProfileDvmRootDir(), 'base.json'))).toBe(true);
      expect(fs.existsSync(legacyDefaultDroneRootDir())).toBe(false);
      expect(fs.existsSync(legacyDefaultDvmRootDir())).toBe(false);
    });
  });

  test('repairs an already-active default profile by moving legacy repo data into it', async () => {
    await withTempRepoDataRoot('drone-profile-migration-', async () => {
      fs.mkdirSync(defaultProfileDroneRootDir(), { recursive: true });
      fs.mkdirSync(defaultProfileDvmRootDir(), { recursive: true });
      await writeActiveProfileName('default');

      fs.mkdirSync(legacyDefaultDroneRootDir(), { recursive: true });
      fs.mkdirSync(legacyDefaultDvmRootDir(), { recursive: true });
      fs.writeFileSync(path.join(legacyDefaultDroneRootDir(), 'registry.json'), JSON.stringify({ drones: { repaired: { id: 'repaired' } } }, null, 2));
      fs.writeFileSync(path.join(legacyDefaultDvmRootDir(), 'base.json'), JSON.stringify({ baseContainer: 'repaired-base' }, null, 2));

      const result = await ensureDefaultProfileForFirstRun();

      expect(result).toEqual({ bootstrapped: false, activeProfile: 'default' });
      expect(fs.existsSync(path.join(defaultProfileDroneRootDir(), 'registry.json'))).toBe(true);
      expect(fs.existsSync(path.join(defaultProfileDvmRootDir(), 'base.json'))).toBe(true);
      expect(fs.existsSync(legacyDefaultDroneRootDir())).toBe(false);
      expect(fs.existsSync(legacyDefaultDvmRootDir())).toBe(false);
    });
  });
});
