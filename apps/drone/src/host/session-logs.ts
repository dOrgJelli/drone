import path from 'node:path';

export function preferredTerminalSessionLogsRoot(dataDirRaw: string | null | undefined): string {
  const dataDir = String(dataDirRaw ?? '').trim();
  if (!dataDir) return path.join('/tmp', 'dvm-sessions');
  const resolved = path.resolve(dataDir);
  if (resolved === '/dvm-data' || resolved.startsWith('/dvm-data/')) {
    return '/dvm-data/dvm-sessions';
  }
  return path.join(resolved, 'tmux-sessions');
}
