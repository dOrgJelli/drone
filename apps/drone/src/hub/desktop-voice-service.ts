import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

import { DESKTOP_VOICE_CODES, type DesktopVoiceClipboardMode, type DesktopVoiceMode } from './desktop-voice-behavior';
import { managedDesktopVoiceModelDirSync } from './desktop-voice-models';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from './voice-approval-code';
import {
  hasTranscriptContent,
  isLikelyShortSleepMistranscription,
  pcm16leRms,
  pcm16leToWav,
  PromptSpeechSegmenter,
  stripCommands,
  type PromptSpeechSegment,
} from './voice-transcription-segmenter';

type CaptureCommand = {
  label: string;
  command: string;
  args: string[];
};

type DesktopVoiceStatus = {
  ok: true;
  mode: DesktopVoiceMode;
  message: string;
  updatedAt: string;
  supportsWakeWords: boolean;
  recognizer: {
    active: boolean;
    backend: string | null;
    error: string | null;
    text: string | null;
    finalText: string | null;
    textFinal: boolean;
    textUpdatedAt: string | null;
  };
  transcript: {
    active: boolean;
    status: 'idle' | 'collecting' | 'transcribing' | 'error';
    text: string;
    error: string | null;
    updatedAt: string | null;
  };
  clipboard: {
    mode: DesktopVoiceClipboardMode;
    message: string;
    text?: string;
    error: string | null;
  };
  lastApprovalCode?: string;
  capture: {
    active: boolean;
    backend: string | null;
    bytes: number;
    level: number;
    error: string | null;
  };
};

type DesktopVoiceEvent = {
  type: 'desktop_voice_status';
  status: DesktopVoiceStatus;
} | {
  type: 'desktop_voice_clipboard_result';
  text: string;
} | {
  type: 'desktop_voice_transcript_segment';
  text: string;
} | {
  type: 'desktop_voice_speak';
  text: string;
} | {
  type: 'desktop_voice_speak_audio';
  text: string;
  contentType: 'audio/wav';
  audioBase64: string;
};

type DesktopVoiceServiceOptions = {
  transcribeWav: (wav: Buffer) => Promise<{ text: string; model: string }>;
  submitAssistantPrompt: (prompt: string) => Promise<void>;
  synthesizeSpeechWav?: (text: string) => Promise<Buffer>;
};

const VOSK_WAKE_GRAMMAR = [
  'hey sebastian',
  'hay sebastian',
  'hey',
  'hay',
  'sebastian',
  'status',
  'state us',
  'state is',
  'status check',
  'check status',
  'approval',
  'code',
  'approval code',
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  '[unk]',
] as const;

function splitEnvCaptureCommand(raw: string): CaptureCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return { label: 'custom', command: process.env.SHELL || '/bin/sh', args: ['-lc', trimmed] };
}

