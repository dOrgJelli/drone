import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { DesktopVoiceService } from '../src/hub/desktop-voice-service';
import { VOICE_APPROVAL_SETTINGS_DEFAULT } from '../src/hub/hub-settings';

function createFakeClipboardRecorder(opts: {
  start?: () => Promise<void>;
  stop?: (tailPadMs: number) => Promise<Buffer>;
  cancel?: () => void;
  active?: boolean;
} = {}) {
  let active = opts.active ?? false;
  return {
    recorder: {
      snapshot: () => ({
        active,
        backend: 'fake',
        tmp: active ? '/tmp/fake.wav' : null,
        error: null,
        firstDataElapsedMs: active ? 0 : null,
        lastObservedSize: active ? 128 : null,
      }),
      start: async () => {
        await opts.start?.();
        active = true;
      },
      stop: async (tailPadMs: number) => {
        active = false;
        return opts.stop ? await opts.stop(tailPadMs) : Buffer.from('wav-bytes');
      },
      cancel: () => {
        active = false;
        opts.cancel?.();
      },
    },
  };
}

describe('DesktopVoiceService', () => {
  const originalClipboardPrewarm = process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM;

  beforeEach(() => {
    process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM = '0';
  });

  afterEach(() => {
    if (originalClipboardPrewarm == null) delete process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM;
    else process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM = originalClipboardPrewarm;
  });

  test('returns to sleeping immediately when transcript sleep command finishes recording', async () => {
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    let submittedPrompt = '';
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async (prompt) => {
        submittedPrompt = prompt;
        await submitPromise;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptTranscriptText = 'check the build';

    const finishPromise = (service as any).finishAssistantPromptRecordingFromTranscript() as Promise<void>;
    await Promise.resolve();

    expect(service.snapshot().mode).toBe('sleeping');
    expect(service.snapshot().message).toBe('Asleep: sending assistant voice prompt.');
    expect(submittedPrompt).toBe('check the build');

    resolveSubmit();
    await finishPromise;

    expect(service.snapshot().mode).toBe('sleeping');
    expect(service.snapshot().message).toBe('Asleep: sent assistant voice prompt.');
  });

  test('aborts normal assistant voice recording without submitting prompt text', async () => {
    let submitCalls = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {
        submitCalls += 1;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).promptTranscriptText = 'do not send this';

    await (service as any).abortPromptRecordingFromTranscript();

    expect(service.snapshot().mode).toBe('sleeping');
    expect(service.snapshot().message).toBe('Asleep: assistant voice prompt cancelled.');
    expect(service.snapshot().transcript.text).toBe('');
    expect(submitCalls).toBe(0);
  });

  test('does not emit transcript text when abort phrase is in the same segment', async () => {
    const phrases = ['ok stop', 'ok, stop', 'okay stop', 'okay, stop'];
    for (const phrase of phrases) {
      let submitCalls = 0;
      const service = new DesktopVoiceService({
        transcribeWav: async () => ({ text: `do not leak this ${phrase}`, model: 'test' }),
        submitAssistantPrompt: async () => {
          submitCalls += 1;
        },
      });
      const events: any[] = [];
      const unsubscribe = service.subscribe((event) => events.push(event));

      (service as any).mode = 'recording';
      (service as any).promptCaptureTarget = 'assistant';
      await (service as any).transcribePromptSegment({
        pcm: Buffer.alloc(3200),
        audioMs: 100,
        speechMs: 100,
        trailingSilenceMs: 0,
        reason: 'flush',
        sequence: 1,
      });

      unsubscribe();

      expect(service.snapshot().mode).toBe('sleeping');
      expect(service.snapshot().message).toBe('Asleep: assistant voice prompt cancelled.');
      expect(service.snapshot().transcript.text).toBe('');
      expect(submitCalls).toBe(0);
      expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
    }
  });

  test('does not emit transcript text when abort phrase follows dictated text', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'do not leak this okay stop', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    unsubscribe();

    expect(service.snapshot().mode).toBe('sleeping');
    expect(service.snapshot().transcript.text).toBe('');
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
  });

  test('does not emit transcript segments for patch or clipboard captures', async () => {
    const texts = ['patch text', 'clipboard text'];
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: texts.shift() ?? '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const segment = {
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    };

    (service as any).promptCaptureTarget = 'patch';
    (service as any).promptTranscriptText = '';
    (service as any).mode = 'recording';
    await (service as any).transcribePromptSegment(segment);

    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = '';
    (service as any).mode = 'recording';
    await (service as any).transcribePromptSegment(segment);

    unsubscribe();

    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
  });

  test('briefly suppresses wake commands after desktop voice transcription stops', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = 'copy this';

    await (service as any).finishPromptRecordingFromTranscript();
    expect(service.snapshot().mode).toBe('sleeping');

    (service as any).handleRecognizedText('can you transcribe', true);
    expect(service.snapshot().mode).toBe('sleeping');

    (service as any).promptCommandSuppressedUntil = Date.now() - 1;
    (service as any).handleRecognizedText('can you transcribe', true);
    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('clipboard');
  });

  test('uses configured post-prompt command suppression delay', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    service.setApprovalSettings({
      ...VOICE_APPROVAL_SETTINGS_DEFAULT,
      postPromptCommandSuppressionMs: 0,
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = 'copy this';

    await (service as any).finishPromptRecordingFromTranscript();
    (service as any).handleRecognizedText('can you transcribe', true);

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('clipboard');
  });

  test('emits synthesized audio for desktop speak when a TTS synthesizer is configured', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
      synthesizeSpeechWav: async () => Buffer.from('wav-bytes'),
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    await expect(service.speak('hello')).resolves.toBe(true);
    unsubscribe();

    const speakEvent = events.find((event) => event.type === 'desktop_voice_speak_audio');
    expect(speakEvent?.contentType).toBe('audio/wav');
    expect(speakEvent?.audioBase64).toBe(Buffer.from('wav-bytes').toString('base64'));
  });

  test('cancels clipboard recording without transcribing buffered audio', () => {
    let transcribeCalls = 0;
    let cancelCalls = 0;
    const fake = createFakeClipboardRecorder({
      active: true,
      cancel: () => {
        cancelCalls += 1;
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => {
        transcribeCalls += 1;
        return { text: 'ignored', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    (service as any).clipboardMode = 'recording';
    (service as any).clipboardMessage = 'Voice transcription recording.';

    const status = service.cancelClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.clipboard.message).toBe('Voice transcription cancelled.');
    expect(cancelCalls).toBe(1);
    expect(transcribeCalls).toBe(0);
  });

  test('suppresses a late clipboard start after cancel', async () => {
    let startCalls = 0;
    const fake = createFakeClipboardRecorder({
      start: async () => {
        startCalls += 1;
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'ignored', model: 'test' }),
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    service.cancelClipboardRecording();
    const status = await service.toggleClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(startCalls).toBe(0);
  });

  test('clipboard recording transcribes recorder wav bytes with tail padding', async () => {
    let transcribed: Buffer | null = null;
    let tailPadMs = 0;
    const fake = createFakeClipboardRecorder({
      stop: async (nextTailPadMs) => {
        tailPadMs = nextTailPadMs;
        return Buffer.from('fake-wav');
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async (wav) => {
        transcribed = wav;
        return { text: 'hello world', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    await service.toggleClipboardRecording();
    const status = await service.toggleClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.clipboard.message).toBe('Transcribed 11 characters.');
    expect(transcribed?.toString('utf8')).toBe('fake-wav');
    expect(tailPadMs).toBe(400);
  });
});
