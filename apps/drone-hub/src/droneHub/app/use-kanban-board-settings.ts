import React from 'react';
import type { KanbanBoardState } from './kanban-board-state';
import type { KanbanBoardSettingsResponse } from './settings-types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseKanbanBoardSettingsArgs = {
  board: KanbanBoardState;
  setBoard: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
  requestJson: RequestJson;
};

export type UseKanbanBoardSettingsResult = {
  boardLoading: boolean;
  boardSaving: boolean;
  boardError: string | null;
  boardUpdatedAt: string | null;
  reloadBoard: () => Promise<void>;
};

const SAVE_DEBOUNCE_MS = 400;

export function useKanbanBoardSettings({
  board,
  setBoard,
  requestJson,
}: UseKanbanBoardSettingsArgs): UseKanbanBoardSettingsResult {
  const [boardLoading, setBoardLoading] = React.useState(true);
  const [boardSaving, setBoardSaving] = React.useState(false);
  const [boardError, setBoardError] = React.useState<string | null>(null);
  const [boardUpdatedAt, setBoardUpdatedAt] = React.useState<string | null>(null);
  const readyRef = React.useRef(false);
  const lastSavedSerializedRef = React.useRef('');
  const saveSeqRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<number | null>(null);

  const cancelPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveSeqRef.current += 1;
    setBoardSaving(false);
  }, []);

  const reloadBoard = React.useCallback(async () => {
    cancelPendingSave();
    setBoardLoading(true);
    try {
      const data = await requestJson<KanbanBoardSettingsResponse>('/api/settings/kanban-board');
      setBoard(data.kanbanBoard);
      lastSavedSerializedRef.current = JSON.stringify(data.kanbanBoard);
      setBoardUpdatedAt(data.updatedAt);
      setBoardError(null);
    } catch (err: any) {
      setBoardError(err?.message ?? String(err));
    } finally {
      readyRef.current = true;
      setBoardLoading(false);
    }
  }, [cancelPendingSave, requestJson, setBoard]);

  React.useEffect(() => {
    void reloadBoard();
  }, [reloadBoard]);

  React.useEffect(() => {
    if (!readyRef.current) return;
    const serialized = JSON.stringify(board);
    if (serialized === lastSavedSerializedRef.current) return;
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      setBoardSaving(true);
      void requestJson<KanbanBoardSettingsResponse>('/api/settings/kanban-board', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kanbanBoard: board }),
      })
        .then((data) => {
          if (saveSeqRef.current !== seq) return;
          lastSavedSerializedRef.current = JSON.stringify(data.kanbanBoard);
          setBoardUpdatedAt(data.updatedAt);
          setBoardError(null);
        })
        .catch((err: any) => {
          if (saveSeqRef.current !== seq) return;
          setBoardError(err?.message ?? String(err));
        })
        .finally(() => {
          if (saveSeqRef.current !== seq) return;
          setBoardSaving(false);
        });
    }, SAVE_DEBOUNCE_MS);
    saveTimeoutRef.current = timeout;
    return () => {
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
      window.clearTimeout(timeout);
    };
  }, [board, requestJson]);

  return {
    boardLoading,
    boardSaving,
    boardError,
    boardUpdatedAt,
    reloadBoard,
  };
}
