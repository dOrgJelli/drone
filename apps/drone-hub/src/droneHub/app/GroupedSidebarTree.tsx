import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { DroneCard } from '../overview';
import { TypingDots } from '../overview/icons';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { createSidebarChatDragData, parseDroneHubDragData, useDroneHubActiveDrag, type SidebarDroneDragData } from './drone-hub-dnd';
import { isDroneStartingOrSeeding } from './helpers';
import { IconChatThread, IconColumns, IconDrone, IconEye, IconEyeOff, IconFolder, IconPencil, IconPlus, IconSpinner, IconTrash } from './icons';
import { buildSidebarDroneTree, type SidebarDroneTree } from './sidebar-drone-tree';
import { buildSidebarNodeTree, type SidebarNodeTreeModel, type SidebarTreeDroneNode, type SidebarTreeFolderNode, type SidebarTreeNode } from './sidebar-node-tree';
import {
  moveSidebarNodeIdsBetweenParents,
  removeDroneIdsFromSidebarNodeOrderByParent,
  reorderSidebarNodeParentOrder,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  sidebarFolderPathFromNodeId,
} from './sidebar-node-order';
import {
  orderSidebarEntries,
  reorderSidebarEntryOrder,
  sidebarGroupOrderToken,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import { sidebarDropPlacementFromRects, SidebarReorderDropIndicator } from './sidebar-reorder-ui';
import { isSameOrDescendantSidebarGroupPath, joinSidebarGroupPath, sidebarGroupBaseName } from './sidebar-group-paths';
import type { SidebarDensityMode } from './settings-types';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { SidebarGroup } from './use-sidebar-view-model';

type FolderEditorState = {
  mode: 'create' | 'rename';
  parentPath: string | null;
  anchorPath: string | null;
  targetPath: string | null;
  value: string;
  error: string | null;
  pending: boolean;
};

type GroupedSidebarTreeProps = {
  sidebarGroups: SidebarGroup[];
  sidebarDensityMode: SidebarDensityMode;
  sidebarFolderTree: import('./sidebar-folder-tree').SidebarFolderNode[];
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  setSidebarNodeOrderByParent: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  setSidebarChatOrderByDrone: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  droneById: Record<string, DroneSummary>;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  selectedDrone: string | null;
  activeChatName: string;
  selectedSidebarNodeId: string | null;
  selectedFolderPath: string | null;
  setSelectedSidebarNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  onSelectFolder: (path: string) => void;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onRenameGroup: (group: string, nextName?: string) => Promise<boolean> | boolean;
  onToggleGroupCollapsed: (group: string) => void;
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  hiddenSidebarGroupTokenSet: Set<string>;
  selectedGroupMultiChat: string | null;
  onOpenFolderCreate: (parentPath: string | null, opts?: { anchorPath?: string | null }) => void;
  onStartRenameFolder: (path: string) => void;
  onFolderEditorValueChange: (next: string) => void;
  onSubmitFolderEditor: () => void;
  onBlurFolderEditor: () => void;
  onCancelFolderEditor: () => void;
  folderEditor: FolderEditorState | null;
  folderEditorInputRef: React.RefObject<HTMLInputElement>;
  toggleSidebarGroupHidden: (target: { group: string; kind: 'group' | 'repo' }) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => void;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  uiDroneName: (nameRaw: string) => string;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onCreateDroneChat: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onPrepareDroneDragStart: (droneId: string) => void;
};

type TreeDropPlacement = SidebarGroupDropPlacement | 'into';

type GroupedSidebarTreeContextValue = GroupedSidebarTreeProps & {
  nodeTree: SidebarNodeTreeModel;
  droneTreeByGroupPath: Record<string, SidebarDroneTree>;
  dragOverTreeTarget: { nodeId: string; placement: TreeDropPlacement } | null;
  dragOverFolderBodyId: string | null;
  dragOverChat: { key: string; placement: SidebarGroupDropPlacement } | null;
  deletingChats: Record<string, boolean>;
  handleDeleteChat: (droneId: string, chatName: string) => Promise<void>;
  shouldSuppressClick: () => boolean;
};

const GroupedSidebarTreeContext = React.createContext<GroupedSidebarTreeContextValue | null>(null);

function groupedSidebarDensityClasses(sidebarDensityMode: SidebarDensityMode): {
  icon: string;
  emptyHint: string;
  chatRow: string;
  chatDeleteWidth: string;
  chatPlaceholderWidth: string;
  chatBlockIndent: string;
  nestedDroneIndent: string;
  nestedDroneRail: string;
  folderRow: string;
  folderPaddingX: string;
  folderLabel: string;
  folderInput: string;
  folderActionButton: string;
  folderBody: string;
  folderCreateBody: string;
  folderDepthPaddingPx: number;
} {
  if (sidebarDensityMode === 'compact') {
    return {
      icon: 'h-3 w-3 text-[var(--muted-dim)] opacity-72',
      emptyHint:
        'flex items-center gap-2 rounded-md border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.02)] px-2 py-1 text-[9.5px] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
      chatRow: 'h-6 px-1.5 text-[10px]',
      chatDeleteWidth: 'w-5',
      chatPlaceholderWidth: 'w-5',
      chatBlockIndent: 'ml-3 mr-1',
      nestedDroneIndent: 'ml-2',
      nestedDroneRail: 'ml-1 mr-1 pl-1',
      folderRow: 'min-h-6',
      folderPaddingX: 'px-1 py-0.5',
      folderLabel: 'text-[10px]',
      folderInput: 'px-1.5 py-0.5 text-[10px]',
      folderActionButton: 'h-[18px] w-[18px]',
      folderBody: 'ml-0.5 flex flex-col gap-0.5 border-l pl-1',
      folderCreateBody: 'px-2 py-1',
      folderDepthPaddingPx: 4,
    };
  }
  if (sidebarDensityMode === 'comfortable') {
    return {
      icon: 'h-[15px] w-[15px] text-[var(--muted-dim)] opacity-72',
      emptyHint:
        'flex items-center gap-2 rounded-md border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.02)] px-2.5 py-2 text-[10.5px] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
      chatRow: 'h-7 px-2 text-[11px]',
      chatDeleteWidth: 'w-7',
      chatPlaceholderWidth: 'w-7',
      chatBlockIndent: 'ml-[18px] mr-1',
      nestedDroneIndent: 'ml-3.5',
      nestedDroneRail: 'ml-1.5 mr-1 pl-1.5',
      folderRow: 'min-h-8',
      folderPaddingX: 'px-1.5 py-1',
      folderLabel: 'text-[11px]',
      folderInput: 'px-2 py-1 text-[11px]',
      folderActionButton: 'h-5 w-5',
      folderBody: 'ml-1.5 flex flex-col gap-0.5 border-l pl-2',
      folderCreateBody: 'px-2.5 py-2',
      folderDepthPaddingPx: 6,
    };
  }
  return {
    icon: 'h-3.5 w-3.5 text-[var(--muted-dim)] opacity-72',
    emptyHint:
      'flex items-center gap-2 rounded-md border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.02)] px-2 py-1.5 text-[10px] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
    chatRow: 'h-[25px] px-1.5 text-[10.5px]',
    chatDeleteWidth: 'w-6',
    chatPlaceholderWidth: 'w-6',
    chatBlockIndent: 'ml-[14px] mr-1',
    nestedDroneIndent: 'ml-2.5',
    nestedDroneRail: 'ml-1 mr-1 pl-1',
    folderRow: 'min-h-7',
    folderPaddingX: 'px-1 py-0.5',
    folderLabel: 'text-[10.5px]',
    folderInput: 'px-2 py-1 text-[10.5px]',
    folderActionButton: 'h-5 w-5',
    folderBody: 'ml-1 flex flex-col gap-0.5 border-l pl-1.5',
    folderCreateBody: 'px-2 py-1.5',
    folderDepthPaddingPx: 5,
  };
}

function useGroupedSidebarTreeContext(): GroupedSidebarTreeContextValue {
  const value = React.useContext(GroupedSidebarTreeContext);
  if (!value) throw new Error('GroupedSidebarTree context missing');
  return value;
}

function groupedFolderDragData(args: { nodeId: string; folderPath: string; label: string }): {
  type: 'sidebar-folder';
  folderNodeId: string;
  folderPath: string;
  label: string;
} {
  const folderNodeId = String(args.nodeId ?? '').trim();
  const folderPath = String(args.folderPath ?? '').trim();
  const label = String(args.label ?? '').trim();
  return {
    type: 'sidebar-folder',
    folderNodeId,
    folderPath,
    label: label || sidebarGroupBaseName(folderPath) || folderPath,
  };
}

function groupedDroneDragData(args: {
  drone: DroneSummary;
  uiDroneName: (nameRaw: string) => string;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
}): SidebarDroneDragData {
  const selectedDragDroneIds =
    args.selectedDroneSet.has(args.drone.id) && args.selectedDroneIds.length > 0
      ? args.selectedDroneIds.slice()
      : [args.drone.id];
  return {
    type: 'sidebar-drone',
    droneId: args.drone.id,
    droneIds: selectedDragDroneIds,
    groupOrderKey: null,
    label: args.uiDroneName(args.drone.name),
  };
}

function placementFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  allowInto: boolean,
): TreeDropPlacement {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect ?? null;
  if (!activeRect || !overRect) return allowInto ? 'into' : 'after';
  if (!allowInto) return sidebarDropPlacementFromRects(activeRect, overRect);
  const midY = activeRect.top + activeRect.height / 2;
  const topLimit = overRect.top + overRect.height * 0.28;
  const bottomLimit = overRect.top + overRect.height * 0.72;
  if (midY < topLimit) return 'before';
  if (midY > bottomLimit) return 'after';
  return 'into';
}

