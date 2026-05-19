import React from 'react';
import { copyText } from './clipboard';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const SILENCE_RMS_THRESHOLD = 0.006;
const WARM_STREAM_TTL_MS = 10 * 60 * 1000;

type VoiceRecorderStatus = 'idle' | 'starting' | 'recording' | 'transcribing';
type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
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

type TranscriptionResponse = {
  ok: true;
  text: string;
  model: string;
};

type MicActivitySnapshot = {
  peakRms: number;
  samples: number;
  unavailable: boolean;
};

type MicActivityMeter = {
  snapshot: () => MicActivitySnapshot;
  stop: () => void;
};

function bestRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function microphoneLabelForStream(stream: MediaStream | null): string {
  const label = stream?.getAudioTracks()[0]?.label?.trim();
  return label || 'default microphone';
}

function formatPeakPercent(peakRms: number): string {
  return `${Math.round(Math.max(0, peakRms) * 1000) / 10}%`;
}

function isSilentMicActivity(snapshot: MicActivitySnapshot): boolean {
  return !snapshot.unavailable && snapshot.samples >= 3 && snapshot.peakRms < SILENCE_RMS_THRESHOLD;
}

function normalizeVoiceLevel(rms: number): number {
  const normalized = Math.max(0, Math.min(1, (rms - 0.003) / 0.08));
  return Math.sqrt(normalized);
}

function createMicActivityMeter(stream: MediaStream, onLevel?: (level: number) => void): MicActivityMeter {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    return {
      snapshot: () => ({ peakRms: 0, samples: 0, unavailable: true }),
      stop: () => {},
    };
  }

  try {
    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let peakRms = 0;
    let samples = 0;
    const sample = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      peakRms = Math.max(peakRms, rms);
      samples += 1;
      onLevel?.(normalizeVoiceLevel(rms));
    };
    const interval = window.setInterval(sample, 120);
    void ctx.resume().catch(() => {});
    sample();
    return {
      snapshot: () => ({ peakRms, samples, unavailable: false }),
      stop: () => {
        window.clearInterval(interval);
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {
          // Meter cleanup is best-effort.
        }
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return {
      snapshot: () => ({ peakRms: 0, samples: 0, unavailable: true }),
      stop: () => {},
    };
  }
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function isLiveAudioStream(stream: MediaStream | null): stream is MediaStream {
  return Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled));
}

