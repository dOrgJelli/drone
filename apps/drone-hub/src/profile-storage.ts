function normalizeProfileId(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value) ? value : '';
}

const PROFILE_OVERRIDE_STORAGE_KEY = 'droneHub.activeProfileOverride';

function readStoredProfileOverride(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return normalizeProfileId(localStorage.getItem(PROFILE_OVERRIDE_STORAGE_KEY));
  } catch {
    return '';
  }
}

const ACTIVE_PROFILE_ID = readStoredProfileOverride() || normalizeProfileId(import.meta.env.VITE_DRONE_PROFILE_ID);

export function activeProfileStorageId(): string | null {
  return ACTIVE_PROFILE_ID || null;
}

export function persistProfileStorageIdOverride(profileIdRaw: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return;
  const profileId = normalizeProfileId(profileIdRaw);
  try {
    if (profileId) localStorage.setItem(PROFILE_OVERRIDE_STORAGE_KEY, profileId);
    else localStorage.removeItem(PROFILE_OVERRIDE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function clearProfileScopedStorage(profileIdRaw: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return;
  const profileId = normalizeProfileId(profileIdRaw);
  if (!profileId) return;
  const suffix = `:${profileId}`;
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.endsWith(suffix)) continue;
      keysToRemove.push(key);
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
    if (readStoredProfileOverride() === profileId) {
      localStorage.removeItem(PROFILE_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function profileStorageKey(baseKeyRaw: string): string {
  const baseKey = String(baseKeyRaw ?? '').trim();
  if (!baseKey) return '';
  if (!ACTIVE_PROFILE_ID) return baseKey;
  return `${baseKey}:${ACTIVE_PROFILE_ID}`;
}
