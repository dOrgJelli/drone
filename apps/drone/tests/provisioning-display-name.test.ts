import { describe, expect, test } from 'bun:test';
import { applyPendingDisplayNameToProvisionedDrone, resolvePendingDroneDisplayName } from '../src/hub/server';

describe('pending provisioning display name helpers', () => {
  test('prefers the latest pending rename over a stale created drone name', () => {
    const droneEntry: any = { id: 'drone-1', name: 'Untitled 25' };
    const pendingEntry: any = { id: 'drone-1', name: 'auth-bugfix' };

    const applied = applyPendingDisplayNameToProvisionedDrone(droneEntry, pendingEntry, 'Untitled 25');

    expect(applied).toBe('auth-bugfix');
    expect(droneEntry.name).toBe('auth-bugfix');
  });

  test('keeps the created drone name when no pending rename exists', () => {
    const droneEntry: any = { id: 'drone-1', name: 'existing-name' };

    const applied = applyPendingDisplayNameToProvisionedDrone(droneEntry, null, 'fallback-name');

    expect(applied).toBe('existing-name');
    expect(droneEntry.name).toBe('existing-name');
  });

  test('falls back when the pending entry has no valid name yet', () => {
    expect(resolvePendingDroneDisplayName({ name: '   ' }, 'Untitled 25')).toBe('Untitled 25');
  });
});
