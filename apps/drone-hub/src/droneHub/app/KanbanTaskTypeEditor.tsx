import React from 'react';
import type { KanbanTaskType } from './kanban-board-state';
import { IconPlus } from './icons';

type KanbanTaskTypeEditorProps = {
  taskTypes: KanbanTaskType[];
  onAddTaskType: () => void;
  onUpdateTaskType: (taskTypeId: string, patch: Partial<KanbanTaskType>) => void;
  onRemoveTaskType: (taskTypeId: string) => void;
};

export function KanbanTaskTypeEditor({
  taskTypes,
  onAddTaskType,
  onUpdateTaskType,
  onRemoveTaskType,
}: KanbanTaskTypeEditorProps) {
  return (
    <div className="px-6 pb-4">
      <div className="rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] text-[var(--muted)]">Task types drive board filters and task organization.</div>
          <button
            type="button"
            onClick={onAddTaskType}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] transition-all hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            <IconPlus className="opacity-80" />
            Type
          </button>
        </div>
        <div className="space-y-2">
          {taskTypes.map((taskType) => (
            <div key={taskType.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <input
                value={taskType.label}
                onChange={(event) => onUpdateTaskType(taskType.id, { label: event.target.value })}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
              />
              <button
                type="button"
                onClick={() => onUpdateTaskType(taskType.id, { active: taskType.active === false })}
                className={`inline-flex h-8 items-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  taskType.active === false
                    ? 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(157,202,255,.18)] text-[#CBE2FF]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {taskType.active === false ? 'Inactive' : 'Active'}
              </button>
              <button
                type="button"
                onClick={() => onRemoveTaskType(taskType.id)}
                disabled={taskTypes.length <= 1}
                className={`inline-flex h-8 items-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  taskTypes.length <= 1
                    ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                    : 'bg-[var(--red-subtle)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
