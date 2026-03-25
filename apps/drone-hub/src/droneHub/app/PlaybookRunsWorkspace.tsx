import React from 'react';
import { timeAgo } from '../../domain';
import { requestJson } from '../http';
import type { PlaybookDefinition, PlaybookRunSummary } from '../types';
import { fetchJson, useNowMs, usePoll } from './hooks';
import { IconBoard, IconChevron, IconSpinner, IconTrash } from './icons';
import { normalizePlaybookArtifactPath } from './playbook-config';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { playbookArtifactKey, usePlaybookArtifactAvailability } from './use-playbook-artifact-availability';

type PlaybookRunsWorkspaceProps = {
  initialRepoPath: string;
  registeredRepoPaths: string[];
  pullHostBranchBeforeCreate: boolean;
  onClose: () => void;
  onOpenPlaybookSettings: (playbookId: string) => void;
  onDeleteRunDrone: (droneId: string) => Promise<void>;
  deletingDrones: Record<string, boolean>;
  onOpenRun: (droneId: string, chatName: string) => void;
  onOpenArtifact: (droneId: string, chatName: string, path: string, name: string) => void;
};

function repoLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'All repos';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function runCountLabel(count: number): string {
  return `${count} run${count === 1 ? '' : 's'}`;
}

export function PlaybookRunsWorkspace({
  initialRepoPath,
  registeredRepoPaths,
  pullHostBranchBeforeCreate,
  onClose,
  onOpenPlaybookSettings,
  onDeleteRunDrone,
  deletingDrones,
  onOpenRun,
  onOpenArtifact,
}: PlaybookRunsWorkspaceProps) {
  const playbookRunsSelectionInitialized = useDroneHubUiStore((s) => s.playbookRunsSelectionInitialized);
  const setPlaybookRunsSelectionInitialized = useDroneHubUiStore((s) => s.setPlaybookRunsSelectionInitialized);
  const selectedPlaybookId = useDroneHubUiStore((s) => s.playbookRunsSelectedPlaybookId);
  const setStoredSelectedPlaybookId = useDroneHubUiStore((s) => s.setPlaybookRunsSelectedPlaybookId);
  const selectedRepoPath = useDroneHubUiStore((s) => s.playbookRunsSelectedRepoPath);
  const setStoredSelectedRepoPath = useDroneHubUiStore((s) => s.setPlaybookRunsSelectedRepoPath);
  const [launchPendingCountById, setLaunchPendingCountById] = React.useState<Record<string, number>>({});
  const [actionBusyByKey, setActionBusyByKey] = React.useState<Record<string, true>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [expandedSummaryByRunId, setExpandedSummaryByRunId] = React.useState<Record<string, true>>({});
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  const initialRepoPathNormalized = React.useMemo(() => String(initialRepoPath ?? '').trim(), [initialRepoPath]);

  const setSelectedPlaybookId = React.useCallback(
    (next: string | ((current: string) => string)) => {
      setPlaybookRunsSelectionInitialized(true);
      setStoredSelectedPlaybookId(next);
    },
    [setPlaybookRunsSelectionInitialized, setStoredSelectedPlaybookId],
  );

  const setSelectedRepoPath = React.useCallback(
    (next: string | ((current: string) => string)) => {
      setPlaybookRunsSelectionInitialized(true);
      setStoredSelectedRepoPath(next);
    },
    [setPlaybookRunsSelectionInitialized, setStoredSelectedRepoPath],
  );

  React.useEffect(() => {
    if (playbookRunsSelectionInitialized) return;
    if (!initialRepoPathNormalized) return;
    setStoredSelectedRepoPath(initialRepoPathNormalized);
    setPlaybookRunsSelectionInitialized(true);
  }, [
    initialRepoPathNormalized,
    playbookRunsSelectionInitialized,
    setPlaybookRunsSelectionInitialized,
    setStoredSelectedRepoPath,
  ]);

  React.useEffect(() => {
    if (!selectedRepoPath) return;
    if (registeredRepoPaths.length === 0) return;
    if (registeredRepoPaths.includes(selectedRepoPath)) return;
    setSelectedRepoPath('');
  }, [registeredRepoPaths, selectedRepoPath]);

  const runsQuery = React.useMemo(() => `?refresh=${refreshNonce}`, [refreshNonce]);

  const { value: playbooksResp, error: playbooksError, loading: playbooksLoading } = usePoll<{ ok: true; playbooks: PlaybookDefinition[] }>(
    () => fetchJson('/api/playbooks'),
    5000,
    [],
  );
  const { value: runsResp, error: runsError, loading: runsLoading } = usePoll<{ ok: true; runs: PlaybookRunSummary[] }>(
    () => fetchJson(`/api/playbook-runs${runsQuery}`),
    2000,
    [runsQuery],
  );
  const nowMs = useNowMs(30_000, true);

  const playbooks = Array.isArray(playbooksResp?.playbooks) ? playbooksResp.playbooks : [];
  const runs = Array.isArray(runsResp?.runs) ? runsResp.runs : [];
  const artifactAvailabilityByKey = usePlaybookArtifactAvailability({ runs });

  React.useEffect(() => {
    if (playbooksLoading) return;
    if (!selectedPlaybookId) return;
    if (playbooks.some((playbook) => playbook.id === selectedPlaybookId)) return;
    setSelectedPlaybookId('');
  }, [playbooks, playbooksLoading, selectedPlaybookId, setSelectedPlaybookId]);

  const selectedPlaybook = React.useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooks, selectedPlaybookId],
  );
  const runsForSelectedRepo = React.useMemo(
    () => (selectedRepoPath ? runs.filter((run) => run.repoPath === selectedRepoPath) : runs),
    [runs, selectedRepoPath],
  );
  const playbookRunCountById = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const run of runsForSelectedRepo) next[run.playbookId] = (next[run.playbookId] ?? 0) + 1;
    return next;
  }, [runsForSelectedRepo]);
  const runsForSelectedPlaybook = React.useMemo(
    () => (selectedPlaybookId ? runs.filter((run) => run.playbookId === selectedPlaybookId) : runs),
    [runs, selectedPlaybookId],
  );
  const repoRunCountByPath = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const run of runsForSelectedPlaybook) next[run.repoPath] = (next[run.repoPath] ?? 0) + 1;
    return next;
  }, [runsForSelectedPlaybook]);
  const filteredRuns = React.useMemo(
    () =>
      runs.filter(
        (run) =>
          (!selectedPlaybookId || run.playbookId === selectedPlaybookId) &&
          (!selectedRepoPath || run.repoPath === selectedRepoPath),
      ),
    [runs, selectedPlaybookId, selectedRepoPath],
  );
  const selectedPlaybookPendingLaunchCount = selectedPlaybook ? launchPendingCountById[selectedPlaybook.id] ?? 0 : 0;
  const runDisabled = !selectedPlaybook || !selectedRepoPath;
  const runDisabledReason = !selectedPlaybook
    ? 'Select a playbook to launch.'
    : !selectedRepoPath
      ? 'Select a repo to launch the selected playbook.'
      : selectedPlaybookPendingLaunchCount > 0
        ? `Starting ${selectedPlaybookPendingLaunchCount} run${selectedPlaybookPendingLaunchCount === 1 ? '' : 's'}. Click again to queue another.`
        : 'Run the selected playbook.';

  const runPlaybook = React.useCallback(
    async (playbook: PlaybookDefinition) => {
      if (!selectedRepoPath) {
        setActionError('Choose a repo before launching a playbook.');
        return;
      }
      setLaunchPendingCountById((prev) => ({
        ...prev,
        [playbook.id]: (prev[playbook.id] ?? 0) + 1,
      }));
      setActionError(null);
      setRefreshNonce((prev) => prev + 1);
      try {
        await requestJson(`/api/playbooks/${encodeURIComponent(playbook.id)}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath: selectedRepoPath,
            pullHostBranchBeforeCreate,
          }),
        });
        setRefreshNonce((prev) => prev + 1);
      } catch (e: any) {
        setActionError(e?.message ?? String(e));
      } finally {
        setLaunchPendingCountById((prev) => {
          const current = prev[playbook.id] ?? 0;
          if (current <= 1) {
            const next = { ...prev };
            delete next[playbook.id];
            return next;
          }
          const next = { ...prev };
          next[playbook.id] = current - 1;
          return next;
        });
      }
    },
    [pullHostBranchBeforeCreate, selectedRepoPath],
  );

  const sendRunAction = React.useCallback(async (run: PlaybookRunSummary, action: PlaybookDefinition['actions'][number]) => {
    const key = `${run.id}:${action.id}`;
    setActionBusyByKey((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      for (const prompt of action.messages) {
        await requestJson(`/api/drones/${encodeURIComponent(run.droneId)}/chats/${encodeURIComponent(run.chatName)}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
      }
      setRefreshNonce((prev) => prev + 1);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
    } finally {
      setActionBusyByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, []);

  const toggleRunSummary = React.useCallback((runId: string) => {
    setExpandedSummaryByRunId((prev) => {
      if (prev[runId]) {
        const next = { ...prev };
        delete next[runId];
        return next;
      }
      return { ...prev, [runId]: true };
    });
  }, []);

  const statusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'running' || s === 'active' || s === 'streaming') return 'dh-run-status-badge--running';
    if (s === 'error' || s === 'failed') return 'dh-run-status-badge--error';
    if (s === 'completed' || s === 'done' || s === 'finished') return 'dh-run-status-badge--completed';
    return 'dh-run-status-badge--idle';
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8 flex flex-col gap-5">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,.12)]">
          <div className="relative border-b border-[var(--border)] overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(167,139,250,.05)_0%,transparent_50%)]" />
            <div className="dh-noise relative px-6 py-5 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(167,139,250,.1)] text-[var(--accent)]">
                    <IconBoard className="opacity-80" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                    Playbook Runs
                  </div>
                </div>
                <p className="text-[12px] text-[var(--muted)] mt-2 max-w-[64ch] leading-relaxed">
                  Launch repo-scoped runs, monitor status in real-time, and jump into any run chat directly.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded-lg text-[10px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Back
              </button>
            </div>
            <div className="dh-accent-bar" />
          </div>

          {(actionError || playbooksError || runsError) && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-[rgba(255,90,90,.2)] bg-[rgba(255,90,90,.06)] px-4 py-2.5 text-[11px] text-[var(--red)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" />
              {actionError || playbooksError || runsError}
            </div>
          )}

          <div className="px-5 py-5 flex flex-col gap-6">
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(255,255,255,.04)]">
                  <IconBoard className="opacity-50" />
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]" style={{ fontFamily: 'var(--display)' }}>
                  Launch
                </div>
                <div className="flex-1 h-px bg-[linear-gradient(90deg,var(--border-subtle),transparent)]" />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)] gap-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Playbooks
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1 leading-relaxed">
                        Select to focus runs and enable launch.
                      </div>
                    </div>
                    {playbooksLoading ? (
                      <div className="px-4 py-6 flex flex-col items-center gap-2 text-center">
                        <IconSpinner className="text-[var(--accent)] opacity-60" />
                        <div className="text-[11px] text-[var(--muted-dim)]">Loading playbooks...</div>
                      </div>
                    ) : playbooks.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          No playbooks yet.<br />Create one in <strong className="text-[var(--muted)]">Settings &gt; Playbooks</strong>.
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => setSelectedPlaybookId('')}
                          aria-pressed={selectedPlaybookId === ''}
                          className={`dh-selection-card w-full px-4 py-3.5 text-left border-b border-[var(--border-subtle)] ${
                            selectedPlaybookId === '' ? 'is-active' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[12px] font-semibold text-[var(--fg)]">All playbooks</div>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1">Show runs for every playbook.</div>
                            </div>
                            <div className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]" style={{ fontFamily: 'var(--code)' }}>
                              {runsForSelectedRepo.length}
                            </div>
                          </div>
                        </button>
                        {playbooks.map((playbook) => {
                          const active = selectedPlaybookId === playbook.id;
                          const pendingLaunchCount = launchPendingCountById[playbook.id] ?? 0;
                          return (
                            <div
                              key={playbook.id}
                              className="flex items-stretch border-b border-[var(--border-subtle)] last:border-b-0"
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedPlaybookId((current) => (current === playbook.id ? '' : playbook.id))}
                                aria-pressed={active}
                                className={`dh-selection-card flex-1 px-4 py-3.5 text-left ${active ? 'is-active' : ''}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="text-[12px] font-semibold text-[var(--fg)]">{playbook.label || 'Untitled playbook'}</div>
                                      {pendingLaunchCount > 0 && (
                                        <span className="flex items-center gap-1 rounded-md bg-[rgba(74,222,128,.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--green)]" style={{ fontFamily: 'var(--display)' }}>
                                          <span className="h-1 w-1 rounded-full bg-[var(--green)] animate-pulse-dot" />
                                          Starting {pendingLaunchCount}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-[var(--muted-dim)] mt-1" style={{ fontFamily: 'var(--code)' }}>
                                      {playbook.messages.length} msg{playbook.messages.length === 1 ? '' : 's'}
                                      {playbook.actions.length > 0 ? ` · ${playbook.actions.length} action${playbook.actions.length === 1 ? '' : 's'}` : ''}
                                    </div>
                                  </div>
                                  <div className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]" style={{ fontFamily: 'var(--code)' }}>
                                    {playbookRunCountById[playbook.id] ?? 0}
                                  </div>
                                </div>
                                <div className="mt-2 text-[11px] text-[var(--muted-dim)] whitespace-pre-wrap line-clamp-2 leading-relaxed">
                                  {playbook.messages[0]?.prompt ?? 'No prompt yet.'}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenPlaybookSettings(playbook.id)}
                                className={`shrink-0 px-3.5 flex items-center text-[10px] font-semibold uppercase tracking-wide border-l transition-all ${
                                  active
                                    ? 'border-[rgba(167,139,250,.15)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.08)]'
                                    : 'border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.03)] hover:text-[var(--fg-secondary)]'
                                }`}
                                style={{ fontFamily: 'var(--display)' }}
                                title={`Open "${playbook.label || 'Untitled playbook'}" in Settings > Playbooks`}
                              >
                                Edit
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Repos
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1 leading-relaxed">
                        Pick a repo to filter runs and set launch target.
                      </div>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedRepoPath('')}
                        aria-pressed={selectedRepoPath === ''}
                        className={`dh-selection-card w-full px-4 py-3.5 text-left border-b border-[var(--border-subtle)] ${
                          selectedRepoPath === '' ? 'is-active' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold text-[var(--fg)]">All repos</div>
                            <div className="text-[10px] text-[var(--muted-dim)] mt-1">Show runs across every registered repo.</div>
                          </div>
                          <div className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]" style={{ fontFamily: 'var(--code)' }}>
                            {runsForSelectedPlaybook.length}
                          </div>
                        </div>
                      </button>
                      {registeredRepoPaths.map((repoPath) => {
                        const active = selectedRepoPath === repoPath;
                        return (
                          <button
                            key={repoPath}
                            type="button"
                            onClick={() => setSelectedRepoPath((current) => (current === repoPath ? '' : repoPath))}
                            aria-pressed={active}
                            className={`dh-selection-card w-full px-4 py-3.5 text-left border-b border-[var(--border-subtle)] last:border-b-0 ${
                              active ? 'is-active' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold text-[var(--fg)]">{repoLabel(repoPath)}</div>
                                <div className="mt-1 truncate text-[10px] text-[var(--muted-dim)]" title={repoPath} style={{ fontFamily: 'var(--code)' }}>
                                  {repoPath}
                                </div>
                              </div>
                              <div className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]" style={{ fontFamily: 'var(--code)' }}>
                                {repoRunCountByPath[repoPath] ?? 0}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] p-5 flex flex-col gap-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Current Selection
                    </div>
                    <div className="text-[11px] text-[var(--muted)] mt-1">
                      Configure and launch your next run.
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] overflow-hidden">
                    <div className="px-4 py-3.5 border-b border-[var(--border-subtle)]">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Playbook
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--fg)] mt-1">
                        {selectedPlaybook?.label || <span className="text-[var(--muted-dim)] italic font-normal">None selected</span>}
                      </div>
                      <div className="text-[11px] text-[var(--muted-dim)] mt-1.5 whitespace-pre-wrap line-clamp-2 leading-relaxed">
                        {selectedPlaybook
                          ? selectedPlaybook.messages[0]?.prompt || 'No prompt yet.'
                          : 'Pick a playbook row to enable launch.'}
                      </div>
                    </div>
                    <div className="px-4 py-3.5">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Repo
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--fg)] mt-1">
                        {selectedRepoPath ? repoLabel(selectedRepoPath) : <span className="text-[var(--muted-dim)] italic font-normal">None selected</span>}
                      </div>
                      <div className="text-[10px] text-[var(--muted-dim)] mt-1" title={selectedRepoPath || undefined} style={{ fontFamily: 'var(--code)' }}>
                        {selectedRepoPath || 'Pick a repo row to set the launch target.'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-auto">
                    <span className="inline-flex" title={runDisabledReason}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPlaybook) void runPlaybook(selectedPlaybook);
                        }}
                        disabled={runDisabled}
                        className={`h-10 px-5 rounded-lg text-[10px] font-semibold tracking-wide uppercase transition-all ${
                          runDisabled
                            ? 'opacity-30 cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)]'
                            : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 animate-accent-glow shadow-[0_2px_12px_rgba(167,139,250,.2)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {selectedPlaybook ? `Run ${selectedPlaybook.label || 'Playbook'}` : 'Run Playbook'}
                      </button>
                    </span>
                    {selectedPlaybook && (
                      <button
                        type="button"
                        onClick={() => onOpenPlaybookSettings(selectedPlaybook.id)}
                        className="h-10 px-4 rounded-lg text-[10px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        Edit Playbook
                      </button>
                    )}
                  </div>
                  {runDisabled && <div className="text-[10px] text-[var(--muted-dim)] leading-relaxed">{runDisabledReason}</div>}
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(255,255,255,.04)]">
                  <IconChevron down className="opacity-50" />
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]" style={{ fontFamily: 'var(--display)' }}>
                  Active Runs
                </div>
                <span className="rounded-md bg-[rgba(255,255,255,.05)] px-2 py-0.5 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                  {filteredRuns.length}
                </span>
                <span className="text-[10px] text-[var(--muted-dim)]">
                  {selectedPlaybook?.label || 'All playbooks'} · {selectedRepoPath ? repoLabel(selectedRepoPath) : 'All repos'}
                </span>
                <div className="flex-1 h-px bg-[linear-gradient(90deg,var(--border-subtle),transparent)]" />
              </div>
              {runsLoading ? (
                <div className="flex items-center gap-2 px-1 py-4 text-[11px] text-[var(--muted-dim)]">
                  <IconSpinner className="text-[var(--accent)] opacity-60" />
                  Loading runs...
                </div>
              ) : filteredRuns.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.01)] px-6 py-8 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(255,255,255,.04)]">
                    <IconBoard className="opacity-30" />
                  </div>
                  <div className="text-[12px] text-[var(--muted)]">No runs found</div>
                  <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                    {selectedPlaybook?.label || 'the current playbook filter'} in{' '}
                    {selectedRepoPath ? repoLabel(selectedRepoPath) : 'the current repo filter'}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <table className="dh-runs-table w-full min-w-[920px] text-left">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                        <th className="px-4 py-3 font-semibold">Run</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Summary</th>
                        <th className="px-4 py-3 font-semibold">Updated</th>
                        <th className="px-4 py-3 font-semibold">Actions</th>
                        <th className="px-4 py-3 font-semibold">Artifacts</th>
                        <th className="px-4 py-3 font-semibold w-[60px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((run) => {
                        const summaryExpanded = Boolean(expandedSummaryByRunId[run.id]);
                        const deleteBusy = Boolean(deletingDrones[run.droneId]);
                        return (
                          <tr key={run.id} className="border-t border-[var(--border-subtle)] align-top">
                            <td className="px-4 py-3.5">
                              <button
                                type="button"
                                onClick={() => onOpenRun(run.droneId, run.chatName)}
                                className="text-[12px] font-semibold text-[var(--accent)] hover:underline decoration-[var(--accent-muted)] underline-offset-2"
                                title={`Open "${run.playbookLabel}"`}
                              >
                                {run.playbookLabel}
                              </button>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1" style={{ fontFamily: 'var(--code)' }}>{repoLabel(run.repoPath)}</div>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className={`dh-run-status-badge ${statusClass(run.status)}`}>
                                {run.status}
                              </div>
                              {run.statusError && (
                                <div className="mt-2 rounded-md bg-[rgba(255,90,90,.06)] px-2 py-1 text-[10px] text-[var(--red)] max-w-[180px] leading-relaxed">
                                  {run.statusError}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3.5 max-w-[320px]">
                              <button
                                type="button"
                                onClick={() => toggleRunSummary(run.id)}
                                className="block w-full text-left"
                                title={summaryExpanded ? 'Collapse summary' : 'Expand summary'}
                              >
                                <div
                                  className={`text-[11px] text-[var(--fg-secondary)] whitespace-pre-wrap leading-relaxed ${summaryExpanded ? '' : 'line-clamp-2'}`}
                                >
                                  {run.lastMessage || <span className="italic text-[var(--muted-dim)]">No output yet.</span>}
                                </div>
                              </button>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="text-[11px] text-[var(--fg-secondary)]" style={{ fontFamily: 'var(--code)' }}>
                                {timeAgo(run.updatedAt, nowMs)}
                              </div>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-0.5" style={{ fontFamily: 'var(--code)' }}>
                                {run.runsCompleted} completed
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex flex-wrap gap-1.5 max-w-[260px]">
                                {run.actions.map((action) => {
                                  const busyKey = `${run.id}:${action.id}`;
                                  return (
                                    <button
                                      key={action.id}
                                      type="button"
                                      onClick={() => void sendRunAction(run, action)}
                                      disabled={Boolean(actionBusyByKey[busyKey])}
                                      className={`h-7 px-2.5 rounded-md text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                        actionBusyByKey[busyKey]
                                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                          : 'bg-[rgba(255,255,255,.03)] border-[var(--border-subtle)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[rgba(167,139,250,.06)] hover:text-[var(--accent)]'
                                      }`}
                                      style={{ fontFamily: 'var(--display)' }}
                                      title={`${action.messages.length} queued message${action.messages.length === 1 ? '' : 's'}`}
                                    >
                                      {actionBusyByKey[busyKey] ? <IconSpinner className="inline mr-1 opacity-60" /> : null}
                                      {action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex flex-wrap gap-1.5 max-w-[280px]">
                                {run.artifacts.map((artifactPath) => {
                                  const normalizedArtifact = normalizePlaybookArtifactPath(artifactPath);
                                  if (!normalizedArtifact) return null;
                                  const availability = artifactAvailabilityByKey[playbookArtifactKey(run.id, normalizedArtifact)];
                                  if (!availability?.exists) return null;
                                  return (
                                    <button
                                      key={normalizedArtifact}
                                      type="button"
                                      onClick={() => onOpenArtifact(run.droneId, run.chatName, availability.path, availability.name)}
                                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold tracking-wide border bg-[rgba(74,222,128,.04)] border-[rgba(74,222,128,.15)] text-[var(--green)] hover:bg-[rgba(74,222,128,.1)] hover:border-[rgba(74,222,128,.25)]"
                                      title={availability.path}
                                      style={{ fontFamily: 'var(--code)' }}
                                    >
                                      {availability.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <button
                                type="button"
                                onClick={() => void onDeleteRunDrone(run.droneId)}
                                disabled={deleteBusy}
                                className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-all ${
                                  deleteBusy
                                    ? 'opacity-40 cursor-not-allowed bg-transparent border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                    : 'bg-[rgba(255,90,90,.06)] border-[rgba(255,90,90,.15)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)] hover:border-[rgba(255,90,90,.25)]'
                                }`}
                                title={deleteBusy ? `Removing "${run.droneName}"...` : `Delete or archive "${run.droneName}"`}
                                aria-label={deleteBusy ? `Removing "${run.droneName}"` : `Delete or archive "${run.droneName}"`}
                              >
                                {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-80" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
