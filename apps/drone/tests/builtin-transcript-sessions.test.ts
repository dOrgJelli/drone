import { describe, expect, test } from 'bun:test';
import { formatTranscriptJobFailure } from '../src/hub/builtin-transcript-sessions';

describe('formatTranscriptJobFailure', () => {
  test('surfaces when the prompt command failed without any captured output', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'cursor',
        stdoutRaw: '',
        stderrRaw: '',
        fallbackRaw: '',
        exitCode: 17,
      }),
    ).toBe('prompt command failed without any captured stdout/stderr output (exit 17)');
  });

  test('surfaces missing output even when no exit code was captured', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'cursor',
        stdoutRaw: '',
        stderrRaw: '',
        fallbackRaw: '',
      }),
    ).toBe('prompt command failed before any stdout/stderr output or exit code was captured');
  });

  test('preserves codex lifecycle-specific failures and appends the exit code', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'codex',
        stdoutRaw: [
          '{"type":"thread.started","thread_id":"thread_123"}',
          '{"type":"turn.started"}',
        ].join('\n'),
        stderrRaw: '',
        fallbackRaw: '',
        exitCode: 1,
      }),
    ).toBe('Codex turn started but exited before producing a response. (exit 1)');
  });

  test('preserves existing error details for non-codex agents', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'pi',
        stdoutRaw: '',
        stderrRaw: 'authentication failed',
        fallbackRaw: 'authentication failed',
        exitCode: 4,
      }),
    ).toBe('authentication failed (exit 4)');
  });
});