function activeRectMidY(event: DragMoveEvent | DragOverEvent | DragEndEvent): number | null {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  if (!activeRect) return null;
  return activeRect.top + activeRect.height / 2;
}

function resolveFolderBodyInsertionTarget(
  folderNodeIdRaw: string,
  pointerMidY: number | null,
): { nodeId: string; placement: SidebarGroupDropPlacement } | null {
  if (pointerMidY == null || typeof document === 'undefined') return null;
  const folderNodeId = String(folderNodeIdRaw ?? '').trim();
  if (!folderNodeId) return null;
  const bodyEl = document.querySelector<HTMLElement>(`[data-sidebar-folder-body="${CSS.escape(folderNodeId)}"]`);
  if (!bodyEl) return null;
  const childEls = Array.from(bodyEl.querySelectorAll<HTMLElement>(':scope > [data-sidebar-node-id]'));
  if (childEls.length === 0) return null;

  for (const childEl of childEls) {
    const childNodeId = childEl.dataset.sidebarNodeId?.trim();
    if (!childNodeId) continue;
    const anchorEl =
      childEl.querySelector<HTMLElement>(`[data-sidebar-node-anchor-id="${CSS.escape(childNodeId)}"]`) ?? childEl;
    const rect = anchorEl.getBoundingClientRect();
    if (pointerMidY < rect.top + rect.height / 2) {
      return { nodeId: childNodeId, placement: 'before' };
    }
  }

  const lastChildNodeId = childEls[childEls.length - 1]?.dataset.sidebarNodeId?.trim();
  return lastChildNodeId ? { nodeId: lastChildNodeId, placement: 'after' } : null;
}

function chatReorderDropId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `sidebar-grouped-chat-reorder:${droneId}:${chatName}`;
}

function folderGroupPath(node: SidebarTreeFolderNode | null | undefined): string | null {
  if (!node) return null;
  return String(node.groupPath ?? node.path ?? '').trim() || null;
}

function folderTargetGroupPath(node: SidebarTreeFolderNode | null | undefined): string | null {
  if (!node) return null;
  if (node.groupKind === 'repo' && !node.groupPath) return null;
  return folderGroupPath(node);
}

function TreeDropGuide({ placement }: { placement: SidebarGroupDropPlacement }) {
  return <SidebarReorderDropIndicator placement={placement} />;
}

