import React from 'react';
import { IconChevron, IconSpinner } from './icons';
import type { DroneHubTask } from './drone-hub-task-parser';

type SpawnTaskResult = {
  ok: boolean;
  error?: string | null;
};

type DroneHubTaskListProps = {
  tasks: DroneHubTask[];
  onSpawnTask: (task: DroneHubTask) => Promise<SpawnTaskResult>;
};

export function DroneHubTaskList({ tasks, onSpawnTask }: DroneHubTaskListProps) {
  const taskKeys = React.useMemo(
    () => tasks.map((task, index) => `${index}:${task.name}:${task.description}`),
    [tasks],
  );
  const [expandedByKey, setExpandedByKey] = React.useState<Record<string, boolean>>({});
  const [spawningByKey, setSpawningByKey] = React.useState<Record<string, boolean>>({});
  const [spawnedByKey, setSpawnedByKey] = React.useState<Record<string, boolean>>({});
  const [errorByKey, setErrorByKey] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const activeKeys = new Set(taskKeys);
    setExpandedByKey((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const key of taskKeys) {
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
          next[key] = Boolean(prev[key]);
        } else if (taskKeys.length === 1) {
          next[key] = true;
          changed = true;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
      return next;
    });
    setSpawningByKey((prev) => pruneTaskState(prev, activeKeys));
    setSpawnedByKey((prev) => pruneTaskState(prev, activeKeys));
    setErrorByKey((prev) => pruneTaskState(prev, activeKeys));
  }, [taskKeys]);

  const toggleExpanded = React.useCallback((taskKey: string) => {
    setExpandedByKey((prev) => ({
      ...prev,
      [taskKey]: !Boolean(prev[taskKey]),
    }));
  }, []);

  const spawnTask = React.useCallback(
    async (taskKey: string, task: DroneHubTask) => {
      if (spawningByKey[taskKey]) return;
      setSpawningByKey((prev) => ({ ...prev, [taskKey]: true }));
      setErrorByKey((prev) => ({ ...prev, [taskKey]: '' }));
      try {
        const result = await onSpawnTask(task);
        if (!result?.ok) {
          setSpawnedByKey((prev) => ({ ...prev, [taskKey]: false }));
          setErrorByKey((prev) => ({ ...prev, [taskKey]: String(result?.error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.' }));
          return;
        }
        setSpawnedByKey((prev) => ({ ...prev, [taskKey]: true }));
      } catch (error: any) {
        setSpawnedByKey((prev) => ({ ...prev, [taskKey]: false }));
        setErrorByKey((prev) => ({ ...prev, [taskKey]: String(error?.message ?? error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.' }));
      } finally {
        setSpawningByKey((prev) => ({ ...prev, [taskKey]: false }));
      }
    },
    [onSpawnTask, spawningByKey],
  );

  if (tasks.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] overflow-hidden">
      <div
        className="px-3 py-2 border-b border-[var(--border-subtle)] text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--muted-dim)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        Drone tasks
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {tasks.map((task, index) => {
          const taskKey = taskKeys[index] ?? `${index}`;
          const expanded = Boolean(expandedByKey[taskKey]);
          const spawning = Boolean(spawningByKey[taskKey]);
          const spawned = Boolean(spawnedByKey[taskKey]);
          const error = String(errorByKey[taskKey] ?? '').trim();
          return (
            <div key={taskKey} className="group/task">
              <div className="flex items-start gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleExpanded(taskKey)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={expanded}
                  title={expanded ? 'Collapse task details' : 'Expand task details'}
                >
                  <div className="flex items-center gap-2">
                    <IconChevron down={expanded} className="w-3 h-3 text-[var(--muted)]" />
                    <span className="truncate text-[13px] font-medium text-[var(--fg)]">{task.name}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void spawnTask(taskKey, task);
                  }}
                  disabled={spawning}
                  className={`inline-flex items-center justify-center h-7 px-2.5 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                    spawning || spawned
                      ? 'opacity-100'
                      : 'opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100'
                  } ${
                    spawned
                      ? 'border-[var(--accent-muted)] bg-[rgba(0,0,0,.24)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
                  } ${spawning ? 'cursor-wait' : ''}`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={spawned ? 'Clone queued' : 'Spawn a clone from this drone for this task'}
                >
                  {spawning ? (
                    <span className="inline-flex items-center gap-1.5">
                      <IconSpinner className="w-3 h-3 text-[var(--accent)]" />
                      Queuing
                    </span>
                  ) : spawned ? (
                    'Queued'
                  ) : (
                    'Spawn clone'
                  )}
                </button>
              </div>
              {expanded ? (
                <div className="px-3 pb-3">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[12px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap">
                    {task.description}
                  </div>
                </div>
              ) : null}
              {error ? <div className="px-3 pb-3 text-[11px] text-[var(--red)]">{error}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pruneTaskState<T>(state: Record<string, T>, activeKeys: Set<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!activeKeys.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : state;
}
