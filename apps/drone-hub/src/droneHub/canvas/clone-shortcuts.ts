import { createCanvasChatNodeId, parseCanvasChatNodeId } from '../app/app-config';
import type { DroneSummary } from '../types';

const DRAFT_CANVAS_NODE_PREFIX = 'draft:';

export function collectCloneableDroneIdsFromCanvasSelection(selectedNodeIdsRaw: string[]): string[] {
  const selectedNodeIds = Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of selectedNodeIds) {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || nodeId.startsWith(DRAFT_CANVAS_NODE_PREFIX)) continue;
    const chatRef = parseCanvasChatNodeId(nodeId);
    if (!chatRef) continue;
    const droneId = String(chatRef.droneId ?? '').trim();
    if (!droneId || seen.has(droneId)) continue;
    seen.add(droneId);
    out.push(droneId);
  }
  return out;
}

export async function cloneCanvasDronesById(
  copiedDroneIdsRaw: string[],
  droneById: Record<string, DroneSummary>,
  cloneDrone: (drone: DroneSummary) => Promise<boolean> | boolean,
): Promise<void> {
  const copiedDroneIds = Array.isArray(copiedDroneIdsRaw) ? copiedDroneIdsRaw : [];
  for (const raw of copiedDroneIds) {
    const droneId = String(raw ?? '').trim();
    if (!droneId) continue;
    const drone = droneById[droneId];
    if (!drone) continue;
    await cloneDrone(drone);
  }
}

export function collectCloneSourceNodeIdByDroneId(selectedNodeIdsRaw: string[]): Record<string, string> {
  const selectedNodeIds = Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : [];
  const out: Record<string, string> = {};
  for (const raw of selectedNodeIds) {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || nodeId.startsWith(DRAFT_CANVAS_NODE_PREFIX)) continue;
    const chatRef = parseCanvasChatNodeId(nodeId);
    const droneId = String(chatRef?.droneId ?? '').trim();
    if (!droneId || out[droneId]) continue;
    out[droneId] = nodeId;
  }
  return out;
}

export function buildOptimisticCloneCanvasNodes(args: {
  copiedDroneIdsRaw: string[];
  cloneResultsRaw: Array<{ sourceDroneId: string; cloneDroneId?: string | null; cloneDroneName?: string | null }>;
  sourceNodeIdByDroneId: Record<string, string>;
  nodesById: Record<string, { x: number; y: number } | undefined>;
  cloneOffsetXPx: number;
  cloneOffsetYPx: number;
}): {
  nodes: Array<{ droneId: string; label: string; x: number; y: number }>;
  optimisticDroneNameById: Record<string, string>;
} {
  const copiedDroneIds = Array.isArray(args.copiedDroneIdsRaw) ? args.copiedDroneIdsRaw : [];
  const cloneResults = Array.isArray(args.cloneResultsRaw) ? args.cloneResultsRaw : [];
  const cloneResultBySourceDroneId = new Map<string, { cloneDroneId: string; cloneDroneName: string }>();
  for (const candidate of cloneResults) {
    const sourceDroneId = String(candidate?.sourceDroneId ?? '').trim();
    const cloneDroneId = String(candidate?.cloneDroneId ?? '').trim();
    if (!sourceDroneId || !cloneDroneId) continue;
    cloneResultBySourceDroneId.set(sourceDroneId, {
      cloneDroneId,
      cloneDroneName: String(candidate?.cloneDroneName ?? '').trim(),
    });
  }

  const nodes: Array<{ droneId: string; label: string; x: number; y: number }> = [];
  const optimisticDroneNameById: Record<string, string> = {};
  let cloneIndex = 0;

  for (const raw of copiedDroneIds) {
    const sourceDroneId = String(raw ?? '').trim();
    if (!sourceDroneId) continue;
    const result = cloneResultBySourceDroneId.get(sourceDroneId);
    if (!result) continue;
    const sourceNodeId = String(args.sourceNodeIdByDroneId[sourceDroneId] ?? '').trim();
    const sourceNode = sourceNodeId ? args.nodesById[sourceNodeId] : null;
    const cloneNodeId = createCanvasChatNodeId(result.cloneDroneId, 'default');
    if (!sourceNode || !cloneNodeId) continue;
    cloneIndex += 1;
    nodes.push({
      droneId: cloneNodeId,
      label: 'default',
      x: sourceNode.x + args.cloneOffsetXPx * cloneIndex,
      y: sourceNode.y + args.cloneOffsetYPx * cloneIndex,
    });
    if (result.cloneDroneName) optimisticDroneNameById[result.cloneDroneId] = result.cloneDroneName;
  }

  return { nodes, optimisticDroneNameById };
}
