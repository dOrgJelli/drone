import { pcm16ToWav } from './wav.js';

export type RuntimeResult = {
  text: string;
  provider: 'openai' | 'fallback';
};

function apiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || process.env.VOICE_STREAM_NEXT_OPENAI_API_KEY?.trim() || '';
}

function assistantModel(): string {
  return process.env.VOICE_STREAM_NEXT_ASSISTANT_MODEL?.trim() || 'gpt-5.2';
}

function sttModel(): string {
  return process.env.VOICE_STREAM_NEXT_STT_MODEL?.trim() || 'gpt-4o-mini-transcribe';
}

function ttsModel(): string {
  return process.env.VOICE_STREAM_NEXT_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
}

function ttsVoice(): string {
  return process.env.VOICE_STREAM_NEXT_TTS_VOICE?.trim() || 'alloy';
}

export function hasOpenAiRuntime(): boolean {
  return Boolean(apiKey());
}

export async function generateAssistantReply(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<RuntimeResult> {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content.trim() || '';
  if (!apiKey()) {
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
  if (!apiKey()) {
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
  form.append('model', sttModel());
  form.append('file', new Blob([wavBody], { type: 'audio/wav' }), 'voice-stream.wav');
  form.append('response_format', 'json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  const body = await parseOpenAiResponse(response);
  return {
    provider: 'openai',
    text: String(body.text ?? '').trim(),
  };
}

export async function synthesizeSpeech(text: string): Promise<{ audio: Uint8Array | null; provider: 'openai' | 'fallback' }> {
  const input = text.trim().slice(0, 4096);
  if (!apiKey() || !input) {
    return { audio: null, provider: 'fallback' };
  }
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify({
      model: ttsModel(),
      voice: ttsVoice(),
      input,
      response_format: 'wav',
    }),
  });
  if (!response.ok) await parseOpenAiResponse(response);
  return {
    provider: 'openai',
    audio: new Uint8Array(await response.arrayBuffer()),
  };
}

function fallbackReply(prompt: string): string {
  if (!prompt) return 'I did not catch anything yet.';
  return `I heard: ${prompt}`;
}

function openAiHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey()}`,
    'content-type': 'application/json',
  };
}

async function parseOpenAiResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text } };
  }
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `OpenAI request failed: ${response.status}`);
  }
  return body;
}
