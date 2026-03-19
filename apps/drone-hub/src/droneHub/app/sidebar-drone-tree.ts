import type { DroneSummary } from '../types';

export type SidebarDroneTree = {
  rootDroneIds: string[];
  childDroneIdsByParentId: Record<string, string[]>;
};

export function buildSidebarDroneTree(drones: DroneSummary[]): SidebarDroneTree {
  const visibleDroneIds = new Set(
    drones
      .map((drone) => String(drone?.id ?? '').trim())
      .filter(Boolean),
  );
  const rootDroneIds: string[] = [];
  const childDroneIdsByParentId: Record<string, string[]> = {};

  for (const drone of drones) {
    const droneId = String(drone?.id ?? '').trim();
    if (!droneId) continue;
    const parentId = String(drone?.fleetParentId ?? '').trim();
    if (parentId && parentId !== droneId && visibleDroneIds.has(parentId)) {
      if (!Array.isArray(childDroneIdsByParentId[parentId])) {
        childDroneIdsByParentId[parentId] = [];
      }
      childDroneIdsByParentId[parentId].push(droneId);
      continue;
    }
    rootDroneIds.push(droneId);
  }

  return { rootDroneIds, childDroneIdsByParentId };
}
