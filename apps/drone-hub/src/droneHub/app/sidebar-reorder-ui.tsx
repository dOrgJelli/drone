import React from 'react';
import { normalizeSidebarGroupOrder, type SidebarGroupDropPlacement } from './sidebar-group-order';

export function sidebarDropPlacementFromRects(
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
): SidebarGroupDropPlacement {
  if (!activeRect || !overRect) return 'after';
  const activeCenterY = activeRect.top + activeRect.height / 2;
  return activeCenterY < overRect.top + overRect.height / 2 ? 'before' : 'after';
}

export function normalizeSidebarReorderTarget(
  entriesRaw: string[],
  overIdRaw: string,
  placement: SidebarGroupDropPlacement,
): { overId: string; placement: SidebarGroupDropPlacement } {
  const entries = normalizeSidebarGroupOrder(entriesRaw);
  const overId = String(overIdRaw ?? '').trim();
  if (!overId) return { overId, placement };
  const overIndex = entries.indexOf(overId);
  if (overIndex < 0) return { overId, placement };
  if (placement === 'after' && overIndex + 1 < entries.length) {
    return {
      overId: entries[overIndex + 1] ?? overId,
      placement: 'before',
    };
  }
  return { overId, placement };
}

export function SidebarReorderDropIndicator({
  placement,
}: {
  placement: SidebarGroupDropPlacement;
}) {
  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 h-[2px] bg-[var(--accent)] ${
        placement === 'before' ? 'top-0' : 'bottom-0'
      }`}
    />
  );
}
