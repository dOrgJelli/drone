import { describe, expect, test } from 'bun:test';

import {
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
