import { describe, expect, test } from 'bun:test';
import { fleetDescendantIdsForActor } from '../src/hub/fleet-helpers';

describe('fleetDescendantIdsForActor', () => {
  test('collects nested descendants without looping forever on cycles', () => {
    const reg = {
      drones: {
        parent: { name: 'parent', fleet: { createdBy: null } },
        child: { name: 'child', fleet: { createdBy: 'parent' } },
        grandchild: { name: 'grandchild', fleet: { createdBy: 'child' } },
        sibling: { name: 'sibling', fleet: { createdBy: 'parent' } },
        cycle: { name: 'cycle', fleet: { createdBy: 'cycle-child' } },
        'cycle-child': { name: 'cycle-child', fleet: { createdBy: 'cycle' } },
      },
      pending: {},
    };

    expect(fleetDescendantIdsForActor(reg, 'parent')).toEqual(['child', 'grandchild', 'sibling']);
    expect(fleetDescendantIdsForActor(reg, 'cycle')).toEqual(['cycle-child']);
  });
});
