import * as fs from 'fs';
import * as path from 'path';

const PROFILE_MANIFEST_VERSION = 1;
const PROFILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

type ProfileManifest = {
  version: 1;
  activeProfile: string;
};

function repoRootDir(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function repoDataRootDir(): string {
  return path.join(repoRootDir(), 'data');
}

export function profilesRootDir(): string {
  return path.join(repoDataRootDir(), 'profiles');
}

export function profileManifestPath(): string {
  return path.join(profilesRootDir(), 'manifest.json');
}

export function legacyDefaultDvmRootDir(): string {
  return path.join(repoDataRootDir(), 'dvm');
}

function normalizeProfileName(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value || !PROFILE_NAME_PATTERN.test(value)) return null;
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

export function profileDvmRootDir(profileNameRaw: string): string {
  const profileName = normalizeProfileName(profileNameRaw);
  if (!profileName) throw new Error('invalid profile name');
  return path.join(profilesRootDir(), profileName, 'dvm');
}

export function resolveDvmRootFromActiveProfile(): string | null {
  const activeProfile = readActiveProfileNameSync();
  return activeProfile ? profileDvmRootDir(activeProfile) : null;
}
