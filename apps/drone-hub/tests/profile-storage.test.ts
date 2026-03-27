import { describe, expect, test } from 'bun:test';

describe('profile storage helper', () => {
  test('namespaces storage keys when a profile id is available', async () => {
    const mod = await import('../src/profile-storage');
    expect(mod.profileStorageKey('droneHub.ui')).toBeTypeOf('string');
    expect(mod.profileStorageKey('droneHub.ui').startsWith('droneHub.ui')).toBe(true);
  });

  test('clears storage entries for a deleted profile id', async () => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      get length() {
        return storage.size;
      },
      key(index: number) {
        return Array.from(storage.keys())[index] ?? null;
      },
      getItem(key: string) {
        return storage.has(key) ? storage.get(key)! : null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    };

    const prevLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = localStorageMock;
    try {
      const mod = await import(`../src/profile-storage?test=${Date.now()}`);
      localStorageMock.setItem('droneHub.ui:default', '1');
      localStorageMock.setItem('droneHub.runtime:default', '2');
      localStorageMock.setItem('droneHub.ui:fresh', '3');
      localStorageMock.setItem('droneHub.activeProfileOverride', 'default');

      mod.clearProfileScopedStorage('default');

      expect(localStorageMock.getItem('droneHub.ui:default')).toBeNull();
      expect(localStorageMock.getItem('droneHub.runtime:default')).toBeNull();
      expect(localStorageMock.getItem('droneHub.ui:fresh')).toBe('3');
      expect(localStorageMock.getItem('droneHub.activeProfileOverride')).toBeNull();
    } finally {
      if (prevLocalStorage === undefined) {
        delete (globalThis as any).localStorage;
      } else {
        (globalThis as any).localStorage = prevLocalStorage;
      }
    }
  });
});
