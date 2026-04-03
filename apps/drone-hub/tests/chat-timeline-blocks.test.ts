import { describe, expect, test } from 'bun:test';
import { buildChatTimelineBlocks } from '../src/droneHub/app/chat-timeline-blocks';
import type { PendingTimelineBlock } from '../src/droneHub/app/pending-timeline-blocks';
import type { TranscriptTimelineBlock } from '../src/droneHub/app/prompt-loop-groups';
import type { PendingPrompt } from '../src/droneHub/types';

function pendingPrompt(id: string, at: string): PendingPrompt {
  return {
    id,
    at,
    updatedAt: at,
    prompt: id,
    state: 'queued',
  };
}

describe('buildChatTimelineBlocks', () => {
  test('keeps a running automation card ahead of a later blocked manual message', () => {
    const transcriptTimelineBlocks: TranscriptTimelineBlock[] = [
      {
        kind: 'pending-prompt',
        key: 'pending:manual',
        item: pendingPrompt('manual-after-automation', '2026-03-19T12:04:00.000Z'),
      },
    ];
    const pendingTimelineBlocks: PendingTimelineBlock[] = [
      {
        kind: 'running-automation',
        key: 'running:automation',
        sortMs: Date.parse('2026-03-19T12:03:00.000Z'),
        order: 0,
      },
    ];

    const out = buildChatTimelineBlocks({
      transcriptTimelineBlocks,
      pendingTimelineBlocks,
      runningAutomationIdentity: '',
    });

    expect(out.map((item) => `${item.source}:${item.block.kind}`)).toEqual([
      'pending:running-automation',
      'transcript:pending-prompt',
    ]);
  });

  test('keeps a running prompt-loop transcript group ahead of queued automation even when queued earlier', () => {
    const transcriptTimelineBlocks: TranscriptTimelineBlock[] = [
      {
        kind: 'prompt-loop-group',
        key: 'group:running',
        identity: 'job:job-1',
        runs: [
          {
            turn: 1,
            at: '2026-03-19T12:03:00.000Z',
            promptAt: '2026-03-19T12:03:00.000Z',
            prompt: 'automation run',
            who: 'agent',
            text: 'working',
          },
        ],
      },
    ];
    const pendingTimelineBlocks: PendingTimelineBlock[] = [
      {
        kind: 'queued-automation',
        key: 'queued:automation',
        queueId: 'queue-1',
        sortMs: Date.parse('2026-03-19T12:02:00.000Z'),
        order: 0,
      },
    ];

    const out = buildChatTimelineBlocks({
      transcriptTimelineBlocks,
      pendingTimelineBlocks,
      runningAutomationIdentity: 'job:job-1',
    });

    expect(out.map((item) => `${item.source}:${item.block.kind}`)).toEqual([
      'transcript:prompt-loop-group',
      'pending:queued-automation',
    ]);
  });
});
