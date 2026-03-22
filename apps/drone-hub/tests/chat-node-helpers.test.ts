import { describe, expect, test } from 'bun:test';
import { hasOnlyDefaultChat, resolveCanvasChatDisplay } from '../src/droneHub/app/chat-node-helpers';
import type { DroneSummary } from '../src/droneHub/types';

function drone(seed: Partial<DroneSummary> & Pick<DroneSummary, 'id' | 'name'>): DroneSummary {
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group ?? null,
    createdAt: seed.createdAt ?? '2026-01-01T00:00:00.000Z',
    repoPath: seed.repoPath ?? '',
    containerPort: seed.containerPort ?? 0,
    hostPort: seed.hostPort ?? null,
    statusOk: seed.statusOk ?? true,
    statusError: seed.statusError ?? null,
    chats: seed.chats ?? ['default'],
    fleetParentId: seed.fleetParentId ?? null,
    repoAttached: seed.repoAttached ?? false,
    hubPhase: seed.hubPhase ?? null,
    hubMessage: seed.hubMessage ?? null,
    busy: seed.busy ?? false,
  };
}

describe('chat node helpers', () => {
  test('treats an implicit empty chat list as only the default chat', () => {
    expect(hasOnlyDefaultChat(drone({ id: 'alpha', name: 'Alpha', chats: [] }))).toBe(true);
  });

  test('uses the drone name as the canvas primary label for a lone default chat', () => {
    expect(resolveCanvasChatDisplay(drone({ id: 'alpha', name: 'Alpha', chats: ['default'] }), 'default', 'Alpha')).toEqual({
      primaryLabel: 'Alpha',
      secondaryLabel: '',
    });
  });

  test('keeps the chat name when the drone has additional chats', () => {
    expect(resolveCanvasChatDisplay(drone({ id: 'alpha', name: 'Alpha', chats: ['default', 'review'] }), 'default', 'Alpha')).toEqual({
      primaryLabel: 'default',
      secondaryLabel: 'Alpha',
    });
  });
});
