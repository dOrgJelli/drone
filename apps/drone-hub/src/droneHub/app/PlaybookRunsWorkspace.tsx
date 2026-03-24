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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8 flex flex-col gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                Playbooks
              </div>
              <div className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                Runs
              </div>
              <p className="text-[12px] text-[var(--muted)] mt-1 max-w-[72ch]">
                Launch repo-scoped hidden runs, watch their status, and open any run chat directly.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Back
            </button>
          </div>

          {(actionError || playbooksError || runsError) && (
            <div className="px-5 py-3 border-b border-[var(--border)] text-[11px] text-[var(--red)] bg-[var(--red-subtle)]">
              {actionError || playbooksError || runsError}
            </div>
          )}

          <div className="px-5 py-4 flex flex-col gap-4">
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconBoard className="opacity-70" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Launch
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)] gap-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Playbooks
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1">
                        Select a playbook row to focus the runs table and enable launch.
                      </div>
                    </div>
                    {playbooksLoading ? (
                      <div className="px-3 py-3 text-[11px] text-[var(--muted-dim)]">Loading playbooks...</div>
                    ) : playbooks.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] text-[var(--muted-dim)]">
                        No playbooks yet. Create one in Settings &gt; Playbooks.
                      </div>
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => setSelectedPlaybookId('')}
                          aria-pressed={selectedPlaybookId === ''}
                          className={`w-full px-3 py-3 text-left transition-colors ${
                            selectedPlaybookId === '' ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'hover:bg-[var(--hover)] text-[var(--fg)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[12px] font-semibold">All playbooks</div>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1">Show runs for every playbook.</div>
                            </div>
                            <div className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
                              {runCountLabel(runsForSelectedRepo.length)}
                            </div>
                          </div>
                        </button>
                        {playbooks.map((playbook) => {
                          const active = selectedPlaybookId === playbook.id;
                          const pendingLaunchCount = launchPendingCountById[playbook.id] ?? 0;
                          return (
                            <div
                              key={playbook.id}
                              className={`flex items-stretch border-t ${
                                active ? 'border-[var(--accent-muted)]' : 'border-[var(--border-subtle)]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedPlaybookId((current) => (current === playbook.id ? '' : playbook.id))}
                                aria-pressed={active}
                                className={`flex-1 px-3 py-3 text-left transition-colors ${
                                  active ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg)] hover:bg-[var(--hover)]'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[12px] font-semibold">{playbook.label || 'Untitled playbook'}</div>
                                    <div className="text-[10px] text-[var(--muted-dim)] mt-1">
                                      {playbook.messages.length} run message{playbook.messages.length === 1 ? '' : 's'}
                                      {playbook.actions.length > 0 ? ` • ${playbook.actions.length} action button${playbook.actions.length === 1 ? '' : 's'}` : ''}
                                      {pendingLaunchCount > 0 ? ` • starting ${pendingLaunchCount}` : ''}
                                    </div>
                                  </div>
                                  <div className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
                                    {runCountLabel(playbookRunCountById[playbook.id] ?? 0)}
                                  </div>
                                </div>
                                <div className="mt-2 text-[11px] text-[var(--muted-dim)] whitespace-pre-wrap line-clamp-2">
                                  {playbook.messages[0]?.prompt ?? 'No prompt yet.'}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenPlaybookSettings(playbook.id)}
                                className={`shrink-0 px-3 text-[10px] font-semibold uppercase tracking-wide border-l transition-colors ${
                                  active
                                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-105'
                                    : 'border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
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

                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Repos
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1">
                        Select a repo row to filter runs and choose the launch target.
                      </div>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedRepoPath('')}
                        aria-pressed={selectedRepoPath === ''}
                        className={`w-full px-3 py-3 text-left transition-colors ${
                          selectedRepoPath === '' ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'hover:bg-[var(--hover)] text-[var(--fg)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold">All repos</div>
                            <div className="text-[10px] text-[var(--muted-dim)] mt-1">Show runs across every registered repo.</div>
                          </div>
                          <div className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
                            {runCountLabel(runsForSelectedPlaybook.length)}
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
                            className={`w-full px-3 py-3 text-left transition-colors border-t ${
                              active
                                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--fg)]'
                                : 'border-[var(--border-subtle)] bg-transparent text-[var(--fg)] hover:bg-[var(--hover)]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold">{repoLabel(repoPath)}</div>
                                <div className="mt-1 truncate text-[10px] text-[var(--muted-dim)]" title={repoPath}>
                                  {repoPath}
                                </div>
                              </div>
                              <div className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
                                {runCountLabel(repoRunCountByPath[repoPath] ?? 0)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 flex flex-col gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Current Selection
                    </div>
                    <div className="text-[11px] text-[var(--muted)] mt-1">
                      Use the selected playbook and repo for the next launch.
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 flex flex-col gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Playbook
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--fg)] mt-1">
                        {selectedPlaybook?.label || 'No playbook selected'}
                      </div>
                      <div className="text-[11px] text-[var(--muted-dim)] mt-1 whitespace-pre-wrap line-clamp-3">
                        {selectedPlaybook
                          ? selectedPlaybook.messages[0]?.prompt || 'No prompt yet.'
                          : 'Pick a playbook row to focus the run list and enable the launch button.'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                        Repo
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--fg)] mt-1">
                        {selectedRepoPath ? repoLabel(selectedRepoPath) : 'No repo selected'}
                      </div>
                      <div className="text-[11px] text-[var(--muted-dim)] mt-1" title={selectedRepoPath || undefined}>
                        {selectedRepoPath || 'Pick a repo row to set the launch target. "All repos" keeps the table broad but does not launch.'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex" title={runDisabledReason}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPlaybook) void runPlaybook(selectedPlaybook);
                        }}
                        disabled={runDisabled}
                        className={`h-9 px-4 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                          runDisabled
                            ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                            : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {selectedPlaybook ? `Run ${selectedPlaybook.label || 'Playbook'}` : 'Run Selected Playbook'}
                      </button>
                    </span>
                    {selectedPlaybook && (
                      <button
                        type="button"
                        onClick={() => onOpenPlaybookSettings(selectedPlaybook.id)}
                        className="h-9 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        Edit Playbook
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--muted-dim)]">{runDisabledReason}</div>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconChevron down className="opacity-70" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Current Runs
                </div>
                <div className="text-[10px] text-[var(--muted-dim)]">
                  {selectedPlaybook?.label || 'All playbooks'} • {selectedRepoPath ? repoLabel(selectedRepoPath) : 'All repos'}
                </div>
              </div>
              {runsLoading ? (
                <div className="text-[11px] text-[var(--muted-dim)]">Loading runs...</div>
              ) : filteredRuns.length === 0 ? (
                <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
                  No playbook runs for {selectedPlaybook?.label || 'the current playbook filter'} in{' '}
                  {selectedRepoPath ? repoLabel(selectedRepoPath) : 'the current repo filter'}.
                </div>
              ) : (
                <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
                  <table className="w-full min-w-[920px] text-left">
                    <thead className="bg-[rgba(255,255,255,.03)]">
                      <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                        <th className="px-3 py-2 font-semibold">Run</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Summary</th>
                        <th className="px-3 py-2 font-semibold">Updated</th>
                        <th className="px-3 py-2 font-semibold">Actions</th>
                        <th className="px-3 py-2 font-semibold">Artifacts</th>
                        <th className="px-3 py-2 font-semibold">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((run) => {
                        const summaryExpanded = Boolean(expandedSummaryByRunId[run.id]);
                        const deleteBusy = Boolean(deletingDrones[run.droneId]);
                        return (
                          <tr key={run.id} className="border-t border-[var(--border-subtle)] align-top">
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => onOpenRun(run.droneId, run.chatName)}
                                className="text-[12px] font-semibold text-[var(--accent)] hover:underline"
                                title={`Open "${run.playbookLabel}"`}
                              >
                                {run.playbookLabel}
                              </button>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1">{repoLabel(run.repoPath)}</div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="inline-flex items-center rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
                                {run.status}
                              </div>
                              {run.statusError && <div className="text-[10px] text-[var(--red)] mt-2 max-w-[180px]">{run.statusError}</div>}
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => toggleRunSummary(run.id)}
                                className="block w-full text-left"
                                title={summaryExpanded ? 'Collapse summary' : 'Expand summary'}
                              >
                                <div
                                  className={`text-[11px] text-[var(--fg-secondary)] whitespace-pre-wrap ${summaryExpanded ? '' : 'line-clamp-3'}`}
                                >
                                  {run.lastMessage || 'No assistant output yet.'}
                                </div>
                              </button>
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-[11px] text-[var(--fg-secondary)]">
                                {timeAgo(run.updatedAt, nowMs)}
                                <span className="text-[var(--muted-dim)]"> ({run.runsCompleted})</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2 max-w-[260px]">
                                {run.actions.map((action) => {
                                  const busyKey = `${run.id}:${action.id}`;
                                  return (
                                    <button
                                      key={action.id}
                                      type="button"
                                      onClick={() => void sendRunAction(run, action)}
                                      disabled={Boolean(actionBusyByKey[busyKey])}
                                      className={`h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                        actionBusyByKey[busyKey]
                                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                                      }`}
                                      style={{ fontFamily: 'var(--display)' }}
                                      title={`${action.messages.length} queued message${action.messages.length === 1 ? '' : 's'}`}
                                    >
                                      {action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2 max-w-[280px]">
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
                                      className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                                      title={availability.path}
                                    >
                                      {availability.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => void onDeleteRunDrone(run.droneId)}
                                disabled={deleteBusy}
                                className={`h-8 w-8 inline-flex items-center justify-center rounded border transition-all ${
                                  deleteBusy
                                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                    : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                                }`}
                                title={deleteBusy ? `Removing "${run.droneName}"...` : `Delete or archive "${run.droneName}"`}
                                aria-label={deleteBusy ? `Removing "${run.droneName}"` : `Delete or archive "${run.droneName}"`}
                              >
                                {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
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
