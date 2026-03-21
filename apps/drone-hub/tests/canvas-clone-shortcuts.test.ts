import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import {
  buildOptimisticCloneCanvasNodes,
  cloneCanvasDronesById,
  collectCloneableDroneIdsFromCanvasSelection,
  collectCloneSourceNodeIdByDroneId,
} from '../src/droneHub/canvas/clone-shortcuts';
import type { DroneSummary } from '../src/droneHub/types';

describe('canvas clone shortcut helpers', () => {
  test('dedupes selected chats down to ordered unique drone ids', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        createCanvasChatNodeId('alpha', 'default'),
        createCanvasChatNodeId('alpha', 'review'),
        createCanvasChatNodeId('beta', 'default'),
      ]),
    ).toEqual(['alpha', 'beta']);
  });

  test('ignores draft and invalid node ids', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        'draft:abc123',
        'not-a-canvas-node',
        createCanvasChatNodeId('gamma', 'default'),
      ]),
    ).toEqual(['gamma']);
  });

  test('clones every copied drone in order and skips missing ids', async () => {
    const cloned: string[] = [];
    const drone = (id: string): DroneSummary =>
      ({
        id,
        name: id,
        group: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        statusOk: true,
        statusError: null,
        hubStatus: 'ready',
        hubUrl: null,
        kind: 'drone',
        runtime: 'container',
      }) as DroneSummary;

    await cloneCanvasDronesById(
      ['alpha', 'missing', 'beta'],
      { alpha: drone('alpha'), beta: drone('beta') },
      async (entry) => {
        cloned.push(entry.id);
        return true;
      },
    );

    expect(cloned).toEqual(['alpha', 'beta']);
  });

  test('records the first selected source node per drone for paste-clone placement', () => {
    expect(
      collectCloneSourceNodeIdByDroneId([
        createCanvasChatNodeId('alpha', 'review'),
        createCanvasChatNodeId('alpha', 'default'),
        'draft:abc123',
        createCanvasChatNodeId('beta', 'default'),
      ]),
    ).toEqual({
      alpha: createCanvasChatNodeId('alpha', 'review'),
      beta: createCanvasChatNodeId('beta', 'default'),
    });
  });

  test('builds optimistic clone nodes in source order with stable offsets', () => {
    const optimistic = buildOptimisticCloneCanvasNodes({
      copiedDroneIdsRaw: ['alpha', 'beta', 'missing'],
      cloneResultsRaw: [
        { sourceDroneId: 'alpha', cloneDroneId: 'alpha-copy', cloneDroneName: 'alpha-copy' },
        { sourceDroneId: 'beta', cloneDroneId: 'beta-copy', cloneDroneName: 'beta-copy' },
      ],
      sourceNodeIdByDroneId: {
        alpha: createCanvasChatNodeId('alpha', 'review'),
        beta: createCanvasChatNodeId('beta', 'default'),
      },
      nodesById: {
        [createCanvasChatNodeId('alpha', 'review')]: { x: 100, y: 200 },
        [createCanvasChatNodeId('beta', 'default')]: { x: 300, y: 400 },
      },
      cloneOffsetXPx: 44,
      cloneOffsetYPx: 34,
    });

    expect(optimistic.nodes).toEqual([
      {
        droneId: createCanvasChatNodeId('alpha-copy', 'default'),
        label: 'default',
        x: 144,
        y: 234,
      },
      {
        droneId: createCanvasChatNodeId('beta-copy', 'default'),
        label: 'default',
        x: 388,
        y: 468,
      },
    ]);
    expect(optimistic.optimisticDroneNameById).toEqual({
      'alpha-copy': 'alpha-copy',
      'beta-copy': 'beta-copy',
    });
  });
});
