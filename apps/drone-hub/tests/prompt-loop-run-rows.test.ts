import { describe, expect, test } from 'bun:test';
import { fillMissingPromptLoopRunRows, type PromptLoopRunRow } from '../src/droneHub/chat/prompt-loop-run-rows';

function row(runIndex: number): PromptLoopRunRow {
  return {
    rowKey: `row-${runIndex}`,
    runIndex,
    atIso: `2026-03-19T00:00:0${runIndex}.000Z`,
    status: 'done',
    statusLabel: 'Done',
    output: `run ${runIndex}`,
    fadeTo: 'rgba(0,0,0,.14)',
  };
}

describe('fillMissingPromptLoopRunRows', () => {
  test('inserts a synthetic failed row for an internal numbering gap', () => {
    const out = fillMissingPromptLoopRunRows([row(1), row(3)]);
    expect(out.map((item) => item.runIndex)).toEqual([1, 2, 3]);
    expect(out[1]).toMatchObject({
      status: 'failed',
      statusLabel: 'Failed',
      atIso: '',
    });
    expect(out[1]?.output).toContain('No transcript row was recorded');
  });

  test('fills missing leading indexes when the first recorded run starts later', () => {
    const out = fillMissingPromptLoopRunRows([row(3)]);
    expect(out.map((item) => item.runIndex)).toEqual([1, 2, 3]);
    expect(out[0]?.status).toBe('failed');
    expect(out[1]?.status).toBe('failed');
    expect(out[2]?.status).toBe('done');
  });

  test('leaves contiguous rows unchanged', () => {
    const input = [row(1), row(2), row(3)];
    const out = fillMissingPromptLoopRunRows(input);
    expect(out).toEqual(input);
  });
});
