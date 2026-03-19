import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { createKanbanCard, createKanbanLane, parsePastedKanbanCard, type KanbanBoardState } from './kanban-board-state';
import { IconBoard, IconFolder, IconPlus, IconTrash } from './icons';
import { SpawnContextToolbar } from './SpawnContextToolbar';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

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
  const chatHeaderRepoPath = useDroneHubUiStore((s) => s.chatHeaderRepoPath);
  const controlsLocked = boardLoading;
  const laneCount = board.lanes.length;
  const cardCount = React.useMemo(
    () => board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [board.lanes],
  );

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
        const confirmed = window.confirm(`Delete lane "${lane.title || 'Untitled lane'}" and its ${cardCountLabel(lane.cards.length)}?`);
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
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: [...lane.cards, createKanbanCard({ title: seed?.title ?? 'Untitled task', description: seed?.description ?? '' })],
              }
            : lane,
        ),
      }));
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
      <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[rgba(120,180,255,.5)] via-[rgba(255,255,255,.14)] to-transparent" />
        <div className="px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border border-[rgba(120,180,255,.18)] bg-[linear-gradient(180deg,rgba(120,180,255,.18),rgba(120,180,255,.08))] text-[#9DCAFF]">
                <IconBoard />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                    Task board
                  </span>
                  <span className="inline-flex items-center h-5 px-2 rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[10px] font-mono text-[var(--muted-dim)]">
                    {laneCountLabel(laneCount)} • {cardCountLabel(cardCount)}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">
                  Full-window planning surface. Paste plain text on the board background to add a task into the first lane.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onReloadBoard}
                disabled={boardLoading}
                className={`inline-flex items-center justify-center h-7 px-2 rounded border transition-all text-[10px] font-semibold tracking-wide uppercase ${
                  boardLoading
                    ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
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
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border transition-all text-[10px] font-semibold tracking-wide uppercase ${
                  controlsLocked
                    ? 'opacity-40 cursor-not-allowed border-[rgba(120,180,255,.18)] bg-[rgba(120,180,255,.06)] text-[#9DCAFF]'
                    : 'border-[rgba(120,180,255,.25)] bg-[rgba(120,180,255,.08)] text-[#9DCAFF] hover:bg-[rgba(120,180,255,.12)]'
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
                className="inline-flex items-center justify-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all text-[10px] font-semibold tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {(boardSaving || boardUpdatedAt || boardError) && (
            <div className="flex items-center gap-2">
              {boardSaving ? (
                <span className="text-[10px] text-[#9DCAFF]">Saving board…</span>
              ) : boardError ? (
                <span className="text-[10px] text-[var(--red)]" title={boardError}>
                  Sync error
                </span>
              ) : boardUpdatedAt ? (
                <span className="text-[10px] text-[var(--muted-dim)]" title={boardUpdatedAt}>
                  Saved {new Date(boardUpdatedAt).toLocaleString()}
                </span>
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

      <div className="flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(120,180,255,.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,0))]">
        <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden px-4 py-4">
          <div className="h-full min-h-0 w-max flex gap-4 items-stretch pr-4">
            {board.lanes.map((lane, laneIdx) => (
              <section
                key={lane.id}
                className="w-[320px] h-full min-h-0 rounded-[22px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02))] shadow-[0_20px_50px_rgba(0,0,0,.18)] overflow-hidden flex flex-col"
              >
                <div className="px-4 pt-4 pb-3 border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0))]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <input
                        value={lane.title}
                        onChange={(event) => updateLaneTitle(lane.id, event.target.value)}
                        disabled={controlsLocked}
                        placeholder={`Lane ${laneIdx + 1}`}
                        className={`w-full bg-transparent text-[13px] font-semibold placeholder:text-[var(--muted-dim)] focus:outline-none ${
                          controlsLocked ? 'text-[var(--muted)] opacity-70 cursor-not-allowed' : 'text-[var(--fg)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      />
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--muted-dim)]">
                        <span className="inline-flex items-center h-5 px-2 rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)]">
                          {cardCountLabel(lane.cards.length)}
                        </span>
                        {laneIdx === 0 ? (
                          <span className="inline-flex items-center h-5 px-2 rounded-full border border-[rgba(120,180,255,.2)] bg-[rgba(120,180,255,.08)] text-[#9DCAFF]">
                            Paste target
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLane(lane.id)}
                      disabled={controlsLocked || board.lanes.length <= 1}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-all ${
                        controlsLocked || board.lanes.length <= 1
                          ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[rgba(255,90,90,.35)] hover:bg-[rgba(255,90,90,.08)]'
                      }`}
                      title={controlsLocked ? 'Board is loading' : board.lanes.length <= 1 ? 'Keep at least one lane' : 'Delete lane'}
                    >
                      <IconTrash className="opacity-80" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
                  {lane.cards.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-4 py-5 text-center text-[11px] text-[var(--muted-dim)]">
                      <div style={{ fontFamily: 'var(--display)' }} className="uppercase tracking-wide text-[10px]">
                        Empty lane
                      </div>
                      <div className="mt-2">Add a task or paste plain text on the board background.</div>
                    </div>
                  ) : null}
                  {lane.cards.map((card) => (
                    <article
                      key={card.id}
                      className="rounded-[20px] border border-[rgba(255,255,255,.08)] bg-[linear-gradient(180deg,rgba(18,22,28,.92),rgba(18,22,28,.76))] px-3.5 py-3 shadow-[0_14px_30px_rgba(0,0,0,.18)]"
                    >
                      <input
                        value={card.title}
                        onChange={(event) => updateCard(lane.id, card.id, { title: event.target.value })}
                        disabled={controlsLocked}
                        placeholder="Task title"
                        className={`w-full bg-transparent text-[13px] font-semibold placeholder:text-[var(--muted-dim)] focus:outline-none ${
                          controlsLocked ? 'text-[var(--muted)] opacity-70 cursor-not-allowed' : 'text-[var(--fg)]'
                        }`}
                      />
                      <textarea
                        value={card.description}
                        onChange={(event) => updateCard(lane.id, card.id, { description: event.target.value })}
                        disabled={controlsLocked}
                        placeholder="Description"
                        rows={5}
                        className={`mt-2 w-full resize-none bg-transparent text-[11px] leading-5 placeholder:text-[var(--muted-dim)] focus:outline-none ${
                          controlsLocked ? 'text-[var(--muted-dim)] opacity-70 cursor-not-allowed' : 'text-[var(--muted)]'
                        }`}
                      />
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-dim)]">
                          <IconFolder className="w-3 h-3 opacity-40" />
                          {chatHeaderRepoPath ? 'Repo scoped' : 'No repo'}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCard(lane.id, card.id)}
                          disabled={controlsLocked}
                          className={`inline-flex items-center gap-1 h-6 px-2 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                            controlsLocked
                              ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[rgba(255,90,90,.35)] hover:bg-[rgba(255,90,90,.08)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                          title={controlsLocked ? 'Board is loading' : 'Delete task'}
                        >
                          <IconTrash className="opacity-80" />
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="px-3 pb-3 pt-1">
                  <button
                    type="button"
                    onClick={() => addCard(lane.id)}
                    disabled={controlsLocked}
                    className={`w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-[16px] border text-[11px] font-semibold tracking-wide uppercase transition-all ${
                      controlsLocked
                        ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    <IconPlus className="opacity-80" />
                    Add task
                  </button>
                </div>
              </section>
            ))}

            <button
              type="button"
              onClick={addLane}
              disabled={controlsLocked}
              className={`w-[220px] h-full min-h-[280px] rounded-[22px] border border-dashed transition-all flex flex-col items-center justify-center gap-3 ${
                controlsLocked
                  ? 'opacity-40 cursor-not-allowed border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01))] text-[var(--muted-dim)]'
                  : 'border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01))] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--accent-muted)] hover:bg-[rgba(120,180,255,.05)]'
              }`}
            >
              <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)]">
                <IconPlus className="w-4 h-4" />
              </span>
              <div className="text-center px-4">
                <div className="text-[11px] font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  Add lane
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted-dim)]">Create another swim lane for a new phase of work.</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
