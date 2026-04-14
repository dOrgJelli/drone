import { describe, expect, test } from 'bun:test';

import { suggestReplyToAgentMessage } from '../src/hub/agent-suggestion';
import { type LlmProviderId, AGENT_SUGGESTION_POLICY_DEFAULT } from '../src/hub/hub-settings';

type EvalFixture = {
  label: string;
  expectedOutcome: 'suggest' | 'none';
  prompt?: string;
  response: string;
  context?: Array<{ turn: number; prompt: string; response: string }>;
};

function resolveEvalProvider(): { provider: LlmProviderId; apiKey: string | null } {
  const requested = String(process.env.DRONE_HUB_AGENT_SUGGESTION_EVAL_PROVIDER ?? '').trim().toLowerCase();
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
    label: 'completed merge already committed',
    expectedOutcome: 'none',
    prompt: 'commit',
    response: [
      'Committed the merge resolution as `a695a0b1a`.',
      '',
      'This concluded the in-progress merge with the resolved co-pilot/logline prompt state intact.',
    ].join('\n'),
    context: [
      {
        turn: 6,
        prompt: 'commit',
        response: [
          'The merge conflicts are resolved. There are no remaining unmerged files or conflict markers.',
          '',
          'No questions from my side. If you want, I can commit the conflict resolution next.',
        ].join('\n'),
      },
    ],
  },
  {
    label: 'commit offered but not done yet',
    expectedOutcome: 'suggest',
    prompt: 'commit',
    response: [
      'The merge conflicts are resolved. There are no remaining unmerged files or conflict markers.',
      '',
      'No questions from my side. If you want, I can commit the conflict resolution next.',
    ].join('\n'),
  },
  {
    label: 'low value completion acknowledgement',
    expectedOutcome: 'none',
    prompt: 'commit',
    response: [
      'Committed as `b50ef22e` with message `Rename logline highlight tool`.',
      '',
      'That commit includes the tool rename and regenerated prompt bundle. Broader checks are still blocked by the repo’s existing TypeScript deprecation settings.',
    ].join('\n'),
  },
  {
    label: 'mid task progress update',
    expectedOutcome: 'suggest',
    prompt: 'keep going',
    response: [
      'I’ve wired the create-page upload mode and mapping UI.',
      '',
      'The next set of edits is the server-side validation path plus the final submit wiring.',
    ].join('\n'),
  },
  {
    label: 'review findings delivered back to user',
    expectedOutcome: 'none',
    prompt: 'review the patch',
    response: [
      '**Findings**',
      '',
      '1. High: the workspace role check can be bypassed because the mutation trusts the client-provided role id.',
      '2. Medium: the API returns success before the role cache is refreshed, so the UI can render stale permissions.',
      '',
      'The review is complete. I did not find other blocking issues.',
    ].join('\n'),
  },
  {
    label: 'needs explicit regression pass',
    expectedOutcome: 'suggest',
    prompt: 'what next',
    response: [
      'The rename is in across the UI and API paths.',
      '',
      'I have not run the focused regression checks yet, so the next useful step is a review pass on the changed transcript and commit flows.',
    ].join('\n'),
  },
];

const runtime = resolveEvalProvider();
const describeEval = runtime.apiKey ? describe : describe.skip;

describeEval('agent suggestion eval', () => {
  test('scores the seeded transcript fixtures by outcome', async () => {
    const failures: string[] = [];
    for (const fixture of fixtures) {
      const result = await suggestReplyToAgentMessage(
        {
          prompt: fixture.prompt ?? '',
          response: fixture.response,
          context: fixture.context,
          policyMarkdown: AGENT_SUGGESTION_POLICY_DEFAULT,
        },
        {
          provider: runtime.provider,
          apiKey: runtime.apiKey ?? undefined,
        },
      );
      if (result.outcome !== fixture.expectedOutcome) {
        failures.push(
          `${fixture.label}: expected ${fixture.expectedOutcome}, got ${result.outcome} (${result.reason})${
            result.outcome === 'suggest' ? ` -> ${result.suggestion}` : ''
          }`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});
