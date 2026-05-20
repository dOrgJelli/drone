import React from 'react';

import {
  subscribeAssistantDesktopVoiceStatus,
  type DesktopAssistantVoiceStatus,
} from './desktop-assistant-voice';

const DEFAULT_STATUS: DesktopAssistantVoiceStatus = {
  mode: 'off',
  message: 'Desktop voice is off.',
};

function indicatorLabel(status: DesktopAssistantVoiceStatus): string {
  switch (status.mode) {
    case 'dormant':
      return 'Desktop voice sleeping';
    case 'sleeping':
      return 'Desktop voice awake';
    case 'recording':
      return 'Desktop voice recording';
    case 'transcribing':
      return 'Desktop voice transcribing';
    case 'locked':
      return 'Desktop voice locked';
    case 'error':
      return 'Desktop voice error';
    default:
      return 'Desktop voice active';
  }
}

export function DesktopVoiceFloatingIndicator() {
  const [status, setStatus] = React.useState<DesktopAssistantVoiceStatus>(DEFAULT_STATUS);

  React.useEffect(() => subscribeAssistantDesktopVoiceStatus(setStatus), []);

  if (status.mode === 'off' || status.mode === 'error') return null;

  const sleeping = status.mode === 'dormant';
  const locked = status.mode === 'locked';
  const busy = status.mode === 'recording' || status.mode === 'transcribing';
  const awake = !sleeping && !locked;

  return (
    <div
      className="pointer-events-none flex flex-col items-center gap-1"
      title={status.message || indicatorLabel(status)}
      aria-label={indicatorLabel(status)}
      role="status"
    >
      <div
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 ${
          sleeping
            ? 'border-[rgba(148,163,184,.42)] bg-[rgba(148,163,184,.08)] text-[var(--muted)]'
            : locked
              ? 'border-[rgba(251,191,36,.45)] bg-[rgba(251,191,36,.1)] text-[rgb(251,191,36)] shadow-[0_0_18px_rgba(251,191,36,.18)]'
              : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_22px_rgba(45,212,191,.34)]'
        }`}
      >
        {awake ? (
          <span
            className={`absolute inset-0 rounded-full bg-[var(--accent)] opacity-25 ${busy ? 'animate-ping' : 'animate-pulse'}`}
            aria-hidden="true"
          />
        ) : null}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="relative h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
          <path d="M8 21h8" />
        </svg>
      </div>
      <div
        className="rounded-full border border-[var(--border-subtle)] bg-[rgba(0,0,0,.28)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] backdrop-blur-sm"
        style={{ fontFamily: 'var(--display)' }}
      >
        {sleeping ? 'Sleep' : locked ? 'Locked' : busy ? 'Live' : 'Voice'}
      </div>
    </div>
  );
}
