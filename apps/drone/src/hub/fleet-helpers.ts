import {
  FLEET_API_VERSION,
  FLEET_CAPABILITY_CREATE,
  FLEET_CAPABILITY_READ,
  FLEET_CAPABILITY_SEND,
  FLEET_DEFAULT_LIMITS,
} from '../fleet/contracts';

const FLEET_READ_SCOPES = new Set(['children', 'assigned', 'self']);
const FLEET_CAPABILITIES = new Set([FLEET_CAPABILITY_CREATE, FLEET_CAPABILITY_SEND, FLEET_CAPABILITY_READ]);

export type FleetActorConfig = {
  enabled: boolean;
  capabilities: string[];
  readScopes: string[];
  assigned: string[];
  quotas: Record<string, number>;
  createdBy: string | null;
  createdAt: string | null;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeUniqueStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? Array.from(new Set(raw.map(String).filter(Boolean))) : [];
}

export function sanitizeFleetCapabilities(raw: unknown): string[] {
  return normalizeUniqueStringList(raw).filter((value) => FLEET_CAPABILITIES.has(value));
}

export function sanitizeFleetReadScopes(raw: unknown): string[] {
  const scopes = normalizeUniqueStringList(raw).filter((value) => FLEET_READ_SCOPES.has(value));
  return scopes.length > 0 ? scopes : ['children'];
}

export function sanitizeFleetAssigned(raw: unknown): string[] {
  return normalizeUniqueStringList(raw);
}

export function sanitizeFleetQuotas(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key), Number(value)])
      .filter(([, value]) => Number.isFinite(value)),
  ) as Record<string, number>;
}

export function fleetActorConfig(entry: any): FleetActorConfig {
  const raw = entry?.fleet && typeof entry.fleet === 'object' ? entry.fleet : {};
  return {
    enabled: raw.enabled === true,
    capabilities:
      raw.capabilities === undefined
        ? [FLEET_CAPABILITY_CREATE, FLEET_CAPABILITY_SEND, FLEET_CAPABILITY_READ]
        : sanitizeFleetCapabilities(raw.capabilities),
    readScopes: sanitizeFleetReadScopes(raw.readScopes),
    assigned: sanitizeFleetAssigned(raw.assigned),
    quotas: sanitizeFleetQuotas(raw.quotas),
    createdBy: typeof raw.createdBy === 'string' && raw.createdBy.trim() ? raw.createdBy.trim() : null,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : null,
  };
}

export function setFleetActorConfig(entry: any, config: FleetActorConfig): any {
  entry.fleet = {
    ...(entry?.fleet && typeof entry.fleet === 'object' ? entry.fleet : {}),
    enabled: config.enabled === true,
    capabilities: sanitizeFleetCapabilities(config.capabilities),
    readScopes: sanitizeFleetReadScopes(config.readScopes),
    assigned: sanitizeFleetAssigned(config.assigned),
    quotas: sanitizeFleetQuotas(config.quotas),
    createdBy: typeof config.createdBy === 'string' && config.createdBy.trim() ? config.createdBy.trim() : null,
    createdAt: typeof config.createdAt === 'string' && config.createdAt.trim() ? config.createdAt.trim() : null,
  };
  return entry;
}

export function effectiveFleetLimits(entry: any) {
  const quotas = fleetActorConfig(entry).quotas;
  const maxReadPageSize = clampInt(Number(quotas.maxReadPageSize ?? FLEET_DEFAULT_LIMITS.maxReadPageSize), 1, 500);
  const defaultReadPageSize = clampInt(Number(quotas.defaultReadPageSize ?? FLEET_DEFAULT_LIMITS.defaultReadPageSize), 1, maxReadPageSize);
  return {
    maxChildren: clampInt(Number(quotas.maxChildren ?? FLEET_DEFAULT_LIMITS.maxChildren), 1, 100),
    maxCreationsPerHour: clampInt(Number(quotas.maxCreationsPerHour ?? FLEET_DEFAULT_LIMITS.maxCreationsPerHour), 1, 500),
    maxPendingCreationsGlobal: clampInt(
      Number(quotas.maxPendingCreationsGlobal ?? FLEET_DEFAULT_LIMITS.maxPendingCreationsGlobal),
      1,
      1000,
    ),
    maxMessagesPerMinute: clampInt(Number(quotas.maxMessagesPerMinute ?? FLEET_DEFAULT_LIMITS.maxMessagesPerMinute), 1, 1000),
    maxMessageSizeBytes: clampInt(Number(quotas.maxMessageSizeBytes ?? FLEET_DEFAULT_LIMITS.maxMessageSizeBytes), 1, 256 * 1024),
    maxReadPageSize,
    defaultReadPageSize,
    maxReadChars: clampInt(Number(quotas.maxReadChars ?? FLEET_DEFAULT_LIMITS.maxReadChars), 1, 256 * 1024),
  };
}

export function fleetAuditList(regAny: any): any[] {
  regAny.fleet = regAny.fleet ?? {};
  regAny.fleet.audit = Array.isArray(regAny.fleet.audit) ? regAny.fleet.audit : [];
  return regAny.fleet.audit as any[];
}

