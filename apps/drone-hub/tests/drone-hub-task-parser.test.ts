import { describe, expect, test } from 'bun:test';
import { extractDroneHubTasksFromAgentMessage } from '../src/droneHub/chat/drone-hub-task-parser';

describe('drone hub task parser', () => {
  test('extracts a fenced object literal task block and removes it from the message', () => {
    const message = [
      'Here is the plan.',
      '',
      '```js',
      '{',
      "  type: 'drone-hub-task',",
      "  name: 'Fix auth redirect',",
      "  description: 'Check the middleware chain and confirm the callback URL handling.'",
      '}',
      '```',
      '',
      'Ship it after review.',
    ].join('\n');

    expect(extractDroneHubTasksFromAgentMessage(message)).toEqual({
      cleanedText: ['Here is the plan.', '', 'Ship it after review.'].join('\n'),
      tasks: [
        {
          type: 'drone-hub-task',
          name: 'Fix auth redirect',
          description: 'Check the middleware chain and confirm the callback URL handling.',
        },
      ],
    });
  });

  test('extracts arrays and inline task literals in one pass', () => {
    const message = [
      'Queue these next.',
      '',
      '[',
      '  {',
      '    "type": "drone-hub-task",',
      '    "name": "UI polish",',
      '    "description": "Tighten the card spacing on the settings page."',
      '  },',
      '  {',
      '    "type": "drone-hub-task",',
      '    "name": "Error copy",',
      '    "description": "Rewrite the failing sync banner with clearer language."',
      '  }',
      ']',
      '',
      "And later `{'type':'drone-hub-task','name':'Docs','description':'Update the README for the new workflow.'}`.",
    ].join('\n');

    const result = extractDroneHubTasksFromAgentMessage(message);
    expect(result.cleanedText).toBe('Queue these next.\n\nAnd later .');
    expect(result.tasks).toEqual([
      {
        type: 'drone-hub-task',
        name: 'UI polish',
        description: 'Tighten the card spacing on the settings page.',
      },
      {
        type: 'drone-hub-task',
        name: 'Error copy',
        description: 'Rewrite the failing sync banner with clearer language.',
      },
      {
        type: 'drone-hub-task',
        name: 'Docs',
        description: 'Update the README for the new workflow.',
      },
    ]);
  });

  test('ignores unrelated objects', () => {
    const message = "{ type: 'note', name: 'not-a-task' }";
    expect(extractDroneHubTasksFromAgentMessage(message)).toEqual({
      cleanedText: message,
      tasks: [],
    });
  });

  test('ignores task-looking literals inside general fenced examples', () => {
    const message = [
      'Use this skill template.',
      '',
      '```md',
      'When the user asks for tasks, show this example:',
      '{',
      "  type: 'drone-hub-task',",
      "  name: 'Docs',",
      "  description: 'Update the README.'",
      '}',
      '```',
    ].join('\n');

    expect(extractDroneHubTasksFromAgentMessage(message)).toEqual({
      cleanedText: message,
      tasks: [],
    });
  });

  test('rejects placeholder task fields', () => {
    const message = [
      '```js',
      '{',
      "  type: 'drone-hub-task',",
      "  name: '...',",
      "  description: '...'",
      '}',
      '```',
    ].join('\n');

    expect(extractDroneHubTasksFromAgentMessage(message)).toEqual({
      cleanedText: message,
      tasks: [],
    });
  });
});