function GroupedSidebarChatRow({ drone, chatName, isOptimistic }: { drone: DroneSummary; chatName: string; isOptimistic: boolean }) {
  const activeDrag = useDroneHubActiveDrag();
  const {
    sidebarDensityMode,
    uiDroneName,
    movingDroneGroups,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    selectedDrone,
    activeChatName,
    selectedSidebarNodeId,
    setSelectedSidebarNodeId,
    onSelectDroneChat,
    dragOverChat,
    deletingChats,
    handleDeleteChat,
    shouldSuppressClick,
  } = useGroupedSidebarTreeContext();
  const densityClasses = groupedSidebarDensityClasses(sidebarDensityMode);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const chatDragData = React.useMemo(
    () => createSidebarChatDragData(drone.id, chatName, `${uiDroneName(drone.name)} / ${chatName}`),
    [chatName, drone.id, drone.name, uiDroneName],
  );
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-grouped-chat:${drone.id}:${chatName}`,
    data: chatDragData ?? undefined,
    disabled: !chatDragData || movingDroneGroups || isOptimistic,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: chatReorderDropId(drone.id, chatName),
    data: {
      type: 'sidebar-chat-reorder',
      droneId: drone.id,
      chatName,
    },
    disabled: movingDroneGroups || isOptimistic || activeDrag?.type !== 'sidebar-chat',
  });
  const active = selectedDrone === drone.id && activeChatName === chatName;
  const selected = selectedSidebarNodeId === sidebarChatId;
  const reorderPreviewClass =
    dragOverChat?.key === `${drone.id}:${chatName}`
      ? dragOverChat.placement === 'before'
        ? 'pt-3'
        : 'pb-3'
      : '';

  return (
    <div ref={setDropNodeRef} className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
      <div className="relative flex items-stretch gap-1 group/chat-row">
        {dragOverChat?.key === `${drone.id}:${chatName}` ? <TreeDropGuide placement={dragOverChat.placement} /> : null}
        <button
          ref={setDragNodeRef}
          type="button"
          {...(attributes as unknown as Record<string, unknown>)}
          {...(listeners as unknown as Record<string, unknown>)}
          onClick={(event) => {
            event.stopPropagation();
            if (shouldSuppressClick()) return;
            setSelectedSidebarNodeId(sidebarChatId);
            onSelectDroneChat(drone.id, chatName);
          }}
          className={`relative flex flex-1 items-center gap-1.5 rounded border text-left transition-all ${densityClasses.chatRow} ${
            selected
              ? 'border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.045)] text-[var(--fg)]'
              : active
                ? 'border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.025)] text-[var(--fg-secondary)]'
                : 'border-transparent text-[var(--muted)] hover:border-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.03)] hover:text-[var(--fg-secondary)]'
          } ${isDragging ? 'opacity-35' : ''} ${movingDroneGroups || isOptimistic ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
          title={`${uiDroneName(drone.name)} / ${chatName}`}
        >
          {active ? (
            <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
          ) : null}
          <span className="inline-flex flex-shrink-0 items-center">
            <IconChatThread className={densityClasses.icon} />
          </span>
          {!active && !busyChatNodeIdSet.has(chatNodeId) && unreadAgentMessageByChatNodeId[chatNodeId] ? (
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--yellow)]" />
          ) : (
            <span className="h-1.5 w-1.5 flex-shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono">{chatName}</span>
          {busyChatNodeIdSet.has(chatNodeId) ? (
            <span className="inline-flex items-center flex-shrink-0" title="Agent responding">
              <TypingDots color="var(--yellow)" />
            </span>
          ) : null}
        </button>
        {chatName !== 'default' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleDeleteChat(drone.id, chatName);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            disabled={Boolean(deletingChats[`${drone.id}:${chatName}`])}
            className={`inline-flex ${densityClasses.chatDeleteWidth} flex-shrink-0 items-center justify-center rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] text-[var(--red)] opacity-0 pointer-events-none transition-all group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto disabled:opacity-50`}
            title={`Delete chat "${chatName}"`}
            aria-label={`Delete chat "${chatName}"`}
          >
            {deletingChats[`${drone.id}:${chatName}`] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
          </button>
        ) : (
          <span className={`${densityClasses.chatPlaceholderWidth} flex-shrink-0`} />
        )}
      </div>
    </div>
  );
}

