import React from 'react';
import type { VoiceApprovalSettings, VoiceTranscriptionSettings } from './settings-types';
import type { UseVoiceApprovalSettingsResult } from './use-voice-approval-settings';

type VoiceApprovalSettingsTabProps = {
  voiceApproval: UseVoiceApprovalSettingsResult;
};

type NumberField = {
  key: keyof Pick<
    VoiceApprovalSettings,
    | 'minDigits'
    | 'maxDigits'
    | 'stableMs'
    | 'collectTimeoutMs'
    | 'duplicateCooldownMs'
    | 'finalizeCheckIntervalMs'
    | 'postPromptCommandSuppressionMs'
  >;
  label: string;
  description: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
};

function sameSettings(a: VoiceApprovalSettings | null, b: VoiceApprovalSettings | null): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameTranscriptionSettings(a: VoiceTranscriptionSettings | null, b: VoiceTranscriptionSettings | null): boolean {
  if (!a || !b) return false;
  return a.finalMode === b.finalMode;
}

function savedSettings(input: UseVoiceApprovalSettingsResult): VoiceApprovalSettings | null {
  const value = input.voiceApprovalSettings?.voiceApproval;
  if (!value) return null;
  return {
    triggerPhrase: value.triggerPhrase,
    unlockCode: value.unlockCode,
    lockCode: value.lockCode,
    lockedOffCode: value.lockedOffCode,
    minDigits: value.minDigits,
    maxDigits: value.maxDigits,
    stableMs: value.stableMs,
    collectTimeoutMs: value.collectTimeoutMs,
    duplicateCooldownMs: value.duplicateCooldownMs,
    finalizeCheckIntervalMs: value.finalizeCheckIntervalMs,
    postPromptCommandSuppressionMs: value.postPromptCommandSuppressionMs,
  };
}

function savedTranscriptionSettings(input: UseVoiceApprovalSettingsResult): VoiceTranscriptionSettings | null {
  const value = input.voiceApprovalSettings?.voiceTranscription;
  if (!value) return null;
  return {
    finalMode: value.finalMode,
  };
}

function codeOnly(value: string, maxDigits: number): string {
  return value.replace(/\D/g, '').slice(0, maxDigits);
}

