import { describe, expect, test } from 'bun:test';

import {
  classifyAgentMessageAutoContinue,
  classifyAgentMessageAutoContinueBypass,
} from '../src/hub/agent-message-auto-continue';

describe('agent message auto-continue classifier bypass', () => {
  test('bypasses messages that contain agent-copilot JSON', () => {
    const message = [
      'Sending this to the copilot now.',
      '',
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "docs-review",',
      '  "message": "Review the changed docs and report any gaps."',
      '}',
      '```',
      '',
      'When the copilot reply comes back, I will synthesize it.',
    ].join('\n');

    expect(classifyAgentMessageAutoContinueBypass(message)).toEqual({
      bucket: 'user-turn',
      reason: 'Message contains agent copilot JSON; auto-continue is disabled for structured copilot handoffs.',
      source: 'agent-copilot-json',
    });
  });

  test('does not bypass plain-language copilot mentions without structured JSON', () => {
    const message = 'Sending this to the copilot now. When it comes back, I will synthesize the result.';
    expect(classifyAgentMessageAutoContinueBypass(message)).toBeNull();
  });

  test('bypasses invalid copilot payloads because they still alter chat flow', () => {
    const message = [
      '{"type":"agent-copilot","name":"one","message":"First"}',
      '{"type":"agent-copilot","name":"two","message":"Second"}',
    ].join('\n');

    expect(classifyAgentMessageAutoContinueBypass(message)).toEqual({
      bucket: 'user-turn',
      reason: 'Message contains agent copilot JSON; auto-continue is disabled for structured copilot handoffs.',
      source: 'agent-copilot-json',
    });
  });
});

describe('agent message auto-continue heuristics', () => {
  test('classifies the seeded transcript-style examples', async () => {
    const fixtures = [
      {
        message: 'Updated the user user facing copy from synopsis to logline.',
        expected: {
          bucket: 'user-turn',
          reason: 'Short past-tense completion update with no explicit next-step language; keep control with the user.',
          source: 'heuristic',
        },
      },
      {
        message: 'Continued to rename into the remaining user visible back-end driven copy.',
        expected: {
          bucket: 'user-turn',
          reason: 'Short past-tense completion update with no explicit next-step language; keep control with the user.',
          source: 'heuristic',
        },
      },
      {
        message: "I'm taking the first incremental step on the core canvas model.",
        expected: {
          bucket: 'continue',
          reason: 'Message explicitly says the agent is still working or is taking the next step now.',
          source: 'heuristic',
        },
      },
      {
        message: "I'm aligned, you want the existing workspace.",
        expected: {
          bucket: 'user-turn',
          reason: 'Message acknowledges or restates the user request instead of indicating active continued execution.',
          source: 'heuristic',
        },
      },
    ] as const;

    for (const fixture of fixtures) {
      await expect(classifyAgentMessageAutoContinue(fixture.message)).resolves.toEqual(fixture.expected);
    }
  });

  test('continues when a completion summary also says more work is still in progress', async () => {
    const message = [
      'Updated the user facing copy from synopsis to logline across the web UI.',
      '',
      "Next I'm wiring the remaining canvas labels and verification pass.",
    ].join('\n');

    await expect(classifyAgentMessageAutoContinue(message)).resolves.toEqual({
      bucket: 'continue',
      reason: 'Message explicitly says the agent is still working or is taking the next step now.',
      source: 'heuristic',
    });
  });

  test('treats PR created and merged delivery summaries as user-turn', async () => {
    const message = [
      'PR created and merged: [#330](https://github.com/nerfZael/drone/pull/330)',
      '',
      'Merge commit: `d5a57cf8e86632b2b962a08a768a11efbae700d6`',
      '',
      'What shipped:',
      '- assistant suggestions can now explicitly return no reply',
      '- dead-end acknowledgements get suppressed',
      '- suppressed results are hidden in the transcript UI',
      '- focused backend/frontend tests were added',
      '',
      'Verification used:',
      '- `bun test apps/drone/tests/agent-suggestion.test.ts`',
      '- `bun test apps/drone-hub/tests/agent-suggestion-state.test.ts`',
      '',
      'Broader package checks remain blocked by the existing workspace issues noted earlier.',
    ].join('\n');

    await expect(classifyAgentMessageAutoContinue(message)).resolves.toEqual({
      bucket: 'user-turn',
      reason: 'Agent reports a completed PR/merge outcome and hands the result back to the user.',
      source: 'heuristic',
    });
  });
});
