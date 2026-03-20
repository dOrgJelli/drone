#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

function fleetBundleArgs(root) {
  return [
    'build',
    path.join(root, 'src', 'fleet.ts'),
    '--target=node',
    '--format=cjs',
    `--outfile=${path.join(root, 'dist', 'fleet.js')}`,
  ];
}

function runOrThrow(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`failed running ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`command failed: ${cmd} ${args.join(' ')}${details ? `\n${details}` : ''}`);
  }
}

async function chmodExecutableBestEffort(targetPath) {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(targetPath, 0o755);
  } catch {
    // Best-effort only; not all filesystems honor POSIX modes.
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  runOrThrow('bun', fleetBundleArgs(root), { cwd: root });
  await chmodExecutableBestEffort(path.join(root, 'dist', 'cli.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'daemon.js'));
  await chmodExecutableBestEffort(path.join(root, 'dist', 'fleet.js'));
}

module.exports = {
  fleetBundleArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
