import { describe, expect, test } from 'bun:test';
import { listRepoTransferPeers } from '../src/droneHub/app/use-workspace-actions';

describe('repo transfer peers', () => {
  test('filters to other container drones on the same repo and sorts newest first', () => {
    const currentDrone = {
      id: 'alpha',
      name: 'alpha',
      group: 'core',
      createdAt: '2026-03-20T10:00:00.000Z',
      runtime: 'container',
      repoAttached: true,
      repoPath: '/work/repo',
      containerPort: 7777,
      hostPort: 3001,
      statusOk: true,
      statusError: null,
      chats: ['default'],
    };

    const peers = listRepoTransferPeers(currentDrone, [
      currentDrone,
      {
        id: 'beta',
        name: 'beta',
        group: 'core',
        createdAt: '2026-03-21T10:00:00.000Z',
        runtime: 'container',
        repoAttached: true,
        repoPath: '/work/repo',
        containerPort: 7777,
        hostPort: 3002,
        statusOk: true,
        statusError: null,
        chats: ['default'],
      },
      {
        id: 'gamma',
        name: 'gamma',
        group: null,
        createdAt: '2026-03-22T10:00:00.000Z',
        runtime: 'container',
        repoAttached: true,
        repoPath: '/work/repo',
        containerPort: 7777,
        hostPort: 3003,
        statusOk: true,
        statusError: null,
        chats: ['default'],
      },
      {
        id: 'host-drone',
        name: 'host-drone',
        group: null,
        createdAt: '2026-03-23T10:00:00.000Z',
        runtime: 'host',
        repoAttached: true,
        repoPath: '/work/repo',
        containerPort: 7777,
        hostPort: 3004,
        statusOk: true,
        statusError: null,
        chats: ['default'],
      },
      {
        id: 'other-repo',
        name: 'other-repo',
        group: null,
        createdAt: '2026-03-24T10:00:00.000Z',
        runtime: 'container',
        repoAttached: true,
        repoPath: '/work/other',
        containerPort: 7777,
        hostPort: 3005,
        statusOk: true,
        statusError: null,
        chats: ['default'],
      },
    ]);

    expect(peers).toEqual([
      { id: 'gamma', name: 'gamma', group: null },
      { id: 'beta', name: 'beta', group: 'core' },
    ]);
  });

  test('returns empty when current drone has no repo path', () => {
    const peers = listRepoTransferPeers(
      {
        id: 'alpha',
        name: 'alpha',
        group: null,
        createdAt: '2026-03-20T10:00:00.000Z',
        runtime: 'container',
        repoAttached: false,
        repoPath: '',
        containerPort: 7777,
        hostPort: 3001,
        statusOk: true,
        statusError: null,
        chats: ['default'],
      },
      [],
    );

    expect(peers).toEqual([]);
  });
});
