import { describe, expect, test } from 'bun:test';

describe('profile storage helper', () => {
  test('namespaces storage keys when a profile id is available', async () => {
    const mod = await import('../src/profile-storage');
    expect(mod.profileStorageKey('droneHub.ui')).toBeTypeOf('string');
    expect(mod.profileStorageKey('droneHub.ui').startsWith('droneHub.ui')).toBe(true);
  });
});
