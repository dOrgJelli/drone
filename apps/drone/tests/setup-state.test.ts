import { describe, expect, test } from 'bun:test';
import {
  clearWelcomeDismissedAtForScope,
  dismissWelcomeForScope,
  readHubSetupState,
  readWelcomeDismissedAtForScope,
  resolveHubSetupScopeKey,
} from '../src/host/setup-state';
import { withTempRepoDataRoot } from './test-helpers';

describe('hub setup state', () => {
  test('tracks welcome dismissal separately for default and named profile scopes', async () => {
    await withTempRepoDataRoot('drone-setup-state-', async () => {
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

  test('clearing a scope removes only that profile dismissal', async () => {
    await withTempRepoDataRoot('drone-setup-state-', async () => {
      const defaultScope = resolveHubSetupScopeKey('default');
      const freshScope = resolveHubSetupScopeKey('fresh');

      await dismissWelcomeForScope(defaultScope);
      await dismissWelcomeForScope(freshScope);
      await clearWelcomeDismissedAtForScope(freshScope);

      expect(await readWelcomeDismissedAtForScope(defaultScope)).not.toBeNull();
      expect(await readWelcomeDismissedAtForScope(freshScope)).toBeNull();
    });
  });
});
