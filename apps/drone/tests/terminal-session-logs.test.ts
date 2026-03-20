import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { preferredTerminalSessionLogsRoot } from '../src/host/session-logs';

describe('terminal session logs root', () => {
  test('keeps container runtimes on /dvm-data', () => {
    expect(preferredTerminalSessionLogsRoot('/dvm-data/drone')).toBe('/dvm-data/dvm-sessions');
  });

  test('uses the daemon data dir for host runtimes', () => {
    expect(preferredTerminalSessionLogsRoot('/home/test/drone/daemon')).toBe(
      path.join('/home/test/drone/daemon', 'tmux-sessions'),
    );
  });

  test('falls back to /tmp when no data dir is configured', () => {
    expect(preferredTerminalSessionLogsRoot('')).toBe(path.join('/tmp', 'dvm-sessions'));
  });
});
