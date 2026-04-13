import { describe, expect, test } from 'bun:test';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';
import { resolveAgentSuggestionStateFromResponse } from '../src/droneHub/app/agent-suggestion-response';
import { resolveLatestAgentSuggestionTarget } from '../src/droneHub/app/agent-suggestion-target';

function makeTranscript(turn: number): TranscriptItem {
  const at = `2026-02-10T12:00:0${turn}.000Z`;
  return {
    turn,
    at,
    promptAt: at,
    completedAt: at,
    id: `prompt-${turn}`,
    prompt: `prompt ${turn}`,
    session: 'drone-hub-chat-default',
    logPath: `/tmp/transcript-${turn}.log`,
    ok: true,
    output: `output ${turn}`,
  };
}

function makePendingPrompt(id: string): PendingPrompt {
  return {
    id,
    at: '2026-02-10T12:00:30.000Z',
    prompt: 'continue',
    state: 'sent',
  };
}

describe('assistant suggestion target selection', () => {
  test('targets the latest completed transcript turn when there is no newer user prompt', () => {
    const first = makeTranscript(1);
    const second = makeTranscript(2);
    expect(resolveLatestAgentSuggestionTarget([first, second], [])).toBe(second);
  });

  test('hides the suggestion when a newer pending user prompt exists', () => {
    const first = makeTranscript(1);
    const second = makeTranscript(2);
    expect(resolveLatestAgentSuggestionTarget([first, second], [makePendingPrompt('pending-1')])).toBeNull();
  });
});

describe('assistant suggestion response mapping', () => {
  test('maps an explicit no-suggestion result to a suppressed state', () => {
    expect(
      resolveAgentSuggestionStateFromResponse({
        ok: true,
        outcome: 'none',
        suggestion: null,
        reason: 'The agent already finished and no reply would add value.',
        kind: 'none',
        policyFingerprint: 'abc123def456',
      }),
    ).toEqual({
      status: 'suppressed',
      reason: 'The agent already finished and no reply would add value.',
      policyFingerprint: 'abc123def456',
    });
  });

  test('keeps concrete suggestions as ready state', () => {
    expect(
      resolveAgentSuggestionStateFromResponse({
        ok: true,
        outcome: 'suggest',
        suggestion: 'review',
        reason: 'A regression pass is the likely next step.',
        kind: 'review',
        policyFingerprint: 'abc123def456',
      }),
    ).toEqual({
      status: 'ready',
      suggestion: 'review',
      reason: 'A regression pass is the likely next step.',
      kind: 'review',
      policyFingerprint: 'abc123def456',
    });
  });
});
