import { describe, expect, test } from 'bun:test';

import {
  isLowValueAcknowledgementSuggestion,
  normalizeAgentSuggestionResult,
} from '../src/hub/agent-suggestion';

describe('agent suggestion normalization', () => {
  test('preserves actionable suggestions', () => {
    expect(
      normalizeAgentSuggestionResult({
        outcome: 'suggest',
        suggestion: 'review',
        reason: 'The agent likely needs a regression pass.',
        kind: 'review',
      }),
    ).toEqual({
      outcome: 'suggest',
      suggestion: 'review',
      reason: 'The agent likely needs a regression pass.',
      kind: 'review',
    });
  });

  test('allows an explicit no-suggestion outcome', () => {
    expect(
      normalizeAgentSuggestionResult({
        outcome: 'none',
        reason: 'The conversation is complete and silence is likelier.',
        kind: 'none',
      }),
    ).toEqual({
      outcome: 'none',
      reason: 'The conversation is complete and silence is likelier.',
      kind: 'none',
    });
  });

  test('suppresses low-value acknowledgement replies even if the model emits one', () => {
    expect(
      normalizeAgentSuggestionResult({
        outcome: 'suggest',
        suggestion: 'Okay',
        reason: 'This would just acknowledge completion.',
        kind: 'approval',
      }),
    ).toEqual({
      outcome: 'none',
      reason: 'This would just acknowledge completion.',
      kind: 'none',
    });
  });

  test('recognizes common acknowledgement variants', () => {
    expect(isLowValueAcknowledgementSuggestion('sounds good.')).toBe(true);
    expect(isLowValueAcknowledgementSuggestion('  thank you  ')).toBe(true);
    expect(isLowValueAcknowledgementSuggestion('continue')).toBe(false);
    expect(isLowValueAcknowledgementSuggestion('review')).toBe(false);
  });
});
