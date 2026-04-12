import { describe, expect, test } from 'bun:test';
import { resolveRepoSeedFromParentDroneId } from '../src/droneHub/app/child-drone-repo-seed';

describe('resolveRepoSeedFromParentDroneId', () => {
  test('uses the parent drone when container runtime and repo paths match', () => {
    expect(
      resolveRepoSeedFromParentDroneId({
        drones: [{ id: 'parent-1', repoAttached: true, repoPath: '/work/repo' }],
        parentDroneId: 'parent-1',
        repoPath: '/work/repo',
        runtime: 'container',
      }),
    ).toBe('parent-1');
  });

  test('skips parent repo seeding when the repo path differs', () => {
    expect(
      resolveRepoSeedFromParentDroneId({
        drones: [{ id: 'parent-1', repoAttached: true, repoPath: '/work/other' }],
        parentDroneId: 'parent-1',
        repoPath: '/work/repo',
        runtime: 'container',
      }),
    ).toBeNull();
  });

  test('skips parent repo seeding for host runtime or missing parent', () => {
    expect(
      resolveRepoSeedFromParentDroneId({
        drones: [{ id: 'parent-1', repoAttached: true, repoPath: '/work/repo' }],
        parentDroneId: 'parent-1',
        repoPath: '/work/repo',
        runtime: 'host',
      }),
    ).toBeNull();
    expect(
      resolveRepoSeedFromParentDroneId({
        drones: [],
        parentDroneId: 'missing',
        repoPath: '/work/repo',
        runtime: 'container',
      }),
    ).toBeNull();
  });
});
