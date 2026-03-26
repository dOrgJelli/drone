import React from 'react';
import { timeAgo } from '../../domain';
import type { PlaybookDefinition, PlaybookRunQueueSummary } from '../types';
import { IconChevron, IconSpinner, IconTrash } from './icons';

const PLAYBOOK_RUN_BATCH_MIN = 1;
const PLAYBOOK_RUN_BATCH_MAX = 50;

export function playbookRunsRepoLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'All repos';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function normalizePlaybookRunLaunchCount(raw: string): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return PLAYBOOK_RUN_BATCH_MIN;
  return Math.max(PLAYBOOK_RUN_BATCH_MIN, Math.min(PLAYBOOK_RUN_BATCH_MAX, value));
}

function queuedCountLabel(count: number): string {
  return `${count} queued`;
}

type PlaybookRunLaunchControlsProps = {
  selectedPlaybook: PlaybookDefinition | null;
  selectedRepoPath: string;
  totalQueuedCount: number;
  launchCountInput: string;
  normalizedLaunchCount: number;
  serializeFirstMessageGroup: boolean;
  runDisabled: boolean;
  runDisabledReason: string;
  onLaunchCountInputChange: (value: string) => void;
  onToggleSerializeFirstMessageGroup: () => void;
  onRun: () => void;
};

