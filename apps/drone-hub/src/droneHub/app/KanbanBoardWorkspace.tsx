import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { createKanbanCard, createKanbanLane, parsePastedKanbanCard, type KanbanBoardState } from './kanban-board-state';
import { IconBoard, IconChevron, IconPlus, IconTrash } from './icons';
import { SpawnContextToolbar } from './SpawnContextToolbar';

type KanbanBoardWorkspaceProps = {
  board: KanbanBoardState;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  boardLoading: boolean;
  boardSaving: boolean;
  boardError: string | null;
  boardUpdatedAt: string | null;
  onReloadBoard: () => void;
  onOpenCustomAgentModal: () => void;
  onBoardChange: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
  onClose: () => void;
};

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function laneCountLabel(count: number): string {
  return `${count} lane${count === 1 ? '' : 's'}`;
}

function cardCountLabel(count: number): string {
  return `${count} task${count === 1 ? '' : 's'}`;
}

export function KanbanBoardWorkspace({
  board,
  spawnAgentMenuEntries,
  spawnAgentConfig,
  createRepoMenuEntries,
  boardLoading,
  boardSaving,
  boardError,
  boardUpdatedAt,
  onReloadBoard,
  onOpenCustomAgentModal,
  onBoardChange,
  onClose,
}: KanbanBoardWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const controlsLocked = boardLoading;
  const [expandedCardIds, setExpandedCardIds] = React.useState<Set<string>>(() => new Set());
  const laneCount = board.lanes.length;
  const cardCount = React.useMemo(
    () => board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [board.lanes],
  );

  React.useEffect(() => {
    const validCardIds = new Set(board.lanes.flatMap((lane) => lane.cards.map((card) => card.id)));
    setExpandedCardIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validCardIds.has(id)) {
          next.add(id);
          continue;
        }
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [board.lanes]);

  const expandCard = React.useCallback((cardIdRaw: string) => {
    const cardId = String(cardIdRaw ?? '').trim();
    if (!cardId) return;
    setExpandedCardIds((prev) => {
      if (prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });
  }, []);

  const toggleCardExpanded = React.useCallback((cardIdRaw: string) => {
    const cardId = String(cardIdRaw ?? '').trim();
    if (!cardId) return;
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  const addLane = React.useCallback(() => {
    onBoardChange((prev) => ({
      ...prev,
      lanes: [...prev.lanes, createKanbanLane({ title: `Lane ${prev.lanes.length + 1}` })],
    }));
  }, [onBoardChange]);

  const updateLaneTitle = React.useCallback(
    (laneIdRaw: string, nextTitle: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return;
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) => (lane.id === laneId ? { ...lane, title: nextTitle } : lane)),
      }));
    },
    [onBoardChange],
  );

  const removeLane = React.useCallback(
    (laneIdRaw: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return;
      const lane = board.lanes.find((item) => item.id === laneId) ?? null;
      if (!lane || board.lanes.length <= 1) return;
      if (lane.cards.length > 0) {
        const confirmed = window.confirm(
          `Delete lane "${lane.title || 'Untitled lane'}" and its ${cardCountLabel(lane.cards.length)}?`,
        );
        if (!confirmed) return;
      }
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.filter((item) => item.id !== laneId),
      }));
    },
    [board.lanes, onBoardChange],
  );

  const addCard = React.useCallback(
    (laneIdRaw: string, seed?: Partial<Pick<ReturnType<typeof createKanbanCard>, 'title' | 'description'>>) => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return;
      const nextCard = createKanbanCard({
        title: seed?.title ?? 'Untitled task',
        description: seed?.description ?? '',
      });
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: [...lane.cards, nextCard],
              }
            : lane,
        ),
      }));
      if (nextCard.description.trim()) expandCard(nextCard.id);
    },
    [expandCard, onBoardChange],
  );

  const updateCard = React.useCallback(
    (laneIdRaw: string, cardIdRaw: string, patch: { title?: string; description?: string }) => {
      const laneId = String(laneIdRaw ?? '').trim();
      const cardId = String(cardIdRaw ?? '').trim();
      if (!laneId || !cardId) return;
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: lane.cards.map((card) =>
                  card.id === cardId
                    ? {
                        ...card,
                        ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: String(patch.title ?? '') } : {}),
                        ...(Object.prototype.hasOwnProperty.call(patch, 'description')
                          ? { description: String(patch.description ?? '') }
                          : {}),
                      }
                    : card,
                ),
              }
            : lane,
        ),
      }));
    },
    [onBoardChange],
  );

  const removeCard = React.useCallback(
    (laneIdRaw: string, cardIdRaw: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      const cardId = String(cardIdRaw ?? '').trim();
      if (!laneId || !cardId) return;
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: lane.cards.filter((card) => card.id !== cardId),
              }
            : lane,
        ),
      }));
      setExpandedCardIds((prev) => {
        if (!prev.has(cardId)) return prev;
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    },
    [onBoardChange],
  );

  const handlePasteCapture = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (controlsLocked) return;
      if (isEditablePasteTarget(event.target)) return;
      const parsed = parsePastedKanbanCard(event.clipboardData?.getData('text/plain') ?? '');
      const firstLaneId = String(board.lanes[0]?.id ?? '').trim();
      if (!parsed || !firstLaneId) return;
      event.preventDefault();
      addCard(firstLaneId, parsed);
    },
    [addCard, board.lanes, controlsLocked],
  );

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onPasteCapture={handlePasteCapture}
      onMouseDown={(event) => {
        if (isEditablePasteTarget(event.target)) return;
        rootRef.current?.focus();
      }}
      className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden outline-none"
    >
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01))]">
        <div className="px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(255,255,255,.05)] text-[var(--fg)]">
                <IconBoard />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                    Task board
                  </span>
                  <span className="inline-flex items-center rounded-full bg-[rgba(255,255,255,.04)] px-2 py-1 text-[10px] font-medium text-[var(--muted-dim)]">
                    {laneCountLabel(laneCount)} • {cardCountLabel(cardCount)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">
                  Simple planning surface. Paste plain text on the board background to add a task into the first lane.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onReloadBoard}
                disabled={boardLoading}
                className={`inline-flex h-8 items-center justify-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  boardLoading
                    ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                    : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Reload saved board from hub storage"
              >
                {boardLoading ? 'Loading' : 'Reload'}
              </button>
              <button
                type="button"
                onClick={addLane}
                disabled={controlsLocked}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  controlsLocked
                    ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                    : 'bg-[var(--fg)] text-[var(--panel)] hover:opacity-90'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Add a new lane"
              >
                <IconPlus className="opacity-80" />
                Lane
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)] transition-all hover:bg-[rgba(255,255,255,.04)] hover:text-[var(--fg)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
          {(boardLoading || boardSaving || boardUpdatedAt || boardError) && (
            <div className="text-[10px] text-[var(--muted-dim)]">
              {boardLoading ? (
                <span>Loading saved board…</span>
              ) : boardSaving ? (
                <span>Saving board…</span>
              ) : boardError ? (
                <span className="text-[var(--red)]" title={boardError}>
                  Sync error
                </span>
              ) : boardUpdatedAt ? (
                <span title={boardUpdatedAt}>Saved {new Date(boardUpdatedAt).toLocaleString()}</span>
              ) : null}
            </div>
          )}
          <SpawnContextToolbar
            agentMenuEntries={spawnAgentMenuEntries}
            spawnAgentConfig={spawnAgentConfig}
            createRepoMenuEntries={createRepoMenuEntries}
            onOpenCustomAgentModal={onOpenCustomAgentModal}
            agentTitle="Choose default agent context for tasks on this board."
            modelTitle="Set default model context for this board."
            customButtonTitle="Manage custom agents"
            controlsLocked={controlsLocked}
            repoContainerClassName="min-w-0"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,.015),rgba(255,255,255,0))]">
        <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden px-6 py-6">
          <div className="flex h-full min-h-0 w-max items-start gap-8 pr-6">
            {board.lanes.map((lane, laneIdx) => (
              <section key={lane.id} className="flex h-full min-h-0 w-[280px] flex-col gap-4">
                <div className="flex items-start justify-between gap-3 px-1">
                  <div className="min-w-0 flex-1">
                    <input
                      value={lane.title}
                      onChange={(event) => updateLaneTitle(lane.id, event.target.value)}
                      disabled={controlsLocked}
                      placeholder={`Lane ${laneIdx + 1}`}
                      className={`w-full bg-transparent text-[13px] font-semibold placeholder:text-[var(--muted-dim)] focus:outline-none ${
                        controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    />
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--muted-dim)]">
                      <span>{cardCountLabel(lane.cards.length)}</span>
                      {laneIdx === 0 ? (
                        <span className="rounded-full bg-[rgba(255,255,255,.05)] px-2 py-0.5 text-[#9DCAFF]">
                          Paste target
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLane(lane.id)}
                    disabled={controlsLocked || board.lanes.length <= 1}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                      controlsLocked || board.lanes.length <= 1
                        ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-30'
                        : 'text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--red)]'
                    }`}
                    title={controlsLocked ? 'Board is loading' : board.lanes.length <= 1 ? 'Keep at least one lane' : 'Delete lane'}
                  >
                    <IconTrash className="opacity-80" />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <div className="space-y-3">
                    {lane.cards.length === 0 ? (
                      <div className="px-1 py-8 text-[11px] text-[var(--muted-dim)]">
                        <div className="font-semibold uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
                          Empty
                        </div>
                        <div className="mt-1">Add a task or paste plain text on the board background.</div>
                      </div>
                    ) : null}
                    {lane.cards.map((card) => {
                      const expanded = expandedCardIds.has(card.id);
                      return (
                        <article
                          key={card.id}
                          className="rounded-[20px] bg-[rgba(255,255,255,.04)] px-3.5 py-3 shadow-[0_14px_30px_rgba(0,0,0,.12)] ring-1 ring-[rgba(255,255,255,.05)]"
                        >
                          <div className="flex items-start gap-2">
                            <input
                              value={card.title}
                              onChange={(event) => updateCard(lane.id, card.id, { title: event.target.value })}
                              disabled={controlsLocked}
                              placeholder="Task title"
                              className={`min-w-0 flex-1 bg-transparent text-[13px] font-medium placeholder:text-[var(--muted-dim)] focus:outline-none ${
                                controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
                              }`}
                            />
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleCardExpanded(card.id)}
                                disabled={controlsLocked}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                                  controlsLocked
                                    ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-30'
                                    : 'text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]'
                                }`}
                                title={expanded ? 'Hide details' : 'Show details'}
                              >
                                <IconChevron down={expanded} className="opacity-70" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeCard(lane.id, card.id)}
                                disabled={controlsLocked}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                                  controlsLocked
                                    ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-30'
                                    : 'text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--red)]'
                                }`}
                                title={controlsLocked ? 'Board is loading' : 'Delete task'}
                              >
                                <IconTrash className="opacity-80" />
                              </button>
                            </div>
                          </div>
                          {!expanded && card.description.trim() ? (
                            <div className="mt-2 text-[10px] text-[var(--muted-dim)]">Description hidden</div>
                          ) : null}
                          {expanded ? (
                            <div className="mt-3">
                              <textarea
                                value={card.description}
                                onChange={(event) => updateCard(lane.id, card.id, { description: event.target.value })}
                                disabled={controlsLocked}
                                placeholder="Description"
                                rows={5}
                                className={`w-full resize-none bg-transparent text-[11px] leading-5 placeholder:text-[var(--muted-dim)] focus:outline-none ${
                                  controlsLocked
                                    ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-70'
                                    : 'text-[var(--muted)]'
                                }`}
                              />
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => addCard(lane.id)}
                  disabled={controlsLocked}
                  className={`inline-flex h-9 items-center gap-1.5 self-start rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    controlsLocked
                      ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                      : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  <IconPlus className="opacity-80" />
                  Add task
                </button>
              </section>
            ))}

            <button
              type="button"
              onClick={addLane}
              disabled={controlsLocked}
              className={`inline-flex h-10 self-start items-center gap-1.5 rounded-full px-4 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                controlsLocked
                  ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                  : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              <IconPlus className="opacity-80" />
              Add lane
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
