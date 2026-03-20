import React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { createCanvasChatNodeId } from './app-config';
import type { SidebarGroupOrderKind } from './sidebar-group-order';
import { expandDroneIdsToChatNodeIds, orderChatNodeIdsBySidebar } from '../canvas/chat-node-utils';

export type SidebarDragGroupRef = {
  group: string;
  kind: SidebarGroupOrderKind;
};

export type SidebarGroupDragData = {
  type: 'sidebar-group';
  groupRef: SidebarDragGroupRef;
  groupLabel: string;
  droneIds: string[];
};

export type SidebarDroneDragData = {
  type: 'sidebar-drone';
  droneId: string;
  droneIds: string[];
  groupOrderKey: string | null;
  label: string;
};

export type SidebarChatDragData = {
  type: 'sidebar-chat';
  droneId: string;
  chatName: string;
  nodeId: string;
  label: string;
};

export type DroneHubDragData =
  | SidebarGroupDragData
  | SidebarDroneDragData
  | SidebarChatDragData;

const DroneHubActiveDragContext = React.createContext<DroneHubDragData | null>(null);

function isSidebarDragGroupRef(value: unknown): value is SidebarDragGroupRef {
  if (!value || typeof value !== 'object') return false;
  const group = String((value as SidebarDragGroupRef).group ?? '').trim();
  const kind = (value as SidebarDragGroupRef).kind;
  return Boolean(group) && (kind === 'group' || kind === 'repo');
}

export function parseDroneHubDragData(value: unknown): DroneHubDragData | null {
  if (!value || typeof value !== 'object') return null;
  const type = String((value as DroneHubDragData).type ?? '').trim();
  if (type === 'sidebar-group') {
    const groupRef = (value as SidebarGroupDragData).groupRef;
    const groupLabel = String((value as SidebarGroupDragData).groupLabel ?? '').trim();
    const droneIds = Array.isArray((value as SidebarGroupDragData).droneIds)
      ? (value as SidebarGroupDragData).droneIds
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      : [];
    if (!isSidebarDragGroupRef(groupRef) || !groupLabel || droneIds.length === 0) return null;
    return { type: 'sidebar-group', groupRef, groupLabel, droneIds };
  }
  if (type === 'sidebar-drone') {
    const droneId = String((value as SidebarDroneDragData).droneId ?? '').trim();
    const droneIds = Array.isArray((value as SidebarDroneDragData).droneIds)
      ? (value as SidebarDroneDragData).droneIds
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      : [];
    const label = String((value as SidebarDroneDragData).label ?? '').trim();
    const groupOrderKeyRaw = (value as SidebarDroneDragData).groupOrderKey;
    const groupOrderKey =
      typeof groupOrderKeyRaw === 'string' && groupOrderKeyRaw.trim() ? groupOrderKeyRaw.trim() : null;
    if (!droneId || droneIds.length === 0 || !label) return null;
    return { type: 'sidebar-drone', droneId, droneIds, groupOrderKey, label };
  }
  if (type === 'sidebar-chat') {
    const droneId = String((value as SidebarChatDragData).droneId ?? '').trim();
    const chatName = String((value as SidebarChatDragData).chatName ?? '').trim() || 'default';
    const nodeId = String((value as SidebarChatDragData).nodeId ?? '').trim();
    const label = String((value as SidebarChatDragData).label ?? '').trim();
    if (!droneId || !nodeId || !label) return null;
    return { type: 'sidebar-chat', droneId, chatName, nodeId, label };
  }
  return null;
}

export function draggedDroneIdsFromData(data: DroneHubDragData | null): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-chat') return [];
  return Array.from(new Set(data.droneIds.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

export function draggedCanvasChatNodeIdsFromData(
  data: DroneHubDragData | null,
  sidebarOrderedChatNodeIds: string[],
): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-chat') return [data.nodeId];
  if (data.type === 'sidebar-drone') {
    return orderChatNodeIdsBySidebar(
      expandDroneIdsToChatNodeIds(data.droneIds, sidebarOrderedChatNodeIds),
      sidebarOrderedChatNodeIds,
    );
  }
  return orderChatNodeIdsBySidebar(
    expandDroneIdsToChatNodeIds(data.droneIds, sidebarOrderedChatNodeIds),
    sidebarOrderedChatNodeIds,
  );
}

function dragPreviewLabel(data: DroneHubDragData): { title: string; detail: string } {
  if (data.type === 'sidebar-chat') {
    return { title: data.label, detail: 'Chat' };
  }
  if (data.type === 'sidebar-drone') {
    const count = data.droneIds.length;
    return {
      title: count > 1 ? `${count} drones` : data.label,
      detail: count > 1 ? 'Sidebar selection' : 'Drone',
    };
  }
  const count = data.droneIds.length;
  return {
    title: data.groupLabel,
    detail: `${count} drone${count === 1 ? '' : 's'}`,
  };
}

function ActiveDragPreview({ data }: { data: DroneHubDragData }) {
  const preview = dragPreviewLabel(data);
  return (
    <div className="pointer-events-none rounded-md border border-[var(--accent-muted)] bg-[rgba(17,20,28,.96)] px-3 py-2 shadow-[0_18px_44px_rgba(0,0,0,.34)]">
      <div className="text-[11px] font-semibold text-[var(--fg)]">{preview.title}</div>
      <div className="text-[10px] text-[var(--muted-dim)]">{preview.detail}</div>
    </div>
  );
}

export function DroneHubDndProvider({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );
  const [activeDrag, setActiveDrag] = React.useState<DroneHubDragData | null>(null);

  const clearActiveDrag = React.useCallback(() => {
    setActiveDrag(null);
  }, []);

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDrag(parseDroneHubDragData(event.active.data.current));
  }, []);

  const onDragEnd = React.useCallback((event: DragEndEvent) => {
    void event;
    clearActiveDrag();
  }, [clearActiveDrag]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragCancel={clearActiveDrag}
      onDragEnd={onDragEnd}
    >
      <DroneHubActiveDragContext.Provider value={activeDrag}>
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDrag ? <ActiveDragPreview data={activeDrag} /> : null}
        </DragOverlay>
      </DroneHubActiveDragContext.Provider>
    </DndContext>
  );
}

export function useDroneHubActiveDrag(): DroneHubDragData | null {
  return React.useContext(DroneHubActiveDragContext);
}

export function createSidebarChatDragData(droneIdRaw: string, chatNameRaw: string, label: string): SidebarChatDragData | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const nodeId = createCanvasChatNodeId(droneId, chatName);
  const safeLabel = String(label ?? '').trim();
  if (!droneId || !nodeId || !safeLabel) return null;
  return {
    type: 'sidebar-chat',
    droneId,
    chatName,
    nodeId,
    label: safeLabel,
  };
}
