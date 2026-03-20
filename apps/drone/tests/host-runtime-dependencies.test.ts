import { describe, expect, test } from 'bun:test';
import { missingHostDependencyMessage } from '../src/host/runtime';

describe('host runtime dependency messaging', () => {
  test('formats tmux dependency failures clearly', () => {
    expect(missingHostDependencyMessage('tmux', 'host runtime drones')).toBe(
      'host runtime drones require tmux on the host PATH',
    );
    expect(missingHostDependencyMessage('tmux', 'host runtime sessions')).toBe(
      'host runtime sessions require tmux on the host PATH',
    );
  });
});
