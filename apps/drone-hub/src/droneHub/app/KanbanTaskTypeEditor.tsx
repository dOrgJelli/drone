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
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Task Types</div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)]">Organize board filters and task categorization.</div>
          </div>
          <button
            type="button"
            onClick={onAddTaskType}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(167,139,250,.2)] bg-[rgba(167,139,250,.06)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] transition-all hover:bg-[rgba(167,139,250,.12)] hover:border-[rgba(167,139,250,.3)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            <IconPlus className="opacity-80" />
            Type
          </button>
        </div>
        <div className="space-y-px">
          {taskTypes.map((taskType, idx) => (
            <div key={taskType.id} className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 ${idx % 2 === 0 ? 'bg-[rgba(255,255,255,.015)]' : ''}`}>
              <input
                value={taskType.label}
                onChange={(event) => onUpdateTaskType(taskType.id, { label: event.target.value })}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] focus:bg-[rgba(0,0,0,.25)]"
              />
              <button
                type="button"
                onClick={() => onUpdateTaskType(taskType.id, { active: taskType.active === false })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  taskType.active === false
                    ? 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)]'
                    : 'border border-[rgba(74,222,128,.2)] bg-[rgba(74,222,128,.08)] text-[var(--green)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${taskType.active === false ? 'bg-[var(--muted-dim)]' : 'bg-[var(--green)]'}`} />
                {taskType.active === false ? 'Off' : 'On'}
              </button>
              <button
                type="button"
                onClick={() => onRemoveTaskType(taskType.id)}
                disabled={taskTypes.length <= 1}
                className={`inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  taskTypes.length <= 1
                    ? 'cursor-not-allowed bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-30'
                    : 'border border-[rgba(255,90,90,.15)] bg-[rgba(255,90,90,.06)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)] hover:border-[rgba(255,90,90,.25)]'
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
