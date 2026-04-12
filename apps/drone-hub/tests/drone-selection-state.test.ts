import { describe, expect, test } from 'bun:test';
import { resolveSelectedChatForDrone, shouldKeepPendingSelectedChat } from '../src/droneHub/app/drone-selection-helpers';
import type { DroneSummary } from '../src/droneHub/types';

function makeDrone(id: string, chats: string[]): DroneSummary {
  return {
    id,
    name: id,
    group: null,
    createdAt: '2026-03-07T00:00:00.000Z',
    repoPath: '',
    containerPort: 7777,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats,
  };
}

describe('resolveSelectedChatForDrone', () => {
  test('restores the last selected chat when it still exists on the drone', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['default', 'chat-2'])],
      lastSelectedChatByDrone: { 'drone-a': 'chat-2' },
    });

    expect(selected).toBe('chat-2');
  });

  test('falls back to default when the remembered chat no longer exists', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['default'])],
      lastSelectedChatByDrone: { 'drone-a': 'chat-2' },
    });

    expect(selected).toBe('default');
  });

  test('falls back to the first available chat when default is unavailable', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['review'])],
      lastSelectedChatByDrone: {},
    });

    expect(selected).toBe('review');
  });

  test('falls back to default when the drone has no chats yet', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', [])],
      lastSelectedChatByDrone: {},
    });

    expect(selected).toBe('default');
  });
});

describe('shouldKeepPendingSelectedChat', () => {
  test('keeps a newly selected non-default chat while the server list is stale', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(true);
  });

  test('stops keeping the pending chat after the grace window expires', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default'],
        pendingUntilMs: 1_000,
        nowMs: 2_000,
      }),
    ).toBe(false);
  });

  test('does not keep default or already-materialized chats', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'default',
        availableChats: ['default'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default', 'chat-2'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(false);
  });
});
