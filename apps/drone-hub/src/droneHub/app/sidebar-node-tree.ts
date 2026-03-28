import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { orderSidebarEntries, sidebarGroupOrderToken } from './sidebar-group-order';
import { orderSidebarNodeIds, SIDEBAR_ROOT_PARENT_ID, sidebarDroneNodeId, sidebarFolderNodeId } from './sidebar-node-order';
import { sidebarFolderDisplayLabel, type SidebarFolderNode } from './sidebar-folder-tree';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import type { SidebarGroup } from './use-sidebar-view-model';

export type SidebarTreeFolderNode = {
  id: string;
  kind: 'folder';
  path: string;
  label: string;
  parentId: string;
  depth: number;
  totalDroneCount: number;
  directDroneCount: number;
};

export type SidebarTreeDroneNode = {
  id: string;
  kind: 'drone';
  droneId: string;
  parentId: string;
  groupPath: string | null;
  depth: number;
};

export type SidebarTreeNode = SidebarTreeFolderNode | SidebarTreeDroneNode;

export type SidebarNodeTreeModel = {
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParent: Record<string, string[]>;
  rootChildIds: string[];
  folderNodeByPath: Record<string, SidebarTreeFolderNode>;
};

type BuildSidebarNodeTreeArgs = {
  sidebarFolderTree: SidebarFolderNode[];
  sidebarGroups: SidebarGroup[];
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
};

function appendDroneTreeNodes(args: {
  tree: ReturnType<typeof buildSidebarDroneTree>;
  rootDroneIds: string[];
  parentId: string;
  groupPath: string | null;
  depth: number;
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParentDraft: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
}) {
  const visit = (droneIdRaw: string, parentId: string, depth: number) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    const id = sidebarDroneNodeId(droneId);
    args.nodesById[id] = {
      id,
      kind: 'drone',
      droneId,
      parentId,
      groupPath: args.groupPath,
      depth,
    };
    args.childIdsByParentDraft[parentId] ??= [];
    args.childIdsByParentDraft[parentId].push(id);

    const childDroneIds = args.tree.childDroneIdsByParentId[droneId] ?? [];
    const orderedChildDroneIds = orderSidebarNodeIds(
      childDroneIds.map((childId) => sidebarDroneNodeId(childId)),
      args.sidebarNodeOrderByParent[id] ?? [],
    ).map((childNodeId) => childNodeId.slice('drone:'.length));

    for (const childDroneId of orderedChildDroneIds) {
      visit(childDroneId, id, depth + 1);
    }
  };

  for (const rootDroneId of args.rootDroneIds) {
    visit(rootDroneId, args.parentId, args.depth);
  }
}

function collectFolderNodes(
  folder: SidebarFolderNode,
  parentId: string,
  nodesById: Record<string, SidebarTreeNode>,
  folderNodeByPath: Record<string, SidebarTreeFolderNode>,
  childIdsByParentDraft: Record<string, string[]>,
): void {
  const id = sidebarFolderNodeId(folder.path);
  const folderNode: SidebarTreeFolderNode = {
    id,
    kind: 'folder',
    path: folder.path,
    label: sidebarFolderDisplayLabel(folder),
    parentId,
    depth: folder.depth,
    totalDroneCount: folder.totalDroneCount,
    directDroneCount: folder.directDroneCount,
  };
  nodesById[id] = folderNode;
  folderNodeByPath[folder.path] = folderNode;
  childIdsByParentDraft[parentId] ??= [];
  childIdsByParentDraft[parentId].push(id);
  childIdsByParentDraft[id] ??= [];
  for (const child of folder.children) {
    collectFolderNodes(child, id, nodesById, folderNodeByPath, childIdsByParentDraft);
  }
}

export function buildSidebarNodeTree({
  sidebarFolderTree,
  sidebarGroups,
  sidebarGroupOrder,
  sidebarDroneOrderByGroup,
  sidebarNodeOrderByParent,
}: BuildSidebarNodeTreeArgs): SidebarNodeTreeModel {
  const nodesById: Record<string, SidebarTreeNode> = {};
  const folderNodeByPath: Record<string, SidebarTreeFolderNode> = {};
  const childIdsByParentDraft: Record<string, string[]> = {};

  for (const folder of sidebarFolderTree) {
    collectFolderNodes(folder, SIDEBAR_ROOT_PARENT_ID, nodesById, folderNodeByPath, childIdsByParentDraft);
  }

  const rootUngrouped = sidebarGroups.find((group) => group.kind === 'group' && isUngroupedGroupName(group.group)) ?? null;
  const rootUngroupedOrderedItems = orderSidebarEntries(
    rootUngrouped?.items ?? [],
    sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: 'Ungrouped', kind: 'group' })] ?? [],
    (item) => item.id,
    { unorderedPlacement: 'start' },
  );
  const rootUngroupedTree = buildSidebarDroneTree(rootUngroupedOrderedItems);
  appendDroneTreeNodes({
    tree: rootUngroupedTree,
    rootDroneIds: rootUngroupedTree.rootDroneIds,
    parentId: SIDEBAR_ROOT_PARENT_ID,
    groupPath: null,
    depth: 0,
    nodesById,
    childIdsByParentDraft,
    sidebarNodeOrderByParent,
  });

  for (const group of sidebarGroups) {
    if (group.kind !== 'group') continue;
    const groupPath = String(group.group ?? '').trim();
    if (!groupPath || isUngroupedGroupName(groupPath)) continue;
    const folderNode = folderNodeByPath[groupPath];
    if (!folderNode) continue;
    const orderedDroneItems = orderSidebarEntries(
      group.items,
      sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: groupPath, kind: 'group' })] ?? [],
      (item) => item.id,
      { unorderedPlacement: 'start' },
    );
    const tree = buildSidebarDroneTree(orderedDroneItems);
    appendDroneTreeNodes({
      tree,
      rootDroneIds: tree.rootDroneIds,
      parentId: folderNode.id,
      groupPath,
      depth: folderNode.depth + 1,
      nodesById,
      childIdsByParentDraft,
      sidebarNodeOrderByParent,
    });
  }

  const childIdsByParent: Record<string, string[]> = {};
  const orderedParentIds = new Set<string>([SIDEBAR_ROOT_PARENT_ID, ...Object.keys(childIdsByParentDraft)]);
  for (const parentId of orderedParentIds) {
    const rawChildIds = childIdsByParentDraft[parentId] ?? [];
    if (rawChildIds.length === 0) continue;
    childIdsByParent[parentId] = orderSidebarNodeIds(rawChildIds, sidebarNodeOrderByParent[parentId] ?? []);
  }

  return {
    nodesById,
    childIdsByParent,
    rootChildIds: childIdsByParent[SIDEBAR_ROOT_PARENT_ID] ?? [],
    folderNodeByPath,
  };
}
