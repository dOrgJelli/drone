import { describe, expect, test } from 'bun:test';
import { currentPromptAutomationDisplayStatus } from '../src/droneHub/app/prompt-automation-display-status';
import type { PromptAutomationJobSnapshot } from '../src/droneHub/app/use-prompt-automation-state';

function runningJob(overrides?: Partial<PromptAutomationJobSnapshot>): PromptAutomationJobSnapshot {
  return {
    status: 'running',
    running: true,
    jobKey: 'job-1',
    automationId: 'loop',
    automationLabel: 'Loop',
    runsTotal: 3,
    runsCompleted: 0,
    startedAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
    lastPromptId: null,
    error: null,
    ...overrides,
  };
}

describe('currentPromptAutomationDisplayStatus', () => {
  test('treats a newly accepted automation as queued until its first prompt exists', () => {
    expect(currentPromptAutomationDisplayStatus(runningJob())).toBe('queued');
  });

  test('treats an automation as running once it has submitted its first prompt', () => {
    expect(currentPromptAutomationDisplayStatus(runningJob({ lastPromptId: 'prompt-1' }))).toBe('running');
  });

  test('treats an automation as running once at least one run has completed', () => {
    expect(currentPromptAutomationDisplayStatus(runningJob({ runsCompleted: 1, lastPromptId: 'prompt-1' }))).toBe('running');
  });
});
