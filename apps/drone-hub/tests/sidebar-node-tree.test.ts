import { describe, expect, test } from 'bun:test';
import { buildSidebarFolderTree } from '../src/droneHub/app/sidebar-folder-tree';
import { sidebarFolderNodeId } from '../src/droneHub/app/sidebar-node-order';
import { buildSidebarNodeTree, type SidebarTreeFolderNode } from '../src/droneHub/app/sidebar-node-tree';
import type { SidebarGroup } from '../src/droneHub/app/use-sidebar-view-model';
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

function folderNode(node: unknown): SidebarTreeFolderNode {
  expect(node && typeof node === 'object' && (node as any).kind === 'folder').toBe(true);
  return node as SidebarTreeFolderNode;
}

describe('buildSidebarNodeTree', () => {
  test('renders repo-scoped empty folders under the owning repo root', () => {
    const repoPath = '/work/repo-a';
    const sidebarGroups: SidebarGroup[] = [
      {
        group: `repo:${repoPath}`,
        label: 'repo-a',
        kind: 'repo',
        items: [drone({ id: 'drone-a', name: 'drone-a', repoPath, repoAttached: true })],
      },
    ];
    const sidebarFolderTree = buildSidebarFolderTree(sidebarGroups, []);

    const tree = buildSidebarNodeTree({
      sidebarFolderTree,
      sidebarGroups,
      sidebarGroupOrder: [],
      repoScopedGroupPathsByRepoGroup: {
        [`repo:${repoPath}`]: ['showreels/alpha'],
      },
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
    });

    const repoRootId = sidebarFolderNodeId(`repo:${repoPath}`);
    const repoChildren = (tree.childIdsByParent[repoRootId] ?? []).map((id) => tree.nodesById[id]);
    const showreelsNode = folderNode(repoChildren.find((node) => (node as any)?.kind === 'folder' && (node as any)?.groupPath === 'showreels'));
    const alphaNode = folderNode(
      (tree.childIdsByParent[showreelsNode.id] ?? []).map((id) => tree.nodesById[id]).find((node) => (node as any)?.groupPath === 'showreels/alpha'),
    );

    expect(showreelsNode.repoGroupPath).toBe(`repo:${repoPath}`);
    expect(showreelsNode.totalDroneCount).toBe(0);
    expect(alphaNode.repoGroupPath).toBe(`repo:${repoPath}`);
    expect(alphaNode.totalDroneCount).toBe(0);
  });
});
