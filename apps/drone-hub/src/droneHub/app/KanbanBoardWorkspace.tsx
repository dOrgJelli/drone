import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { createKanbanCard, createKanbanLane, parsePastedKanbanCard, type KanbanBoardState } from './kanban-board-state';
import { IconBoard, IconPlus, IconTrash } from './icons';
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
  onSuggestCardTitleFromPaste: (description: string) => Promise<string | null>;
  onBoardChange: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
  onClose: () => void;
};

const LANE_ACCENTS = ['#D6D06B', '#75B3FF', '#F0B447', '#39D59C'] as const;

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

function laneAccent(index: number): string {
  return LANE_ACCENTS[index % LANE_ACCENTS.length] ?? '#9DCAFF';
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
  onSuggestCardTitleFromPaste,
  onBoardChange,
  onClose,
}: KanbanBoardWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const controlsLocked = boardLoading;
  const [selectedCardRef, setSelectedCardRef] = React.useState<{ laneId: string; cardId: string } | null>(null);
  const laneCount = board.lanes.length;
  const cardCount = React.useMemo(
    () => board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [board.lanes],
  );

  const selectedCardEntry = React.useMemo(() => {
    if (!selectedCardRef) return null;
    const lane = board.lanes.find((item) => item.id === selectedCardRef.laneId) ?? null;
    const card = lane?.cards.find((item) => item.id === selectedCardRef.cardId) ?? null;
    if (!lane || !card) return null;
    return { lane, card };
  }, [board.lanes, selectedCardRef]);

  React.useEffect(() => {
    if (selectedCardRef && !selectedCardEntry) setSelectedCardRef(null);
  }, [selectedCardEntry, selectedCardRef]);

  const selectCard = React.useCallback((laneIdRaw: string, cardIdRaw: string) => {
    const laneId = String(laneIdRaw ?? '').trim();
    const cardId = String(cardIdRaw ?? '').trim();
    if (!laneId || !cardId) return;
    setSelectedCardRef({ laneId, cardId });
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
      setSelectedCardRef((prev) => (prev?.laneId === laneId ? null : prev));
    },
    [board.lanes, onBoardChange],
  );

  const addCard = React.useCallback(
    (
      laneIdRaw: string,
      seed?: Partial<Pick<ReturnType<typeof createKanbanCard>, 'title' | 'description'>>,
    ): ReturnType<typeof createKanbanCard> | null => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return null;
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
      setSelectedCardRef({ laneId, cardId: nextCard.id });
      return nextCard;
    },
    [onBoardChange],
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
      setSelectedCardRef((prev) => (prev?.cardId === cardId ? null : prev));
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
      const nextCard = addCard(firstLaneId, parsed);
      if (!parsed.needsGeneratedTitle || !nextCard) return;
      const provisionalTitle = nextCard.title;
      void onSuggestCardTitleFromPaste(parsed.description)
        .then((suggestedTitle) => {
          const title = String(suggestedTitle ?? '').trim();
          if (!title) return;
          onBoardChange((prev) => ({
            ...prev,
            lanes: prev.lanes.map((lane) =>
              lane.id === firstLaneId
                ? {
                    ...lane,
                    cards: lane.cards.map((card) =>
                      card.id === nextCard.id && (!card.title.trim() || card.title === provisionalTitle)
                        ? { ...card, title }
                        : card,
                    ),
                  }
                : lane,
            ),
          }));
        })
        .catch(() => {});
    },
    [addCard, board.lanes, controlsLocked, onBoardChange, onSuggestCardTitleFromPaste],
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
                  Compact board view. Select a task to edit its details below, or paste plain text to add one into the first lane.
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

      <div className="flex-1 min-h-0 overflow-hidden px-6 py-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-[rgba(255,255,255,.08)] bg-[rgba(9,12,19,.82)] shadow-[0_24px_80px_rgba(0,0,0,.24)]">
          <div className="flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,.06)] px-5 py-3">
            <div className="min-w-0 text-[12px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              task board - workflow
            </div>
            <div className="text-[11px] text-[var(--muted-dim)]">{cardCount} tasks active</div>
          </div>

          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 py-4">
            <div className="flex h-full min-h-0 w-max items-start gap-6 pr-4">
              {board.lanes.map((lane, laneIdx) => {
                const accent = laneAccent(laneIdx);
                return (
                  <section key={lane.id} className="flex h-full min-h-0 w-[280px] flex-col gap-3">
                    <div className="flex items-center justify-between gap-3 px-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
                          <input
                            value={lane.title}
                            onChange={(event) => updateLaneTitle(lane.id, event.target.value)}
                            disabled={controlsLocked}
                            placeholder={`Lane ${laneIdx + 1}`}
                            className={`min-w-0 flex-1 bg-transparent font-medium focus:outline-none ${
                              controlsLocked ? 'cursor-not-allowed opacity-70' : ''
                            }`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[var(--muted-dim)]">{lane.cards.length}</span>
                        <button
                          type="button"
                          onClick={() => removeLane(lane.id)}
                          disabled={controlsLocked || board.lanes.length <= 1}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                            controlsLocked || board.lanes.length <= 1
                              ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-30'
                              : 'text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--red)]'
                          }`}
                          title={controlsLocked ? 'Board is loading' : board.lanes.length <= 1 ? 'Keep at least one lane' : 'Delete lane'}
                        >
                          <IconTrash className="opacity-80" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <div className="space-y-2.5">
                        {lane.cards.length === 0 ? (
                          <div className="px-2 py-6 text-[11px] text-[var(--muted-dim)]">
                            <div className="font-semibold uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
                              Empty
                            </div>
                            <div className="mt-1">Add a task or paste plain text on the board background.</div>
                          </div>
                        ) : null}
                        {lane.cards.map((card, cardIdx) => {
                          const selected = selectedCardRef?.cardId === card.id && selectedCardRef.laneId === lane.id;
                          return (
                            <article
                              key={card.id}
                              onClick={() => selectCard(lane.id, card.id)}
                              className={`rounded-[16px] border px-3.5 py-3 transition-all ${
                                selected
                                  ? 'border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.08)]'
                                  : 'border-[rgba(255,255,255,.04)] bg-[rgba(255,255,255,.04)] hover:bg-[rgba(255,255,255,.06)]'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <input
                                    value={card.title}
                                    onFocus={() => selectCard(lane.id, card.id)}
                                    onChange={(event) => updateCard(lane.id, card.id, { title: event.target.value })}
                                    disabled={controlsLocked}
                                    placeholder="Task title"
                                    className={`w-full bg-transparent text-[13px] font-medium focus:outline-none ${
                                      controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
                                    }`}
                                  />
                                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
                                    <span>{card.description.trim() ? 'Details available' : 'No details yet'}</span>
                                    <span style={{ color: accent }}>#{cardIdx + 1}</span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeCard(lane.id, card.id);
                                  }}
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
                            </article>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => addCard(lane.id)}
                      disabled={controlsLocked}
                      className={`inline-flex h-8 items-center gap-1.5 self-start rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
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
                );
              })}

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

          <div className="border-t border-[rgba(255,255,255,.06)] px-5 py-3">
            {selectedCardEntry ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[11px] text-[var(--muted-dim)]">
                  <span style={{ color: laneAccent(board.lanes.findIndex((lane) => lane.id === selectedCardEntry.lane.id)) }}>
                    &gt;
                  </span>
                  <span>{selectedCardEntry.lane.title}</span>
                  <span>/</span>
                  <span className="truncate text-[var(--muted)]">{selectedCardEntry.card.title || 'Untitled task'}</span>
                </div>
                <textarea
                  value={selectedCardEntry.card.description}
                  onChange={(event) =>
                    updateCard(selectedCardEntry.lane.id, selectedCardEntry.card.id, { description: event.target.value })
                  }
                  disabled={controlsLocked}
                  placeholder="Description"
                  rows={3}
                  className={`w-full resize-none rounded-[14px] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[11px] leading-5 focus:outline-none ${
                    controlsLocked
                      ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-70'
                      : 'text-[var(--muted)] placeholder:text-[var(--muted-dim)]'
                  }`}
                />
              </div>
            ) : (
              <div className="text-[11px] text-[var(--muted-dim)]">
                Select a task to edit its description.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
