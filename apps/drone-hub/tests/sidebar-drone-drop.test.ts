import { describe, expect, test } from 'bun:test';
import {
  canReparentSidebarDroneSelection,
  sidebarDroneDropIntentFromRects,
} from '../src/droneHub/app/sidebar-drone-drop';
import type { DroneSummary } from '../src/droneHub/types';

function drone(seed: Partial<DroneSummary> & Pick<DroneSummary, 'id' | 'name'>): DroneSummary {
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group ?? null,
    createdAt: seed.createdAt ?? '2026-01-01T00:00:00.000Z',
    repoPath: seed.repoPath ?? '',
    containerPort: seed.containerPort ?? 0,
    hostPort: seed.hostPort ?? null,
    statusOk: seed.statusOk ?? true,
    statusError: seed.statusError ?? null,
    chats: seed.chats ?? ['default'],
    fleetParentId: seed.fleetParentId ?? null,
    repoAttached: seed.repoAttached ?? false,
    hubPhase: seed.hubPhase ?? null,
    hubMessage: seed.hubMessage ?? null,
    busy: seed.busy ?? false,
  };
}

describe('sidebar drone drop helpers', () => {
  test('treats the middle third of a drone row as a parenting drop', () => {
    const overRect = { top: 100, height: 90 };
    expect(sidebarDroneDropIntentFromRects({ top: 100, height: 12 }, overRect)).toBe('before');
    expect(sidebarDroneDropIntentFromRects({ top: 139, height: 12 }, overRect)).toBe('inside');
    expect(sidebarDroneDropIntentFromRects({ top: 178, height: 12 }, overRect)).toBe('after');
  });

  test('rejects reparenting a drone beneath itself or one of its descendants', () => {
    const droneById = Object.fromEntries(
      [
        drone({ id: 'parent', name: 'parent' }),
        drone({ id: 'child', name: 'child', fleetParentId: 'parent' }),
        drone({ id: 'grandchild', name: 'grandchild', fleetParentId: 'child' }),
        drone({ id: 'sibling', name: 'sibling' }),
      ].map((item) => [item.id, item]),
    );

    expect(canReparentSidebarDroneSelection(droneById, ['parent'], 'child')).toBe(false);
    expect(canReparentSidebarDroneSelection(droneById, ['child'], 'child')).toBe(false);
    expect(canReparentSidebarDroneSelection(droneById, ['child'], 'sibling')).toBe(true);
  });
});
