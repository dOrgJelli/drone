import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { migrateLegacyToDefaultProfile } from '../src/host/profile-manager';
import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  legacyDefaultDroneRootDir,
  legacyDefaultDvmRootDir,
  profileManifestPath,
  profileRootDir,
  readActiveProfileName,
} from '../src/host/profiles';

const DEFAULT_PROFILE_ROOT = profileRootDir('default');
const MANIFEST_PATH = profileManifestPath();

type Backup = {
  targetPath: string;
  backupPath: string | null;
};

function backupPath(targetPath: string): Backup {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return { targetPath: resolved, backupPath: null };
  const backupPath = `${resolved}.bak-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.renameSync(resolved, backupPath);
  return { targetPath: resolved, backupPath };
}

function restorePath(backup: Backup): void {
  fs.rmSync(backup.targetPath, { recursive: true, force: true });
  if (!backup.backupPath) return;
  fs.mkdirSync(path.dirname(backup.targetPath), { recursive: true });
  fs.renameSync(backup.backupPath, backup.targetPath);
}

let backups: Backup[] = [];

beforeEach(() => {
  backups = [
    backupPath(MANIFEST_PATH),
    backupPath(DEFAULT_PROFILE_ROOT),
    backupPath(legacyDefaultDroneRootDir()),
    backupPath(legacyDefaultDvmRootDir()),
  ];
  resetDroneRootDirForTests();
});

afterEach(() => {
  for (const backup of backups.reverse()) {
    restorePath(backup);
  }
  backups = [];
  resetDroneRootDirForTests();
});

describe('legacy profile migration', () => {
  test('migrates legacy drone and dvm roots into the default profile', async () => {
    fs.mkdirSync(legacyDefaultDroneRootDir(), { recursive: true });
    fs.mkdirSync(legacyDefaultDvmRootDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDefaultDroneRootDir(), 'registry.json'), JSON.stringify({ drones: { legacy: { name: 'legacy' } } }, null, 2));
    fs.writeFileSync(path.join(legacyDefaultDvmRootDir(), 'base.json'), JSON.stringify({ baseContainer: 'legacy-base' }, null, 2));

    const result = await migrateLegacyToDefaultProfile({ stopCurrentHub: false });

    expect(result.activeProfile).toBe('default');
    expect(result.migratedFromLegacy).toBe(true);
    expect(await readActiveProfileName()).toBe('default');
    expect(fs.existsSync(path.join(DEFAULT_PROFILE_ROOT, 'drone', 'registry.json'))).toBe(true);
    expect(fs.existsSync(path.join(DEFAULT_PROFILE_ROOT, 'dvm', 'base.json'))).toBe(true);
    expect(fs.existsSync(legacyDefaultDroneRootDir())).toBe(false);
    expect(fs.existsSync(legacyDefaultDvmRootDir())).toBe(false);
  });
});
