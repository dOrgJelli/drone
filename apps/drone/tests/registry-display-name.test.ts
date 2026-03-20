import { describe, expect, test } from 'bun:test';
import type { DroneRegistry } from '../src/host/registry';
import { registryHasDisplayName } from '../src/host/registry';

describe('registryHasDisplayName', () => {
  test('ignores the same pending drone id while still blocking other ids', () => {
    const reg: DroneRegistry = {
      version: 2,
      drones: {},
      pending: {
        'pending-1': {
          id: 'pending-1',
          name: 'default-drone-11',
          repoPath: '',
          containerPort: 7777,
          build: false,
          createdAt: '2026-03-20T12:00:00.000Z',
          phase: 'starting',
        },
      },
    };

    expect(registryHasDisplayName(reg, 'default-drone-11')).toBe(true);
    expect(registryHasDisplayName(reg, 'default-drone-11', { excludeId: 'pending-1' })).toBe(false);
    expect(registryHasDisplayName(reg, 'default-drone-11', { excludeId: 'pending-2' })).toBe(true);
  });
});
