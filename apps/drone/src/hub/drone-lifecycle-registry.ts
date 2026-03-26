export type DroneLifecycleKind = 'real' | 'pending';

export type DroneLifecycleRef = {
  kind: DroneLifecycleKind;
  id: string;
};

export type DroneLifecycleEntry = {
  key: string;
  entry: any;
};

export type DroneLifecycleEntries = {
  id: string;
  real: DroneLifecycleEntry | null;
  pending: DroneLifecycleEntry | null;
};

export function normalizeDroneIdentity(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  if (id.length > 128) return '';
  return id;
}

export function findDroneEntryByIdentity(regAny: any, droneId: string): DroneLifecycleEntry | null {
  const byId = normalizeDroneIdentity(droneId);
  if (!byId) return null;
  for (const [key, entry] of Object.entries(regAny?.drones ?? {})) {
    if (normalizeDroneIdentity((entry as any)?.id) === byId) {
      return { key: String(key), entry };
    }
  }
  return null;
}

export function findPendingDroneEntryByIdentity(regAny: any, droneId: string): DroneLifecycleEntry | null {
  const byId = normalizeDroneIdentity(droneId);
  if (!byId) return null;
  for (const [key, entry] of Object.entries(regAny?.pending ?? {})) {
    if (normalizeDroneIdentity((entry as any)?.id) === byId) {
      return { key: String(key), entry };
    }
  }
  return null;
}

export function findDroneLifecycleEntriesByIdentity(regAny: any, droneId: string): DroneLifecycleEntries | null {
  const byId = normalizeDroneIdentity(droneId);
  if (!byId) return null;
  const real = findDroneEntryByIdentity(regAny, byId);
  const pending = findPendingDroneEntryByIdentity(regAny, byId);
  if (!real && !pending) return null;
  return { id: byId, real, pending };
}

export function findDroneIdByRef(regAny: any, refRaw: string): DroneLifecycleRef | null {
  const ref = String(refRaw ?? '').trim();
  if (!ref) return null;
  if (regAny?.drones?.[ref]) return { kind: 'real', id: ref };
  if (regAny?.pending?.[ref]) return { kind: 'pending', id: ref };
  const stableRef = normalizeDroneIdentity(ref);
  if (stableRef) {
    for (const [id, d] of Object.entries(regAny?.drones ?? {})) {
      if (normalizeDroneIdentity((d as any)?.id) === stableRef) return { kind: 'real', id: String(id) };
    }
    for (const [id, d] of Object.entries(regAny?.pending ?? {})) {
      if (normalizeDroneIdentity((d as any)?.id) === stableRef) return { kind: 'pending', id: String(id) };
    }
  }
  for (const [id, d] of Object.entries(regAny?.drones ?? {})) {
    if (String((d as any)?.name ?? '').trim() === ref) return { kind: 'real', id: String(id) };
  }
  for (const [id, d] of Object.entries(regAny?.pending ?? {})) {
    if (String((d as any)?.name ?? '').trim() === ref) return { kind: 'pending', id: String(id) };
  }
  return null;
}

export function resolveStableDroneOrPendingIdFromRef(regAny: any, refRaw: unknown): string | null {
  const ref = String(refRaw ?? '').trim();
  if (!ref) return null;
  const found = findDroneIdByRef(regAny, ref);
  if (!found) return normalizeDroneIdentity(ref) || null;
  const entry = found.kind === 'real' ? regAny?.drones?.[found.id] : regAny?.pending?.[found.id];
  return normalizeDroneIdentity((entry as any)?.id) || normalizeDroneIdentity(found.id) || String(found.id).trim() || null;
}

export function applyDroneDisplayNameAcrossLifecycleEntries(regAny: any, droneId: string, newNameRaw: unknown): boolean {
  const lifecycle = findDroneLifecycleEntriesByIdentity(regAny, droneId);
  if (!lifecycle) return false;
  const newName = String(newNameRaw ?? '').trim();
  if (!newName) return false;
  if (lifecycle.real) {
    lifecycle.real.entry.name = newName;
    regAny.drones = regAny.drones ?? {};
    regAny.drones[lifecycle.real.key] = lifecycle.real.entry;
  }
  if (lifecycle.pending) {
    lifecycle.pending.entry.name = newName;
    regAny.pending = regAny.pending ?? {};
    regAny.pending[lifecycle.pending.key] = lifecycle.pending.entry;
  }
  return true;
}
