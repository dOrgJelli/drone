import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import {
  createKanbanCard,
  createKanbanLane,
  moveKanbanCard,
  parsePastedKanbanCard,
  type KanbanBoardState,
  type KanbanCard,
  type KanbanLane,
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

type KanbanCardRef = {
  laneId: string;
  cardId: string;
};

type KanbanCardLocation = {
  laneId: string;
  index: number;
};

type SortableKanbanCardProps = {
  card: KanbanCard;
  laneId: string;
  controlsLocked: boolean;
  selected: boolean;
  activeDragCardId: string | null;
  onToggleCard: (laneId: string, cardId: string) => void;
  onSelectCard: (laneId: string, cardId: string) => void;
  onUpdateCard: (laneId: string, cardId: string, patch: { title?: string; description?: string }) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

type KanbanLaneCardsProps = {
  lane: KanbanLane;
  controlsLocked: boolean;
  selectedCardRef: KanbanCardRef | null;
  activeDragCardId: string | null;
  onToggleCard: (laneId: string, cardId: string) => void;
  onSelectCard: (laneId: string, cardId: string) => void;
  onUpdateCard: (laneId: string, cardId: string, patch: { title?: string; description?: string }) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

const LANE_ACCENTS = ['#D6D06B', '#75B3FF', '#F0B447', '#39D59C'] as const;

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isCardControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, input, textarea, select, [contenteditable="true"]'));
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

function findKanbanCardLocation(board: KanbanBoardState, cardIdRaw: string): KanbanCardLocation | null {
  const cardId = String(cardIdRaw ?? '').trim();
  if (!cardId) return null;
  for (const lane of board.lanes) {
    const index = lane.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { laneId: lane.id, index };
  }
  return null;
}

function dragHandleDots() {
  return (
    <span className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
    </span>
  );
}

function EmptyKanbanLaneDropTarget({ laneId, controlsLocked }: { laneId: string; controlsLocked: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane:${laneId}`,
    data: { type: 'lane', laneId },
    disabled: controlsLocked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-[14px] border px-3 py-5 text-[11px] text-[var(--muted-dim)] transition-all ${
        isOver
          ? 'border-[rgba(157,202,255,.5)] bg-[rgba(157,202,255,.08)]'
          : 'border-dashed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
      }`}
    >
      Add a task or paste plain text on the board background.
    </div>
  );
}

function KanbanLaneEndDropTarget({ laneId, controlsLocked }: { laneId: string; controlsLocked: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane-end:${laneId}`,
    data: { type: 'lane-end', laneId },
    disabled: controlsLocked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`mx-3 h-4 rounded-full transition-all ${
        isOver ? 'bg-[rgba(157,202,255,.22)]' : 'bg-transparent'
      }`}
    >
      <div className={`mx-auto mt-[7px] h-0.5 rounded-full transition-all ${isOver ? 'w-full bg-[rgba(157,202,255,.9)]' : 'w-10 bg-[rgba(255,255,255,.07)]'}`} />
    </div>
  );
}

function SortableKanbanCard({
  card,
  laneId,
  controlsLocked,
  selected,
  activeDragCardId,
  onToggleCard,
  onSelectCard,
  onUpdateCard,
  onRemoveCard,
}: SortableKanbanCardProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', laneId },
    disabled: controlsLocked,
  });
  const style = React.useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );
  const snippet = descriptionSnippet(card.description);

  return (
    <article
      ref={setNodeRef}
      style={style}
      onClick={(event) => {
        if (isCardControlTarget(event.target)) return;
        onToggleCard(laneId, card.id);
      }}
      className={`rounded-[16px] border px-3.5 py-3 transition-all ${
        selected
          ? 'border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.08)]'
          : 'border-[rgba(255,255,255,.05)] bg-[rgba(255,255,255,.03)] hover:bg-[rgba(255,255,255,.05)]'
      } ${isDragging || activeDragCardId === card.id ? 'opacity-25' : ''}`}
    >
      <div className="flex items-start gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...(controlsLocked ? {} : listeners)}
          onClick={(event) => event.stopPropagation()}
          disabled={controlsLocked}
          title={controlsLocked ? 'Board is loading' : 'Drag task'}
          className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--muted-dim)] transition-all ${
            controlsLocked
              ? 'cursor-not-allowed opacity-30'
              : 'cursor-grab touch-none hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)] active:cursor-grabbing'
          }`}
        >
          {dragHandleDots()}
        </button>
        <div className="min-w-0 flex-1">
          {selected ? (
            <input
              value={card.title}
              onFocus={() => onSelectCard(laneId, card.id)}
              onChange={(event) => onUpdateCard(laneId, card.id, { title: event.target.value })}
              disabled={controlsLocked}
              placeholder="Task title"
              className={`w-full bg-transparent text-[13px] font-medium focus:outline-none ${
                controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
              }`}
            />
          ) : (
            <div
              className={`w-full bg-transparent text-left text-[13px] font-medium ${
                controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
              }`}
            >
              {card.title || 'Untitled task'}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveCard(laneId, card.id);
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
            onChange={(event) => onUpdateCard(laneId, card.id, { description: event.target.value })}
            disabled={controlsLocked}
            placeholder="Description"
            rows={4}
            className={`w-full resize-none bg-transparent text-[11px] leading-5 placeholder:text-[var(--muted-dim)] focus:outline-none ${
              controlsLocked ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-70' : 'text-[var(--muted)]'
            }`}
          />
        </div>
      ) : snippet ? (
        <div className="mt-2 text-[11px] leading-5 text-[var(--muted-dim)]">{snippet}</div>
      ) : null}
    </article>
  );
}

function DragOverlayKanbanCard({ card }: { card: KanbanCard }) {
  const snippet = descriptionSnippet(card.description);

  return (
    <article className="w-[264px] rounded-[16px] border border-[rgba(255,255,255,.16)] bg-[rgba(24,24,28,.92)] px-3.5 py-3 shadow-[0_18px_48px_rgba(0,0,0,.38)] backdrop-blur-sm">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--muted-dim)]">
          {dragHandleDots()}
        </div>
        <div className="min-w-0 flex-1 text-[13px] font-medium text-[var(--fg)]">{card.title || 'Untitled task'}</div>
      </div>
      {snippet ? <div className="mt-2 text-[11px] leading-5 text-[var(--muted-dim)]">{snippet}</div> : null}
    </article>
  );
}

