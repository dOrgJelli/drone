export function normalizeSidebarGroupPath(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

export function splitSidebarGroupPath(pathRaw: string | null | undefined): string[] {
  const path = normalizeSidebarGroupPath(pathRaw);
  if (!path) return [];
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinSidebarGroupPath(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeSidebarGroupPath(part))
    .filter(Boolean)
    .join('/');
}

export function sidebarGroupParentPath(pathRaw: string | null | undefined): string | null {
  const parts = splitSidebarGroupPath(pathRaw);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join('/');
}

export function sidebarGroupBaseName(pathRaw: string | null | undefined): string {
  const parts = splitSidebarGroupPath(pathRaw);
  if (parts.length === 0) return normalizeSidebarGroupPath(pathRaw);
  return parts[parts.length - 1] ?? '';
}

export function isSameOrDescendantSidebarGroupPath(
  pathRaw: string | null | undefined,
  prefixRaw: string | null | undefined,
): boolean {
  const path = normalizeSidebarGroupPath(pathRaw);
  const prefix = normalizeSidebarGroupPath(prefixRaw);
  if (!path || !prefix) return false;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function rewriteSidebarGroupPathPrefix(
  pathRaw: string | null | undefined,
  fromPrefixRaw: string | null | undefined,
  toPrefixRaw: string | null | undefined,
): string {
  const path = normalizeSidebarGroupPath(pathRaw);
  const fromPrefix = normalizeSidebarGroupPath(fromPrefixRaw);
  const toPrefix = normalizeSidebarGroupPath(toPrefixRaw);
  if (!path || !fromPrefix || !toPrefix || !isSameOrDescendantSidebarGroupPath(path, fromPrefix)) return path;
  if (path === fromPrefix) return toPrefix;
  return `${toPrefix}/${path.slice(fromPrefix.length + 1)}`;
}
