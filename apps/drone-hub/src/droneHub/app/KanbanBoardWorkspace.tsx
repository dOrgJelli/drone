import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import {
  createKanbanCard,
  createKanbanLane,
  moveKanbanCard,
  parsePastedKanbanCard,
  type KanbanBoardState,
} from './kanban-board-state';
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

function descriptionSnippet(textRaw: string): string {
  const normalized = String(textRaw ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 92 ? `${normalized.slice(0, 89).trimEnd()}...` : normalized;
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
  const [draggedCardRef, setDraggedCardRef] = React.useState<{ laneId: string; cardId: string } | null>(null);
  const [dropTargetRef, setDropTargetRef] = React.useState<{ laneId: string; index: number } | null>(null);
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
      setDropTargetRef((prev) => (prev?.laneId === laneId ? null : prev));
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
      setDraggedCardRef((prev) => (prev?.cardId === cardId ? null : prev));
    },
    [onBoardChange],
  );

  const handleDropAt = React.useCallback(
    (laneIdRaw: string, indexRaw: number) => {
      const laneId = String(laneIdRaw ?? '').trim();
      const index = Number(indexRaw);
      if (!laneId || !Number.isFinite(index) || !draggedCardRef) return;
      onBoardChange((prev) => moveKanbanCard(prev, { ...draggedCardRef, toLaneId: laneId, toIndex: index }));
      setSelectedCardRef({ laneId, cardId: draggedCardRef.cardId });
      setDraggedCardRef(null);
      setDropTargetRef(null);
    },
    [draggedCardRef, onBoardChange],
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
                  Paste plain text to add a task into the first lane. Drag cards to reorder them or move them between lanes.
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

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-6 py-6">
        <div className="flex h-full min-h-0 w-max items-start gap-6 pr-6">
          {board.lanes.map((lane, laneIdx) => {
            const accent = laneAccent(laneIdx);
            return (
              <section key={lane.id} className="flex h-full min-h-0 w-[300px] flex-col gap-3">
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
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted-dim)]">
                      <span>{lane.cards.length}</span>
                      {laneIdx === 0 ? (
                        <span className="rounded-full bg-[rgba(255,255,255,.04)] px-2 py-0.5 text-[#9DCAFF]">
                          Paste target
                        </span>
                      ) : null}
                    </div>
                  </div>
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

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <div className="space-y-2">
                    {lane.cards.length === 0 ? (
                      <div
                        onDragOver={(event) => {
                          if (!draggedCardRef) return;
                          event.preventDefault();
                          setDropTargetRef({ laneId: lane.id, index: 0 });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropAt(lane.id, 0);
                        }}
                        className={`rounded-[14px] border px-3 py-5 text-[11px] text-[var(--muted-dim)] transition-all ${
                          dropTargetRef?.laneId === lane.id && dropTargetRef.index === 0
                            ? 'border-[rgba(157,202,255,.5)] bg-[rgba(157,202,255,.08)]'
                            : 'border-dashed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
                        }`}
                      >
                        Add a task or paste plain text on the board background.
                      </div>
                    ) : null}

                    {lane.cards.map((card, cardIdx) => {
                      const selected = selectedCardRef?.cardId === card.id && selectedCardRef.laneId === lane.id;
                      const snippet = descriptionSnippet(card.description);
                      return (
                        <React.Fragment key={card.id}>
                          <div
                            onDragOver={(event) => {
                              if (!draggedCardRef) return;
                              event.preventDefault();
                              setDropTargetRef({ laneId: lane.id, index: cardIdx });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDropAt(lane.id, cardIdx);
                            }}
                            className={`h-2 rounded-full transition-all ${
                              dropTargetRef?.laneId === lane.id && dropTargetRef.index === cardIdx
                                ? 'bg-[rgba(157,202,255,.35)]'
                                : ''
                            }`}
                          />
                          <article
                            draggable={!controlsLocked}
                            onDragStart={(event) => {
                              if (controlsLocked || isEditablePasteTarget(event.target)) {
                                event.preventDefault();
                                return;
                              }
                              setDraggedCardRef({ laneId: lane.id, cardId: card.id });
                              setDropTargetRef({ laneId: lane.id, index: cardIdx });
                              if (event.dataTransfer) {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', card.id);
                              }
                            }}
                            onDragEnd={() => {
                              setDraggedCardRef(null);
                              setDropTargetRef(null);
                            }}
                            onClick={() => selectCard(lane.id, card.id)}
                            className={`rounded-[16px] border px-3.5 py-3 transition-all ${
                              selected
                                ? 'border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.08)]'
                                : 'border-[rgba(255,255,255,.05)] bg-[rgba(255,255,255,.03)] hover:bg-[rgba(255,255,255,.05)]'
                            } ${draggedCardRef?.cardId === card.id ? 'opacity-50' : ''}`}
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
                            {selected ? (
                              <div className="mt-3">
                                <textarea
                                  value={card.description}
                                  onChange={(event) => updateCard(lane.id, card.id, { description: event.target.value })}
                                  disabled={controlsLocked}
                                  placeholder="Description"
                                  rows={4}
                                  className={`w-full resize-none bg-transparent text-[11px] leading-5 placeholder:text-[var(--muted-dim)] focus:outline-none ${
                                    controlsLocked
                                      ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-70'
                                      : 'text-[var(--muted)]'
                                  }`}
                                />
                              </div>
                            ) : snippet ? (
                              <div className="mt-2 text-[11px] leading-5 text-[var(--muted-dim)]">
                                {snippet}
                              </div>
                            ) : null}
                          </article>
                        </React.Fragment>
                      );
                    })}

                    {lane.cards.length > 0 ? (
                      <div
                        onDragOver={(event) => {
                          if (!draggedCardRef) return;
                          event.preventDefault();
                          setDropTargetRef({ laneId: lane.id, index: lane.cards.length });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropAt(lane.id, lane.cards.length);
                        }}
                        className={`h-2 rounded-full transition-all ${
                          dropTargetRef?.laneId === lane.id && dropTargetRef.index === lane.cards.length
                            ? 'bg-[rgba(157,202,255,.35)]'
                            : ''
                        }`}
                      />
                    ) : null}
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
    </div>
  );
}
