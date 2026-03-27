import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  dismissWelcomeForScope,
  hubSetupStatePath,
  readHubSetupState,
  readWelcomeDismissedAtForScope,
  resolveHubSetupScopeKey,
} from '../src/host/setup-state';

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

let backup: Backup;

beforeEach(() => {
  backup = backupPath(hubSetupStatePath());
});

afterEach(() => {
  restorePath(backup);
});

describe('hub setup state', () => {
  test('tracks welcome dismissal separately for default and named profile scopes', async () => {
    const implicitDefaultScope = resolveHubSetupScopeKey(null);
    const namedDefaultScope = resolveHubSetupScopeKey('default');
    const freshScope = resolveHubSetupScopeKey('fresh');

    expect(implicitDefaultScope).toBe(namedDefaultScope);
    expect(await readWelcomeDismissedAtForScope(namedDefaultScope)).toBeNull();

    await dismissWelcomeForScope(namedDefaultScope);

    expect(await readWelcomeDismissedAtForScope(namedDefaultScope)).not.toBeNull();
    expect(await readWelcomeDismissedAtForScope(freshScope)).toBeNull();

    const state = await readHubSetupState();
    expect(state?.welcomeDismissedAtByScope[namedDefaultScope]).toBeTruthy();
    expect(state?.welcomeDismissedAtByScope[freshScope]).toBeUndefined();
  });
});