function playReadySound(): void {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.12);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Audio feedback is best-effort.
  }
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
  updateVoiceToast?: UpdateVoiceToastFn;
}): { toggleVoiceClipboardRecording: () => boolean } {
  const { requestJson, showToast, updateVoiceToast } = opts;
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const warmStreamRef = React.useRef<MediaStream | null>(null);
  const meterRef = React.useRef<MicActivityMeter | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const maxTimerRef = React.useRef<number | null>(null);
  const warmTimerRef = React.useRef<number | null>(null);
  const warmInFlightRef = React.useRef<Promise<MediaStream | null> | null>(null);
  const statusRef = React.useRef<VoiceRecorderStatus>('idle');
  const recordingToastIdRef = React.useRef<string | null>(null);

  const clearMaxTimer = React.useCallback(() => {
    if (maxTimerRef.current == null) return;
    window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
  }, []);

  const clearWarmTimer = React.useCallback(() => {
    if (warmTimerRef.current == null) return;
    window.clearTimeout(warmTimerRef.current);
    warmTimerRef.current = null;
  }, []);

  const releaseWarmStream = React.useCallback(() => {
    clearWarmTimer();
    stopStream(warmStreamRef.current);
    warmStreamRef.current = null;
  }, [clearWarmTimer]);

  const keepWarmStream = React.useCallback(
    (stream: MediaStream | null) => {
      if (!isLiveAudioStream(stream)) return;
      if (warmStreamRef.current && warmStreamRef.current !== stream) stopStream(warmStreamRef.current);
      warmStreamRef.current = stream;
      clearWarmTimer();
      warmTimerRef.current = window.setTimeout(() => {
        stopStream(warmStreamRef.current);
        warmStreamRef.current = null;
        warmTimerRef.current = null;
      }, WARM_STREAM_TTL_MS);
    },
    [clearWarmTimer],
  );

  const acquireRecordingStream = React.useCallback(async (): Promise<MediaStream> => {
    clearWarmTimer();
    if (isLiveAudioStream(warmStreamRef.current)) return warmStreamRef.current;
    warmStreamRef.current = null;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    warmStreamRef.current = stream;
    return stream;
  }, [clearWarmTimer]);

  const prewarmMicIfPermitted = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || statusRef.current !== 'idle') return;
    if (isLiveAudioStream(warmStreamRef.current) || warmInFlightRef.current) return;
    warmInFlightRef.current = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        keepWarmStream(stream);
        return stream;
      })
      .catch(() => null)
      .finally(() => {
        warmInFlightRef.current = null;
      });
    await warmInFlightRef.current;
  }, [keepWarmStream]);

  const showTransientToast = React.useCallback(
    (
      message: string,
      title: string,
      tone: 'success' | 'error' = 'error',
      toastOpts?: { voiceActive?: boolean; voiceLevel?: number; autoDismissMs?: number | null },
    ) => {
      return showToast(message, title, tone, toastOpts);
    },
    [showToast],
  );

  const updateRecordingToast = React.useCallback(
    (level: number, patch?: { message?: string; title?: string; tone?: 'success' | 'error'; voiceActive?: boolean }) => {
      const id = recordingToastIdRef.current;
      if (!id) return;
      updateVoiceToast?.(id, level, patch);
    },
    [updateVoiceToast],
  );

  const stopMeter = React.useCallback((): MicActivitySnapshot => {
    const meter = meterRef.current;
    meterRef.current = null;
    const snapshot = meter?.snapshot() ?? { peakRms: 0, samples: 0, unavailable: true };
    meter?.stop();
    return snapshot;
  }, []);

  const finishRecording = React.useCallback(
    async (recorder: MediaRecorder, chunks: Blob[], stoppedByLimit: boolean) => {
      clearMaxTimer();
      const stream = streamRef.current;
      const microphoneLabel = microphoneLabelForStream(stream);
      const micActivity = stopMeter();
      recordingToastIdRef.current = null;
      streamRef.current = null;
      recorderRef.current = null;
      keepWarmStream(stream);

      if (chunks.length === 0) {
        statusRef.current = 'idle';
        showTransientToast('No audio was captured.', 'Voice transcription failed');
        return;
      }

      if (isSilentMicActivity(micActivity)) {
        statusRef.current = 'idle';
        showTransientToast(
          `No microphone input was detected from ${microphoneLabel} (peak ${formatPeakPercent(micActivity.peakRms)}). Check the browser/site microphone selector or OS input level.`,
          'Voice recording silent',
        );
        return;
      }

      statusRef.current = 'transcribing';
      const signalSuffix = micActivity.unavailable ? '' : ` (mic peak ${formatPeakPercent(micActivity.peakRms)})`;
      if (stoppedByLimit) {
        showTransientToast(`Recording reached the 10 minute limit${signalSuffix}. Transcribing now.`, 'Voice recording stopped', 'success');
      } else {
        showTransientToast(`Voice recording stopped${signalSuffix}. Transcribing now.`, 'Voice recording stopped', 'success');
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
    [clearMaxTimer, keepWarmStream, requestJson, showTransientToast, stopMeter],
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
      const stream = await acquireRecordingStream();
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
        recordingToastIdRef.current = null;
        stopMeter();
        stopStream(stream);
        if (warmStreamRef.current === stream) warmStreamRef.current = null;
        clearMaxTimer();
        statusRef.current = 'idle';
      };
      const microphoneLabel = microphoneLabelForStream(stream);
      recorder.onstart = () => {
        playReadySound();
        const toastId = showTransientToast(
          `Recording from ${microphoneLabel}. Speak now. Press \` again to stop and copy the transcription.`,
          'Voice recording ready',
          'success',
          { voiceActive: true, voiceLevel: 0, autoDismissMs: null },
        );
        recordingToastIdRef.current = toastId;
        statusRef.current = 'recording';
        maxTimerRef.current = window.setTimeout(() => stopRecording(true), MAX_RECORDING_MS);
      };
      meterRef.current = createMicActivityMeter(stream, (level) => updateRecordingToast(level));
      recorder.start(1000);
    } catch (error: any) {
      recordingToastIdRef.current = null;
      stopMeter();
      stopStream(streamRef.current);
      if (warmStreamRef.current === streamRef.current) warmStreamRef.current = null;
      streamRef.current = null;
      recorderRef.current = null;
      clearMaxTimer();
      statusRef.current = 'idle';
      showTransientToast(error?.message ?? String(error), 'Voice recording failed');
    }
  }, [acquireRecordingStream, clearMaxTimer, showTransientToast, stopMeter, stopRecording, updateRecordingToast]);

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
      recordingToastIdRef.current = null;
      stopMeter();
      stopStream(streamRef.current);
      releaseWarmStream();
    };
  }, [clearMaxTimer, releaseWarmStream, stopMeter]);

  React.useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.permissions?.query) return;
    let cancelled = false;
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((permission) => {
        if (!cancelled && permission.state === 'granted') void prewarmMicIfPermitted();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [prewarmMicIfPermitted]);

  return { toggleVoiceClipboardRecording };
}
