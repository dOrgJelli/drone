import React from 'react';
import { timeAgo } from '../../domain';
import type { PlaybookDefinition, PlaybookRunQueueSummary } from '../types';
import { IconChevron, IconSpinner, IconTrash } from './icons';

const PLAYBOOK_RUN_BATCH_MIN = 1;
const PLAYBOOK_RUN_BATCH_MAX = 50;
const PLAYBOOK_RUN_BATCH_PRESETS = [1, 2, 3, 10];

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
  onEditSelectedPlaybook: () => void;
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
  onEditSelectedPlaybook,
}: PlaybookRunLaunchControlsProps) {
  return (
    <div className="rounded-xl border border-[rgba(167,139,250,.14)] bg-[linear-gradient(180deg,rgba(167,139,250,.055),rgba(255,255,255,.02))] px-3 py-3.5">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(10,12,16,.28)] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)] shrink-0" style={{ fontFamily: 'var(--display)' }}>
                  Playbook
                </span>
                <span className="text-[11px] font-semibold text-[var(--fg)] truncate">
                  {selectedPlaybook?.label || <span className="text-[var(--muted-dim)] font-normal">—</span>}
                </span>
              </div>
              <span className="text-[var(--border)] shrink-0">·</span>
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)] shrink-0" style={{ fontFamily: 'var(--display)' }}>
                  Repo
                </span>
                <span className="text-[11px] font-semibold text-[var(--fg)] truncate">
                  {selectedRepoPath ? playbookRunsRepoLabel(selectedRepoPath) : <span className="text-[var(--muted-dim)] font-normal">—</span>}
                </span>
              </div>
              {totalQueuedCount > 0 ? (
                <>
                  <span className="text-[var(--border)] shrink-0">·</span>
                  <span className="rounded-full border border-[rgba(251,191,36,.18)] bg-[rgba(251,191,36,.08)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[rgb(245,196,77)]" style={{ fontFamily: 'var(--display)' }}>
                    {queuedCountLabel(totalQueuedCount)}
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {PLAYBOOK_RUN_BATCH_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onLaunchCountInputChange(String(value))}
                  className={`h-7 min-w-[34px] rounded-lg border px-2 text-[10px] font-semibold tracking-wide transition-all ${
                    normalizedLaunchCount === value
                      ? 'border-[rgba(167,139,250,.28)] bg-[rgba(167,139,250,.12)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:text-[var(--fg)]'
                  }`}
                  style={{ fontFamily: 'var(--code)' }}
                >
                  {value}
                </button>
              ))}
              <div className="ml-1 text-[10px] text-[var(--muted-dim)]">Batch size presets</div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(10,12,16,.28)] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Launch Count
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted-dim)]">Queue 1 to {PLAYBOOK_RUN_BATCH_MAX} runs.</div>
              </div>
              <input
                type="number"
                min={PLAYBOOK_RUN_BATCH_MIN}
                max={PLAYBOOK_RUN_BATCH_MAX}
                step={1}
                value={launchCountInput}
                onChange={(event) => onLaunchCountInputChange(event.target.value)}
                className="h-11 w-[92px] rounded-xl border border-[rgba(167,139,250,.18)] bg-[rgba(0,0,0,.22)] px-3 text-right text-[20px] font-semibold text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                style={{ fontFamily: 'var(--code)' }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1 gap-3 min-w-[280px]">
          <button
            type="button"
            role="switch"
            aria-checked={serializeFirstMessageGroup}
            onClick={onToggleSerializeFirstMessageGroup}
            className={`group rounded-xl border px-3 py-3 text-left transition-all ${
              serializeFirstMessageGroup
                ? 'border-[rgba(251,191,36,.24)] bg-[linear-gradient(135deg,rgba(251,191,36,.12),rgba(255,255,255,.02))]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] hover:border-[rgba(167,139,250,.18)] hover:bg-[rgba(167,139,250,.045)]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Serial Start
                </div>
                <div className="mt-1 text-[11px] font-semibold text-[var(--fg)]">
                  Wait for the initial playbook message set before launching the next queued run.
                </div>
                <div className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted-dim)]">
                  Follow-up action buttons do not block the queue. Only the startup message group counts.
                </div>
              </div>
              <span
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full border transition-all ${
                  serializeFirstMessageGroup
                    ? 'border-[rgba(251,191,36,.32)] bg-[rgba(251,191,36,.22)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.04)]'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-4.5 w-4.5 rounded-full bg-white/90 shadow-[0_2px_10px_rgba(0,0,0,.28)] transition-all ${
                    serializeFirstMessageGroup ? 'left-[22px]' : 'left-[2px]'
                  }`}
                />
              </span>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex" title={runDisabledReason}>
              <button
                type="button"
                onClick={onRun}
                disabled={runDisabled}
                className={`h-11 px-5 rounded-xl text-[10px] font-semibold tracking-[0.08em] uppercase transition-all ${
                  runDisabled
                    ? 'opacity-30 cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)]'
                    : serializeFirstMessageGroup || normalizedLaunchCount > 1
                      ? 'bg-[linear-gradient(135deg,rgba(251,191,36,.95),rgba(167,139,250,.96))] text-[rgba(19,15,11,.92)] hover:brightness-105 shadow-[0_8px_22px_rgba(167,139,250,.18)]'
                      : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 shadow-[0_2px_8px_rgba(167,139,250,.18)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {serializeFirstMessageGroup || normalizedLaunchCount > 1 ? 'Queue Runs' : 'Run'}
              </button>
            </span>
            {selectedPlaybook ? (
              <button
                type="button"
                onClick={onEditSelectedPlaybook}
                className="h-11 px-3 rounded-xl text-[10px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Edit
              </button>
            ) : null}
          </div>
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
