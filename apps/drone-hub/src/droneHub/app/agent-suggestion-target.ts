import type { PendingPrompt, TranscriptItem } from '../types';

export function resolveLatestAgentSuggestionTarget(
  transcripts: TranscriptItem[] | null,
  pendingPrompts: PendingPrompt[],
): TranscriptItem | null {
  const list = Array.isArray(transcripts) ? transcripts : [];
  if (list.length === 0) return null;
  if (Array.isArray(pendingPrompts) && pendingPrompts.length > 0) return null;
  return list[list.length - 1] ?? null;
}
