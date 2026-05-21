export const PAIRING_PAYLOAD_VERSION = 1;
export const DEFAULT_PAIRING_TTL_MS = 15 * 60 * 1000;

export type PairingPayloadInput = {
  serverUrl: string;
  deviceId: string;
  token: string;
  deviceType: string;
  displayName: string;
  protocolVersion: number;
  expiresAt: string;
  pairingSessionId: string;
};

export type PairingPayload = PairingPayloadInput & {
  version: number;
  minClientVersion: number;
};

export function minClientVersion(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_MIN_CLIENT_VERSION ?? 1);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

export function pairingTtlMs(): number {
  const raw = Number(process.env.VOICE_STREAM_NEXT_PAIRING_TTL_MS ?? DEFAULT_PAIRING_TTL_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PAIRING_TTL_MS;
}

export function pairingExpiresAt(from = Date.now()): string {
  return new Date(from + pairingTtlMs()).toISOString();
}

export function buildPairingPayload(input: PairingPayloadInput): { payload: PairingPayload; payloadUri: string } {
  const payload: PairingPayload = {
    ...input,
    version: PAIRING_PAYLOAD_VERSION,
    minClientVersion: minClientVersion(),
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    params.set(key, String(value));
  }
  return {
    payload,
    payloadUri: `voicestream://pair?${params.toString()}`,
  };
}

export function parseClientVersion(raw: unknown, fallback: number | null = null): number | null {
  if (Number.isInteger(raw)) return Number(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const leading = trimmed.match(/^(\d+)/);
    if (leading) return Number(leading[1]);
  }
  return fallback;
}

export function clientVersionSupported(clientVersion: number | null): boolean {
  if (clientVersion == null) return true;
  return clientVersion >= minClientVersion();
}