export function PlaybookRunLaunchControls({
  selectedPlaybook,
  selectedRepoPath,
  totalQueuedCount,
  launchCountInput,
  normalizedLaunchCount,
  serializeFirstMessageGroup,
  runDisabled,
  runDisabledReason,
  onLaunchCountInputChange,
  onToggleSerializeFirstMessageGroup,
  onRun,
}: PlaybookRunLaunchControlsProps) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.018)] px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted-dim)]">
          <span className="font-semibold text-[var(--fg)] truncate">{selectedPlaybook?.label || 'No playbook selected'}</span>
          <span className="text-[var(--border)]">·</span>
          <span>{selectedRepoPath ? playbookRunsRepoLabel(selectedRepoPath) : 'No repo selected'}</span>
          {totalQueuedCount > 0 ? (
            <>
              <span className="text-[var(--border)]">·</span>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                {queuedCountLabel(totalQueuedCount)}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)]">
            <span className="font-medium">Serialize startup</span>
            <button
              type="button"
              role="switch"
              aria-checked={serializeFirstMessageGroup}
              onClick={onToggleSerializeFirstMessageGroup}
              className={`relative inline-flex h-4.5 w-8 shrink-0 rounded-full border transition-all ${
                serializeFirstMessageGroup
                  ? 'border-[var(--accent-muted)] bg-[rgba(167,139,250,.18)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.04)]'
              }`}
            >
              <span
                className={`absolute top-[1px] h-3 w-3 rounded-full bg-[var(--fg)] transition-all ${
                  serializeFirstMessageGroup ? 'left-[16px]' : 'left-[1px]'
                }`}
              />
            </button>
          </label>

          <label className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)]">
            <span className="font-medium">Count</span>
            <input
              type="number"
              min={PLAYBOOK_RUN_BATCH_MIN}
              max={PLAYBOOK_RUN_BATCH_MAX}
              step={1}
              value={launchCountInput}
              onChange={(event) => onLaunchCountInputChange(event.target.value)}
              className="h-7 w-[68px] rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-right text-[12px] font-semibold text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
              style={{ fontFamily: 'var(--code)' }}
            />
          </label>

          <span className="inline-flex" title={runDisabledReason}>
            <button
              type="button"
              onClick={onRun}
              disabled={runDisabled}
              className={`h-8 px-3 rounded-md text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                runDisabled
                  ? 'opacity-30 cursor-not-allowed bg-[rgba(255,255,255,.04)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.04)] border-[var(--border)] text-[var(--fg)] hover:bg-[rgba(255,255,255,.08)] hover:border-[var(--accent-muted)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {serializeFirstMessageGroup || normalizedLaunchCount > 1 ? 'Queue' : 'Run'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function queueStateClass(state: PlaybookRunQueueSummary['state']): string {
  if (state === 'error') return 'border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)] text-[var(--red)]';
  if (state === 'launching') return 'border-[rgba(74,222,128,.18)] bg-[rgba(74,222,128,.08)] text-[var(--green)]';
  if (state === 'waiting') return 'border-[rgba(251,191,36,.18)] bg-[rgba(251,191,36,.08)] text-[rgb(245,196,77)]';
  return 'border-[rgba(167,139,250,.16)] bg-[rgba(167,139,250,.08)] text-[var(--accent)]';
}

function queueStateLabel(item: PlaybookRunQueueSummary): string {
  if (item.state === 'error') return 'Error';
  if (item.state === 'launching') return `Launching ${item.inFlightCount}`;
  if (item.state === 'waiting') return 'Waiting';
  return 'Queued';
}

type PlaybookRunQueueSectionProps = {
  queue: PlaybookRunQueueSummary[];
  selectedPlaybookLabel: string | null;
  selectedRepoPath: string;
  nowMs: number;
  actionBusyByKey: Record<string, true>;
  onClearQueuedRuns: () => void;
  onRemoveQueuedRun: (queueItemId: string) => void;
};

export function PlaybookRunQueueSection({
  queue,
  selectedPlaybookLabel,
  selectedRepoPath,
  nowMs,
  actionBusyByKey,
  onClearQueuedRuns,
  onRemoveQueuedRun,
}: PlaybookRunQueueSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(255,255,255,.04)]">
          <IconChevron down className="opacity-50" />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]" style={{ fontFamily: 'var(--display)' }}>
          Launch Queue
        </div>
        <span className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-0.5 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
          {queue.length}
        </span>
        <span className="text-[10px] text-[var(--muted-dim)]">
          {selectedPlaybookLabel || 'All playbooks'} · {selectedRepoPath ? playbookRunsRepoLabel(selectedRepoPath) : 'All repos'}
        </span>
        <div className="flex-1 h-px bg-[linear-gradient(90deg,var(--border-subtle),transparent)]" />
        {queue.length > 0 ? (
          <button
            type="button"
            onClick={onClearQueuedRuns}
            disabled={Boolean(actionBusyByKey['queue:clear'])}
            className={`h-8 px-3 rounded-lg text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              actionBusyByKey['queue:clear']
                ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.06)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)] hover:border-[rgba(255,90,90,.25)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {actionBusyByKey['queue:clear'] ? 'Clearing…' : 'Clear Visible'}
          </button>
        ) : null}
      </div>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.01)] px-6 py-6 text-center">
          <div className="text-[12px] text-[var(--muted)]">No queued launches</div>
          <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
            Batch requests and serial launches will show up here until they start.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {queue.map((item) => {
            const busyKey = `queue:${item.id}`;
            return (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.018)] px-3 py-3 shadow-[0_10px_22px_rgba(0,0,0,.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[12px] font-semibold text-[var(--fg)] truncate">{item.playbookLabel}</div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${queueStateClass(item.state)}`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {queueStateLabel(item)}
                      </span>
                      {item.serializeFirstMessageGroup ? (
                        <span
                          className="rounded-full border border-[rgba(251,191,36,.18)] bg-[rgba(251,191,36,.08)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[rgb(245,196,77)]"
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Serial
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                      {playbookRunsRepoLabel(item.repoPath)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveQueuedRun(item.id)}
                    disabled={Boolean(actionBusyByKey[busyKey])}
                    className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-all ${
                      actionBusyByKey[busyKey]
                        ? 'opacity-40 cursor-not-allowed bg-transparent border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,90,90,.06)] border-[rgba(255,90,90,.15)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)] hover:border-[rgba(255,90,90,.25)]'
                    }`}
                    title={actionBusyByKey[busyKey] ? 'Removing queued launches…' : 'Remove remaining queued launches'}
                  >
                    {actionBusyByKey[busyKey] ? <IconSpinner className="opacity-80" /> : <IconTrash className="opacity-80" />}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Requested
                    </div>
                    <div className="mt-1 text-[16px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--code)' }}>
                      {item.requestedCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Started
                    </div>
                    <div className="mt-1 text-[16px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--code)' }}>
                      {item.launchedCount + item.inFlightCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Remaining
                    </div>
                    <div className="mt-1 text-[16px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--code)' }}>
                      {item.remainingCount}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-[10px] leading-relaxed text-[var(--muted-dim)]">
                  Added {timeAgo(item.createdAt, nowMs)}.
                  {item.serializeFirstMessageGroup
                    ? ' Waiting only on the startup prompt group for the next launch.'
                    : ' Launches start as soon as the backend drains the queue.'}
                </div>
                {item.error ? (
                  <div className="mt-2 rounded-lg border border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[10px] leading-relaxed text-[var(--red)]">
                    {item.error}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