export function VoiceApprovalSettingsTab({ voiceApproval }: VoiceApprovalSettingsTabProps) {
  const {
    voiceApprovalSettings,
    voiceApprovalSettingsLoading,
    voiceApprovalSettingsError,
    voiceApprovalSettingsNotice,
    voiceApprovalDraft,
    voiceTranscriptionDraft,
    savingVoiceApprovalSettings,
    setVoiceApprovalDraft,
    setVoiceTranscriptionDraft,
    saveVoiceApprovalSettings,
  } = voiceApproval;
  const limits = voiceApprovalSettings?.limits;
  const defaults = voiceApprovalSettings?.defaults;
  const transcriptionDefaults = voiceApprovalSettings?.transcriptionDefaults;
  const saved = savedSettings(voiceApproval);
  const savedTranscription = savedTranscriptionSettings(voiceApproval);
  const dirty = !sameSettings(voiceApprovalDraft, saved) || !sameTranscriptionSettings(voiceTranscriptionDraft, savedTranscription);

  const updateDraft = React.useCallback(
    (patch: Partial<VoiceApprovalSettings>) => {
      setVoiceApprovalDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (next.maxDigits < next.minDigits) next.maxDigits = next.minDigits;
        return next;
      });
    },
    [setVoiceApprovalDraft],
  );

  if (voiceApprovalSettingsLoading && !voiceApprovalDraft) {
    return <div className="text-[12px] text-[var(--muted-dim)]">Loading voice approval settings...</div>;
  }

  if (!voiceApprovalDraft || !voiceTranscriptionDraft || !limits || !defaults || !transcriptionDefaults) {
    return (
      <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
        {voiceApprovalSettingsError ?? 'Voice approval settings are unavailable.'}
      </div>
    );
  }

  const codeFields: Array<{
    key: keyof Pick<VoiceApprovalSettings, 'unlockCode' | 'lockCode' | 'lockedOffCode'>;
    label: string;
    description: string;
  }> = [
    { key: 'unlockCode', label: 'Unlock code', description: 'Digits that re-enable voice handling after approval locking is on.' },
    { key: 'lockCode', label: 'Legacy lock code', description: 'Kept for saved settings. Awake voice now locks when you say go to sleep.' },
    { key: 'lockedOffCode', label: 'Off code', description: 'Digits that fully disable voice while awake or locked.' },
  ];

  const numberFields: NumberField[] = [
    {
      key: 'minDigits',
      label: 'Minimum digits',
      description: 'Shortest approval code allowed.',
      suffix: 'digits',
      min: limits.minDigitsMin,
      max: limits.minDigitsMax,
      step: 1,
    },
    {
      key: 'maxDigits',
      label: 'Maximum digits',
      description: 'Longest approval code allowed.',
      suffix: 'digits',
      min: limits.maxDigitsMin,
      max: limits.maxDigitsMax,
      step: 1,
    },
    {
      key: 'stableMs',
      label: 'Pause before accepting',
      description: 'After the last digit is heard, wait this long before running the code. This gives speech recognition time to finish correcting or adding digits.',
      suffix: 'ms',
      min: limits.stableMsMin,
      max: limits.stableMsMax,
      step: 50,
    },
    {
      key: 'collectTimeoutMs',
      label: 'Code entry timeout',
      description: 'After the trigger phrase, give up if no complete code is heard within this time.',
      suffix: 'ms',
      min: limits.collectTimeoutMsMin,
      max: limits.collectTimeoutMsMax,
      step: 250,
    },
    {
      key: 'duplicateCooldownMs',
      label: 'Repeat protection',
      description: 'Ignore the same code for this long after it fires, so one spoken code cannot accidentally trigger twice.',
      suffix: 'ms',
      min: limits.duplicateCooldownMsMin,
      max: limits.duplicateCooldownMsMax,
      step: 250,
    },
    {
      key: 'finalizeCheckIntervalMs',
      label: 'Readiness check rate',
      description: 'How often the app checks whether the pause before accepting has finished. Lower values react a little faster; higher values do less background checking.',
      suffix: 'ms',
      min: limits.finalizeCheckIntervalMsMin,
      max: limits.finalizeCheckIntervalMsMax,
      step: 25,
    },
    {
      key: 'postPromptCommandSuppressionMs',
      label: 'Post-prompt command delay',
      description: 'After desktop voice hears a stop phrase, ignore wake commands for this long so trailing audio cannot restart recording.',
      suffix: 'ms',
      min: limits.postPromptCommandSuppressionMsMin,
      max: limits.postPromptCommandSuppressionMsMax,
      step: 100,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {voiceApprovalSettingsError && (
        <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {voiceApprovalSettingsError}
        </div>
      )}
      {voiceApprovalSettingsNotice && (
        <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
          {voiceApprovalSettingsNotice}
        </div>
      )}

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Transcription
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([
            {
              mode: 'full-recording' as const,
              label: 'Full recording',
              description: 'Use chunks only to hear the stop phrase, then transcribe the full recording for the final text.',
            },
            {
              mode: 'segments' as const,
              label: 'Segment transcript',
              description: 'Use the older chunk-by-chunk transcript as the final text.',
            },
          ]).map((option) => {
            const active = voiceTranscriptionDraft.finalMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                onClick={() => setVoiceTranscriptionDraft({ finalMode: option.mode })}
                disabled={savingVoiceApprovalSettings}
                className={`rounded border px-3 py-3 text-left transition-all ${
                  active
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] shadow-[var(--glow-accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'
                } ${savingVoiceApprovalSettings ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <span className="block text-[12px] font-semibold text-[var(--fg-secondary)]">{option.label}</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-[var(--muted-dim)]">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Codes
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Trigger phrase</span>
            <span className="text-[10px] leading-relaxed text-[var(--muted-dim)]">Say this before the digits, for example: approval code 1234.</span>
            <input
              value={voiceApprovalDraft.triggerPhrase}
              onChange={(e) => updateDraft({ triggerPhrase: e.target.value.slice(0, limits.triggerPhraseMaxChars) })}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
              disabled={savingVoiceApprovalSettings}
            />
          </label>
          {codeFields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">{field.label}</span>
              <span className="text-[10px] leading-relaxed text-[var(--muted-dim)]">{field.description}</span>
              <input
                value={voiceApprovalDraft[field.key]}
                onChange={(e) => updateDraft({ [field.key]: codeOnly(e.target.value, limits.codeMaxDigits) } as Partial<VoiceApprovalSettings>)}
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] font-mono focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                disabled={savingVoiceApprovalSettings}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Timing
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {numberFields.map((field) => (
            <label key={field.key} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 flex flex-col gap-2">
              <span className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-semibold text-[var(--fg-secondary)]">{field.label}</span>
                <span className="font-mono text-[var(--muted)]">
                  {voiceApprovalDraft[field.key].toLocaleString()} {field.suffix}
                </span>
              </span>
              <span className="text-[10px] leading-relaxed text-[var(--muted-dim)]">{field.description}</span>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={voiceApprovalDraft[field.key]}
                onChange={(e) => updateDraft({ [field.key]: Number(e.target.value) } as Partial<VoiceApprovalSettings>)}
                disabled={savingVoiceApprovalSettings}
                className="w-full accent-[var(--accent)]"
              />
              <span className="flex justify-between text-[10px] text-[var(--muted-dim)] font-mono">
                <span>{field.min.toLocaleString()}</span>
                <span>{field.max.toLocaleString()}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={() => {
            setVoiceApprovalDraft(defaults);
            setVoiceTranscriptionDraft(transcriptionDefaults);
          }}
          disabled={savingVoiceApprovalSettings}
          className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--display)' }}
        >
          Use defaults
        </button>
        <button
          type="button"
          onClick={() => void saveVoiceApprovalSettings()}
          disabled={!dirty || savingVoiceApprovalSettings || voiceApprovalSettingsLoading}
          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
            !dirty || savingVoiceApprovalSettings || voiceApprovalSettingsLoading
              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          {savingVoiceApprovalSettings ? 'Saving...' : 'Save voice settings'}
        </button>
      </div>
    </div>
  );
}
