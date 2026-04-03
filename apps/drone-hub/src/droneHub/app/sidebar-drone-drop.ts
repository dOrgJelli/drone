import type { DroneSummary } from '../types';
import type { SidebarGroupDropPlacement } from './sidebar-group-order';

export type SidebarDroneDropIntent = SidebarGroupDropPlacement | 'inside';

export function sidebarDroneDropIntentFromRects(
  activeRect:
    | Pick<DOMRect, 'top' | 'height'>
    | Pick<ClientRect, 'top' | 'height'>
    | null
    | undefined,
  overRect:
    | Pick<DOMRect, 'top' | 'height'>
    | Pick<ClientRect, 'top' | 'height'>
    | null
    | undefined,
): SidebarDroneDropIntent {
  if (!activeRect || !overRect) return 'after';
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overHeight = Math.max(1, overRect.height);
  const relativeY = (activeCenterY - overRect.top) / overHeight;
  if (relativeY <= 1 / 3) return 'before';
  if (relativeY >= 2 / 3) return 'after';
  return 'inside';
}

export function canReparentSidebarDroneSelection(
  droneById: Record<string, DroneSummary>,
  sourceDroneIdsRaw: string[],
  targetDroneIdRaw: string,
): boolean {
  const targetDroneId = String(targetDroneIdRaw ?? '').trim();
  if (!targetDroneId) return false;
  const sourceDroneIds = Array.from(
    new Set(sourceDroneIdsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)),
  );
  if (sourceDroneIds.length === 0) return false;
  const sourceDroneIdSet = new Set(sourceDroneIds);
  if (sourceDroneIdSet.has(targetDroneId)) return false;

  for (const sourceDroneId of sourceDroneIds) {
    const visited = new Set<string>();
    let currentDroneId = targetDroneId;
    while (currentDroneId && !visited.has(currentDroneId)) {
      if (currentDroneId === sourceDroneId) return false;
      visited.add(currentDroneId);
      currentDroneId = String(droneById[currentDroneId]?.fleetParentId ?? '').trim();
    }
  }
  return true;
}

export function canSetSidebarDroneSelectionParent(
  droneById: Record<string, DroneSummary>,
  sourceDroneIdsRaw: string[],
  targetParentDroneIdRaw: string | null | undefined,
): boolean {
  const sourceDroneIds = Array.from(
    new Set(sourceDroneIdsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)),
  );
  if (sourceDroneIds.length === 0) return false;
  const targetParentDroneId = String(targetParentDroneIdRaw ?? '').trim();
  if (!targetParentDroneId) return true;
  return canReparentSidebarDroneSelection(droneById, sourceDroneIds, targetParentDroneId);
}
