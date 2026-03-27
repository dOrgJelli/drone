#!/usr/bin/env bun

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  ensureProfileDirs,
  legacyDefaultDroneRootDir,
  legacyDefaultDvmRootDir,
  normalizeProfileName,
  profileDvmRootDir,
  profileDroneRootDir,
  profileRootDir,
  readActiveProfileName,
  writeActiveProfileName,
} from '../apps/drone/src/host/profiles';

function parseArgs(argv: string[]): { name: string } {
  let name = 'default';
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--name') {
      name = String(argv[index + 1] ?? '').trim() || name;
      index += 1;
      continue;
    }
    if (!current.startsWith('-') && name === 'default') {
      name = current;
    }
  }
  return { name };
}

async function dirHasEntries(targetPath: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function pidIsRunning(pidRaw: unknown): boolean {
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return String(error?.code ?? '') === 'EPERM';
  }
}

async function assertLegacyHubNotRunning(): Promise<void> {
  const statePath = path.join(legacyDefaultDroneRootDir(), 'hub.json');
  try {
    const raw = await fsp.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (pidIsRunning(parsed?.pid)) {
      throw new Error('legacy hub appears to still be running; stop it before migrating profiles');
    }
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return;
    if (/legacy hub appears to still be running/i.test(String(error?.message ?? error ?? ''))) throw error;
  }
}

async function moveTree(sourcePath: string, targetPath: string): Promise<boolean> {
  if (!(await dirHasEntries(sourcePath))) return false;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsp.rename(sourcePath, targetPath);
    return true;
  } catch {
    await fsp.cp(sourcePath, targetPath, { recursive: true });
    await fsp.rm(sourcePath, { recursive: true, force: true });
    return true;
  }
}

async function main(): Promise<void> {
  const { name: nameRaw } = parseArgs(process.argv.slice(2));
  const profileName = normalizeProfileName(nameRaw);
  if (!profileName) {
    throw new Error('invalid profile name (use lowercase letters, numbers, ".", "_" or "-")');
  }

  const activeProfile = await readActiveProfileName();
  if (activeProfile) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: `already in profile mode (${activeProfile})` }, null, 2));
    return;
  }

  const hasLegacyDroneData = await dirHasEntries(legacyDefaultDroneRootDir());
  const hasLegacyDvmData = await dirHasEntries(legacyDefaultDvmRootDir());
  if (!hasLegacyDroneData && !hasLegacyDvmData) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no legacy drone or dvm data found' }, null, 2));
    return;
  }

  await assertLegacyHubNotRunning();

  if (fs.existsSync(profileRootDir(profileName))) {
    throw new Error(`target profile already exists: ${profileName}`);
  }

  await ensureProfileDirs(profileName);
  const movedDroneRoot = await moveTree(legacyDefaultDroneRootDir(), profileDroneRootDir(profileName));
  const movedDvmRoot = await moveTree(legacyDefaultDvmRootDir(), profileDvmRootDir(profileName));
  await writeActiveProfileName(profileName);

  console.log(
    JSON.stringify(
      {
        ok: true,
        migratedFromLegacy: true,
        activeProfile: profileName,
        movedDroneRoot,
        movedDvmRoot,
        profileRoot: profileRootDir(profileName),
        droneDataDir: profileDroneRootDir(profileName),
        dvmDataDir: profileDvmRootDir(profileName),
        nextStep: 'Start the hub normally. After you confirm this profile works, the legacy migration code can be removed.',
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
