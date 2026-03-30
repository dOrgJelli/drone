import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resetDroneRootDirForTests, droneRootDir } from '../src/host/paths';
import {
  ensureProfileDirs,
  profileDroneRootDir,
  profileManifestPath,
  profilesRootDir,
  readActiveProfileName,
  resolveDroneRootFromActiveProfile,
  writeActiveProfileName,
} from '../src/host/profiles';
import { withTempRepoDataRoot } from './test-helpers';

const TEST_PROFILE_NAME = 'test-profile-paths';

describe('profile-backed drone paths', () => {
  test('activates a named profile and resolves droneRootDir to that profile root', async () => {
    await withTempRepoDataRoot('drone-profile-paths-', async () => {
      const testProfileRoot = path.join(profilesRootDir(), TEST_PROFILE_NAME);
      const testManifestPath = profileManifestPath();
      fs.rmSync(testProfileRoot, { recursive: true, force: true });
      fs.rmSync(testManifestPath, { force: true });
      resetDroneRootDirForTests();
      await ensureProfileDirs(TEST_PROFILE_NAME);
      await writeActiveProfileName(TEST_PROFILE_NAME);

      const expectedProfileRoot = profileDroneRootDir(TEST_PROFILE_NAME);
      const explicitDroneDataDir = process.env.DRONE_DATA_DIR?.trim();

      expect(await readActiveProfileName()).toBe(TEST_PROFILE_NAME);
      expect(resolveDroneRootFromActiveProfile()).toBe(expectedProfileRoot);
      expect(droneRootDir()).toBe(explicitDroneDataDir ? path.resolve(explicitDroneDataDir) : expectedProfileRoot);
    });
  });

  test('clearing the active profile removes the manifest', async () => {
    await withTempRepoDataRoot('drone-profile-paths-', async () => {
      const testProfileRoot = path.join(profilesRootDir(), TEST_PROFILE_NAME);
      const testManifestPath = profileManifestPath();
      fs.rmSync(testProfileRoot, { recursive: true, force: true });
      fs.rmSync(testManifestPath, { force: true });
      resetDroneRootDirForTests();
      await ensureProfileDirs(TEST_PROFILE_NAME);
      await writeActiveProfileName(TEST_PROFILE_NAME);
      await writeActiveProfileName(null);

      expect(await readActiveProfileName()).toBeNull();
      expect(fs.existsSync(testManifestPath)).toBe(false);
    });
  });
});
