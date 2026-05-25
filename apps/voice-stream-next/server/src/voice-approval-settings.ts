export type VoiceApprovalSettings = {
  triggerPhrase: string;
  unlockCode: string;
  lockCode: string;
  lockedOffCode: string;
  minDigits: number;
  maxDigits: number;
  stableMs: number;
  collectTimeoutMs: number;
  duplicateCooldownMs: number;
  finalizeCheckIntervalMs: number;
  postPromptCommandSuppressionMs: number;
};

export type VoiceApprovalSettingsLimits = {
  triggerPhraseMaxChars: number;
  codeMaxDigits: number;
  minDigitsMin: number;
  minDigitsMax: number;
  maxDigitsMin: number;
  maxDigitsMax: number;
  stableMsMin: number;
  stableMsMax: number;
  collectTimeoutMsMin: number;
  collectTimeoutMsMax: number;
  duplicateCooldownMsMin: number;
  duplicateCooldownMsMax: number;
  finalizeCheckIntervalMsMin: number;
  finalizeCheckIntervalMsMax: number;
  postPromptCommandSuppressionMsMin: number;
  postPromptCommandSuppressionMsMax: number;
};

export const VOICE_APPROVAL_SETTINGS_DEFAULT: VoiceApprovalSettings = {
  triggerPhrase: 'approval code',
  unlockCode: '1234',
  lockCode: '4321',
  lockedOffCode: '0000',
  minDigits: 4,
  maxDigits: 8,
  stableMs: 900,
  collectTimeoutMs: 5_000,
  duplicateCooldownMs: 4_000,
  finalizeCheckIntervalMs: 250,
  postPromptCommandSuppressionMs: 1_800,
};

export const VOICE_APPROVAL_SETTINGS_LIMITS: VoiceApprovalSettingsLimits = {
  triggerPhraseMaxChars: 64,
  codeMaxDigits: 8,
  minDigitsMin: 1,
  minDigitsMax: 8,
  maxDigitsMin: 1,
  maxDigitsMax: 12,
  stableMsMin: 250,
  stableMsMax: 3_000,
  collectTimeoutMsMin: 1_000,
  collectTimeoutMsMax: 15_000,
  duplicateCooldownMsMin: 0,
  duplicateCooldownMsMax: 15_000,
  finalizeCheckIntervalMsMin: 100,
  finalizeCheckIntervalMsMax: 1_000,
  postPromptCommandSuppressionMsMin: 0,
  postPromptCommandSuppressionMsMax: 5_000,
};

function normalizeTriggerPhrase(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return text.length > VOICE_APPROVAL_SETTINGS_LIMITS.triggerPhraseMaxChars
    ? text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.triggerPhraseMaxChars).trim()
    : text;
}

function normalizeCode(raw: unknown): string {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/\D/g, '') : '';
  if (!text) return '';
  return text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.codeMaxDigits);
}

function parseIntegerInRange(raw: unknown, min: number, max: number): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const next = Math.floor(value);
  if (next < min || next > max) return null;
  return next;
}

export function parseVoiceApprovalSettings(raw: unknown): VoiceApprovalSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const triggerPhrase = normalizeTriggerPhrase(value.triggerPhrase);
  const unlockCode = normalizeCode(value.unlockCode);
  const lockCode = normalizeCode(value.lockCode);
  const lockedOffCode = normalizeCode(value.lockedOffCode ?? value.offCode);
  const minDigits = parseIntegerInRange(value.minDigits, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMax);
  const maxDigits = parseIntegerInRange(value.maxDigits, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMax);
  const stableMs = parseIntegerInRange(value.stableMs, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMin, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMax);
  const collectTimeoutMs = parseIntegerInRange(
    value.collectTimeoutMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMax,
  );
  const duplicateCooldownMs = parseIntegerInRange(
    value.duplicateCooldownMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMax,
  );
  const finalizeCheckIntervalMs = parseIntegerInRange(
    value.finalizeCheckIntervalMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMax,
  );
  const postPromptCommandSuppressionMs = parseIntegerInRange(
    value.postPromptCommandSuppressionMs ?? VOICE_APPROVAL_SETTINGS_DEFAULT.postPromptCommandSuppressionMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMax,
  );
  if (
    !triggerPhrase ||
    !unlockCode ||
    !lockCode ||
    !lockedOffCode ||
    minDigits == null ||
    maxDigits == null ||
    stableMs == null ||
    collectTimeoutMs == null ||
    duplicateCooldownMs == null ||
    finalizeCheckIntervalMs == null ||
    postPromptCommandSuppressionMs == null
  ) {
    return null;
  }
  if (maxDigits < minDigits) return null;
  const codeSet = new Set([unlockCode, lockCode, lockedOffCode]);
  if (codeSet.size !== 3) return null;
  if ([unlockCode, lockCode, lockedOffCode].some((code) => code.length > maxDigits)) return null;
  return {
    triggerPhrase,
    unlockCode,
    lockCode,
    lockedOffCode,
    minDigits,
    maxDigits,
    stableMs,
    collectTimeoutMs,
    duplicateCooldownMs,
    finalizeCheckIntervalMs,
    postPromptCommandSuppressionMs,
  };
}

export function voiceApprovalSettingsResponse(settings: VoiceApprovalSettings & { updatedAt: string; speechPlaybackTarget?: string }) {
  return {
    ok: true as const,
    settings: {
      triggerPhrase: settings.triggerPhrase,
      unlockCode: settings.unlockCode,
      lockCode: settings.lockCode,
      lockedOffCode: settings.lockedOffCode,
      minDigits: settings.minDigits,
      maxDigits: settings.maxDigits,
      stableMs: settings.stableMs,
      collectTimeoutMs: settings.collectTimeoutMs,
      duplicateCooldownMs: settings.duplicateCooldownMs,
      finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
      postPromptCommandSuppressionMs: settings.postPromptCommandSuppressionMs,
      speechPlaybackTarget: settings.speechPlaybackTarget ?? 'auto',
      updatedAt: settings.updatedAt,
    },
    defaults: VOICE_APPROVAL_SETTINGS_DEFAULT,
    limits: VOICE_APPROVAL_SETTINGS_LIMITS,
  };
}

export function approvalRecognizerOptions(settings: VoiceApprovalSettings) {
  return {
    triggerPhrase: settings.triggerPhrase,
    minDigits: settings.minDigits,
    maxDigits: settings.maxDigits,
    stableMs: settings.stableMs,
    collectTimeoutMs: settings.collectTimeoutMs,
    duplicateCooldownMs: settings.duplicateCooldownMs,
    finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
  };
}
