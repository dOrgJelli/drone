import { playLocalVoiceCue, type LocalVoiceCue } from './local-voice-cues';

export type DesktopAssistantVoiceMode = 'off' | 'locked' | 'sleeping' | 'recording' | 'transcribing' | 'error';

export type DesktopAssistantVoiceStatus = {
  ok?: true;
  mode: DesktopAssistantVoiceMode;
  message: string;
  updatedAt?: string;
  level?: number;
  lastApprovalCode?: string;
  supportsWakeWords?: boolean;
  recognizer?: {
    active: boolean;
    backend: string | null;
    error: string | null;
    text?: string | null;
    finalText?: string | null;
    textFinal?: boolean;
    textUpdatedAt?: string | null;
  };
  transcript?: {
    active: boolean;
    status: 'idle' | 'collecting' | 'transcribing' | 'error';
    text: string;
    error: string | null;
    updatedAt: string | null;
  };
  capture?: {
    active: boolean;
    backend: string | null;
    bytes: number;
    level: number;
    error: string | null;
  };
};

export const ASSISTANT_DESKTOP_VOICE_TOGGLE_EVENT = 'droneHub:assistantDesktopVoiceToggle';
export const ASSISTANT_DESKTOP_VOICE_STATUS_EVENT = 'droneHub:assistantDesktopVoiceStatus';
export const ASSISTANT_DESKTOP_VOICE_TRANSCRIPT_SEGMENT_EVENT = 'droneHub:assistantDesktopVoiceTranscriptSegment';

let latestStatus: DesktopAssistantVoiceStatus | null = null;
let lastCueKey = '';
let lastCueAt = 0;
let toggleInFlight = false;
let lastToggleAt = 0;

function cueForTransition(previous: DesktopAssistantVoiceStatus | null, next: DesktopAssistantVoiceStatus): LocalVoiceCue | null {
  if (!previous) return null;
  if (previous.updatedAt === next.updatedAt && previous.mode === next.mode && previous.message === next.message) return null;
  if (next.mode === 'off' && previous.mode !== 'off') {
    return next.lastApprovalCode === '0000' ? 'locked_off' : 'stop_button';
  }
  if ((previous.mode === 'off' || previous.mode === 'error') && next.mode === 'locked') return 'start_button';
  if (previous.mode === 'locked' && next.mode === 'sleeping') return 'unlock';
  if ((previous.mode === 'sleeping' || previous.mode === 'recording') && next.mode === 'locked') return 'lock';
  if (previous.mode === 'sleeping' && next.mode === 'recording') return 'wake';
  if ((previous.mode === 'recording' || previous.mode === 'transcribing') && next.mode === 'sleeping') return 'sleep';
  if (next.mode === 'sleeping' && next.message.toLowerCase().includes('status ok')) return 'status';
  return null;
}

function playCueForStatus(status: DesktopAssistantVoiceStatus): void {
  const cue = cueForTransition(latestStatus, status);
  latestStatus = status;
  if (!cue) return;
  const cueKey = `${cue}:${status.updatedAt ?? ''}:${status.mode}:${status.message}`;
  const now = Date.now();
  if (cueKey === lastCueKey && now - lastCueAt < 250) return;
  lastCueKey = cueKey;
  lastCueAt = now;
  playLocalVoiceCue(cue);
}

function speakDesktopVoiceText(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

async function requestDesktopVoiceToggle(): Promise<void> {
  const now = Date.now();
  if (toggleInFlight || now - lastToggleAt < 500) return;
  toggleInFlight = true;
  lastToggleAt = now;
  try {
    const response = await fetch('/api/assistant/desktop-voice/toggle', { method: 'POST' });
    if (!response.ok) {
      let message = `Desktop voice toggle failed (${response.status})`;
      try {
        const data = await response.json();
        message = String(data?.error ?? message);
      } catch {
        // keep fallback
      }
      dispatchAssistantDesktopVoiceStatus({ mode: 'error', message });
    }
  } catch (error: any) {
    dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) });
  } finally {
    toggleInFlight = false;
  }
}

export function dispatchAssistantDesktopVoiceToggle(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_DESKTOP_VOICE_TOGGLE_EVENT));
  void requestDesktopVoiceToggle();
}

export function dispatchAssistantDesktopVoiceStatus(status: DesktopAssistantVoiceStatus): void {
  if (typeof window === 'undefined') return;
  playCueForStatus(status);
  window.dispatchEvent(new CustomEvent<DesktopAssistantVoiceStatus>(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, { detail: status }));
}

export function dispatchAssistantDesktopVoiceTranscriptSegment(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ASSISTANT_DESKTOP_VOICE_TRANSCRIPT_SEGMENT_EVENT, { detail: text }));
}

export function subscribeAssistantDesktopVoiceStatus(listener: (status: DesktopAssistantVoiceStatus) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<DesktopAssistantVoiceStatus>).detail);
  };
  window.addEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, handler);
  let source: EventSource | null = null;
  if (typeof window.EventSource !== 'undefined') {
    source = new window.EventSource('/api/assistant/desktop-voice/events');
    source.addEventListener('desktop_voice_status', (event) => {
      try {
        const status = JSON.parse((event as MessageEvent).data);
        dispatchAssistantDesktopVoiceStatus(status);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    source.addEventListener('desktop_voice_transcript_segment', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (text) dispatchAssistantDesktopVoiceTranscriptSegment(text);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    source.addEventListener('desktop_voice_speak', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (text) speakDesktopVoiceText(text);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    source.onerror = () => {
      dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: 'Desktop voice event stream disconnected.' });
    };
  } else {
    fetch('/api/assistant/desktop-voice/status')
      .then((response) => response.json())
      .then((status) => dispatchAssistantDesktopVoiceStatus(status))
      .catch((error) => dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) }));
  }
  return () => {
    window.removeEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, handler);
    source?.close();
  };
}
