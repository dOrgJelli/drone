import React from 'react';
import type { SidebarGroupDropPlacement } from './sidebar-group-order';

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
