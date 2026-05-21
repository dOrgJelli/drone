import { describe, expect, test } from 'bun:test';

import {
  StreamingTranscriptionManager,
  buildStreamingTranscriptionConfigFromEnv,
  hasTranscriptContent,
  stripTranscriptCommands,
} from './streaming-transcription.js';

describe('stripTranscriptCommands', () => {
  test('detects sleep and abort terminal phrases', () => {
    const sleep = stripTranscriptCommands("Please summarize the notes, that's it.");
    expect(sleep.sleepDetected).toBe(true);
    expect(sleep.sleepPhrase).toBeTruthy();
    expect(sleep.abortDetected).toBe(false);
    expect(sleep.text).toBe('Please summarize the notes,');

    const abort = stripTranscriptCommands('Never mind, okay stop now.');
    expect(abort.abortDetected).toBe(true);
    expect(abort.abortPhrase).toBeTruthy();
    expect(abort.sleepDetected).toBe(false);
    expect(abort.text).toBe('Never mind, now.');
  });

  test('detects cancel and abort aliases', () => {
    const cancel = stripTranscriptCommands('Scratch that, cancel this.');
    expect(cancel.abortDetected).toBe(true);
    expect(cancel.text).toBe('Scratch that,');
  });

  test('strips wake phrases without finishing the recording', () => {
    const wake = stripTranscriptCommands('Hey Sebastian, patch me in for the meeting.');
    expect(wake.wakeDetected).toBe(true);
    expect(wake.sleepDetected).toBe(false);
    expect(wake.abortDetected).toBe(false);
    expect(wake.text).toBe('for the meeting.');
  });
});

describe('hasTranscriptContent', () => {
  test('requires letters or numbers', () => {
    expect(hasTranscriptContent('')).toBe(false);
    expect(hasTranscriptContent('...')).toBe(false);
    expect(hasTranscriptContent('hello')).toBe(true);
  });
});

describe('StreamingTranscriptionManager', () => {
  test('auto-finishes on sleep phrase using test transcript hook', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = "Please capture this note, that's it.";
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('sleep');
    expect(commands[0]?.transcriptText).toContain('Please capture this note');
  });

  test('auto-aborts on stop phrase using test transcript hook', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Scratch that, okay stop.';
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('abort');
    expect(commands[0]?.transcriptText).toBe('');
  });
});

function speechLikeChunk(): Uint8Array {
  const samples = new Int16Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? 2500 : -2500;
  }
  return new Uint8Array(samples.buffer);
}

function silentChunk(): Uint8Array {
  return new Uint8Array(4096 * 2);
}
