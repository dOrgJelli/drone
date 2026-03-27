import fs from 'node:fs/promises';
import path from 'node:path';
import { repoDataRootDir } from './profiles';

export type HubSetupScopeKey = 'legacy' | `profile:${string}`;

export type HubSetupState = {
  version: 2;
  firstHubStartedAt: string;
  welcomeDismissedAtByScope: Record<string, string>;
};

const HUB_SETUP_STATE_VERSION = 2;

export function hubSetupStatePath(): string {
  return path.join(repoDataRootDir(), 'hub-setup.json');
}

function normalizeIsoTimestamp(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeDismissedMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeIsoTimestamp(value);
    if (normalized) next[key] = normalized;
  }
  return next;
}

function parseHubSetupStateV1(raw: Record<string, unknown>): HubSetupState | null {
  const firstHubStartedAt = normalizeIsoTimestamp(raw.firstHubStartedAt);
  if (!firstHubStartedAt) return null;
  const legacyDismissedAt = normalizeIsoTimestamp(raw.welcomeDismissedAt);
  return {
    version: HUB_SETUP_STATE_VERSION,
    firstHubStartedAt,
    welcomeDismissedAtByScope: legacyDismissedAt ? { legacy: legacyDismissedAt } : {},
  };
}

function parseHubSetupState(raw: unknown): HubSetupState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const version = Number(value.version);
  if (version === 1) {
    return parseHubSetupStateV1(value);
  }
  if (version !== HUB_SETUP_STATE_VERSION) return null;
  const firstHubStartedAt = normalizeIsoTimestamp(value.firstHubStartedAt);
  if (!firstHubStartedAt) return null;
  return {
    version: HUB_SETUP_STATE_VERSION,
    firstHubStartedAt,
    welcomeDismissedAtByScope: normalizeDismissedMap(value.welcomeDismissedAtByScope),
  };
}

export function resolveHubSetupScopeKey(activeProfile: string | null | undefined): HubSetupScopeKey {
  const profile = typeof activeProfile === 'string' ? activeProfile.trim() : '';
  return profile ? `profile:${profile}` : 'legacy';
}

export async function readHubSetupState(): Promise<HubSetupState | null> {
  try {
    const raw = await fs.readFile(hubSetupStatePath(), 'utf8');
    return parseHubSetupState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function ensureHubSetupState(): Promise<HubSetupState> {
  const existing = await readHubSetupState();
  if (existing) return existing;
  const created: HubSetupState = {
    version: HUB_SETUP_STATE_VERSION,
    firstHubStartedAt: new Date().toISOString(),
    welcomeDismissedAtByScope: {},
  };
  await fs.mkdir(repoDataRootDir(), { recursive: true });
  await fs.writeFile(hubSetupStatePath(), JSON.stringify(created, null, 2), 'utf8');
  return created;
}

export async function updateHubSetupState(patch: Partial<Omit<HubSetupState, 'version'>>): Promise<HubSetupState> {
  const current = await ensureHubSetupState();
  const next: HubSetupState = {
    version: HUB_SETUP_STATE_VERSION,
    firstHubStartedAt: normalizeIsoTimestamp(patch.firstHubStartedAt) ?? current.firstHubStartedAt,
    welcomeDismissedAtByScope:
      patch.welcomeDismissedAtByScope === undefined
        ? current.welcomeDismissedAtByScope
        : normalizeDismissedMap(patch.welcomeDismissedAtByScope),
  };
  await fs.mkdir(repoDataRootDir(), { recursive: true });
  await fs.writeFile(hubSetupStatePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function readWelcomeDismissedAtForScope(scope: HubSetupScopeKey): Promise<string | null> {
  const state = await ensureHubSetupState();
  return state.welcomeDismissedAtByScope[scope] ?? null;
}

export async function dismissWelcomeForScope(scope: HubSetupScopeKey): Promise<HubSetupState> {
  const current = await ensureHubSetupState();
  const next = {
    ...current.welcomeDismissedAtByScope,
    [scope]: new Date().toISOString(),
  };
  return await updateHubSetupState({ welcomeDismissedAtByScope: next });
}

export async function clearWelcomeDismissedAtForScope(scope: HubSetupScopeKey): Promise<HubSetupState> {
  const current = await ensureHubSetupState();
  const next = { ...current.welcomeDismissedAtByScope };
  delete next[scope];
  return await updateHubSetupState({ welcomeDismissedAtByScope: next });
}
