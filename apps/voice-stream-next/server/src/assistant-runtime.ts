import { pcm16ToWav } from './wav.js';

export type RuntimeResult = {
  text: string;
  provider: 'openai' | 'groq' | 'fallback';
};

const GROQ_TRANSCRIPTION_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TTS_DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_TRANSCRIPTION_DEFAULT_MODEL = 'whisper-large-v3-turbo';
const GROQ_TTS_DEFAULT_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_TTS_DEFAULT_VOICE = 'austin';

function openAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || process.env.VOICE_STREAM_NEXT_OPENAI_API_KEY?.trim() || '';
}

function groqApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_API_KEY?.trim() || '';
}

function groqSttApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_STT_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_STT_API_KEY?.trim() || groqApiKey(env);
}

function groqTtsApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_TTS_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_TTS_API_KEY?.trim() || groqApiKey(env);
}

function assistantModel(): string {
  return process.env.VOICE_STREAM_NEXT_ASSISTANT_MODEL?.trim() || 'gpt-5.2';
}

function groqSttModel(): string {
  return process.env.GROQ_STT_MODEL?.trim() ||
    process.env.GROQ_TRANSCRIPTION_MODEL?.trim() ||
    process.env.VOICE_STREAM_NEXT_STT_MODEL?.trim() ||
    GROQ_TRANSCRIPTION_DEFAULT_MODEL;
}

function groqTtsEndpoint(): string {
  return process.env.GROQ_TTS_ENDPOINT?.trim() ||
    process.env.VOICE_STREAM_NEXT_GROQ_TTS_ENDPOINT?.trim() ||
    GROQ_TTS_DEFAULT_ENDPOINT;
}

function groqTtsModel(): string {
  return process.env.GROQ_TTS_MODEL?.trim() ||
    process.env.VOICE_STREAM_NEXT_TTS_MODEL?.trim() ||
    GROQ_TTS_DEFAULT_MODEL;
}

function groqTtsVoice(): string {
  return process.env.GROQ_TTS_VOICE?.trim() ||
    process.env.VOICE_STREAM_NEXT_TTS_VOICE?.trim() ||
    GROQ_TTS_DEFAULT_VOICE;
}

export function hasOpenAiRuntime(): boolean {
  return Boolean(openAiApiKey());
}

export function hasGroqSpeechRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(groqSttApiKey(env));
}

export async function generateAssistantReply(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<RuntimeResult> {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content.trim() || '';
  if (!openAiApiKey()) {
    return {
      provider: 'fallback',
      text: fallbackReply(lastUserMessage),
    };
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify({
      model: assistantModel(),
      instructions: 'You are VoiceStream, a concise voice assistant. Answer directly and keep spoken replies short.',
      input: messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n'),
    }),
  });
  const body = await parseOpenAiResponse(response);
  return {
    provider: 'openai',
    text: String(body.output_text ?? '').trim() || fallbackReply(lastUserMessage),
  };
}

export async function transcribePcm16(pcm: Uint8Array): Promise<RuntimeResult> {
  const testTranscript = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
  if (testTranscript != null) {
    return {
      provider: 'fallback',
      text: testTranscript.trim(),
    };
  }
  if (!groqSttApiKey()) {
    return {
      provider: 'fallback',
      text: '',
    };
  }
  if (pcm.byteLength < 1600) {
    return {
      provider: 'fallback',
      text: '',
    };
  }

  const wav = pcm16ToWav(pcm);
  const wavBody = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append('model', groqSttModel());
  form.append('file', new Blob([wavBody], { type: 'audio/wav' }), 'voice-stream.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const response = await fetch(GROQ_TRANSCRIPTION_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${groqSttApiKey()}` },
    body: form,
  });
  const body = await parseProviderJsonResponse(response, 'GROQ transcription');
  return {
    provider: 'groq',
    text: String(body.text ?? '').trim(),
  };
}

export async function synthesizeSpeech(text: string): Promise<{ audio: Uint8Array | null; provider: 'groq' | 'fallback' }> {
  const input = text.trim().slice(0, 4096);
  if (!groqTtsApiKey() || !input) {
    return { audio: null, provider: 'fallback' };
  }
  const response = await fetch(groqTtsEndpoint(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${groqTtsApiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: groqTtsModel(),
      voice: groqTtsVoice(),
      input,
      response_format: 'wav',
    }),
  });
  if (!response.ok) await parseProviderJsonResponse(response, 'GROQ TTS');
  return {
    provider: 'groq',
    audio: new Uint8Array(await response.arrayBuffer()),
  };
}

function fallbackReply(prompt: string): string {
  if (!prompt) return 'I did not catch anything yet.';
  return `I heard: ${prompt}`;
}

function openAiHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${openAiApiKey()}`,
    'content-type': 'application/json',
  };
}

async function parseOpenAiResponse(response: Response): Promise<any> {
  return parseProviderJsonResponse(response, 'OpenAI');
}

async function parseProviderJsonResponse(response: Response, providerLabel: string): Promise<any> {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text } };
  }
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.message ?? `${providerLabel} request failed: ${response.status}`);
  }
  return body;
}