export function fleetChildrenForActor(
  regAny: any,
  actorId: string,
): Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }> {
  const out: Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }> = [];
  for (const [id, entry] of Object.entries(regAny?.drones ?? {})) {
    const config = fleetActorConfig(entry);
    if (config.createdBy !== actorId) continue;
    out.push({ id: String(id), name: String((entry as any)?.name ?? id), kind: 'real', phase: null });
  }
  for (const [id, entry] of Object.entries(regAny?.pending ?? {})) {
    const config = fleetActorConfig(entry);
    if (config.createdBy !== actorId) continue;
    out.push({
      id: String(id),
      name: String((entry as any)?.name ?? id),
      kind: 'pending',
      phase: typeof (entry as any)?.phase === 'string' ? String((entry as any).phase) : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function fleetAuditUsageCount(
  regAny: any,
  opts: { actorId: string; action: 'create_child' | 'send_message'; status?: 'accepted' | 'rejected'; sinceMs: number },
): number {
  const nowMs = Date.now();
  return fleetAuditList(regAny).filter((item: any) => {
    if (String(item?.actor ?? '') !== opts.actorId) return false;
    if (String(item?.action ?? '') !== opts.action) return false;
    if (opts.status && String(item?.status ?? '') !== opts.status) return false;
    const atMs = Date.parse(String(item?.at ?? ''));
    return Number.isFinite(atMs) && nowMs - atMs <= opts.sinceMs;
  }).length;
}

export function fleetTargetAllowedForSend(actorEntry: any, actorId: string, targetId: string): boolean {
  if (targetId === actorId) return true;
  return fleetActorConfig(actorEntry).assigned.includes(targetId);
}

export function fleetTargetAllowedForRead(regAny: any, actorEntry: any, actorId: string, targetId: string): boolean {
  if (targetId === actorId) return fleetActorConfig(actorEntry).readScopes.includes('self');
  const actorConfig = fleetActorConfig(actorEntry);
  const childIds = new Set(fleetChildrenForActor(regAny, actorId).map((item) => item.id));
  if (childIds.has(targetId) && actorConfig.readScopes.includes('children')) return true;
  if (actorConfig.assigned.includes(targetId) && actorConfig.readScopes.includes('assigned')) return true;
  return false;
}

export function encodeFleetCursor(index: number, order: 'asc' | 'desc'): string {
  return Buffer.from(JSON.stringify({ index, order }), 'utf8').toString('base64url');
}

export function decodeFleetCursor(raw: unknown, order: 'asc' | 'desc'): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as any;
    if (decoded?.order && String(decoded.order) !== order) return 0;
    const index = Number(decoded?.index ?? 0);
    return Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  } catch {
    return 0;
  }
}

export function transcriptTurnsToFleetMessages(
  chatName: string,
  turns: any[],
  nowIso: () => string = () => new Date().toISOString(),
): Array<{
  id: string;
  chat: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  runId?: string;
}> {
  const items: Array<{ id: string; chat: string; role: 'user' | 'assistant'; content: string; createdAt: string; runId?: string }> = [];
  for (const turn of turns) {
    const promptId = typeof turn?.id === 'string' && turn.id.trim() ? String(turn.id).trim() : undefined;
    const promptAt = typeof turn?.promptAt === 'string' ? String(turn.promptAt) : typeof turn?.at === 'string' ? String(turn.at) : nowIso();
    const completedAt = typeof turn?.completedAt === 'string' ? String(turn.completedAt) : typeof turn?.at === 'string' ? String(turn.at) : promptAt;
    const prompt = String(turn?.prompt ?? '').trim();
    const output = String(turn?.output ?? '').trim();
    if (prompt) {
      items.push({ id: `${promptId ?? `${items.length}`}:user`, chat: chatName, role: 'user', content: prompt, createdAt: promptAt, runId: promptId });
    }
    if (output) {
      items.push({
        id: `${promptId ?? `${items.length}`}:assistant`,
        chat: chatName,
        role: 'assistant',
        content: output,
        createdAt: completedAt,
        runId: promptId,
      });
    } else if (turn?.ok === false) {
      items.push({
        id: `${promptId ?? `${items.length}`}:assistant-error`,
        chat: chatName,
        role: 'assistant',
        content: String(turn?.error ?? 'failed'),
        createdAt: completedAt,
        runId: promptId,
      });
    }
  }
  return items;
}

export function fleetActorPayload(regAny: any, actorId: string) {
  const actorEntry = regAny?.drones?.[actorId];
  if (!actorEntry) throw new Error(`unknown drone: ${actorId}`);
  const actorConfig = fleetActorConfig(actorEntry);
  const limits = effectiveFleetLimits(actorEntry);
  const children = fleetChildrenForActor(regAny, actorId);
  const assigned = actorConfig.assigned
    .map((targetId) => {
      const target = regAny?.drones?.[targetId] ?? regAny?.pending?.[targetId] ?? null;
      if (!target) return null;
      return {
        id: targetId,
        name: String(target?.name ?? targetId),
        kind: regAny?.drones?.[targetId] ? 'real' : 'pending',
      };
    })
    .filter(Boolean);
  const availableTargets = Object.entries(regAny?.drones ?? {})
    .filter(([id]) => String(id) !== actorId)
    .map(([id, entry]) => ({
      id: String(id),
      name: String((entry as any)?.name ?? id),
      assigned: actorConfig.assigned.includes(String(id)),
      child: children.some((item) => item.id === id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    apiVersion: FLEET_API_VERSION,
    actor: { id: actorId, name: String(actorEntry?.name ?? actorId) },
    config: {
      enabled: actorConfig.enabled,
      capabilities: actorConfig.capabilities,
      readScopes: actorConfig.readScopes,
      quotas: actorConfig.quotas,
    },
    limits,
    usage: {
      childrenCount: children.length,
      assignedCount: assigned.length,
      creationsLastHour: fleetAuditUsageCount(regAny, { actorId, action: 'create_child', status: 'accepted', sinceMs: 60 * 60 * 1000 }),
      messagesLastMinute: fleetAuditUsageCount(regAny, { actorId, action: 'send_message', status: 'accepted', sinceMs: 60 * 1000 }),
      pendingCreationsGlobal: Object.keys(regAny?.pending ?? {}).length,
    },
    relationships: {
      children,
      assigned,
    },
    availableTargets,
  };
}
