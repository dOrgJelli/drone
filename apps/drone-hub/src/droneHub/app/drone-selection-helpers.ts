import { normalizedDroneChats } from './chat-node-helpers';
import type { DroneSummary } from '../types';

export function resolveSelectedChatForDrone(args: {
  droneId: string;
  drones: DroneSummary[];
  lastSelectedChatByDrone: Record<string, string>;
}): string {
  const droneId = String(args.droneId ?? '').trim();
  if (!droneId) return 'default';
  const drone = args.drones.find((item) => item.id === droneId) ?? null;
  const chats = normalizedDroneChats(drone);
  const remembered = String(args.lastSelectedChatByDrone[droneId] ?? '').trim();
  if (remembered && chats.includes(remembered)) return remembered;
  if (chats.includes('default')) return 'default';
  return chats[0] ?? 'default';
}

export function shouldKeepPendingSelectedChat(args: {
  selectedChat: string;
  availableChats: string[];
  pendingUntilMs: number;
  nowMs?: number;
}): boolean {
  const selectedChat = String(args.selectedChat ?? '').trim();
  if (!selectedChat || selectedChat === 'default') return false;
  if (args.availableChats.includes(selectedChat)) return false;
  return args.pendingUntilMs > (args.nowMs ?? Date.now());
}
