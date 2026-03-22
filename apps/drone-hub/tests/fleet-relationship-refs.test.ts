import { describe, expect, test } from 'bun:test';
import {
  buildFleetAssignedIdsByDroneId,
  buildFleetParentIdByDroneId,
} from '../src/droneHub/app/fleet-relationship-refs';
import type { DroneSummary } from '../src/droneHub/types';

function drone(overrides: Partial<DroneSummary>): DroneSummary {
  return {
    id: 'drone-id',
    name: 'drone-name',
    group: null,
    createdAt: '2026-03-22T00:00:00.000Z',
    repoPath: '',
    containerPort: 7777,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats: ['default'],
    ...overrides,
  };
}

describe('fleet relationship ref normalization', () => {
  test('normalizes parent refs from names to stable ids', () => {
    const drones = [
      drone({ id: 'owner-id', name: 'fleet-chat-manager' }),
      drone({ id: 'child-id', name: 'worker-a', fleetParentId: 'fleet-chat-manager' }),
    ];

    expect(buildFleetParentIdByDroneId(drones)).toEqual({
      'child-id': 'owner-id',
    });
  });

  test('normalizes assigned refs from names to stable ids and dedupes them', () => {
    const drones = [
      drone({
        id: 'owner-id',
        name: 'fleet-chat-manager',
        fleetAssignedIds: ['worker-a', 'worker-b', 'worker-a', 'owner-id', 'missing'],
      }),
      drone({ id: 'worker-a-id', name: 'worker-a' }),
      drone({ id: 'worker-b-id', name: 'worker-b' }),
    ];

    expect(buildFleetAssignedIdsByDroneId(drones)).toEqual({
      'owner-id': ['worker-a-id', 'worker-b-id'],
    });
  });
});
