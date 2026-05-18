import { describe, expect, test } from 'bun:test';

import { buildVoiceStreamProcessEnv } from '../src/hub/voice-stream-launch';

describe('voice stream launch env', () => {
  test('injects the Hub Groq key for STT and TTS', () => {
    const env = buildVoiceStreamProcessEnv({ GROQ_API_KEY: 'env-groq' }, { port: 3100, groqApiKey: 'settings-groq' });

    expect(env.PORT).toBe('3100');
    expect(env.GROQ_API_KEY).toBe('settings-groq');
    expect(env.GROQ_TTS_API_KEY).toBe('settings-groq');
  });

  test('keeps an explicit TTS key when one is already configured', () => {
    const env = buildVoiceStreamProcessEnv(
      { GROQ_TTS_API_KEY: 'tts-groq' },
      { port: 3100, groqApiKey: 'settings-groq' },
    );

    expect(env.GROQ_API_KEY).toBe('settings-groq');
    expect(env.GROQ_TTS_API_KEY).toBe('tts-groq');
  });

  test('preserves inherited Groq env when no Hub Groq key is stored', () => {
    const env = buildVoiceStreamProcessEnv({ GROQ_API_KEY: 'env-groq' }, { port: 3100, groqApiKey: null });

    expect(env.GROQ_API_KEY).toBe('env-groq');
    expect(env.GROQ_TTS_API_KEY).toBeUndefined();
  });
});
