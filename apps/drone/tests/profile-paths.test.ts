import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resetDroneRootDirForTests, droneRootDir } from '../src/host/paths';
import {
  ensureProfileDirs,
  profileDroneRootDir,
  profileManifestPath,
  profilesRootDir,
  readActiveProfileName,
  writeActiveProfileName,
} from '../src/host/profiles';

const TEST_PROFILE_NAME = 'test-profile-paths';
const TEST_PROFILE_ROOT = path.join(profilesRootDir(), TEST_PROFILE_NAME);
const TEST_MANIFEST_PATH = profileManifestPath();
let manifestBackup: string | null = null;

beforeEach(async () => {
  manifestBackup = fs.existsSync(TEST_MANIFEST_PATH) ? fs.readFileSync(TEST_MANIFEST_PATH, 'utf8') : null;
  fs.rmSync(TEST_PROFILE_ROOT, { recursive: true, force: true });
  fs.rmSync(TEST_MANIFEST_PATH, { force: true });
  resetDroneRootDirForTests();
  await ensureProfileDirs(TEST_PROFILE_NAME);
});

afterEach(async () => {
  fs.rmSync(TEST_PROFILE_ROOT, { recursive: true, force: true });
  if (manifestBackup == null) {
    fs.rmSync(TEST_MANIFEST_PATH, { force: true });
  } else {
    fs.mkdirSync(path.dirname(TEST_MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(TEST_MANIFEST_PATH, manifestBackup, 'utf8');
  }
  resetDroneRootDirForTests();
});

describe('profile-backed drone paths', () => {
  test('activates a named profile and resolves droneRootDir to that profile root', async () => {
    await writeActiveProfileName(TEST_PROFILE_NAME);

    expect(await readActiveProfileName()).toBe(TEST_PROFILE_NAME);
    expect(droneRootDir()).toBe(profileDroneRootDir(TEST_PROFILE_NAME));
  });

  test('clearing the active profile removes the manifest', async () => {
    await writeActiveProfileName(TEST_PROFILE_NAME);
    await writeActiveProfileName(null);

    expect(await readActiveProfileName()).toBeNull();
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(false);
  });
});
