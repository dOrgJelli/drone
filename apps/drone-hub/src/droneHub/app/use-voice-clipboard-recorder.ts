import React from 'react';
import { copyText } from './clipboard';

const MAX_RECORDING_MS = 10 * 60 * 1000;

type VoiceRecorderStatus = 'idle' | 'starting' | 'recording' | 'transcribing';
type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
type ToastFn = (message: string, title: string, tone?: 'success' | 'error') => void;

type TranscriptionResponse = {
  ok: true;
  text: string;
  model: string;
};

function bestRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function playDoneSound(): void {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 350);
  } catch {
    // Audio feedback is best-effort.
  }
}

export function useVoiceClipboardRecorder(opts: {
  requestJson: RequestJson;
  showToast: ToastFn;
}): { toggleVoiceClipboardRecording: () => boolean } {
  const { requestJson, showToast } = opts;
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const maxTimerRef = React.useRef<number | null>(null);
  const statusRef = React.useRef<VoiceRecorderStatus>('idle');

  const clearMaxTimer = React.useCallback(() => {
    if (maxTimerRef.current == null) return;
    window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
  }, []);

  const showTransientToast = React.useCallback(
    (message: string, title: string, tone: 'success' | 'error' = 'error') => {
      showToast(message, title, tone);
    },
    [showToast],
  );

  const finishRecording = React.useCallback(
    async (recorder: MediaRecorder, chunks: Blob[], stoppedByLimit: boolean) => {
      clearMaxTimer();
      const stream = streamRef.current;
      streamRef.current = null;
      recorderRef.current = null;
      stopStream(stream);

      if (chunks.length === 0) {
        statusRef.current = 'idle';
        showTransientToast('No audio was captured.', 'Voice transcription failed');
        return;
      }

      statusRef.current = 'transcribing';
      if (stoppedByLimit) {
        showTransientToast('Recording reached the 10 minute limit. Transcribing now.', 'Voice recording stopped', 'success');
      } else {
        showTransientToast('Voice recording stopped. Transcribing now.', 'Voice recording stopped', 'success');
      }

      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        const data = await requestJson<TranscriptionResponse>('/api/audio/transcriptions', {
          method: 'POST',
          headers: { 'content-type': blob.type || 'audio/webm' },
          body: blob,
        });
        const text = String(data.text ?? '').trim();
        if (!text) throw new Error('The transcription was empty.');
        const copied = await copyText(text);
        if (!copied) {
          showTransientToast('Transcription finished, but the browser blocked clipboard access.', 'Voice transcription ready');
          return;
        }
        playDoneSound();
        showTransientToast(`Copied ${text.length.toLocaleString()} characters to the clipboard.`, 'Voice transcription copied', 'success');
      } catch (error: any) {
        showTransientToast(error?.message ?? String(error), 'Voice transcription failed');
      } finally {
        statusRef.current = 'idle';
      }
    },
    [clearMaxTimer, requestJson, showTransientToast],
  );

  const stopRecording = React.useCallback(
    (stoppedByLimit: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;
      statusRef.current = 'transcribing';
      const chunks = chunksRef.current;
      recorder.onstop = () => {
        void finishRecording(recorder, chunks, stoppedByLimit);
      };
      recorder.stop();
    },
    [finishRecording],
  );

  const startRecording = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showTransientToast('This browser does not support microphone recording.', 'Voice recording unavailable');
      return;
    }

    statusRef.current = 'starting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = bestRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        showTransientToast('The browser stopped the microphone recorder.', 'Voice recording failed');
        stopStream(stream);
        clearMaxTimer();
        statusRef.current = 'idle';
      };
      recorder.start();
      statusRef.current = 'recording';
      showTransientToast('Press ` again to stop and copy the transcription.', 'Voice recording started', 'success');
      maxTimerRef.current = window.setTimeout(() => stopRecording(true), MAX_RECORDING_MS);
    } catch (error: any) {
      stopStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      clearMaxTimer();
      statusRef.current = 'idle';
      showTransientToast(error?.message ?? String(error), 'Voice recording failed');
    }
  }, [clearMaxTimer, showTransientToast, stopRecording]);

  const toggleVoiceClipboardRecording = React.useCallback((): boolean => {
    const status = statusRef.current;
    if (status === 'recording') {
      stopRecording(false);
      return true;
    }
    if (status === 'starting' || status === 'transcribing') {
      showTransientToast('Voice transcription is already in progress.', 'Voice transcription busy');
      return true;
    }
    void startRecording();
    return true;
  }, [showTransientToast, startRecording, stopRecording]);

  React.useEffect(() => {
    return () => {
      clearMaxTimer();
      stopStream(streamRef.current);
    };
  }, [clearMaxTimer]);

  return { toggleVoiceClipboardRecording };
}
