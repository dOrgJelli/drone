import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import { buildCanvasRelationshipEdges } from '../src/droneHub/canvas/relationship-edges';

describe('canvas relationship edges', () => {
  test('renders assigned edges even when the target is also a child drone', () => {
    const ownerNodeId = createCanvasChatNodeId('owner', 'default');
    const childNodeId = createCanvasChatNodeId('child', 'default');

    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: {
        owner: { droneId: ownerNodeId },
        child: { droneId: childNodeId },
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [ownerNodeId]: { x: 100, y: 100, width: 120, height: 54 },
        [childNodeId]: { x: 320, y: 120, width: 120, height: 54 },
      },
      fleetParentIdByDroneId: { child: 'owner' },
      fleetAssignedIdsByDroneId: { owner: ['child'] },
    });

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => ({ key: edge.key, variant: edge.variant }))).toEqual([
      { key: 'owner->child', variant: 'lineage' },
      { key: 'owner=>child', variant: 'assigned' },
    ]);
  });

  test('skips relationships when one side has no visible canvas node', () => {
    const ownerNodeId = createCanvasChatNodeId('owner', 'default');

    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: {
        owner: { droneId: ownerNodeId },
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [ownerNodeId]: { x: 100, y: 100, width: 120, height: 54 },
      },
      fleetParentIdByDroneId: { child: 'owner' },
      fleetAssignedIdsByDroneId: { owner: ['child'] },
    });

    expect(edges).toEqual([]);
  });
});
