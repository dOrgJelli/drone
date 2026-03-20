import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const { fleetBundleArgs } = require('../scripts/postbuild.cjs');

describe('postbuild fleet bundle', () => {
  test('bundles fleet for Node into dist/fleet.js', () => {
    const root = path.resolve(__dirname, '..');
    expect(fleetBundleArgs(root)).toEqual([
      'build',
      path.join(root, 'src', 'fleet.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'fleet.js')}`,
    ]);
  });
});
