import { describe, expect, test } from 'bun:test';
import {
  applyDroneDisplayNameAcrossLifecycleEntries,
  findDroneIdByRef,
  findDroneLifecycleEntriesByIdentity,
  resolveStableDroneOrPendingIdFromRef,
} from '../src/hub/drone-lifecycle-registry';

describe('drone lifecycle registry helpers', () => {
  test('finds lifecycle entries by stable id across real and pending buckets', () => {
    const regAny: any = {
      drones: {
        'real-key': { id: 'drone-1', name: 'real-name' },
      },
      pending: {
        'pending-key': { id: 'drone-1', name: 'pending-name' },
      },
    };

    const found = findDroneLifecycleEntriesByIdentity(regAny, 'drone-1');

    expect(found?.real?.key).toBe('real-key');
    expect(found?.pending?.key).toBe('pending-key');
  });

  test('resolves refs by stable id, key, and display name', () => {
    const regAny: any = {
      drones: {
        'real-key': { id: 'drone-1', name: 'real-name' },
      },
      pending: {
        'pending-key': { id: 'drone-2', name: 'pending-name' },
      },
    };

    expect(findDroneIdByRef(regAny, 'real-key')).toEqual({ kind: 'real', id: 'real-key' });
    expect(findDroneIdByRef(regAny, 'drone-1')).toEqual({ kind: 'real', id: 'real-key' });
    expect(findDroneIdByRef(regAny, 'pending-name')).toEqual({ kind: 'pending', id: 'pending-key' });
    expect(resolveStableDroneOrPendingIdFromRef(regAny, 'pending-name')).toBe('drone-2');
  });

  test('applies a display-name rename across both lifecycle buckets for the same id', () => {
    const regAny: any = {
      drones: {
        'real-key': { id: 'drone-1', name: 'Untitled 25' },
      },
      pending: {
        'pending-key': { id: 'drone-1', name: 'Untitled 25' },
      },
    };

    const renamed = applyDroneDisplayNameAcrossLifecycleEntries(regAny, 'drone-1', 'task-delete-cli');

    expect(renamed).toBe(true);
    expect(regAny.drones['real-key'].name).toBe('task-delete-cli');
    expect(regAny.pending['pending-key'].name).toBe('task-delete-cli');
  });
});
