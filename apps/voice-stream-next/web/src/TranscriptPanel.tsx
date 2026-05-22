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
    <section className="panel transcript-panel">
      <div className="panel-heading">
        <div>
          <h2>Transcripts</h2>
          <p>
            {filtered.length} of {transcripts.length} final transcripts grouped by voice session.
          </p>
        </div>
        <button type="button" onClick={() => void copyVisibleTranscripts()} disabled={filtered.length === 0}>
          Copy Visible
        </button>
      </div>

      <div className="transcript-toolbar">
        <label>
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
        <label>
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
        <label className="transcript-search">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter transcript text..."
          />
        </label>
      </div>

      <div className="transcript-list">
        {groups.map((group) => (
          <article key={group.voiceSessionId} className="transcript-session">
            <header className="transcript-session-header">
              <div>
                <strong>{group.deviceName || group.deviceId}</strong>
                <span>
                  {group.mode} / {group.transcripts.length} transcript{group.transcripts.length === 1 ? '' : 's'}
                </span>
                <span>
                  {timeLabel(group.sessionStartedAt)}
                  {group.sessionEndedAt ? ` - ${timeLabel(group.sessionEndedAt)}` : ' - active'}
                </span>
              </div>
              <div className="transcript-session-actions">
                {group.assistantThreadId ? (
                  <button type="button" className="link-button" onClick={() => onOpenThread(group.assistantThreadId)}>
                    Open {threadTitle(group.assistantThreadId)}
                  </button>
                ) : null}
              </div>
            </header>
            <div className="transcript-session-body">
              {group.transcripts.map((transcript) => (
                <article key={transcript.id} className="transcript-row">
                  <div>
                    <span>{timeLabel(transcript.createdAt)}</span>
                    <span className="transcript-mode-pill">{transcript.mode}</span>
                  </div>
                  <p>{transcript.text}</p>
                </article>
              ))}
            </div>
          </article>
        ))}
        {groups.length === 0 ? (
          <div className="empty-note">
            {transcripts.length === 0 ? 'No transcripts yet.' : 'No transcripts match the current filters.'}
          </div>
        ) : null}
      </div>
    </section>
  );
}
