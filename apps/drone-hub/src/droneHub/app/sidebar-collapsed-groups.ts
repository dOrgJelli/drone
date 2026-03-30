import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
} from './sidebar-group-paths';

export function renameCollapsedGroupKeysByPrefix(
  value: Record<string, boolean>,
  currentGroup: string,
  nextGroup: string,
): Record<string, boolean> {
  let changed = false;
  const nextMap: Record<string, boolean> = {};
  for (const [key, collapsed] of Object.entries(value)) {
    const nextKey = isSameOrDescendantSidebarGroupPath(key, currentGroup)
      ? rewriteSidebarGroupPathPrefix(key, currentGroup, nextGroup)
      : key;
    if (nextKey !== key) changed = true;
    nextMap[nextKey] = collapsed;
  }
  return changed ? nextMap : value;
}

export function removeCollapsedGroupKeysByPrefix(
  value: Record<string, boolean>,
  currentGroup: string,
): Record<string, boolean> {
  let changed = false;
  const nextMap: Record<string, boolean> = {};
  for (const [key, collapsed] of Object.entries(value)) {
    if (isSameOrDescendantSidebarGroupPath(key, currentGroup)) {
      changed = true;
      continue;
    }
    nextMap[key] = collapsed;
  }
  return changed ? nextMap : value;
}
