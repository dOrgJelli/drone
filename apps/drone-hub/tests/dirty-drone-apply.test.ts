import { describe, expect, test } from 'bun:test';
import { dirtyDroneApplyFileLabel, dirtyDroneApplyRequestBody } from '../src/droneHub/app/dirty-drone-apply';

describe('dirty drone apply helpers', () => {
  test('formats dirty file counts for modal copy', () => {
    expect(dirtyDroneApplyFileLabel(1)).toBe('1 file');
    expect(dirtyDroneApplyFileLabel(3)).toBe('3 files');
    expect(dirtyDroneApplyFileLabel(null)).toBe('one or more files');
  });

  test('builds request bodies for commit and keep-dirty apply paths', () => {
    expect(dirtyDroneApplyRequestBody('commit', 'snapshot')).toEqual({ commitDirty: true, commitMessage: 'snapshot' });
    expect(dirtyDroneApplyRequestBody('keep', 'ignored')).toEqual({ allowDirty: true });
  });
});