function KanbanLaneCards({
  lane,
  controlsLocked,
  selectedCardRef,
  activeDragCardId,
  onToggleCard,
  onSelectCard,
  onUpdateCard,
  onRemoveCard,
}: KanbanLaneCardsProps) {
  const cardIds = React.useMemo(() => lane.cards.map((card) => card.id), [lane.cards]);

  return (
    <div className="space-y-2 rounded-[18px] p-1">
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {lane.cards.length === 0 ? (
          <EmptyKanbanLaneDropTarget laneId={lane.id} controlsLocked={controlsLocked} />
        ) : (
          <>
            {lane.cards.map((card) => (
              <SortableKanbanCard
                key={card.id}
                card={card}
                laneId={lane.id}
                controlsLocked={controlsLocked}
                selected={selectedCardRef?.laneId === lane.id && selectedCardRef?.cardId === card.id}
                activeDragCardId={activeDragCardId}
                onToggleCard={onToggleCard}
                onSelectCard={onSelectCard}
                onUpdateCard={onUpdateCard}
                onRemoveCard={onRemoveCard}
              />
            ))}
            <KanbanLaneEndDropTarget laneId={lane.id} controlsLocked={controlsLocked} />
          </>
        )}
      </SortableContext>
    </div>
  );
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
  const [selectedCardRef, setSelectedCardRef] = React.useState<KanbanCardRef | null>(null);
  const [activeDragCardId, setActiveDragCardId] = React.useState<string | null>(null);
  const laneCount = board.lanes.length;
  const cardCount = React.useMemo(
    () => board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [board.lanes],
  );
  const activeDragCard = React.useMemo(() => {
    if (!activeDragCardId) return null;
    for (const lane of board.lanes) {
      const card = lane.cards.find((item) => item.id === activeDragCardId) ?? null;
      if (card) return card;
    }
    return null;
  }, [activeDragCardId, board.lanes]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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

  const toggleCard = React.useCallback((laneIdRaw: string, cardIdRaw: string) => {
    const laneId = String(laneIdRaw ?? '').trim();
    const cardId = String(cardIdRaw ?? '').trim();
    if (!laneId || !cardId) return;
    setSelectedCardRef((prev) => (prev?.laneId === laneId && prev.cardId === cardId ? null : { laneId, cardId }));
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
      setActiveDragCardId((prev) => (prev === cardId ? null : prev));
    },
    [onBoardChange],
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const cardId = String(event.active.id ?? '').trim();
    setActiveDragCardId(cardId || null);
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragCardId(null);
      const activeCardId = String(event.active.id ?? '').trim();
      const overId = String(event.over?.id ?? '').trim();
      if (!activeCardId || !event.over || !overId) return;

      const activeLocation = findKanbanCardLocation(board, activeCardId);
      if (!activeLocation) return;

      const overType = String((event.over.data.current as { type?: string } | undefined)?.type ?? '').trim();
      let toLaneId = '';
      let toIndex = 0;

      if (overType === 'lane' || overType === 'lane-end') {
        toLaneId = String((event.over.data.current as { laneId?: string } | undefined)?.laneId ?? '').trim();
        if (!toLaneId) return;
        toIndex = board.lanes.find((lane) => lane.id === toLaneId)?.cards.length ?? 0;
      } else {
        const overLocation = findKanbanCardLocation(board, overId);
        if (!overLocation) return;
        toLaneId = overLocation.laneId;
        const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
        const activeMidpoint = (activeRect?.top ?? 0) + (activeRect?.height ?? 0) / 2;
        const overMidpoint = event.over.rect.top + event.over.rect.height / 2;
        const placeAfter = activeMidpoint > overMidpoint;
        toIndex = overLocation.index + (placeAfter ? 1 : 0);
      }

      onBoardChange((prev) =>
        moveKanbanCard(prev, {
          cardId: activeCardId,
          fromLaneId: activeLocation.laneId,
          toLaneId,
          toIndex,
        }),
      );
      setSelectedCardRef({ laneId: toLaneId, cardId: activeCardId });
    },
    [board, onBoardChange],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveDragCardId(null);
  }, []);

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
          {(boardLoading || boardSaving || boardUpdatedAt || boardError) && (
            <div className="ml-auto text-[10px] text-[var(--muted-dim)]">
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
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
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
                      title={
                        controlsLocked ? 'Board is loading' : board.lanes.length <= 1 ? 'Keep at least one lane' : 'Delete lane'
                      }
                    >
                      <IconTrash className="opacity-80" />
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                    <KanbanLaneCards
                      lane={lane}
                      controlsLocked={controlsLocked}
                      selectedCardRef={selectedCardRef}
                      activeDragCardId={activeDragCardId}
                      onToggleCard={toggleCard}
                      onSelectCard={selectCard}
                      onUpdateCard={updateCard}
                      onRemoveCard={removeCard}
                    />
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
        <DragOverlay>
          {activeDragCard ? <DragOverlayKanbanCard card={activeDragCard} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
