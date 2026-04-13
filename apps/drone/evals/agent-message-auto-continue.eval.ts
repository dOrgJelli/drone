import { describe, expect, test } from 'bun:test';

import { classifyAgentMessageAutoContinue } from '../src/hub/agent-message-auto-continue';
import type { LlmProviderId } from '../src/hub/hub-settings';

type EvalFixture = {
  label: string;
  expected: 'user-turn' | 'continue';
  text: string;
};

function resolveEvalProvider(): { provider: LlmProviderId; apiKey: string | null } {
  const requested = String(process.env.DRONE_HUB_AUTO_CONTINUE_EVAL_PROVIDER ?? '').trim().toLowerCase();
  if (requested === 'gemini') {
    return {
      provider: 'gemini',
      apiKey: String(process.env.GEMINI_API_KEY ?? '').trim() || null,
    };
  }
  if (requested === 'openai') {
    return {
      provider: 'openai',
      apiKey: String(process.env.OPENAI_API_KEY ?? '').trim() || null,
    };
  }
  const openAiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (openAiKey) return { provider: 'openai', apiKey: openAiKey };
  const geminiKey = String(process.env.GEMINI_API_KEY ?? '').trim();
  if (geminiKey) return { provider: 'gemini', apiKey: geminiKey };
  return { provider: 'openai', apiKey: null };
}

const fixtures: EvalFixture[] = [
  {
    label: 'done review findings',
    expected: 'user-turn',
    text: [
      '**Findings**',
      '',
      '1. High: the workspace role check can be bypassed because the mutation trusts the client-provided role id.',
      '2. Medium: the API returns success before the role cache is refreshed, so the UI can render stale permissions.',
      '',
      'The review is complete. I did not find other blocking issues.',
    ].join('\n'),
  },
  {
    label: 'done explanatory answer',
    expected: 'user-turn',
    text: [
      'Yes. VS Code highlighting is usually richer because it combines TextMate grammars with semantic tokens, while our viewer only applies the TextMate pass.',
      '',
      'I updated the grammar mapping and verified the changed snippets render correctly in the editor pane.',
    ].join('\n'),
  },
  {
    label: 'copilot json handoff',
    expected: 'user-turn',
    text: [
      'Sending this to the copilot now.',
      '',
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "loading-spinner-investigation",',
      '  "message": "Investigate why the image generation loading spinner can remain stuck after a failed request."',
      '}',
      '```',
      '',
      'When the copilot reply comes back, I will synthesize it and report the result.',
    ].join('\n'),
  },
  {
    label: 'partial implementation with next edits',
    expected: 'continue',
    text: [
      'I’ve wired the create-page upload mode and mapping UI.',
      '',
      'The next set of edits is the server-side validation path plus the final submit wiring.',
    ].join('\n'),
  },
  {
    label: 'verification still running',
    expected: 'continue',
    text: [
      'The code changes are in.',
      '',
      'I’m running focused builds and tests now, and I still need to confirm the browser flow before I call this finished.',
    ].join('\n'),
  },
  {
    label: 'investigation still active',
    expected: 'continue',
    text: [
      'I’m resuming the same read-only investigation.',
      '',
      'Next I’m verifying whether the spinner state is cleared on both the success and failure paths.',
    ].join('\n'),
  },
];

const runtime = resolveEvalProvider();
const describeEval = runtime.apiKey ? describe : describe.skip;

describeEval('agent message auto-continue eval', () => {
  test('classifies the seeded transcript fixtures', async () => {
    const failures: string[] = [];
    for (const fixture of fixtures) {
      const result = await classifyAgentMessageAutoContinue(fixture.text, {
        provider: runtime.provider,
        apiKey: runtime.apiKey ?? undefined,
      });
      if (result.bucket !== fixture.expected) {
        failures.push(`${fixture.label}: expected ${fixture.expected}, got ${result.bucket} (${result.reason})`);
      }
    }
    expect(failures).toEqual([]);
  });
});
