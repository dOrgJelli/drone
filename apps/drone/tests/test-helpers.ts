import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetDroneRootDirForTests } from '../src/host/paths';

export async function withTempDroneDataDir<T>(
  prefix: string,
  fn: (droneDataDir: string) => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  fs.mkdirSync(droneDataDir, { recursive: true });
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = droneDataDir;
  resetDroneRootDirForTests();

  try {
    return await fn(droneDataDir);
  } finally {
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
