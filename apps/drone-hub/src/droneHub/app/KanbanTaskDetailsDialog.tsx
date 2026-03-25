import React from 'react';
import type { KanbanCard, KanbanTaskType } from './kanban-board-state';

type KanbanTaskDetailsDialogProps = {
  card: KanbanCard | null;
  laneTitle: string | null;
  taskTypes: KanbanTaskType[];
  controlsLocked: boolean;
  creatorDroneAvailable: boolean;
  onClose: () => void;
  onUpdate: (patch: { title?: string; description?: string; typeId?: string }) => void;
  onDelete: () => void;
  onOpenCreatorDrone: () => void;
};

export function KanbanTaskDetailsDialog({
  card,
  laneTitle,
  taskTypes,
  controlsLocked,
  creatorDroneAvailable,
  onClose,
  onUpdate,
  onDelete,
  onOpenCreatorDrone,
}: KanbanTaskDetailsDialogProps) {
  if (!card) return null;
  const activeTaskTypes = taskTypes.filter((item) => item.active !== false || item.id === card.typeId);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(5,8,13,.62)] px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Task details"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[720px] rounded-[24px] border border-[rgba(255,255,255,.08)] bg-[rgba(18,21,27,.96)] shadow-[0_32px_120px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Task details
            </div>
            {laneTitle ? <div className="mt-1 text-[11px] text-[var(--muted)]">Lane: {laneTitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)] transition-all hover:bg-[rgba(255,255,255,.04)] hover:text-[var(--fg)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_180px]">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-[var(--muted-dim)]">Title</label>
              <input
                type="text"
                value={card.title}
                onChange={(event) => onUpdate({ title: event.target.value })}
                disabled={controlsLocked}
                placeholder="Task title"
                className="h-10 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.22)] px-3 text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-[var(--muted-dim)]">Task type</label>
              <select
                value={card.typeId}
                onChange={(event) => onUpdate({ typeId: event.target.value })}
                disabled={controlsLocked}
                className="h-10 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.22)] px-3 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {activeTaskTypes.map((taskType) => (
                  <option key={taskType.id} value={taskType.id}>
                    {taskType.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-[var(--muted-dim)]">Description</label>
            <textarea
              value={card.description}
              onChange={(event) => onUpdate({ description: event.target.value })}
              disabled={controlsLocked}
              placeholder="Task details"
              rows={10}
              className="min-h-[220px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.22)] px-3 py-3 text-[12px] leading-6 text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Metadata
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-[var(--muted)] sm:grid-cols-2">
              <div>Created: {card.createdAt || 'Unknown'}</div>
              <div>Updated: {card.updatedAt || 'Unknown'}</div>
              <div>Playbook: {card.playbookLabel || 'Unknown'}</div>
              <div>Creator: {card.droneName || 'Unknown'}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2">
            {creatorDroneAvailable ? (
              <button
                type="button"
                onClick={onOpenCreatorDrone}
                className="inline-flex h-9 items-center justify-center rounded-full px-4 text-[10px] font-semibold uppercase tracking-wide bg-[rgba(157,202,255,.14)] text-[#CBE2FF] transition-all hover:bg-[rgba(157,202,255,.22)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Open creator drone
              </button>
            ) : card.droneName ? (
              <div className="text-[11px] text-[var(--muted-dim)]">Creator drone is no longer available.</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={controlsLocked}
            className="inline-flex h-9 items-center justify-center rounded-full px-4 text-[10px] font-semibold uppercase tracking-wide bg-[var(--red-subtle)] text-[var(--red)] transition-all hover:bg-[rgba(255,90,90,.18)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Delete task
          </button>
        </div>
      </div>
    </div>
  );
}
