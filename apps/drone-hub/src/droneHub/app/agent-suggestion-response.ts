import type { AgentSuggestionState } from './app-types';

export type AgentSuggestionResponse = {
  ok: true;
  outcome?: string;
  suggestion?: string | null;
  reason: string;
  kind: string;
  policyFingerprint: string;
};

export function resolveAgentSuggestionStateFromResponse(data: AgentSuggestionResponse): AgentSuggestionState {
  const outcome = String(data?.outcome ?? '').trim().toLowerCase();
  const policyFingerprint = String(data?.policyFingerprint ?? '').trim();
  const reason = String(data?.reason ?? '').trim();
  if (outcome === 'none') {
    return {
      status: 'suppressed',
      reason,
      policyFingerprint,
    };
  }

  const suggestion = String(data?.suggestion ?? '').trim();
  if (!suggestion) throw new Error('Empty assistant suggestion response.');
  return {
    status: 'ready',
    suggestion,
    reason,
    kind: String(data?.kind ?? '').trim(),
    policyFingerprint,
  };
}
