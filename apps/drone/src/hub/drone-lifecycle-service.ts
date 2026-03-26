import { loadRegistry, updateRegistry } from '../host/registry';
import { findDroneEntryByIdentity, findDroneIdByRef } from './drone-lifecycle-registry';

export type ResolvedDrone = { id: string; drone: any };
export type ResolvedOrPendingDrone =
  | { kind: 'real'; id: string; drone: any }
  | { kind: 'pending'; id: string; pending: any };

export async function resolveDroneFromRegistryRef(
  droneRef: string,
  handlers: {
    onStillStarting: () => void;
    onUnknown: () => void;
  },
): Promise<ResolvedDrone | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneIdByRef(regAny, droneRef);
  if (!found) {
    handlers.onUnknown();
    return null;
  }
  if (found.kind === 'pending' && !regAny?.drones?.[found.id]) {
    handlers.onStillStarting();
    return null;
  }
  const drone = regAny?.drones?.[found.id] ?? null;
  if (!drone) {
    handlers.onUnknown();
    return null;
  }
  return { id: found.id, drone };
}

export async function resolveDroneOrPendingForReadRef(droneRef: string): Promise<ResolvedOrPendingDrone | null> {
  const ref = String(droneRef ?? '').trim();
  if (!ref) return null;
  const regAny: any = await loadRegistry();
  const found = findDroneIdByRef(regAny, ref);
  if (!found) return null;
  const real = regAny?.drones?.[found.id] ?? null;
  if (real) return { kind: 'real', id: found.id, drone: real };
  const pending = regAny?.pending?.[found.id] ?? null;
  if (pending) return { kind: 'pending', id: found.id, pending };
  return null;
}

export async function resolveDroneNameByIdentity(droneId: string): Promise<string | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const entryName = String(found.entry?.name ?? '').trim();
  if (entryName) return entryName;
  const keyName = String(found.key ?? '').trim();
  return keyName || null;
}

export async function resolveDroneContainerNameByIdentity(droneId: string): Promise<string | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const cn = String((found.entry as any)?.containerName ?? (found.entry as any)?.name ?? found.key ?? '').trim();
  return cn || null;
}

export async function setDroneHubMetaByIdentity(
  opts: {
    droneId: string;
    hub: null | { phase: 'starting' | 'seeding' | 'error'; message?: string; promptId?: string };
  },
): Promise<void> {
  await updateRegistry((regAny: any) => {
    const found = findDroneEntryByIdentity(regAny, opts.droneId);
    if (!found) return;
    const d: any = found.entry;
    if (!opts.hub) {
      delete d.hub;
    } else {
      d.hub = {
        phase: opts.hub.phase,
        message: opts.hub.message,
        updatedAt: new Date().toISOString(),
        ...(opts.hub.promptId ? { promptId: opts.hub.promptId } : {}),
      };
    }
    regAny.drones = regAny.drones ?? {};
    regAny.drones[found.key] = d;
  });
}
