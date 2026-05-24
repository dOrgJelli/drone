import React from 'react';
import type { AssistantThread, DeviceRecord, TranscriptRecord, TranscriptSessionGroup } from './dashboardTypes.js';
import { timeLabel } from './time.js';

function groupTranscriptsBySession(transcripts: TranscriptRecord[]): TranscriptSessionGroup[] {
  const groups = new Map<string, TranscriptSessionGroup>();
  for (const transcript of transcripts) {
    const existing = groups.get(transcript.voiceSessionId);
    if (existing) {
      existing.transcripts.push(transcript);
      continue;
    }
    groups.set(transcript.voiceSessionId, {
      voiceSessionId: transcript.voiceSessionId,
      assistantThreadId: transcript.assistantThreadId,
      deviceId: transcript.deviceId,
      deviceName: transcript.deviceName,
      mode: transcript.mode,
      sessionStartedAt: transcript.sessionStartedAt,
      sessionEndedAt: transcript.sessionEndedAt,
      transcripts: [transcript],
    });
  }
  return [...groups.values()].sort(
    (left, right) => Date.parse(right.sessionStartedAt) - Date.parse(left.sessionStartedAt),
  );
}

export function TranscriptPanel({
  transcripts,
  devices,
  threads,
  onOpenThread,
}: {
  transcripts: TranscriptRecord[];
  devices: DeviceRecord[];
  threads: AssistantThread[];
  onOpenThread: (threadId: string) => void;
}) {
  const [deviceFilter, setDeviceFilter] = React.useState('all');
  const [modeFilter, setModeFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transcripts.filter((transcript) => {
      if (deviceFilter !== 'all' && transcript.deviceId !== deviceFilter) return false;
      if (modeFilter !== 'all' && transcript.mode !== modeFilter) return false;
      if (!needle) return true;
      return (
        transcript.text.toLowerCase().includes(needle) ||
        transcript.deviceName.toLowerCase().includes(needle) ||
        transcript.mode.toLowerCase().includes(needle)
      );
    });
  }, [deviceFilter, modeFilter, query, transcripts]);

  const groups = React.useMemo(() => groupTranscriptsBySession(filtered), [filtered]);
  const modes = React.useMemo(
    () => [...new Set(transcripts.map((transcript) => transcript.mode).filter(Boolean))].sort(),
    [transcripts],
  );

  async function copyVisibleTranscripts() {
    const text = filtered
      .map((transcript) => `[${transcript.createdAt}] ${transcript.deviceName || transcript.deviceId} ${transcript.mode}: ${transcript.text}`)
      .join('\n');
    await navigator.clipboard?.writeText(text);
  }

  function threadTitle(threadId: string): string {
    return threads.find((thread) => thread.id === threadId)?.title ?? 'Voice thread';
  }

  return (
    <section className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-3 text-[var(--fg-secondary)] shadow-none">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 mt-0.5 text-[15px] font-bold leading-tight text-[var(--fg)]">Transcripts</h2>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            {filtered.length} of {transcripts.length} final transcripts grouped by voice session.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-[30px] items-center justify-center rounded border border-[var(--border)] bg-white/[.035] px-2.5 font-display text-[10px] font-semibold uppercase text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.36)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void copyVisibleTranscripts()}
          disabled={filtered.length === 0}
        >
          Copy Visible
        </button>
      </div>

      <div className="mb-3 grid grid-cols-[180px_160px_minmax(220px,1fr)] gap-2.5 max-[620px]:grid-cols-1">
        <label className="grid gap-1.5 text-[10px] font-extrabold uppercase leading-tight text-[var(--muted)]">
          Device
          <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
            <option value="all">All devices</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[10px] font-extrabold uppercase leading-tight text-[var(--muted)]">
          Mode
          <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
            <option value="all">All modes</option>
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[10px] font-extrabold uppercase leading-tight text-[var(--muted)]">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter transcript text..."
          />
        </label>
      </div>

      <div className="grid max-h-none gap-2 rounded border border-[var(--border-subtle)] bg-white/[.018] p-2">
        {groups.map((group) => (
          <article key={group.voiceSessionId} className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-white/[.02]">
            <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border-subtle)] bg-[rgba(74,222,128,.06)] p-3 max-[620px]:grid-cols-1">
              <div className="grid min-w-0 gap-1">
                <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{group.deviceName || group.deviceId}</strong>
                <span className="text-xs text-[var(--muted)]">
                  {group.mode} / {group.transcripts.length} transcript{group.transcripts.length === 1 ? '' : 's'}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {timeLabel(group.sessionStartedAt)}
                  {group.sessionEndedAt ? ` - ${timeLabel(group.sessionEndedAt)}` : ' - active'}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-[7px]">
                {group.assistantThreadId ? (
                  <button
                    type="button"
                    className="inline-flex min-h-[30px] items-center justify-center rounded border border-[var(--border)] bg-white/[.035] px-2.5 font-display text-[10px] font-semibold uppercase text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.36)] hover:text-[var(--fg)]"
                    onClick={() => onOpenThread(group.assistantThreadId)}
                  >
                    Open {threadTitle(group.assistantThreadId)}
                  </button>
                ) : null}
              </div>
            </header>
            <div className="grid gap-2 p-2">
              {group.transcripts.map((transcript) => (
                <article key={transcript.id} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 rounded-[7px] border border-[var(--border-subtle)] bg-white/[.025] p-2 text-[var(--fg-secondary)] max-[620px]:grid-cols-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-xs text-[var(--muted)]">{timeLabel(transcript.createdAt)}</span>
                    <span className="w-fit rounded border border-[rgba(74,222,128,.22)] bg-[var(--green-subtle)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--green)]">{transcript.mode}</span>
                  </div>
                  <p className="m-0 min-w-0 text-xs leading-relaxed text-[var(--fg-secondary)]">{transcript.text}</p>
                </article>
              ))}
            </div>
          </article>
        ))}
        {groups.length === 0 ? (
          <div className="p-2.5 text-xs text-[var(--muted)]">
            {transcripts.length === 0 ? 'No transcripts yet.' : 'No transcripts match the current filters.'}
          </div>
        ) : null}
      </div>
    </section>
  );
}
