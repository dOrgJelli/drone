import type { FleetActorPayload } from '../fleet/fleet-api';

export type CanvasAssignmentPreviewDetail = {
  droneIds: string[];
  overDroneId: string | null;
};

export type FleetAssignmentUpdatedDetail = {
  ownerDroneId: string;
  actor: FleetActorPayload;
};

export const CANVAS_ASSIGNMENT_PREVIEW_EVENT = 'dronehub:canvas-assignment-preview';
export const FLEET_ASSIGNMENT_UPDATED_EVENT = 'dronehub:fleet-assignment-updated';

export function normalizeCanvasAssignmentPreviewDetail(detail: unknown): CanvasAssignmentPreviewDetail | null {
  if (!detail || typeof detail !== 'object') return null;
  const droneIds = Array.isArray((detail as CanvasAssignmentPreviewDetail).droneIds)
    ? (detail as CanvasAssignmentPreviewDetail).droneIds.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  if (droneIds.length === 0) return null;
  return {
    droneIds,
    overDroneId: String((detail as CanvasAssignmentPreviewDetail).overDroneId ?? '').trim() || null,
  };
}

export function dispatchCanvasAssignmentPreview(detail: CanvasAssignmentPreviewDetail | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CANVAS_ASSIGNMENT_PREVIEW_EVENT, { detail }));
}

export function normalizeFleetAssignmentUpdatedDetail(detail: unknown): FleetAssignmentUpdatedDetail | null {
  if (!detail || typeof detail !== 'object') return null;
  const ownerDroneId = String((detail as FleetAssignmentUpdatedDetail).ownerDroneId ?? '').trim();
  const actor = (detail as FleetAssignmentUpdatedDetail).actor;
  if (!ownerDroneId || !actor || typeof actor !== 'object') return null;
  const actorId = String(actor.actor?.id ?? '').trim();
  if (!actorId) return null;
  return { ownerDroneId, actor };
}

export function dispatchFleetAssignmentUpdated(detail: FleetAssignmentUpdatedDetail | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FLEET_ASSIGNMENT_UPDATED_EVENT, { detail }));
}

export function resolveFleetAssignmentDropOwnerFromPoint(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined') return null;
  const elements =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean);
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    const dropZone = element.closest('[data-fleet-assignment-drop-zone="1"]');
    if (!(dropZone instanceof HTMLElement)) continue;
    const ownerDroneId = String(dropZone.dataset.fleetAssignmentDroneId ?? '').trim();
    if (ownerDroneId) return ownerDroneId;
  }
  return null;
}