function defaultCaptureCommands(): CaptureCommand[] {
  const custom = splitEnvCaptureCommand(String(process.env.DRONE_DESKTOP_VOICE_CAPTURE_CMD ?? ''));
  if (custom) return [custom];
  if (process.platform === 'darwin') {
    return [
      { label: 'ffmpeg-avfoundation', command: 'ffmpeg', args: ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'] },
    ];
  }
  if (process.platform === 'linux') {
    return [
      { label: 'parecord', command: 'parecord', args: ['--raw', '--format=s16le', '--rate=16000', '--channels=1'] },
      { label: 'arecord', command: 'arecord', args: ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw'] },
      { label: 'ffmpeg-pulse', command: 'ffmpeg', args: ['-hide_banner', '-loglevel', 'error', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'] },
    ];
  }
  return [];
}

function commandDisplay(command: CaptureCommand): string {
  return [command.command, ...command.args].join(' ');
}

function normalizeLevel(rms: number): number {
  const normalized = Math.max(0, Math.min(1, (rms - 0.003) / 0.08));
  return Math.sqrt(normalized);
}

const requireForDesktopVoice = createRequire(__filename);

function envPath(name: string): string | null {
  const value = String(process.env[name] ?? '').trim();
  return value ? path.resolve(value.replace(/^~(?=$|\/)/, os.homedir())) : null;
}

function existingEnvPath(name: string): string | null {
  const value = envPath(name);
  return value && existsSync(value) ? value : null;
}

function hasRequiredVoskModelFiles(modelDir: string): boolean {
  return existsSync(path.join(modelDir, 'am', 'final.mdl')) &&
    existsSync(path.join(modelDir, 'graph', 'HCLr.fst')) &&
    existsSync(path.join(modelDir, 'graph', 'Gr.fst')) &&
    existsSync(path.join(modelDir, 'conf', 'model.conf'));
}

function resolveBundledVoskModelDir(): string | null {
  const candidates = [
    managedDesktopVoiceModelDirSync(),
    path.resolve(__dirname, '..', 'assets', 'vosk-model-en-us'),
    path.resolve(__dirname, '..', '..', '..', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
    path.resolve(process.cwd(), 'apps', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => hasRequiredVoskModelFiles(candidate)) ?? null;
}

function resolveVoskModelDir(): string | { error: string } {
  const explicit = existingEnvPath('DRONE_DESKTOP_VOICE_VOSK_MODEL_DIR');
  if (explicit) {
    if (hasRequiredVoskModelFiles(explicit)) return explicit;
    return { error: `Vosk model files were not found in ${explicit}. Expected the Android-style model directory with am/final.mdl, graph/HCLr.fst, graph/Gr.fst, and conf/model.conf.` };
  }
  const bundled = resolveBundledVoskModelDir();
  if (bundled) return bundled;
  return {
    error: 'Bundled Vosk trigger model was not found. Rebuild Drone Hub or set DRONE_DESKTOP_VOICE_VOSK_MODEL_DIR to an Android-style Vosk model directory.',
  };
}

function desktopVoiceDebugEnabled(): boolean {
  const raw = String(process.env.DRONE_DESKTOP_VOICE_DEBUG ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function desktopVoiceLog(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) console.log(`[desktop-voice] ${message}`, meta);
  else console.log(`[desktop-voice] ${message}`);
}

function desktopVoiceWarn(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) console.warn(`[desktop-voice] ${message}`, meta);
  else console.warn(`[desktop-voice] ${message}`);
}

type VoskModel = { free: () => void };
type VoskRecognizer = {
  acceptWaveform: (pcm: Buffer) => boolean;
  partialResult: () => { partial?: string };
  result: () => { text?: string };
  reset: () => void;
  free: () => void;
};

class VoskCommandRecognizer extends EventEmitter {
  private model: VoskModel | null = null;
  private recognizer: VoskRecognizer | null = null;
  private error: string | null = null;
  private backend: string | null = null;
  private lastText = '';
  private lastEmittedText: string | null = null;
  private lastFinalText: string | null = null;
  private lastTextFinal = false;
  private lastTextUpdatedAt: string | null = null;

  snapshot(): DesktopVoiceStatus['recognizer'] {
    return {
      active: Boolean(this.recognizer),
      backend: this.backend,
      error: this.error,
      text: this.lastEmittedText,
      finalText: this.lastFinalText,
      textFinal: this.lastTextFinal,
      textUpdatedAt: this.lastTextUpdatedAt,
    };
  }

  start(): void {
    if (this.recognizer) return;
    const modelDir = resolveVoskModelDir();
    if (typeof modelDir !== 'string') {
      this.error = modelDir.error;
      desktopVoiceWarn('recognizer unavailable', { error: this.error });
      this.emit('error-state', this.error);
      return;
    }
    try {
      const vosk = requireForDesktopVoice('vosk') as {
        setLogLevel?: (level: number) => void;
        Model: new (modelPath: string) => VoskModel;
        Recognizer: new (params: { model: VoskModel; sampleRate: number; grammar: string[] }) => VoskRecognizer;
      };
      vosk.setLogLevel?.(desktopVoiceDebugEnabled() ? 0 : -1);
      const model = new vosk.Model(modelDir);
      const recognizer = new vosk.Recognizer({
        model,
        sampleRate: 16_000,
        grammar: [...VOSK_WAKE_GRAMMAR],
      });
      this.model = model;
      this.recognizer = recognizer;
      this.backend = 'vosk:constrained-grammar';
      this.lastText = '';
      this.lastEmittedText = null;
      this.lastFinalText = null;
      this.lastTextFinal = false;
      this.lastTextUpdatedAt = null;
      this.error = null;
      desktopVoiceLog('recognizer started', {
        backend: this.backend,
        modelDir,
        grammar: VOSK_WAKE_GRAMMAR,
      });
      this.emit('ready');
    } catch (error: any) {
      this.recognizer = null;
      this.model = null;
      this.backend = null;
      this.error = error?.code === 'MODULE_NOT_FOUND'
        ? 'vosk is not installed. Run `bun install` and restart Drone Hub.'
        : `Vosk recognizer failed to start: ${error?.message ?? String(error)}`;
      desktopVoiceWarn('recognizer start failed', { error: this.error });
      this.emit('error-state', this.error);
    }
  }

  stop(): void {
    if (this.recognizer) desktopVoiceLog('recognizer stopped', { backend: this.backend });
    try {
      this.recognizer?.free();
    } catch {
      // ignore
    }
    try {
      this.model?.free();
    } catch {
      // ignore
    }
    this.recognizer = null;
    this.model = null;
    this.backend = null;
    this.lastText = '';
    this.lastEmittedText = null;
    this.lastFinalText = null;
    this.lastTextFinal = false;
    this.lastTextUpdatedAt = null;
  }

  write(pcm: Buffer): void {
    const recognizer = this.recognizer;
    if (!recognizer || pcm.byteLength < 2) return;
    try {
      const endpoint = recognizer.acceptWaveform(pcm);
      const text = endpoint
        ? String(recognizer.result().text ?? '').trim().toLowerCase()
        : String(recognizer.partialResult().partial ?? '').trim().toLowerCase();
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.lastEmittedText = text;
        this.lastTextFinal = endpoint;
        this.lastTextUpdatedAt = new Date().toISOString();
        if (endpoint) this.lastFinalText = text;
        if (endpoint || desktopVoiceDebugEnabled()) {
          desktopVoiceLog(endpoint ? 'recognizer final text' : 'recognizer partial text', { text });
        }
        this.emit('text', text, endpoint);
      }
      if (endpoint) {
        if (text) {
          this.lastEmittedText = text;
          this.lastFinalText = text;
          this.lastTextFinal = true;
          this.lastTextUpdatedAt = new Date().toISOString();
          desktopVoiceLog('recognizer endpoint text', { text });
          this.emit('text', text, true);
        }
        recognizer.reset();
        this.lastText = '';
      }
    } catch (error: any) {
      this.error = `Vosk recognizer failed while decoding: ${error?.message ?? String(error)}`;
      this.stop();
      desktopVoiceWarn('recognizer decode failed', { error: this.error });
      this.emit('error-state', this.error);
    }
  }
}

class HostMicrophoneCapture extends EventEmitter {
  private child: ChildProcess | null = null;
  private backend: string | null = null;
  private bytes = 0;
  private level = 0;
  private error: string | null = null;
  private stopped = true;
  private startupTimer: NodeJS.Timeout | null = null;
  private candidates: CaptureCommand[] = [];
  private candidateIndex = 0;

  snapshot(): DesktopVoiceStatus['capture'] {
    return {
      active: Boolean(this.child),
      backend: this.backend,
      bytes: this.bytes,
      level: this.level,
      error: this.error,
    };
  }

  start(): void {
    if (this.child) return;
    this.stopped = false;
    this.bytes = 0;
    this.level = 0;
    this.error = null;
    this.candidates = defaultCaptureCommands();
    this.candidateIndex = 0;
    this.startNextCandidate();
  }

  stop(): void {
    this.stopped = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    const child = this.child;
    this.child = null;
    const backend = this.backend;
    this.backend = null;
    if (!child) return;
    child.removeAllListeners();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    try {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 800).unref();
    } catch {
      // ignore
    }
    desktopVoiceLog('host mic capture stopped', { backend });
    this.emit('change');
  }

  private startNextCandidate(): void {
    if (this.stopped) return;
    const candidate = this.candidates[this.candidateIndex];
    if (!candidate) {
      this.error = this.candidates.length === 0
        ? `No host microphone capture backend is configured for ${os.platform()}. Set DRONE_DESKTOP_VOICE_CAPTURE_CMD.`
        : 'No host microphone capture backend started successfully.';
      desktopVoiceWarn('host mic capture unavailable', { error: this.error });
      this.emit('error-state', this.error);
      this.emit('change');
      return;
    }
    this.candidateIndex += 1;
    this.backend = candidate.label;
    let stderr = '';
    let receivedAudio = false;
    try {
      const child = spawn(candidate.command, candidate.args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout?.on('data', (chunk: Buffer) => {
        receivedAudio = true;
        this.bytes += chunk.length;
        this.level = normalizeLevel(pcm16leRms(chunk));
        this.emit('audio', chunk);
        this.emit('change');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      child.on('error', (error) => {
        if (this.child !== child) return;
        this.child = null;
        this.error = `${candidate.label}: ${error.message}`;
        desktopVoiceWarn('host mic capture backend error', { backend: candidate.label, error: this.error });
        this.startNextCandidate();
      });
      child.on('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        const detail = stderr.trim() || `exit ${code ?? signal ?? 'unknown'}`;
        this.error = `${candidate.label}: ${detail}`;
        if (this.stopped) {
          desktopVoiceLog('host mic capture backend exited after stop', { backend: candidate.label, detail });
          this.emit('change');
          return;
        }
        if (!receivedAudio) {
          desktopVoiceWarn('host mic capture backend produced no audio', { backend: candidate.label, detail });
          this.startNextCandidate();
        } else {
          desktopVoiceWarn('host mic capture backend exited', { backend: candidate.label, detail });
          this.emit('error-state', this.error);
          this.emit('change');
        }
      });
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (this.child === child && !receivedAudio) {
          try {
            child.kill('SIGTERM');
          } catch {
            // exit handler tries the next candidate
          }
        }
      }, 1000);
      this.startupTimer.unref();
      this.error = null;
      this.emit('change');
      desktopVoiceLog('host mic capture started', { backend: candidate.label, command: commandDisplay(candidate) });
    } catch (error: any) {
      this.child = null;
      this.error = `${candidate.label}: ${error?.message ?? String(error)}`;
      desktopVoiceWarn('host mic capture spawn failed', { backend: candidate.label, error: this.error });
      this.startNextCandidate();
    }
  }
}

export class DesktopVoiceService {
  private readonly events = new EventEmitter();
  private readonly capture = new HostMicrophoneCapture();
  private readonly recognizer = new VoskCommandRecognizer();
  private readonly approvalRecognizer = new ApprovalCodeRecognizer();
  private approvalFinalizeTimer: NodeJS.Timeout | null = null;
  private desktopSubscriberCount = 0;
  private mode: DesktopVoiceMode = 'off';
  private message = 'Desktop voice is off.';
  private updatedAt = new Date().toISOString();
  private lastApprovalCode = '';
  private lastCommandAt = new Map<string, number>();
  private promptChunks: Buffer[] = [];
  private readonly promptSegmenter = new PromptSpeechSegmenter();
  private promptSegments: PromptSpeechSegment[] = [];
  private promptTranscribing = false;
  private promptTranscriptText = '';
  private promptTranscriptError: string | null = null;
  private promptTranscriptUpdatedAt: string | null = null;
  private clipboardMode: DesktopVoiceClipboardMode = 'idle';
  private clipboardMessage = 'Voice transcription is idle.';
  private clipboardError: string | null = null;
  private clipboardChunks: Buffer[] = [];
  private clipboardStartedCapture = false;

  constructor(private readonly opts: DesktopVoiceServiceOptions) {
    this.capture.on('change', () => this.emitChange());
    this.capture.on('audio', (chunk: Buffer) => this.handleAudio(chunk));
    this.capture.on('error-state', (message) => {
      const text = String(message || 'Host microphone capture failed.');
      if (this.clipboardMode === 'recording') {
        this.clipboardMode = 'error';
        this.clipboardError = text;
        this.clipboardMessage = `Voice transcription failed: ${text}`;
        this.clipboardChunks = [];
        this.clipboardStartedCapture = false;
      }
      if (this.mode !== 'off') {
        this.mode = 'error';
        this.message = text;
      }
      this.touch();
      this.emitChange();
    });
    this.recognizer.on('ready', () => {
      if (this.mode === 'locked') this.message = 'Locked: say approval code one two three four.';
      this.touch();
      this.emitChange();
    });
    this.recognizer.on('text', (text: string, final: boolean) => this.handleRecognizedText(text, final));
    this.recognizer.on('error-state', (message) => {
      this.message = `Local wake model unavailable: ${message}`;
      this.touch();
      this.emitChange();
    });
  }

  snapshot(): DesktopVoiceStatus {
    return {
      ok: true,
      mode: this.mode,
      message: this.message,
      updatedAt: this.updatedAt,
      supportsWakeWords: this.recognizer.snapshot().active,
      recognizer: this.recognizer.snapshot(),
      transcript: {
        active: this.mode === 'recording' || this.mode === 'transcribing',
        status: this.promptTranscriptError
          ? 'error'
          : this.promptTranscribing
            ? 'transcribing'
            : this.mode === 'recording' && this.promptSegmenter.hasOpenSpeech
              ? 'collecting'
              : 'idle',
        text: this.promptTranscriptText,
        error: this.promptTranscriptError,
        updatedAt: this.promptTranscriptUpdatedAt,
      },
      clipboard: {
        mode: this.clipboardMode,
        message: this.clipboardMessage,
        error: this.clipboardError,
      },
      ...(this.lastApprovalCode ? { lastApprovalCode: this.lastApprovalCode } : {}),
      capture: this.capture.snapshot(),
    };
  }

  subscribe(listener: (event: DesktopVoiceEvent) => void): () => void {
    this.desktopSubscriberCount += 1;
    this.events.on('event', listener);
    listener({ type: 'desktop_voice_status', status: this.snapshot() });
    return () => {
      this.events.off('event', listener);
      this.desktopSubscriberCount = Math.max(0, this.desktopSubscriberCount - 1);
    };
  }

  async speak(text: string): Promise<boolean> {
    const trimmed = String(text ?? '').trim();
    if (!trimmed || this.desktopSubscriberCount <= 0) return false;
    if (this.opts.synthesizeSpeechWav) {
      const wav = await this.opts.synthesizeSpeechWav(trimmed);
      this.events.emit('event', {
        type: 'desktop_voice_speak_audio',
        text: trimmed,
        contentType: 'audio/wav',
        audioBase64: wav.toString('base64'),
      } satisfies DesktopVoiceEvent);
      return true;
    }
    this.events.emit('event', { type: 'desktop_voice_speak', text: trimmed } satisfies DesktopVoiceEvent);
    return true;
  }

  toggle(): DesktopVoiceStatus {
    if (this.mode === 'off' || this.mode === 'error') return this.start();
    return this.stop('Desktop voice is off.');
  }

  start(): DesktopVoiceStatus {
    desktopVoiceLog('desktop voice start requested');
    this.mode = 'locked';
    this.message = 'Locked: starting host microphone and local wake model.';
    this.resetApprovalCollection();
    this.touch();
    this.recognizer.start();
    this.capture.start();
    this.emitChange();
    return this.snapshot();
  }

  stop(message = 'Desktop voice is off.'): DesktopVoiceStatus {
    desktopVoiceLog('desktop voice stop requested', { message });
    this.capture.stop();
    this.recognizer.stop();
    this.mode = 'off';
    this.message = message;
    this.promptChunks = [];
    this.resetApprovalCollection();
    this.resetPromptTranscription();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  async toggleClipboardRecording(): Promise<DesktopVoiceStatus> {
    if (this.mode === 'recording' || this.mode === 'transcribing') {
      this.clipboardMode = 'error';
      this.clipboardError = 'Desktop assistant voice is actively streaming.';
      this.clipboardMessage = 'Voice transcription is unavailable while desktop assistant voice is streaming.';
      this.touch();
      this.emitChange();
      return this.snapshot();
    }
    if (this.clipboardMode === 'recording') {
      if (!this.capture.snapshot().active && this.clipboardChunks.length === 0) {
        this.clipboardMode = 'error';
        this.clipboardError = 'Host microphone capture is not active.';
        this.clipboardMessage = `Voice transcription failed: ${this.clipboardError}`;
        this.clipboardStartedCapture = false;
        this.touch();
        this.emitChange();
        return this.snapshot();
      }
      await this.stopClipboardRecording();
      return this.snapshot();
    }
    if (this.clipboardMode === 'transcribing') return this.snapshot();
    desktopVoiceLog('voice clipboard recording start requested');
    this.clipboardMode = 'recording';
    this.clipboardMessage = 'Voice transcription recording.';
    this.clipboardError = null;
    this.clipboardChunks = [];
    this.clipboardStartedCapture = !this.capture.snapshot().active;
    if (this.clipboardStartedCapture) this.capture.start();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  private handleAudio(chunk: Buffer): void {
    if (this.mode !== 'off' && this.mode !== 'error' && this.mode !== 'recording' && this.mode !== 'transcribing') this.recognizer.write(chunk);
    if (this.mode === 'recording') {
      this.promptChunks.push(chunk);
      this.enqueuePromptSegments(this.promptSegmenter.append(chunk));
      if (this.promptSegmenter.hasOpenSpeech) this.emitChange();
    }
    if (this.clipboardMode === 'recording') this.clipboardChunks.push(chunk);
  }

  private handleRecognizedText(text: string, _final: boolean): void {
    if (this.mode === 'off' || this.mode === 'error') return;
    this.touch();
    this.emitChange();

    const approvalUpdate = this.approvalRecognizer.accept(text, Date.now());
    this.handleApprovalUpdate(approvalUpdate);
    if (this.approvalRecognizer.isCollecting) {
      this.scheduleApprovalFinalize();
      return;
    }
    if (approvalUpdate.type !== 'none') {
      return;
    }

    const command = stripCommands(text);
    if (command.status && this.mode === 'sleeping' && this.shouldAcceptCommand('status', 1000)) {
      this.message = 'Asleep: status OK.';
      this.touch();
      this.emitChange();
      return;
    }
    if (command.wake && this.mode === 'sleeping' && this.shouldAcceptCommand('wake', 1500)) {
      this.startAssistantPromptRecording();
      return;
    }
  }

  private scheduleApprovalFinalize(): void {
    if (this.approvalFinalizeTimer) clearTimeout(this.approvalFinalizeTimer);
    this.approvalFinalizeTimer = setTimeout(() => {
      this.approvalFinalizeTimer = null;
      this.handleApprovalUpdate(this.approvalRecognizer.flush(Date.now()));
      if (this.approvalRecognizer.isCollecting && this.mode !== 'off' && this.mode !== 'error') this.scheduleApprovalFinalize();
    }, 250);
    this.approvalFinalizeTimer.unref?.();
  }

  private resetApprovalCollection(): void {
    if (this.approvalFinalizeTimer) {
      clearTimeout(this.approvalFinalizeTimer);
      this.approvalFinalizeTimer = null;
    }
    this.approvalRecognizer.reset();
  }

  private handleApprovalUpdate(update: ApprovalCodeUpdate): void {
    if (update.type === 'none') return;
    if (update.type === 'collecting') {
      if (update.partialCode) {
        this.message = this.mode === 'locked' ? `Unlock: ${update.partialCode}` : `Approval: ${update.partialCode}`;
      } else {
        this.message = this.mode === 'locked' ? 'Unlock code...' : 'Approval code...';
      }
      this.touch();
      this.emitChange();
      return;
    }
    if (update.type === 'cancelled') {
      this.message = 'Approval cancelled.';
      this.touch();
      this.emitChange();
      return;
    }
    this.handleApprovalCode(update.code);
  }

  private handleApprovalCode(code: string): void {
    if (!this.shouldAcceptCommand(`approval:${code}`, 1800)) return;
    this.lastApprovalCode = code;
    if (this.mode === 'locked') {
      if (code === DESKTOP_VOICE_CODES.unlock) {
        this.mode = 'sleeping';
        this.message = 'Asleep: waiting for hey Sebastian.';
      } else if (code === DESKTOP_VOICE_CODES.lockedOff) {
        this.stop('Desktop voice is off.');
        return;
      } else {
        this.message = 'Locked: code ignored.';
      }
      this.touch();
      this.emitChange();
      return;
    }
    if ((this.mode === 'sleeping' || this.mode === 'recording') && code === DESKTOP_VOICE_CODES.lock) {
      this.mode = 'locked';
      this.message = 'Locked: say approval code one two three four.';
      this.promptChunks = [];
      this.resetApprovalCollection();
      this.resetPromptTranscription();
      this.touch();
      this.emitChange();
      return;
    }
    this.message = `Approval code detected: ${code}`;
    this.touch();
    this.emitChange();
  }

  private startAssistantPromptRecording(): void {
    this.mode = 'recording';
    this.message = 'Awake: recording assistant voice prompt.';
    this.promptChunks = [];
    this.resetPromptTranscription();
    this.touch();
    this.emitChange();
  }

  private resetPromptTranscription(): void {
    this.promptSegmenter.reset();
    this.promptSegments = [];
    this.promptTranscribing = false;
    this.promptTranscriptText = '';
    this.promptTranscriptError = null;
    this.promptTranscriptUpdatedAt = null;
  }

  private enqueuePromptSegments(segments: PromptSpeechSegment[]): void {
    if (segments.length === 0) return;
    for (const segment of segments) {
      this.promptSegments.push(segment);
      desktopVoiceLog('queued prompt transcript segment', {
        sequence: segment.sequence,
        reason: segment.reason,
        audioMs: segment.audioMs,
        speechMs: segment.speechMs,
        trailingSilenceMs: segment.trailingSilenceMs,
      });
    }
    this.processPromptTranscriptQueue();
  }

  private processPromptTranscriptQueue(): void {
    if (this.promptTranscribing || this.promptSegments.length === 0 || this.mode !== 'recording') return;
    const segment = this.promptSegments.shift()!;
    this.promptTranscribing = true;
    this.message = 'Awake: transcribing speech segment.';
    this.touch();
    this.emitChange();
    void this.transcribePromptSegment(segment);
  }

  private async transcribePromptSegment(segment: PromptSpeechSegment): Promise<void> {
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(segment.pcm));
      const command = stripCommands(result.text);
      const inferredSleep = !command.sleep && this.shouldInferSleepCommand(result.text, segment);
      const sleep = command.sleep || inferredSleep;
      const text = inferredSleep ? '' : command.text.trim();
      desktopVoiceLog('prompt transcript segment', {
        sequence: segment.sequence,
        model: result.model,
        sleep,
        sleepInferred: inferredSleep,
        rawText: result.text,
        text,
      });
      if (hasTranscriptContent(text)) {
        this.promptTranscriptText = this.promptTranscriptText ? `${this.promptTranscriptText}\n${text}` : text;
        this.promptTranscriptUpdatedAt = new Date().toISOString();
        this.events.emit('event', { type: 'desktop_voice_transcript_segment', text } satisfies DesktopVoiceEvent);
      }
      this.promptTranscriptError = null;
      this.promptTranscribing = false;
      if (sleep && this.mode === 'recording' && this.shouldAcceptCommand('sleep:transcript', 1200)) {
        await this.finishAssistantPromptRecordingFromTranscript();
        return;
      }
      if (this.mode === 'recording') {
        this.message = 'Awake: recording assistant voice prompt.';
        this.touch();
        this.emitChange();
        this.processPromptTranscriptQueue();
      }
    } catch (error: any) {
      this.promptTranscribing = false;
      this.promptTranscriptError = error?.message ?? String(error);
      this.message = `Assistant voice transcription failed: ${this.promptTranscriptError}`;
      this.touch();
      this.emitChange();
      this.processPromptTranscriptQueue();
    }
  }

  private shouldInferSleepCommand(text: string, segment: PromptSpeechSegment): boolean {
    if (segment.speechMs > 900) return false;
    return isLikelyShortSleepMistranscription(text);
  }

  private async finishAssistantPromptRecordingFromTranscript(): Promise<void> {
    const text = this.promptTranscriptText.trim();
    this.promptChunks = [];
    this.promptSegments = [];
    this.promptSegmenter.reset();
    this.mode = 'sleeping';
    this.message = text ? 'Asleep: sending assistant voice prompt.' : 'Asleep: no assistant prompt detected.';
    this.promptTranscribing = false;
    this.touch();
    this.emitChange();
    if (!text) return;
    try {
      await this.opts.submitAssistantPrompt(text);
      if (this.mode === 'sleeping') this.message = 'Asleep: sent assistant voice prompt.';
    } catch (error: any) {
      if (this.mode === 'sleeping') this.message = `Assistant voice prompt failed: ${error?.message ?? String(error)}`;
    }
    this.promptTranscribing = false;
    this.touch();
    this.emitChange();
  }

  private shouldAcceptCommand(key: string, cooldownMs: number): boolean {
    const now = Date.now();
    const last = this.lastCommandAt.get(key) ?? 0;
    if (now - last < cooldownMs) return false;
    this.lastCommandAt.set(key, now);
    return true;
  }

  private async finishAssistantPromptRecording(): Promise<void> {
    const pcm = Buffer.concat(this.promptChunks);
    this.promptChunks = [];
    this.mode = 'transcribing';
    this.message = 'Transcribing assistant voice prompt.';
    this.touch();
    this.emitChange();
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(pcm));
      const text = stripCommands(result.text).text.trim();
      if (text) await this.opts.submitAssistantPrompt(text);
      this.mode = 'sleeping';
      this.message = text ? 'Asleep: sent assistant voice prompt.' : 'Asleep: no assistant prompt detected.';
    } catch (error: any) {
      this.mode = 'sleeping';
      this.message = `Assistant voice transcription failed: ${error?.message ?? String(error)}`;
    }
    this.touch();
    this.emitChange();
  }

  private async stopClipboardRecording(): Promise<void> {
    const pcm = Buffer.concat(this.clipboardChunks);
    this.clipboardChunks = [];
    this.clipboardMode = 'transcribing';
    this.clipboardMessage = 'Transcribing voice recording.';
    this.clipboardError = null;
    this.touch();
    this.emitChange();
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(pcm));
      const text = result.text.trim();
      if (!text) throw new Error('The transcription was empty.');
      this.clipboardMode = 'idle';
      this.clipboardMessage = `Transcribed ${text.length.toLocaleString()} characters.`;
      this.events.emit('event', { type: 'desktop_voice_clipboard_result', text } satisfies DesktopVoiceEvent);
    } catch (error: any) {
      this.clipboardMode = 'error';
      this.clipboardError = error?.message ?? String(error);
      this.clipboardMessage = `Voice transcription failed: ${this.clipboardError}`;
    } finally {
      if (this.clipboardStartedCapture && this.mode === 'off') this.capture.stop();
      this.clipboardStartedCapture = false;
      this.touch();
      this.emitChange();
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }

  private emitChange(): void {
    this.events.emit('event', { type: 'desktop_voice_status', status: this.snapshot() } satisfies DesktopVoiceEvent);
  }
}
