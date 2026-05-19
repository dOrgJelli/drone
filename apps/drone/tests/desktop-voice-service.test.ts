import { describe, expect, test } from 'bun:test';

import { DesktopVoiceService } from '../src/hub/desktop-voice-service';

describe('DesktopVoiceService', () => {
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
    const service = new DesktopVoiceService({
      transcribeWav: async () => {
        transcribeCalls += 1;
        return { text: 'ignored', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
    });

    (service as any).clipboardMode = 'recording';
    (service as any).clipboardMessage = 'Voice transcription recording.';
    (service as any).clipboardChunks = [Buffer.from([1, 2, 3, 4])];

    const status = service.cancelClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.clipboard.message).toBe('Voice transcription cancelled.');
    expect((service as any).clipboardChunks).toEqual([]);
    expect(transcribeCalls).toBe(0);
  });

  test('suppresses a late clipboard start after cancel', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'ignored', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    service.cancelClipboardRecording();
    const status = await service.toggleClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.capture.active).toBe(false);
  });
});