function GroupedSidebarDroneRow({ node, groupPath, nested = false }: { node: SidebarTreeDroneNode; groupPath: string | null; nested?: boolean }) {
  const activeDrag = useDroneHubActiveDrag();
  const {
    sidebarDensityMode,
    droneById,
    sidebarOptimisticDroneIdSet,
    movingDroneGroups,
    uiDroneName,
    selectedDroneIds,
    selectedDroneSet,
    sidebarChatOrderByDrone,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    selectedSidebarNodeId,
    setSelectedSidebarNodeId,
    onSelectDroneCard,
    selectedDrone,
    activeChatName,
    onOpenCloneModal,
    onCreateDroneChat,
    onRenameDrone,
    onSetDroneBaseImage,
    onDeleteDrone,
    onOpenDroneErrorModal,
    dragOverTreeTarget,
    nodeTree,
    shouldSuppressClick,
  } = useGroupedSidebarTreeContext();
  const densityClasses = groupedSidebarDensityClasses(sidebarDensityMode);
  const drone = droneById[node.droneId];
  if (!drone) return null;
  const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
  const dragDisabled = movingDroneGroups || isOptimistic;
  const dragData = React.useMemo(
    () => groupedDroneDragData({ drone, uiDroneName, selectedDroneIds, selectedDroneSet }),
    [drone, selectedDroneIds, selectedDroneSet, uiDroneName],
  );
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-grouped-drone:${drone.id}`,
    data: dragData,
    disabled: dragDisabled,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-tree-node:${node.id}`,
    data: {
      type: 'sidebar-tree-node',
      nodeId: node.id,
      kind: 'drone',
      parentId: node.parentId,
    },
  });
  const chats = orderSidebarEntries(
    normalizedDroneChats(drone),
    sidebarChatOrderByDrone[drone.id] ?? [],
    (chat) => chat,
  );
  const { setNodeRef: setChatTailDropNodeRef, isOver: isChatTailOver } = useDroppable({
    id: `sidebar-tree-drone-tail:${node.id}`,
    data: {
      type: 'sidebar-tree-drone-tail',
      nodeId: node.id,
      parentId: node.parentId,
    },
    disabled: chats.length <= 1,
  });
  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
  const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
  const showBusy =
    !isDroneStartingOrSeeding(drone.hubPhase) && hasOnlyDefaultChat && busyChatNodeIdSet.has(defaultChatNodeId);
  const showUnread = hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true;
  const childDroneIds = (nodeTree.childIdsByParent[node.id] ?? [])
    .map((childNodeId) => nodeTree.nodesById[childNodeId])
    .filter((child): child is SidebarTreeDroneNode => Boolean(child && child.kind === 'drone'));
  const selected = selectedSidebarNodeId === node.id;
  const showOpenDefaultChatIndicator =
    hasOnlyDefaultChat && selectedDrone === drone.id && activeChatName === 'default';
  const reorderPreviewClass =
    dragOverTreeTarget?.nodeId === node.id
      ? dragOverTreeTarget.placement === 'before'
        ? 'pt-3'
        : dragOverTreeTarget.placement === 'after'
          ? 'pb-3'
          : ''
      : isChatTailOver
        ? 'pb-3'
        : '';
  const showChatTailPreview =
    isChatTailOver && (activeDrag?.type === 'sidebar-drone' || activeDrag?.type === 'sidebar-folder');
  const showAfterPreview =
    (dragOverTreeTarget?.nodeId === node.id && dragOverTreeTarget.placement === 'after') || showChatTailPreview;

  return (
    <div className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${nested ? densityClasses.nestedDroneIndent : ''} ${reorderPreviewClass}`}>
      <div ref={setDropNodeRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <DroneCard
          drone={drone}
          density={sidebarDensityMode}
          displayName={uiDroneName(drone.name)}
          selected={selected}
          active={showOpenDefaultChatIndicator}
          activeIndicatorStyle="edge"
          leadingIcon={<IconDrone className={densityClasses.icon} />}
          selectionTone="muted"
          showSelectionEdge={false}
          busy={showBusy}
          unreadAgentMessage={showUnread}
          onClick={(rowOpts) => {
            if (shouldSuppressClick()) return;
            setSelectedSidebarNodeId(node.id);
            onSelectDroneCard(drone.id, rowOpts);
          }}
          dragNodeRef={setDragNodeRef}
          draggable={!dragDisabled}
          dragging={isDragging}
          dragAttributes={attributes as unknown as Record<string, unknown>}
          dragListeners={listeners as unknown as Record<string, unknown>}
          onClone={() => onOpenCloneModal(drone)}
          onCreateChat={() => onCreateDroneChat(drone)}
          onRename={() => onRenameDrone(drone.id)}
          onSetBaseImage={() => onSetDroneBaseImage(drone.id)}
          onDelete={() => onDeleteDrone(drone.id)}
          onErrorClick={onOpenDroneErrorModal}
          cloneDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id]) ||
            String(drone.runtime ?? 'container').trim().toLowerCase() === 'host'
          }
          createChatDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id]) ||
            isDroneStartingOrSeeding(drone.hubPhase)
          }
          renameDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id]) ||
            isDroneStartingOrSeeding(drone.hubPhase)
          }
          renameBusy={Boolean(renamingDrones[drone.id])}
          setBaseImageDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id]) ||
            isDroneStartingOrSeeding(drone.hubPhase)
          }
          setBaseImageBusy={Boolean(settingBaseImages[drone.id])}
          deleteDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id])
          }
          deleteBusy={Boolean(deletingDrones[drone.id])}
        />
      </div>
      {chats.length > 1 ? (
        <div ref={setChatTailDropNodeRef} className={`${densityClasses.chatBlockIndent} flex flex-col gap-0.5`}>
          {chats.map((chatName) => (
            <GroupedSidebarChatRow key={`${drone.id}:${chatName}`} drone={drone} chatName={chatName} isOptimistic={isOptimistic} />
          ))}
        </div>
      ) : null}
      {childDroneIds.length > 0 ? (
        <div className={`${densityClasses.nestedDroneRail} flex flex-col gap-0.5 border-l border-[rgba(255,255,255,.05)]`}>
          {childDroneIds.map((childNode) => (
            <GroupedSidebarDroneRow
              key={childNode.id}
              node={childNode}
              groupPath={groupPath}
              nested={true}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupedSidebarFolderRow({ node }: { node: SidebarTreeFolderNode }) {
  const activeDrag = useDroneHubActiveDrag();
  const {
    sidebarDensityMode,
    collapsedGroups,
    deletingGroups,
    renamingGroups,
    hiddenSidebarGroupTokenSet,
    selectedSidebarNodeId,
    selectedFolderPath,
    setSelectedSidebarNodeId,
    onSelectFolder,
    onToggleGroupCollapsed,
    folderEditor,
    folderEditorInputRef,
    onFolderEditorValueChange,
    onSubmitFolderEditor,
    onBlurFolderEditor,
    onCancelFolderEditor,
    nodeTree,
    dragOverTreeTarget,
    dragOverFolderBodyId,
    onOpenFolderCreate,
    onStartRenameFolder,
    toggleSidebarGroupHidden,
    onOpenGroupMultiChat,
    selectedGroupMultiChat,
    onDeleteGroup,
    shouldSuppressClick,
  } = useGroupedSidebarTreeContext();
  const densityClasses = groupedSidebarDensityClasses(sidebarDensityMode);
  const folderPath = folderGroupPath(node) ?? node.path;
  const isVirtualGroup = node.groupKind === 'repo' && !node.groupPath;
  const groupRef = React.useMemo(
    () => ({ group: folderPath, kind: node.groupKind }),
    [folderPath, node.groupKind],
  );
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const collapsed = Boolean(collapsedGroups[folderPath]);
  const isSelected = selectedSidebarNodeId === node.id || selectedFolderPath === folderPath;
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const showEditorInline = folderEditor?.targetPath === folderPath && folderEditor.mode === 'rename';
  const showCreateInline = (folderEditor?.anchorPath ?? folderEditor?.parentPath) === folderPath && folderEditor?.mode === 'create';
  const childIds = nodeTree.childIdsByParent[node.id] ?? [];
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-folder:${node.id}`,
    data: groupedFolderDragData({ nodeId: node.id, folderPath, label: node.label }),
    disabled: isVirtualGroup,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-tree-node:${node.id}`,
    data: {
      type: 'sidebar-tree-node',
      nodeId: node.id,
      kind: 'folder',
      parentId: node.parentId,
    },
    disabled: isVirtualGroup,
  });
  const { setNodeRef: setBodyDropNodeRef } = useDroppable({
    id: `sidebar-tree-folder-body:${node.id}`,
    data: {
      type: 'sidebar-tree-folder-body',
      nodeId: node.id,
    },
    disabled: collapsed || isVirtualGroup,
  });
  const setHeaderRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDragNodeRef(element);
      setDropNodeRef(element);
    },
    [setDragNodeRef, setDropNodeRef],
  );
  const intoState =
    dragOverFolderBodyId === node.id ||
    (dragOverTreeTarget?.nodeId === node.id && dragOverTreeTarget.placement === 'into');
  const reorderPreviewClass =
    dragOverTreeTarget?.nodeId === node.id
      ? dragOverTreeTarget.placement === 'before'
        ? 'pt-3'
        : dragOverTreeTarget.placement === 'after'
          ? 'pb-3'
          : ''
      : '';

  return (
    <div className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
      <div ref={setHeaderRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <div
          className={`group/folder-row relative flex items-center gap-1 rounded-md pr-1 transition-colors ${densityClasses.folderRow} ${
            intoState
              ? 'bg-[var(--accent-subtle)] ring-1 ring-[var(--accent-muted)]'
              : isSelected
                ? 'border border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.045)]'
                : 'border border-transparent hover:border-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.03)]'
          } ${isDragging ? 'opacity-60' : isHiddenGroup ? 'opacity-70' : ''}`}
          style={{ paddingLeft: `${Math.max(0, node.depth) * densityClasses.folderDepthPaddingPx}px` }}
        >
          <button
            type="button"
            className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX}`}
            onClick={() => {
              if (shouldSuppressClick()) return;
              if (isSelected) {
                onToggleGroupCollapsed(folderPath);
                return;
              }
              setSelectedSidebarNodeId(node.id);
              onSelectFolder(folderPath);
            }}
            onDoubleClick={() => onToggleGroupCollapsed(folderPath)}
            {...(attributes as unknown as Record<string, unknown>)}
            {...(listeners as unknown as Record<string, unknown>)}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <IconFolder className={`flex-shrink-0 ${densityClasses.icon}`} />
              {showEditorInline && folderEditor ? (
                <input
                  ref={folderEditorInputRef}
                  value={folderEditor.value}
                  onChange={(event) => onFolderEditorValueChange(event.target.value)}
                  onBlur={onBlurFolderEditor}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSubmitFolderEditor();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancelFolderEditor();
                    }
                  }}
                  maxLength={64}
                  className={`min-w-0 flex-1 rounded-md border border-[var(--accent-muted)] bg-[rgba(15,18,28,.88)] text-[var(--fg)] shadow-[0_0_0_1px_rgba(167,139,250,.16)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(167,139,250,.18)] ${densityClasses.folderInput}`}
                />
              ) : (
                <span className={`min-w-0 flex-1 truncate font-medium text-[var(--fg-secondary)] ${densityClasses.folderLabel}`} title={folderPath}>
                  {node.label}
                </span>
              )}
            </div>
          </button>
          <div
            className={`relative ml-2 flex flex-shrink-0 items-center justify-end transition-[min-width] duration-150 ${
              isVirtualGroup ? 'group-hover/folder-row:min-w-[72px]' : 'group-hover/folder-row:min-w-[112px]'
            }`}
          >
            <div className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 group-hover/folder-row:opacity-0">
              {node.totalDroneCount}
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center justify-end gap-1 opacity-0 transition-all group-hover/folder-row:opacity-100">
              <button
                type="button"
                onClick={() =>
                  onOpenFolderCreate(isVirtualGroup ? null : folderPath, isVirtualGroup ? { anchorPath: folderPath } : undefined)
                }
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]`}
                title={isVirtualGroup ? `New top-level folder from "${node.label}"` : `New subfolder in "${node.label}"`}
              >
                <IconPlus className="opacity-90" />
              </button>
              {!isVirtualGroup ? (
                <button
                  type="button"
                  onClick={() => onStartRenameFolder(folderPath)}
                  disabled={Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath])}
                  className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] transition-all hover:bg-[rgba(167,139,250,.12)] disabled:opacity-50`}
                  title={`Rename folder "${node.label}"`}
                >
                  {renamingGroups[folderPath] ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toggleSidebarGroupHidden(groupRef)}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border transition-all ${
                  isHiddenGroup
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--muted)]'
                }`}
                title={isHiddenGroup ? `Unhide "${node.label}"` : `Hide "${node.label}"`}
              >
                {isHiddenGroup ? <IconEye className="opacity-90" /> : <IconEyeOff className="opacity-90" />}
              </button>
              <button
                type="button"
                onClick={() => onOpenGroupMultiChat(folderPath)}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border transition-all ${
                  selectedGroupMultiChat === folderPath
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
                }`}
                title={`Open "${node.label}" multi-chat`}
              >
                <IconColumns className="opacity-90" />
              </button>
              <button
                type="button"
                onClick={() =>
                  onDeleteGroup(folderPath, node.totalDroneCount, {
                    kind: node.groupKind,
                    label: node.label,
                    repoPath:
                      isVirtualGroup && node.path.startsWith('repo:') && node.path !== 'repo:ungrouped'
                        ? node.path.slice('repo:'.length)
                        : null,
                  })
                }
                disabled={Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath])}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] text-[var(--red)] transition-all hover:bg-[rgba(255,90,90,.15)] disabled:opacity-50`}
                title={`Delete folder "${node.label}"`}
              >
                {deletingGroups[folderPath] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {!collapsed ? (
        <div
          ref={setBodyDropNodeRef}
          data-sidebar-folder-body={node.id}
          className={`${densityClasses.folderBody} ${intoState ? 'border-[var(--accent-muted)] bg-[rgba(167,139,250,.03)]' : 'border-[rgba(255,255,255,.06)]'}`}
        >
          {showCreateInline ? (
            <div className={`flex items-center gap-2 rounded-md border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] shadow-[0_0_0_1px_rgba(167,139,250,.12)] ${densityClasses.folderCreateBody}`}>
              <IconFolder className={`${densityClasses.icon} flex-shrink-0 text-[var(--accent)] opacity-80`} />
              <input
                ref={folderEditorInputRef}
                value={folderEditor?.value ?? ''}
                onChange={(event) => onFolderEditorValueChange(event.target.value)}
                onBlur={onBlurFolderEditor}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmitFolderEditor();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancelFolderEditor();
                  }
                }}
                maxLength={64}
                placeholder={folderEditor?.parentPath ? 'Subfolder name' : 'Folder name'}
                className={`min-w-0 flex-1 rounded-md border border-[var(--accent-muted)] bg-[rgba(15,18,28,.88)] text-[var(--fg)] shadow-[0_0_0_1px_rgba(167,139,250,.16)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(167,139,250,.18)] ${densityClasses.folderInput}`}
              />
            </div>
          ) : null}
          {!showCreateInline && childIds.length === 0 ? (
            isVirtualGroup && node.totalDroneCount === 0 ? (
              <div className={densityClasses.emptyHint}>
                <IconFolder className={densityClasses.icon} />
                <span className="truncate">No drones in this repo yet.</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onOpenFolderCreate(isVirtualGroup ? null : folderPath, isVirtualGroup ? { anchorPath: folderPath } : undefined)
                }
                className={densityClasses.emptyHint}
                title={isVirtualGroup ? `Create a top-level folder from "${node.label}"` : `Create a subfolder in "${node.label}"`}
              >
                <IconPlus className="opacity-85" />
                <span className="truncate">
                  {isVirtualGroup ? 'Create a top-level folder' : 'Empty folder. Create a subfolder or drop drones here.'}
                </span>
              </button>
            )
          ) : null}
          {childIds.map((childId) => (
            <div key={childId} data-sidebar-node-id={childId}>
              <GroupedSidebarNodeEntry nodeId={childId} groupPath={folderPath} />
            </div>
          ))}
          {showCreateInline && folderEditor?.error ? <div className="text-[10px] text-[var(--red)]">{folderEditor.error}</div> : null}
        </div>
      ) : null}
      {showEditorInline && folderEditor?.error ? <div className="ml-5 text-[10px] text-[var(--red)]">{folderEditor.error}</div> : null}
    </div>
  );
}

function GroupedSidebarNodeEntry({ nodeId, groupPath }: { nodeId: string; groupPath: string | null }) {
  const { nodeTree } = useGroupedSidebarTreeContext();
  const node = nodeTree.nodesById[nodeId];
  if (!node) return null;
  return node.kind === 'folder' ? (
    <GroupedSidebarFolderRow node={node} />
  ) : (
    <GroupedSidebarDroneRow node={node} groupPath={groupPath} />
  );
}

export function GroupedSidebarTree(props: GroupedSidebarTreeProps) {
  const {
    sidebarGroups,
    sidebarFolderTree,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    setSidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    setSidebarChatOrderByDrone,
    droneById,
    selectedDroneIds,
    selectedDroneSet,
    onMoveDronesToGroup,
    onRenameGroup,
    onDeleteDroneChat,
    onPrepareDroneDragStart,
  } = props;
  const [dragOverTreeTarget, setDragOverTreeTarget] = React.useState<{ nodeId: string; placement: TreeDropPlacement } | null>(null);
  const [dragOverFolderBodyId, setDragOverFolderBodyId] = React.useState<string | null>(null);
  const [dragOverChat, setDragOverChat] = React.useState<{ key: string; placement: SidebarGroupDropPlacement } | null>(null);
  const [deletingChats, setDeletingChats] = React.useState<Record<string, boolean>>({});
  const suppressClicksUntilRef = React.useRef<number>(0);

  const nodeTree = React.useMemo(
    () =>
      buildSidebarNodeTree({
        sidebarFolderTree,
        sidebarGroups,
        sidebarGroupOrder,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
      }),
    [sidebarDroneOrderByGroup, sidebarFolderTree, sidebarGroupOrder, sidebarGroups, sidebarNodeOrderByParent],
  );

  const orderedGroupItemsByPath = React.useMemo(() => {
    const out: Record<string, DroneSummary[]> = {};
    for (const group of sidebarGroups) {
      if (group.kind !== 'group') continue;
      const groupPath = String(group.group ?? '').trim() || 'Ungrouped';
      out[groupPath] = orderSidebarEntries(
        group.items,
        sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: groupPath, kind: 'group' })] ?? [],
        (item) => item.id,
        { unorderedPlacement: 'start' },
      );
    }
    return out;
  }, [sidebarDroneOrderByGroup, sidebarGroups]);

  const droneTreeByGroupPath = React.useMemo(() => {
    const out: Record<string, SidebarDroneTree> = {};
    for (const [groupPath, items] of Object.entries(orderedGroupItemsByPath)) {
      out[groupPath] = buildSidebarDroneTree(items);
    }
    return out;
  }, [orderedGroupItemsByPath]);

  const clearDragState = React.useCallback(() => {
    setDragOverTreeTarget(null);
    setDragOverFolderBodyId(null);
    setDragOverChat(null);
  }, []);

  const shouldSuppressClick = React.useCallback(() => Date.now() < suppressClicksUntilRef.current, []);

  const handleDeleteChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      if (!droneId || !chatName || chatName === 'default') return;
      const key = `${droneId}:${chatName}`;
      if (deletingChats[key]) return;
      setDeletingChats((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await onDeleteDroneChat(droneId, chatName);
        if (!result.ok && result.error) window.alert(result.error);
      } finally {
        setDeletingChats((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [deletingChats, onDeleteDroneChat],
  );

  const moveFolder = React.useCallback(
    async (sourcePathRaw: string, targetParentPathRaw: string | null) => {
      const sourcePath = String(sourcePathRaw ?? '').trim();
      const targetParentPath = String(targetParentPathRaw ?? '').trim() || null;
      if (!sourcePath) return false;
      if (targetParentPath && (targetParentPath === sourcePath || isSameOrDescendantSidebarGroupPath(targetParentPath, sourcePath))) {
        return false;
      }
      const nextPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourcePath)]);
      if (!nextPath || nextPath === sourcePath) return true;
      return Boolean(await onRenameGroup(sourcePath, nextPath));
    },
    [onRenameGroup],
  );

  const updateTreeDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const active = parseDroneHubDragData(event.active.data.current);
      const activeRaw = event.active.data.current as Record<string, unknown> | undefined;
      const overData = event.over?.data.current as Record<string, unknown> | undefined;

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String(overData.droneId ?? '').trim();
        const overChatName = String(overData.chatName ?? '').trim() || 'default';
        if (overDroneId && overDroneId === active.droneId && overChatName !== active.chatName) {
          setDragOverTreeTarget(null);
          setDragOverFolderBodyId(null);
          setDragOverChat({
            key: `${overDroneId}:${overChatName}`,
            placement: sidebarDropPlacementFromRects(
              event.active.rect.current.translated ?? event.active.rect.current.initial,
              event.over?.rect ?? null,
            ),
          });
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-drone-tail' &&
        typeof overData.nodeId === 'string'
      ) {
        const targetNodeId = String(overData.nodeId ?? '').trim();
        if (nodeTree.nodesById[targetNodeId]?.kind === 'drone') {
          setDragOverChat(null);
          setDragOverFolderBodyId(null);
          setDragOverTreeTarget({
            nodeId: targetNodeId,
            placement: 'after',
          });
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-chat-reorder' &&
        typeof overData.droneId === 'string'
      ) {
        const targetNodeId = sidebarDroneNodeId(String(overData.droneId ?? '').trim());
        if (nodeTree.nodesById[targetNodeId]?.kind === 'drone') {
          setDragOverChat(null);
          setDragOverFolderBodyId(null);
          setDragOverTreeTarget({
            nodeId: targetNodeId,
            placement: 'after',
          });
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-node' &&
        typeof overData.nodeId === 'string'
      ) {
        const targetNodeId = String(overData.nodeId ?? '').trim();
        setDragOverChat(null);
        setDragOverFolderBodyId(null);
        setDragOverTreeTarget({
          nodeId: targetNodeId,
          placement: placementFromEvent(event, false),
        });
        return;
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-folder-body' &&
        typeof overData.nodeId === 'string'
      ) {
        const folderNodeId = String(overData.nodeId ?? '').trim();
        const insertionTarget = resolveFolderBodyInsertionTarget(folderNodeId, activeRectMidY(event));
        setDragOverChat(null);
        setDragOverTreeTarget(insertionTarget);
        setDragOverFolderBodyId(insertionTarget ? null : folderNodeId);
        return;
      }

      clearDragState();
    },
    [clearDragState],
  );

  useDndMonitor({
    onDragStart: (event) => {
      const active = parseDroneHubDragData(event.active.data.current);
      if (active?.type === 'sidebar-drone') onPrepareDroneDragStart(active.droneId);
    },
    onDragMove: updateTreeDragState,
    onDragOver: updateTreeDragState,
    onDragCancel: () => {
      suppressClicksUntilRef.current = Date.now() + 180;
      clearDragState();
    },
    onDragEnd: (event) => {
      suppressClicksUntilRef.current = Date.now() + 180;
      const active = parseDroneHubDragData(event.active.data.current);
      const activeRaw = event.active.data.current as Record<string, unknown> | undefined;
      const overData = event.over?.data.current as Record<string, unknown> | undefined;

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String(overData.droneId ?? '').trim();
        const overChatName = String(overData.chatName ?? '').trim() || 'default';
        if (overDroneId === active.droneId && overChatName && overChatName !== active.chatName) {
          const currentChats = orderSidebarEntries(
            normalizedDroneChats(droneById[active.droneId]),
            sidebarChatOrderByDrone[active.droneId] ?? [],
            (chat) => chat,
          );
          const placement =
            dragOverChat?.key === `${overDroneId}:${overChatName}`
              ? dragOverChat.placement
              : sidebarDropPlacementFromRects(
                  event.active.rect.current.translated ?? event.active.rect.current.initial,
                  event.over?.rect ?? null,
                );
          setSidebarChatOrderByDrone((prev) => ({
            ...prev,
            [active.droneId]: reorderSidebarEntryOrder(
              prev[active.droneId] ?? [],
              currentChats,
              active.chatName,
              overChatName,
              placement,
            ),
          }));
          clearDragState();
          return;
        }
      }

      if (
        active?.type === 'sidebar-drone' &&
        (
          overData?.type === 'sidebar-tree-node' ||
          overData?.type === 'sidebar-tree-folder-body' ||
          overData?.type === 'sidebar-chat-reorder' ||
          overData?.type === 'sidebar-tree-drone-tail'
        )
      ) {
        const chatTargetNodeId =
          overData?.type === 'sidebar-chat-reorder' ? sidebarDroneNodeId(String(overData.droneId ?? '').trim()) : null;
        const hoveredNodeId = chatTargetNodeId ?? String(overData.nodeId ?? '').trim();
        const folderBodyInsertionTarget =
          overData?.type === 'sidebar-tree-folder-body'
            ? resolveFolderBodyInsertionTarget(hoveredNodeId, activeRectMidY(event))
            : null;
        const targetNodeId = folderBodyInsertionTarget?.nodeId ?? hoveredNodeId;
        const targetNode = nodeTree.nodesById[targetNodeId];
        const hoveredFolderNode = overData?.type === 'sidebar-tree-folder-body' ? nodeTree.nodesById[hoveredNodeId] : null;
        if (!targetNode) {
          if (overData?.type === 'sidebar-tree-folder-body' && hoveredFolderNode?.kind === 'folder') {
            const targetParentId = hoveredFolderNode.id;
            const targetParentNode = nodeTree.nodesById[targetParentId];
            const targetFolderPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
            const sourceNode = nodeTree.nodesById[sidebarDroneNodeId(active.droneId)] as SidebarTreeDroneNode | undefined;
            const sourceParentId = sourceNode?.parentId ?? targetParentId;
            const movingDroneIds =
              props.selectedDroneSet.has(active.droneId) && props.selectedDroneIds.length > 0
                ? props.selectedDroneIds.slice()
                : [active.droneId];
            const previousNodeOrderByParent = sidebarNodeOrderByParent;
            const movingNodeIds = movingDroneIds.map(sidebarDroneNodeId);
            const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
            const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
            const nextSourceVisible = sourceVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
            const nextTargetVisible = targetVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
            setSidebarNodeOrderByParent(
              moveSidebarNodeIdsBetweenParents({
                map: removeDroneIdsFromSidebarNodeOrderByParent(sidebarNodeOrderByParent, movingDroneIds),
                sourceParentId,
                targetParentId,
                sourceVisibleChildIds: nextSourceVisible,
                targetVisibleChildIds: nextTargetVisible,
                movingNodeIds,
                overNodeId: null,
                placement: 'into',
              }),
            );
            void onMoveDronesToGroup(targetFolderPath ?? 'Ungrouped', movingDroneIds).then((result) => {
              if (!result.ok) {
                setSidebarNodeOrderByParent(previousNodeOrderByParent);
              }
            });
          }
          clearDragState();
          return;
        }

        const movingDroneIds =
          props.selectedDroneSet.has(active.droneId) && props.selectedDroneIds.length > 0
            ? props.selectedDroneIds.slice()
            : [active.droneId];
        const placement =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? 'after'
            : overData.type === 'sidebar-tree-folder-body'
              ? (folderBodyInsertionTarget?.placement ?? 'into')
              : dragOverTreeTarget?.nodeId === targetNodeId
                ? dragOverTreeTarget.placement
                : placementFromEvent(event, false);
        const targetParentId =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? targetNode.parentId
            : overData.type === 'sidebar-tree-folder-body'
              ? folderBodyInsertionTarget
                ? targetNode.parentId
                : placement === 'into' && targetNode.kind === 'folder'
                  ? targetNode.id
                  : targetNode.parentId
              : placement === 'into' && targetNode.kind === 'folder'
                ? targetNode.id
                : targetNode.parentId;
        const targetParentNode = targetParentId === SIDEBAR_ROOT_PARENT_ID ? null : nodeTree.nodesById[targetParentId];
        const targetFolderPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
        const sourceNode = nodeTree.nodesById[sidebarDroneNodeId(active.droneId)] as SidebarTreeDroneNode | undefined;
        const sourceParentId = sourceNode?.parentId ?? targetParentId;
        const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
        const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
        if (movingDroneIds.length === 1 && sourceParentId === targetParentId && placement !== 'into') {
          const nextNodeOrderByParent = reorderSidebarNodeParentOrder(
            sidebarNodeOrderByParent,
            sourceParentId,
            sourceVisibleChildIds,
            sidebarDroneNodeId(active.droneId),
            targetNode.id,
            placement as SidebarGroupDropPlacement,
          );
          setSidebarNodeOrderByParent(
            nextNodeOrderByParent,
          );
          clearDragState();
          return;
        }

        const movingNodeIds = movingDroneIds.map(sidebarDroneNodeId);
        const nextSourceVisible = sourceVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
        const nextTargetVisible = targetVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
        const previousNodeOrderByParent = sidebarNodeOrderByParent;
        setSidebarNodeOrderByParent(
          moveSidebarNodeIdsBetweenParents({
            map: removeDroneIdsFromSidebarNodeOrderByParent(sidebarNodeOrderByParent, movingDroneIds),
            sourceParentId,
            targetParentId,
            sourceVisibleChildIds: nextSourceVisible,
            targetVisibleChildIds: nextTargetVisible,
            movingNodeIds,
            overNodeId: placement === 'into' ? null : targetNode.id,
            placement,
          }),
        );
        void onMoveDronesToGroup(targetFolderPath ?? 'Ungrouped', movingDroneIds).then((result) => {
          if (!result.ok) {
            setSidebarNodeOrderByParent(previousNodeOrderByParent);
          }
        });
        clearDragState();
        return;
      }

      if (
        activeRaw?.type === 'sidebar-folder' &&
        (
          overData?.type === 'sidebar-tree-node' ||
          overData?.type === 'sidebar-tree-folder-body' ||
          overData?.type === 'sidebar-chat-reorder' ||
          overData?.type === 'sidebar-tree-drone-tail'
        )
      ) {
        const sourceFolderPath = String(activeRaw.folderPath ?? '').trim();
        const sourceNodeId = String(activeRaw.folderNodeId ?? '').trim() || sidebarFolderNodeId(sourceFolderPath);
        const sourceNode = nodeTree.nodesById[sourceNodeId];
        const chatTargetNodeId =
          overData?.type === 'sidebar-chat-reorder' ? sidebarDroneNodeId(String(overData.droneId ?? '').trim()) : null;
        const hoveredNodeId = chatTargetNodeId ?? String(overData.nodeId ?? '').trim();
        const folderBodyInsertionTarget =
          overData?.type === 'sidebar-tree-folder-body'
            ? resolveFolderBodyInsertionTarget(hoveredNodeId, activeRectMidY(event))
            : null;
        const targetNodeId = folderBodyInsertionTarget?.nodeId ?? hoveredNodeId;
        const targetNode = nodeTree.nodesById[targetNodeId];
        const hoveredFolderNode = overData?.type === 'sidebar-tree-folder-body' ? nodeTree.nodesById[hoveredNodeId] : null;
        if (!sourceNode || !targetNode || targetNode.id === sourceNodeId) {
          if (sourceNode && overData?.type === 'sidebar-tree-folder-body' && hoveredFolderNode?.kind === 'folder') {
            const sourceParentId = sourceNode.parentId;
            const targetParentId = hoveredFolderNode.id;
            const targetParentNode = nodeTree.nodesById[targetParentId];
            const targetParentPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
            const previousNodeOrderByParent = sidebarNodeOrderByParent;
            const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
            const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
            const movedFolderPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourceFolderPath)]);
            if (movedFolderPath) {
              setSidebarNodeOrderByParent(
                moveSidebarNodeIdsBetweenParents({
                  map: sidebarNodeOrderByParent,
                  sourceParentId,
                  targetParentId,
                  sourceVisibleChildIds,
                  targetVisibleChildIds,
                  movingNodeIds: [sidebarFolderNodeId(movedFolderPath)],
                  overNodeId: null,
                  placement: 'into',
                }),
              );
            }
            void moveFolder(sourceFolderPath, targetParentPath).then((ok) => {
              if (!ok) {
                setSidebarNodeOrderByParent(previousNodeOrderByParent);
              }
            });
          }
          clearDragState();
          return;
        }

        const placement =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? 'after'
            : overData.type === 'sidebar-tree-folder-body'
              ? (folderBodyInsertionTarget?.placement ?? 'into')
              : dragOverTreeTarget?.nodeId === targetNodeId
                ? dragOverTreeTarget.placement
                : placementFromEvent(event, false);
        const sourceParentId = sourceNode.parentId;
        const targetParentId =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? targetNode.parentId
            : overData.type === 'sidebar-tree-folder-body' && folderBodyInsertionTarget
              ? targetNode.parentId
              : placement === 'into' && targetNode.kind === 'folder'
                ? targetNode.id
                : targetNode.parentId;
        const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
        const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
        if (sourceParentId === targetParentId && placement !== 'into') {
          const nextNodeOrderByParent = reorderSidebarNodeParentOrder(
            sidebarNodeOrderByParent,
            sourceParentId,
            sourceVisibleChildIds,
            sourceNodeId,
            targetNodeId,
            placement as SidebarGroupDropPlacement,
          );
          setSidebarNodeOrderByParent(
            nextNodeOrderByParent,
          );
          clearDragState();
          return;
        }

        const targetParentNode = targetParentId === SIDEBAR_ROOT_PARENT_ID ? null : nodeTree.nodesById[targetParentId];
        const targetParentPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
        const movedFolderPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourceFolderPath)]);
        const previousNodeOrderByParent = sidebarNodeOrderByParent;
        if (movedFolderPath) {
          setSidebarNodeOrderByParent(
            moveSidebarNodeIdsBetweenParents({
              map: sidebarNodeOrderByParent,
              sourceParentId,
              targetParentId,
              sourceVisibleChildIds,
              targetVisibleChildIds,
              movingNodeIds: [sidebarFolderNodeId(movedFolderPath)],
              overNodeId: placement === 'into' ? null : targetNodeId,
              placement,
            }),
          );
        }
        void moveFolder(sourceFolderPath, targetParentPath).then((ok) => {
          if (!ok) {
            setSidebarNodeOrderByParent(previousNodeOrderByParent);
          }
        });
        clearDragState();
        return;
      }

      clearDragState();
    },
  });

  const contextValue = React.useMemo<GroupedSidebarTreeContextValue>(
    () => ({
      ...props,
      nodeTree,
      droneTreeByGroupPath,
      dragOverTreeTarget,
      dragOverFolderBodyId,
      dragOverChat,
      deletingChats,
      handleDeleteChat,
      shouldSuppressClick,
    }),
    [deletingChats, dragOverChat, dragOverFolderBodyId, dragOverTreeTarget, droneTreeByGroupPath, handleDeleteChat, nodeTree, props, shouldSuppressClick],
  );

  return (
    <GroupedSidebarTreeContext.Provider value={contextValue}>
      {nodeTree.rootChildIds.map((nodeId) => (
        <GroupedSidebarNodeEntry key={nodeId} nodeId={nodeId} groupPath={null} />
      ))}
    </GroupedSidebarTreeContext.Provider>
  );
}
