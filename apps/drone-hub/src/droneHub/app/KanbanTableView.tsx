import React from 'react';
import type { KanbanBoardState, KanbanCard, KanbanLane } from './kanban-board-state';
import { IconTrash } from './icons';

type FlatTask = {
  card: KanbanCard;
  lane: KanbanLane;
  laneIndex: number;
};

type KanbanTableViewProps = {
  board: KanbanBoardState;
  controlsLocked: boolean;
  taskTypeLabelById: Record<string, string>;
  laneAccent: (index: number) => string;
  onOpenCard: (laneId: string, cardId: string) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

function formatShortDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export function KanbanTableView({
  board,
  controlsLocked,
  taskTypeLabelById,
  laneAccent,
  onOpenCard,
  onRemoveCard,
}: KanbanTableViewProps) {
  const rows: FlatTask[] = React.useMemo(() => {
    const out: FlatTask[] = [];
    for (let i = 0; i < board.lanes.length; i++) {
      const lane = board.lanes[i]!;
      for (const card of lane.cards) {
        out.push({ card, lane, laneIndex: i });
      }
    }
    return out;
  }, [board.lanes]);

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted-dim)]">
        No tasks yet. Add tasks via the lane controls or paste text.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
      <table className="dh-task-table w-full">
        <thead>
          <tr>
            <th className="text-left">Task</th>
            <th className="text-left w-[120px]">Lane</th>
            <th className="text-left w-[100px]">Type</th>
            <th className="text-left w-[90px]">Created</th>
            <th className="text-left w-[90px]">Updated</th>
            <th className="w-[44px]" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, lane, laneIndex }) => {
            const accent = laneAccent(laneIndex);
            return (
              <tr
                key={`${lane.id}:${card.id}`}
                onClick={() => onOpenCard(lane.id, card.id)}
                className={controlsLocked ? 'opacity-60' : 'cursor-pointer'}
              >
                <td>
                  <span className="text-[12.5px] font-medium text-[var(--fg)] leading-snug">
                    {card.title || 'Untitled task'}
                  </span>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                    <span className="inline-block h-[7px] w-[7px] rounded-sm shrink-0" style={{ backgroundColor: accent }} />
                    <span className="truncate max-w-[90px]">{lane.title || 'Untitled'}</span>
                  </span>
                </td>
                <td>
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-[rgba(255,255,255,.04)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-dim)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    <span className="inline-block h-1 w-1 rounded-full bg-[var(--accent-muted)] opacity-50" />
                    {taskTypeLabelById[card.typeId] ?? card.typeId}
                  </span>
                </td>
                <td>
                  <span className="text-[10px] text-[var(--muted-dim)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {formatShortDate(card.createdAt)}
                  </span>
                </td>
                <td>
                  <span className="text-[10px] text-[var(--muted-dim)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {formatShortDate(card.updatedAt)}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCard(lane.id, card.id);
                    }}
                    disabled={controlsLocked}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all ${
                      controlsLocked
                        ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-20'
                        : 'text-[var(--muted-dim)] opacity-0 group-hover/row:opacity-100 hover:bg-[rgba(255,90,90,.12)] hover:text-[var(--red)]'
                    }`}
                    title={controlsLocked ? 'Board is loading' : 'Delete task'}
                  >
                    <IconTrash className="opacity-80" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
