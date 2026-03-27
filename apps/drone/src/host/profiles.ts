import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const PROFILE_MANIFEST_VERSION = 1;
export const PROFILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

type ProfileManifest = {
  version: 1;
  activeProfile: string;
};

function repoRootDir(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function repoDataRootDir(): string {
  return path.join(repoRootDir(), 'data');
}

export function profilesRootDir(): string {
  return path.join(repoDataRootDir(), 'profiles');
}

export function profileManifestPath(): string {
  return path.join(profilesRootDir(), 'manifest.json');
}

export function legacyDefaultDroneRootDir(): string {
  return path.join(repoDataRootDir(), 'drone');
}

export function legacyDefaultDvmRootDir(): string {
  return path.join(repoDataRootDir(), 'dvm');
}

export function normalizeProfileName(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (!PROFILE_NAME_PATTERN.test(value)) return null;
  return value;
}

function parseProfileManifest(raw: unknown): ProfileManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Number(value.version) !== PROFILE_MANIFEST_VERSION) return null;
  const activeProfile = normalizeProfileName(value.activeProfile);
  if (!activeProfile) return null;
  return { version: PROFILE_MANIFEST_VERSION, activeProfile };
}

export function readActiveProfileNameSync(): string | null {
  try {
    const raw = fs.readFileSync(profileManifestPath(), 'utf8');
    const parsed = parseProfileManifest(JSON.parse(raw));
    return parsed?.activeProfile ?? null;
  } catch {
    return null;
  }
}

export async function readActiveProfileName(): Promise<string | null> {
  try {
    const raw = await fsp.readFile(profileManifestPath(), 'utf8');
    const parsed = parseProfileManifest(JSON.parse(raw));
    return parsed?.activeProfile ?? null;
  } catch {
    return null;
  }
}

export async function writeActiveProfileName(profileNameRaw: string | null | undefined): Promise<void> {
  const profileName = normalizeProfileName(profileNameRaw);
  await fsp.mkdir(profilesRootDir(), { recursive: true });
  if (!profileName) {
    await fsp.rm(profileManifestPath(), { force: true });
    return;
  }
  const payload: ProfileManifest = { version: PROFILE_MANIFEST_VERSION, activeProfile: profileName };
  await fsp.writeFile(profileManifestPath(), JSON.stringify(payload, null, 2), 'utf8');
}

export function profileRootDir(profileNameRaw: string): string {
  const profileName = normalizeProfileName(profileNameRaw);
  if (!profileName) throw new Error('invalid profile name');
  return path.join(profilesRootDir(), profileName);
}

export function profileDroneRootDir(profileNameRaw: string): string {
  return path.join(profileRootDir(profileNameRaw), 'drone');
}

export function profileDvmRootDir(profileNameRaw: string): string {
  return path.join(profileRootDir(profileNameRaw), 'dvm');
}

export async function ensureProfileDirs(profileNameRaw: string): Promise<{ profileName: string; rootDir: string; droneDir: string; dvmDir: string }> {
  const profileName = normalizeProfileName(profileNameRaw);
  if (!profileName) throw new Error('invalid profile name');
  const rootDir = profileRootDir(profileName);
  const droneDir = profileDroneRootDir(profileName);
  const dvmDir = profileDvmRootDir(profileName);
  await Promise.all([
    fsp.mkdir(rootDir, { recursive: true }),
    fsp.mkdir(droneDir, { recursive: true }),
    fsp.mkdir(dvmDir, { recursive: true }),
  ]);
  return { profileName, rootDir, droneDir, dvmDir };
}

export async function listProfiles(): Promise<string[]> {
  try {
    const entries = await fsp.readdir(profilesRootDir(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeProfileName(entry.name))
      .filter((entry): entry is string => Boolean(entry))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function resolveDroneRootFromActiveProfile(): string | null {
  const activeProfile = readActiveProfileNameSync();
  return activeProfile ? profileDroneRootDir(activeProfile) : null;
}

export function resolveDvmRootFromActiveProfile(): string | null {
  const activeProfile = readActiveProfileNameSync();
  return activeProfile ? profileDvmRootDir(activeProfile) : null;
}
