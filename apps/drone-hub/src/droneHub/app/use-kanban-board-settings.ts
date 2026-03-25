import React from 'react';
import { createDefaultKanbanBoardState, type KanbanBoardState } from './kanban-board-state';
import type { KanbanBoardSettingsResponse } from './settings-types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseKanbanBoardSettingsArgs = {
  enabled: boolean;
  requestJson: RequestJson;
};

export type UseKanbanBoardSettingsResult = {
  board: KanbanBoardState;
  boardLoading: boolean;
  boardSaving: boolean;
  boardError: string | null;
  boardUpdatedAt: string | null;
  reloadBoard: () => Promise<void>;
  onBoardChange: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
};

const REFRESH_INTERVAL_MS = 5_000;

function normalizeConflictBoardPayload(data: any): { kanbanBoard: KanbanBoardState; updatedAt: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const rawBoard = (data as any).kanbanBoard;
  if (!rawBoard || typeof rawBoard !== 'object') return null;
  return {
    kanbanBoard: rawBoard as KanbanBoardState,
    updatedAt: typeof (data as any).updatedAt === 'string' && (data as any).updatedAt.trim() ? (data as any).updatedAt.trim() : null,
  };
}

export function useKanbanBoardSettings({
  enabled,
  requestJson,
}: UseKanbanBoardSettingsArgs): UseKanbanBoardSettingsResult {
  const [board, setBoard] = React.useState<KanbanBoardState>(() => createDefaultKanbanBoardState());
  const [boardLoading, setBoardLoading] = React.useState(false);
  const [boardSaving, setBoardSaving] = React.useState(false);
  const [boardError, setBoardError] = React.useState<string | null>(null);
  const [boardUpdatedAt, setBoardUpdatedAt] = React.useState<string | null>(null);
  const updatedAtRef = React.useRef<string | null>(null);
  const loadedOnceRef = React.useRef(false);
  const loadingRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const queuedBoardRef = React.useRef<KanbanBoardState | null>(null);

  React.useEffect(() => {
    updatedAtRef.current = boardUpdatedAt;
  }, [boardUpdatedAt]);

  const applyServerBoard = React.useCallback((data: KanbanBoardSettingsResponse | { kanbanBoard: KanbanBoardState; updatedAt: string | null }) => {
    setBoard(data.kanbanBoard);
    setBoardUpdatedAt(data.updatedAt);
    updatedAtRef.current = data.updatedAt;
    loadedOnceRef.current = true;
  }, []);

  const reloadBoard = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!enabled) return;
    const silent = opts?.silent === true;
    loadingRef.current = true;
    if (!silent) setBoardLoading(true);
    try {
      const data = await requestJson<KanbanBoardSettingsResponse>('/api/settings/kanban-board');
      applyServerBoard(data);
      setBoardError(null);
    } catch (err: any) {
      setBoardError(err?.message ?? String(err));
    } finally {
      loadingRef.current = false;
      if (!silent) setBoardLoading(false);
    }
  }, [applyServerBoard, enabled, requestJson]);

  const flushQueuedBoard = React.useCallback(async () => {
    if (savingRef.current) return;
    const nextQueued = queuedBoardRef.current;
    if (!nextQueued) return;
    savingRef.current = true;
    setBoardSaving(true);
    try {
      while (queuedBoardRef.current) {
        const nextBoard = queuedBoardRef.current;
        queuedBoardRef.current = null;
        const expectedUpdatedAt = updatedAtRef.current;
        try {
          const data = await requestJson<KanbanBoardSettingsResponse>('/api/settings/kanban-board', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kanbanBoard: nextBoard, expectedUpdatedAt }),
          });
          applyServerBoard(data);
          setBoardError(null);
        } catch (err: any) {
          if (err?.status === 409) {
            queuedBoardRef.current = null;
            const conflict = normalizeConflictBoardPayload(err?.data);
            if (conflict) applyServerBoard(conflict);
            else await reloadBoard({ silent: true });
            setBoardError('Task board changed on the server. Showing the latest saved state.');
            break;
          } else {
            await reloadBoard({ silent: true });
            setBoardError(err?.message ?? String(err));
          }
        }
      }
    } finally {
      savingRef.current = false;
      setBoardSaving(false);
    }
  }, [applyServerBoard, reloadBoard, requestJson]);

  const onBoardChange = React.useCallback<React.Dispatch<React.SetStateAction<KanbanBoardState>>>((next) => {
    setBoard((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      queuedBoardRef.current = resolved;
      queueMicrotask(() => {
        void flushQueuedBoard();
      });
      return resolved;
    });
  }, [flushQueuedBoard]);

  React.useEffect(() => {
    if (!enabled) return;
    void reloadBoard();
  }, [enabled, reloadBoard]);

  React.useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      if (loadingRef.current || savingRef.current || queuedBoardRef.current) return;
      void reloadBoard({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, reloadBoard]);

  React.useEffect(() => {
    if (enabled || !loadedOnceRef.current) return;
    setBoardError(null);
    setBoardLoading(false);
    setBoardSaving(false);
  }, [enabled]);

  return {
    board,
    boardLoading,
    boardSaving,
    boardError,
    boardUpdatedAt,
    reloadBoard,
    onBoardChange,
  };
}
