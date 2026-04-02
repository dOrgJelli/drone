import type { PromptAutomationJobSnapshot } from './use-prompt-automation-state';

export function currentPromptAutomationDisplayStatus(
  job: PromptAutomationJobSnapshot | null,
): 'queued' | 'running' {
  if (!job?.running) return 'queued';
  const runsCompleted = Math.max(0, Number(job.runsCompleted ?? 0) || 0);
  const lastPromptId = String(job.lastPromptId ?? '').trim();
  return runsCompleted === 0 && !lastPromptId ? 'queued' : 'running';
}
