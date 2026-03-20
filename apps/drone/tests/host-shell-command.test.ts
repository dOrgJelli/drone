import { describe, expect, test } from 'bun:test';
import { resolveContainerTerminalShellCommand, resolveHostTerminalShellCommand } from '../src/host/shell';

describe('host terminal shell command', () => {
  test('uses the container default interactive shell without injecting a hub prompt', () => {
    expect(resolveContainerTerminalShellCommand({} as NodeJS.ProcessEnv)).toBe(
      'if command -v bash >/dev/null 2>&1; then exec bash -i; fi; exec sh -i',
    );
  });

  test('defaults to a normal interactive bash shell', () => {
    expect(resolveHostTerminalShellCommand({} as NodeJS.ProcessEnv)).toBe('bash -i');
  });

  test('prefers the host-specific override', () => {
    expect(
      resolveHostTerminalShellCommand({
        DRONE_HUB_HOST_SHELL_CMD: 'bash --login -i',
        DRONE_HUB_SHELL_CMD: 'ignored',
      } as NodeJS.ProcessEnv),
    ).toBe('bash --login -i');
  });

  test('falls back to the shared shell override', () => {
    expect(
      resolveHostTerminalShellCommand({
        DRONE_HUB_SHELL_CMD: 'zsh -i',
      } as NodeJS.ProcessEnv),
    ).toBe('zsh -i');
  });
});
