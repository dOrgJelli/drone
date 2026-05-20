import React from 'react';
import { AssistantDock } from './AssistantDock';
import { DesktopVoiceFloatingIndicator } from './DesktopVoiceFloatingIndicator';

const FLOATING_ASSISTANT_OPEN_STORAGE_KEY = 'droneHub.assistant.floatingOpen';

function readInitialOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(FLOATING_ASSISTANT_OPEN_STORAGE_KEY) === '1';
}

export function FloatingAssistantDock({ embeddedVisible }: { embeddedVisible: boolean }) {
  const [open, setOpen] = React.useState(readInitialOpen);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FLOATING_ASSISTANT_OPEN_STORAGE_KEY, open ? '1' : '0');
  }, [open]);

  if (embeddedVisible) return null;

  if (!open) {
    return (
      <div className="absolute bottom-4 right-4 z-30 flex flex-col items-end gap-2.5 pointer-events-auto">
        <DesktopVoiceFloatingIndicator />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 rounded border border-[var(--accent-muted)] bg-[var(--panel-alt)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)] shadow-[0_16px_40px_rgba(0,0,0,.35)] hover:bg-[var(--accent-subtle)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Open global assistant"
        >
          Assistant
        </button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 right-4 z-30 flex h-[min(720px,calc(100%-2rem))] w-[min(440px,calc(100%-2rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_70px_rgba(0,0,0,.48)] pointer-events-auto">
      <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-[var(--border)] bg-[rgba(255,255,255,.025)] px-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
          Global Assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Minimize assistant"
        >
          Minimize
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AssistantDock />
      </div>
    </div>
  );
}
