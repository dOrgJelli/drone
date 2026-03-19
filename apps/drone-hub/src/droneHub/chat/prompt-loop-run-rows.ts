export type PromptLoopRunRowStatus = 'done' | 'failed' | 'pending';

export type PromptLoopRunRow = {
  rowKey: string;
  runIndex: number;
  atIso: string;
  status: PromptLoopRunRowStatus;
  statusLabel: string;
  output: string;
  outputClassName?: string;
  fadeTo: string;
};

const MISSING_RUN_OUTPUT =
  'No transcript row was recorded for this automation attempt. The run likely failed before prompt enqueue or transcript reconciliation.';

export function fillMissingPromptLoopRunRows(rows: PromptLoopRunRow[]): PromptLoopRunRow[] {
  if (rows.length === 0) return rows;
  const out: PromptLoopRunRow[] = [];
  let expectedRunIndex = 1;

  for (const row of rows) {
    while (expectedRunIndex < row.runIndex) {
      out.push({
        rowKey: `missing-run:${expectedRunIndex}:${row.rowKey}`,
        runIndex: expectedRunIndex,
        atIso: '',
        status: 'failed',
        statusLabel: 'Failed',
        output: MISSING_RUN_OUTPUT,
        fadeTo: 'var(--red-subtle)',
      });
      expectedRunIndex += 1;
    }
    out.push(row);
    expectedRunIndex = Math.max(expectedRunIndex, row.runIndex + 1);
  }

  return out;
}
