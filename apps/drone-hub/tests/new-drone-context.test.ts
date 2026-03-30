import { describe, expect, test } from 'bun:test';
import {
  resolveNewDroneContextFromCurrentSelection,
  shouldInheritNewDroneContextFromCurrentSelection,
} from '../src/droneHub/app/new-drone-context';

describe('new-drone-context', () => {
  test('inherits from the current selection only when no explicit overrides are provided', () => {
    expect(shouldInheritNewDroneContextFromCurrentSelection()).toBe(true);
    expect(shouldInheritNewDroneContextFromCurrentSelection({})).toBe(true);
    expect(shouldInheritNewDroneContextFromCurrentSelection({ repoPath: '/work/repo-a' })).toBe(false);
    expect(shouldInheritNewDroneContextFromCurrentSelection({ group: 'Showreels' })).toBe(false);
  });

  test('resolves repo and group from the current drone selection', () => {
    expect(
      resolveNewDroneContextFromCurrentSelection({
        repoAttached: true,
        repoPath: '/work/repo-a',
        group: 'Showreels',
      }),
    ).toEqual({
      repoPath: '/work/repo-a',
      group: 'Showreels',
    });
  });

  test('normalizes ungrouped and no-repo selections to empty values', () => {
    expect(
      resolveNewDroneContextFromCurrentSelection({
        repoAttached: false,
        repoPath: '',
        group: 'Ungrouped',
      }),
    ).toEqual({
      repoPath: '',
      group: '',
    });
  });
});
