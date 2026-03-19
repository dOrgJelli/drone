import { describe, expect, test } from 'bun:test';
import {
  createDefaultKanbanBoardState,
  parsePastedKanbanCard,
  sanitizeKanbanBoardState,
} from '../src/droneHub/app/kanban-board-state';

describe('kanban board state helpers', () => {
  test('creates a default board with the standard workflow lanes', () => {
    const board = createDefaultKanbanBoardState();
    expect(board.lanes.map((lane) => lane.title)).toEqual(['To do', 'In progress', 'Review', 'Done']);
    expect(board.lanes.every((lane) => lane.cards.length === 0)).toBe(true);
  });

  test('sanitizes invalid persisted state and preserves valid cards', () => {
    const board = sanitizeKanbanBoardState({
      lanes: [
        null,
        {
          title: ' Backlog ',
          cards: [
            { title: ' Wire board mode ', description: 'Add workspace routing.' },
            { id: 'task-2', title: ' polish ', description: 42 },
          ],
        },
      ],
    });

    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0]?.title).toBe('Backlog');
    expect(board.lanes[0]?.cards).toEqual([
      expect.objectContaining({
        title: 'Wire board mode',
        description: 'Add workspace routing.',
      }),
      expect.objectContaining({
        id: 'task-2',
        title: 'polish',
        description: '42',
      }),
    ]);
  });

  test('parses pasted text into title and description', () => {
    expect(
      parsePastedKanbanCard(`
        Refactor task board header

        Reuse the agent and repo controls from draft chat.
        Keep the model override inline.
      `),
    ).toEqual({
      title: 'Refactor task board header',
      description: 'Reuse the agent and repo controls from draft chat.\nKeep the model override inline.',
    });

    expect(parsePastedKanbanCard('')).toBeNull();
  });
});
