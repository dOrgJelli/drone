import React from 'react';
import { DroneCard } from '../overview';
import { TypingDots } from '../overview/icons';
import type { DroneSummary } from '../types';
import { DRONE_CHAT_DND_MIME, createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { isDroneStartingOrSeeding } from './helpers';
import { IconChevron } from './icons';
import type { SidebarDroneTree } from './sidebar-drone-tree';

export type SidebarInlineSectionKind = 'chats' | 'children';

export function sidebarInlineSectionKey(droneIdRaw: string, kind: SidebarInlineSectionKind): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `${kind}:${droneId}`;
}

function SidebarInlineSectionToggle({
  expanded,
  label,
  countLabel,
  onClick,
  title,
}: {
  expanded: boolean;
  label: string;
  countLabel: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-6 rounded border px-2 text-left text-[10px] transition-all flex items-center gap-1.5 border-transparent text-[var(--muted-dim)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
      title={title}
      aria-label={title}
      aria-expanded={expanded}
    >
      <IconChevron down={expanded} className="opacity-70" />
      <span
        className="min-w-0 flex-1 truncate font-semibold tracking-wide uppercase"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </span>
      <span className="flex-shrink-0 font-mono text-[9px] text-[var(--muted-dim)]">
        {countLabel}
      </span>
    </button>
  );
}

export type SidebarDroneTreeListProps = {
  droneById: Record<string, DroneSummary>;
  tree: SidebarDroneTree;
  draftSidebarPlaceholderId: string;
  selectedDroneSet: Set<string>;
  selectedDrone: string | null;
  activeChatName: string;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  collapsedDroneSections: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onToggleSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onDroneDragStart: (droneId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onDroneDragEnd: () => void;
  showGroup?: boolean;
};

export function SidebarDroneTreeList({
  droneById,
  tree,
  draftSidebarPlaceholderId,
  selectedDroneSet,
  selectedDrone,
  activeChatName,
  busyChatNodeIdSet,
  unreadAgentMessageByChatNodeId,
  deletingDrones,
  renamingDrones,
  settingBaseImages,
  movingDroneGroups,
  sidebarOptimisticDroneIdSet,
  collapsedDroneSections,
  uiDroneName,
  onToggleSection,
  onSelectDroneCard,
  onSelectDroneChat,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onDroneDragStart,
  onDroneDragEnd,
  showGroup,
}: SidebarDroneTreeListProps) {
  const renderDroneNode = React.useCallback(
    (droneId: string, ancestorDroneIds?: Set<string>): React.ReactNode => {
      if (ancestorDroneIds?.has(droneId)) return null;
      const drone = droneById[droneId];
      if (!drone) return null;
      const nextAncestorDroneIds = new Set(ancestorDroneIds ?? []);
      nextAncestorDroneIds.add(droneId);
      if (drone.id === draftSidebarPlaceholderId) {
        return (
          <div key={drone.id} className="w-full text-left px-3 h-8 flex items-center rounded-md border bg-[var(--selected)] border-[var(--accent-muted)] relative">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-[var(--fg)]" title={`${drone.name} · pending draft`}>
                {drone.name}
              </span>
              <span
                className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Draft"
              >
                draft
              </span>
            </div>
          </div>
        );
      }

      const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
      const chats = normalizedDroneChats(drone);
      const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
      const hasChatSection = chats.length > 0 && !hasOnlyDefaultChat;
      const childDroneIds = tree.childDroneIdsByParentId[drone.id] ?? [];
      const hasChildrenSection = childDroneIds.length > 0;
      const chatsExpanded = !collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'chats')];
      const childrenExpanded = !collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'children')];
      const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
      const showDroneBusy =
        !isDroneStartingOrSeeding(drone.hubPhase) &&
        hasOnlyDefaultChat &&
        Boolean(defaultChatNodeId && busyChatNodeIdSet.has(defaultChatNodeId));
      const showDroneUnread =
        hasOnlyDefaultChat &&
        Boolean(defaultChatNodeId && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true);

      return (
        <div key={drone.id} className="flex flex-col gap-0.5">
          <DroneCard
            drone={drone}
            displayName={uiDroneName(drone.name)}
            statusHint={isOptimistic ? 'queued' : undefined}
            selected={selectedDroneSet.has(drone.id)}
            busy={showDroneBusy}
            unreadAgentMessage={showDroneUnread}
            showGroup={showGroup}
            onClick={(rowOpts) => onSelectDroneCard(drone.id, rowOpts)}
            draggable={!movingDroneGroups && !isOptimistic}
            onDragStart={(event) => {
              onDroneDragStart(drone.id, event);
              if (!hasOnlyDefaultChat) return;
              const nodeId = createCanvasChatNodeId(drone.id, 'default');
              if (!nodeId) return;
              const payload = [{ nodeId, droneId: drone.id, chatName: 'default' }];
              try {
                event.dataTransfer.setData(DRONE_CHAT_DND_MIME, JSON.stringify(payload));
              } catch {
                // Ignore drag payload assignment errors.
              }
            }}
            onDragEnd={onDroneDragEnd}
            onClone={() => onOpenCloneModal(drone)}
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
          {hasChatSection ? (
            <>
              <div className="ml-5 mr-1">
                <SidebarInlineSectionToggle
                  expanded={chatsExpanded}
                  label="Chats"
                  countLabel={`${chats.length}`}
                  onClick={() => onToggleSection(drone.id, 'chats')}
                  title={chatsExpanded ? `Collapse chats for ${uiDroneName(drone.name)}` : `Expand chats for ${uiDroneName(drone.name)}`}
                />
              </div>
              {chatsExpanded ? (
                <div className="ml-5 mr-1 flex flex-col gap-0.5">
                  {chats.map((chatName) => {
                    const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
                    if (!chatNodeId) return null;
                    const selected = selectedDrone === drone.id && activeChatName === chatName;
                    const unread = unreadAgentMessageByChatNodeId[chatNodeId] === true;
                    const busy = busyChatNodeIdSet.has(chatNodeId);
                    return (
                      <button
                        key={`${drone.id}:${chatName}`}
                        type="button"
                        draggable={!movingDroneGroups && !isOptimistic}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = 'copyMove';
                          const payload = [{ droneId: drone.id, chatName }];
                          try {
                            event.dataTransfer.setData(DRONE_CHAT_DND_MIME, JSON.stringify(payload));
                          } catch {
                            // Ignore drag payload assignment errors.
                          }
                          try {
                            event.dataTransfer.setData('text/plain', `${uiDroneName(drone.name)} / ${chatName}`);
                          } catch {
                            // Ignore drag payload assignment errors.
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectDroneChat(drone.id, chatName);
                        }}
                        className={`w-full h-7 rounded border px-2 text-left text-[11px] transition-all flex items-center gap-1.5 ${
                          selected
                            ? 'border-[var(--accent-muted)] bg-[var(--selected)] text-[var(--fg)]'
                            : 'border-transparent text-[var(--muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        }`}
                        title={`${uiDroneName(drone.name)} / ${chatName}`}
                      >
                        {!busy && unread ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] flex-shrink-0" />
                        ) : (
                          <span className="h-1.5 w-1.5 flex-shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {chatName}
                        </span>
                        {busy ? (
                          <span className="inline-flex items-center flex-shrink-0" title="Agent responding">
                            <TypingDots color="var(--yellow)" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          {hasChildrenSection ? (
            <>
              <div className="ml-5 mr-1">
                <SidebarInlineSectionToggle
                  expanded={childrenExpanded}
                  label="Children"
                  countLabel={`${childDroneIds.length}`}
                  onClick={() => onToggleSection(drone.id, 'children')}
                  title={
                    childrenExpanded
                      ? `Collapse child drones for ${uiDroneName(drone.name)}`
                      : `Expand child drones for ${uiDroneName(drone.name)}`
                  }
                />
              </div>
              {childrenExpanded ? (
                <div className="ml-5 mr-1 flex flex-col gap-0.5">
                  {childDroneIds.map((childDroneId) => renderDroneNode(childDroneId, nextAncestorDroneIds))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      );
    },
    [
      activeChatName,
      busyChatNodeIdSet,
      collapsedDroneSections,
      deletingDrones,
      draftSidebarPlaceholderId,
      droneById,
      movingDroneGroups,
      onDeleteDrone,
      onDroneDragEnd,
      onDroneDragStart,
      onOpenCloneModal,
      onOpenDroneErrorModal,
      onRenameDrone,
      onSelectDroneCard,
      onSelectDroneChat,
      onSetDroneBaseImage,
      onToggleSection,
      renamingDrones,
      selectedDrone,
      selectedDroneSet,
      settingBaseImages,
      showGroup,
      sidebarOptimisticDroneIdSet,
      tree.childDroneIdsByParentId,
      uiDroneName,
      unreadAgentMessageByChatNodeId,
    ],
  );

  return <>{tree.rootDroneIds.map((droneId) => renderDroneNode(droneId))}</>;
}
