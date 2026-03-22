import type { DroneSummary } from '../types';

function trimRef(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDroneIdResolver(drones: DroneSummary[]) {
  const stableIdSet = new Set<string>();
  const droneIdByName = new Map<string, string>();

  for (const drone of drones) {
    const id = trimRef(drone?.id);
    if (!id) continue;
    stableIdSet.add(id);
    const name = trimRef(drone?.name);
    if (name && !droneIdByName.has(name)) droneIdByName.set(name, id);
  }

  return (refRaw: unknown): string | null => {
    const ref = trimRef(refRaw);
    if (!ref) return null;
    if (stableIdSet.has(ref)) return ref;
    return droneIdByName.get(ref) ?? null;
  };
}

export function buildFleetParentIdByDroneId(drones: DroneSummary[]): Record<string, string> {
  const resolveDroneId = buildDroneIdResolver(drones);
  const out: Record<string, string> = {};

  for (const drone of drones) {
    const id = trimRef(drone?.id);
    if (!id) continue;
    const parentId = resolveDroneId(drone?.fleetParentId);
    if (!parentId || parentId === id) continue;
    out[id] = parentId;
  }

  return out;
}

export function buildFleetAssignedIdsByDroneId(drones: DroneSummary[]): Record<string, string[]> {
  const resolveDroneId = buildDroneIdResolver(drones);
  const out: Record<string, string[]> = {};

  for (const drone of drones) {
    const id = trimRef(drone?.id);
    if (!id) continue;
    const assignedIds = Array.isArray(drone?.fleetAssignedIds)
      ? Array.from(
          new Set(
            drone.fleetAssignedIds
              .map((item) => resolveDroneId(item))
              .filter((item): item is string => Boolean(item) && item !== id),
          ),
        )
      : [];
    if (assignedIds.length > 0) out[id] = assignedIds;
  }

  return out;
}
