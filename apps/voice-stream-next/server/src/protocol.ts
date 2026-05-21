export const VOICE_STREAM_PROTOCOL_VERSION = 1;
export const MAX_STREAM_BYTES = 24 * 1024 * 1024;
export const MAX_STREAM_DURATION_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 15_000;

export const VoiceCloseCode = {
  InvalidMessage: 4400,
  Unauthorized: 4401,
  TooLarge: 4409,
  TooLong: 4410,
} as const;

export type VoiceClientMessage =
  | { type: 'client_hello'; protocolVersion?: number; client?: string; mode?: string }
  | { type: 'client_ping'; sentAt?: string }
  | { type: 'end'; reason?: string };

export function parseVoiceClientMessage(raw: unknown): VoiceClientMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type === 'client_hello') {
    return {
      type: 'client_hello',
      protocolVersion: Number.isInteger(parsed.protocolVersion) ? parsed.protocolVersion : undefined,
      client: typeof parsed.client === 'string' ? parsed.client.slice(0, 80) : undefined,
      mode: typeof parsed.mode === 'string' ? parsed.mode.slice(0, 40) : undefined,
    };
  }
  if (parsed.type === 'client_ping') {
    return {
      type: 'client_ping',
      sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : undefined,
    };
  }
  if (parsed.type === 'end') {
    return {
      type: 'end',
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : undefined,
    };
  }
  return null;
}
