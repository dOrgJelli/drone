import { describe, expect, test } from 'bun:test';
import { updateRegistry } from '../src/host/registry';
import {
  resolveDroneFromRegistryRef,
  resolveDroneOrPendingForReadRef,
  setDroneHubMetaByIdentity,
} from '../src/hub/drone-lifecycle-service';
import { withTempDroneDataDir } from './test-helpers';

describe('drone lifecycle service', () => {
  test('resolves a real drone by stable id even when a pending entry also exists', async () => {
    await withTempDroneDataDir('drone-lifecycle-service-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'real-key': { id: 'drone-1', name: 'real-name' },
        };
        reg.pending = {
          'pending-key': { id: 'drone-1', name: 'pending-name', phase: 'starting' },
        };
      });

      let stillStarting = false;
      let unknown = false;
      const resolved = await resolveDroneFromRegistryRef('drone-1', {
        onStillStarting: () => {
          stillStarting = true;
        },
        onUnknown: () => {
          unknown = true;
        },
      });

      expect(resolved?.id).toBe('real-key');
      expect(String(resolved?.drone?.name ?? '')).toBe('real-name');
      expect(stillStarting).toBe(false);
      expect(unknown).toBe(false);
    });
  });

  test('returns a pending lifecycle entry for read paths before the real drone exists', async () => {
    await withTempDroneDataDir('drone-lifecycle-service-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'pending-key': { id: 'drone-2', name: 'pending-name', phase: 'starting' },
        };
      });

      const resolved = await resolveDroneOrPendingForReadRef('pending-name');

      expect(resolved?.kind).toBe('pending');
      expect(resolved?.id).toBe('pending-key');
    });
  });

  test('sets hub metadata by stable drone identity', async () => {
    await withTempDroneDataDir('drone-lifecycle-service-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'real-key': { id: 'drone-3', name: 'real-name' },
        };
      });

      await setDroneHubMetaByIdentity({
        droneId: 'drone-3',
        hub: { phase: 'seeding', message: 'Seeding repo…', promptId: 'prompt-1' },
      });

      const resolved = await resolveDroneOrPendingForReadRef('drone-3');
      expect(resolved?.kind).toBe('real');
      expect((resolved as any)?.drone?.hub).toMatchObject({
        phase: 'seeding',
        message: 'Seeding repo…',
        promptId: 'prompt-1',
      });
    });
  });
});
