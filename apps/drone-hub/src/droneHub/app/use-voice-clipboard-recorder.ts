import React from 'react';
import { dispatchAssistantDesktopVoiceToggle } from '../assistant/desktop-assistant-voice';
import { playLocalVoiceCue } from '../assistant/local-voice-cues';
import { copyText } from './clipboard';

const DOUBLE_PRESS_MS = 320;

type ToastFn = (
  message: string,
  title: string,
  tone?: 'success' | 'error',
  opts?: { voiceActive?: boolean; voiceLevel?: number; autoDismissMs?: number | null },
) => string | null;

type UpdateVoiceToastFn = (
  id: string,
  voiceLevel: number,
  patch?: { message?: string; title?: string; tone?: 'success' | 'error'; voiceActive?: boolean },
) => void;

type DesktopVoiceStatus = {
  ok: true;
  clipboard?: {
    mode?: 'idle' | 'recording' | 'transcribing' | 'error';
    message?: string;
    error?: string | null;
  };
  capture?: {
    level?: number;
  };
};

async function toggleHostClipboardRecording(): Promise<DesktopVoiceStatus> {
  const requestId = createVoiceClipboardRequestId();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clientUnixMs = Date.now();
  console.debug('[voice-clipboard] clipboard-toggle request', { requestId, clientUnixMs });
  const response = await fetch('/api/assistant/desktop-voice/clipboard-toggle', {
    method: 'POST',
    headers: {
      'x-drone-voice-clipboard-request-id': requestId,
      'x-drone-voice-clipboard-client-unix-ms': String(clientUnixMs),
    },
  });
  const text = await response.text();
  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  console.debug('[voice-clipboard] clipboard-toggle response', { requestId, elapsedMs, ok: response.ok });
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(String(data?.error ?? `${response.status} ${response.statusText}`));
  return data as DesktopVoiceStatus;
}

async function cancelHostClipboardRecording(): Promise<void> {
  const requestId = createVoiceClipboardRequestId();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clientUnixMs = Date.now();
  console.debug('[voice-clipboard] clipboard-cancel request', { requestId, clientUnixMs });
  const response = await fetch('/api/assistant/desktop-voice/clipboard-cancel', {
    method: 'POST',
    headers: {
      'x-drone-voice-clipboard-request-id': requestId,
      'x-drone-voice-clipboard-client-unix-ms': String(clientUnixMs),
    },
  });
  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  console.debug('[voice-clipboard] clipboard-cancel response', { requestId, elapsedMs, ok: response.ok });
}

function createVoiceClipboardRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useVoiceClipboardRecorder(opts: {
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  showToast: ToastFn;
  updateVoiceToast?: UpdateVoiceToastFn;
}): { toggleVoiceClipboardRecording: () => boolean } {
  const { showToast, updateVoiceToast } = opts;
  const pendingSinglePressTimerRef = React.useRef<number | null>(null);
  const singlePressIdRef = React.useRef(0);
  const activeSinglePressRef = React.useRef<{ id: number; toastAllowed: boolean } | null>(null);
  const deferredStatusRef = React.useRef<DesktopVoiceStatus | null>(null);
  const recordingStartCuePressIdRef = React.useRef<number | null>(null);
  const recordingToastIdRef = React.useRef<string | null>(null);
  const clipboardModeRef = React.useRef<NonNullable<DesktopVoiceStatus['clipboard']>['mode']>('idle');

  const clearPendingSinglePress = React.useCallback(() => {
    if (pendingSinglePressTimerRef.current == null) return;
    window.clearTimeout(pendingSinglePressTimerRef.current);
    pendingSinglePressTimerRef.current = null;
  }, []);

  const updateRecordingToast = React.useCallback(
    (status: DesktopVoiceStatus) => {
      const id = recordingToastIdRef.current;
      if (!id) return;
      clipboardModeRef.current = status.clipboard?.mode ?? clipboardModeRef.current;
      const level = Math.max(0, Math.min(1, Number(status.capture?.level ?? 0)));
      updateVoiceToast?.(id, level, {
        title: status.clipboard?.mode === 'transcribing' ? 'Voice transcription' : 'Voice recording',
        message: status.clipboard?.message ?? 'Recording from host microphone.',
        tone: status.clipboard?.mode === 'error' ? 'error' : 'success',
        voiceActive: status.clipboard?.mode === 'recording',
      });
    },
    [updateVoiceToast],
  );

  const playRecordingStartCue = React.useCallback((pressId: number) => {
    if (recordingStartCuePressIdRef.current === pressId) return;
    recordingStartCuePressIdRef.current = pressId;
    playLocalVoiceCue('clipboard_recording_start');
  }, []);

  const showClipboardStatus = React.useCallback(
    (status: DesktopVoiceStatus) => {
      const mode = status.clipboard?.mode ?? 'idle';
      clipboardModeRef.current = mode;
      if (mode === 'recording') {
        recordingToastIdRef.current = showToast(
          status.clipboard?.message ?? 'Recording from host microphone. Press the shortcut again to stop and copy.',
          'Voice recording ready',
          'success',
          { voiceActive: true, voiceLevel: status.capture?.level ?? 0, autoDismissMs: null },
        );
        return;
      }
      if (mode === 'transcribing') {
        showToast(status.clipboard?.message ?? 'Transcribing voice recording.', 'Voice transcription', 'success');
        updateRecordingToast(status);
        return;
      }
      if (mode === 'error') {
        recordingToastIdRef.current = null;
        showToast(status.clipboard?.error ?? status.clipboard?.message ?? 'Voice transcription failed.', 'Voice transcription failed');
      }
    },
    [showToast, updateRecordingToast],
  );

  const runSinglePressAction = React.useCallback(async (opts: { deferToastForPressId?: number } = {}) => {
    console.debug('[voice-clipboard] single-press action started', { clientUnixMs: Date.now() });
    try {
      const status = await toggleHostClipboardRecording();
      const mode = status.clipboard?.mode ?? 'idle';
      clipboardModeRef.current = mode;
      if (opts.deferToastForPressId != null) {
        const activePress = activeSinglePressRef.current;
        if (!activePress || activePress.id !== opts.deferToastForPressId) return;
        if (mode === 'recording') playRecordingStartCue(opts.deferToastForPressId);
        if (!activePress.toastAllowed) {
          deferredStatusRef.current = status;
          return;
        }
      }
      showClipboardStatus(status);
    } catch (error: any) {
      if (opts.deferToastForPressId != null) {
        const activePress = activeSinglePressRef.current;
        if (!activePress || activePress.id !== opts.deferToastForPressId) return;
        if (!activePress.toastAllowed) {
          deferredStatusRef.current = {
            ok: true,
            clipboard: {
              mode: 'error',
              message: 'Voice transcription failed.',
              error: error?.message ?? String(error),
            },
          };
          clipboardModeRef.current = 'error';
          return;
        }
      }
      recordingToastIdRef.current = null;
      clipboardModeRef.current = 'error';
      showToast(error?.message ?? String(error), 'Voice transcription failed');
    }
  }, [showClipboardStatus, showToast]);

  const allowDeferredSinglePressToast = React.useCallback((pressId: number) => {
    const activePress = activeSinglePressRef.current;
    if (!activePress || activePress.id !== pressId) return;
    activePress.toastAllowed = true;
    pendingSinglePressTimerRef.current = null;
    const status = deferredStatusRef.current;
    deferredStatusRef.current = null;
    if (status) showClipboardStatus(status);
  }, [showClipboardStatus]);

  const toggleVoiceClipboardRecording = React.useCallback((): boolean => {
    if (pendingSinglePressTimerRef.current != null) {
      clearPendingSinglePress();
      activeSinglePressRef.current = null;
      deferredStatusRef.current = null;
      recordingToastIdRef.current = null;
      clipboardModeRef.current = 'idle';
      void cancelHostClipboardRecording();
      dispatchAssistantDesktopVoiceToggle();
      return true;
    }
    if (clipboardModeRef.current === 'recording') {
      activeSinglePressRef.current = null;
      deferredStatusRef.current = null;
      clearPendingSinglePress();
      void runSinglePressAction();
      return true;
    }
    const pressId = singlePressIdRef.current + 1;
    singlePressIdRef.current = pressId;
    activeSinglePressRef.current = { id: pressId, toastAllowed: false };
    deferredStatusRef.current = null;
    void runSinglePressAction({ deferToastForPressId: pressId });
    pendingSinglePressTimerRef.current = window.setTimeout(() => {
      allowDeferredSinglePressToast(pressId);
    }, DOUBLE_PRESS_MS);
    return true;
  }, [allowDeferredSinglePressToast, clearPendingSinglePress, runSinglePressAction]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    const source = new window.EventSource('/api/assistant/desktop-voice/events');
    source.addEventListener('desktop_voice_status', (event) => {
      try {
        const status = JSON.parse((event as MessageEvent).data) as DesktopVoiceStatus;
        clipboardModeRef.current = status.clipboard?.mode ?? clipboardModeRef.current;
        updateRecordingToast(status);
      } catch {
        // Ignore malformed desktop voice status events.
      }
    });
    source.addEventListener('desktop_voice_clipboard_result', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (!text) return;
        playLocalVoiceCue('clipboard_transcription_success');
        void copyText(text).then((copied) => {
          recordingToastIdRef.current = null;
          clipboardModeRef.current = 'idle';
          showToast(
            copied ? `Copied ${text.length.toLocaleString()} characters to the clipboard.` : 'Transcription finished, but clipboard access was blocked.',
            copied ? 'Voice transcription copied' : 'Voice transcription ready',
            copied ? 'success' : 'error',
          );
        });
      } catch {
        // Ignore malformed clipboard result events.
      }
    });
    return () => source.close();
  }, [showToast, updateRecordingToast]);

  React.useEffect(() => clearPendingSinglePress, [clearPendingSinglePress]);

  return { toggleVoiceClipboardRecording };
}
