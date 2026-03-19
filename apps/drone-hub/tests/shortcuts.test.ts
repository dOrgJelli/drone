import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';

describe('shortcut defaults', () => {
  test('uses Tab for create draft drone, Z for the task board, and Enter for focusing the primary chat input', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.createDraftDrone).toEqual({
      key: 'tab',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.openKanbanBoard).toEqual({
      key: 'z',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.focusPrimaryChatInput).toEqual({
      key: 'enter',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
  });
});
