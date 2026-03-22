import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

async function withTempHomes<T>(fn: (ctx: { tempRoot: string; homeDir: string; xdgDataHome: string }) => Promise<T>): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-registry-atomic-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDataHome, { recursive: true });

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(xdgDataHome, 'drone');
  process.env.HOME = homeDir;
  process.env.XDG_DATA_HOME = xdgDataHome;
  process.env.DRONE_DATA_DIR = droneDataDir;
  fs.mkdirSync(droneDataDir, { recursive: true });

  try {
    return await fn({ tempRoot, homeDir, xdgDataHome });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('registry writes', () => {
  test('loadRegistry keeps returning the previous registry while a save is mid-write', async () => {
    await withTempHomes(async ({ xdgDataHome }) => {
      const fsPromises = require('node:fs/promises');
      const registryModulePath = require.resolve('../src/host/registry');
      const pathsMod = require('../src/host/paths');

      pathsMod.resetDroneRootDirForTests();
      delete require.cache[registryModulePath];

      const preferredDir = path.join(xdgDataHome, 'drone');
      const preferredPath = path.join(preferredDir, 'registry.json');
      fs.mkdirSync(preferredDir, { recursive: true });
      fs.writeFileSync(
        preferredPath,
        JSON.stringify(
          {
            version: 2,
            settings: {
              openai: {
                apiKey: 'old-key',
                updatedAt: '2026-03-22T00:00:00.000Z',
              },
            },
            drones: {},
            pending: {},
          },
          null,
          2,
        ),
        'utf8',
      );

      const originalWriteFile = fsPromises.writeFile;
      let intercepted = false;
      let releaseWrite: (() => void) | null = null;
      const writeStarted = new Promise<void>((resolve) => {
        fsPromises.writeFile = async (...args: any[]) => {
          const [targetPath, data, ...rest] = args;
          const target = String(targetPath ?? '');
          if (!intercepted && /registry\..*\.tmp$/.test(path.basename(target))) {
            intercepted = true;
            const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
            const partial = text.slice(0, Math.max(1, Math.floor(text.length / 3)));
            await originalWriteFile(targetPath, partial, ...rest);
            resolve();
            await new Promise<void>((resume) => {
              releaseWrite = resume;
            });
            return await originalWriteFile(targetPath, text, ...rest);
          }
          return await originalWriteFile(...args);
        };
      });

      try {
        delete require.cache[registryModulePath];
        const registryMod = require('../src/host/registry');
        const savePromise = registryMod.saveRegistry({
          version: 2,
          settings: {
            openai: {
              apiKey: 'new-key',
              updatedAt: '2026-03-22T00:01:00.000Z',
            },
          },
          drones: {},
          pending: {},
        });

        await writeStarted;

        const duringWrite = await registryMod.loadRegistry();
        expect(duringWrite?.settings?.openai?.apiKey).toBe('old-key');

        releaseWrite?.();
        await savePromise;

        const afterWrite = await registryMod.loadRegistry();
        expect(afterWrite?.settings?.openai?.apiKey).toBe('new-key');
      } finally {
        fsPromises.writeFile = originalWriteFile;
        delete require.cache[registryModulePath];
        pathsMod.resetDroneRootDirForTests();
      }
    });
  });
});
