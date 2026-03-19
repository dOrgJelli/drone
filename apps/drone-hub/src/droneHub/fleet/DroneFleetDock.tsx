import React from 'react';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';

type FleetActorPayload = {
  ok: true;
  apiVersion: string;
  actor: { id: string; name: string };
  config: {
    enabled: boolean;
    capabilities: string[];
    readScopes: string[];
    quotas: Record<string, number>;
  };
  limits: {
    maxChildren: number;
    maxCreationsPerHour: number;
    maxPendingCreationsGlobal: number;
    maxMessagesPerMinute: number;
    maxMessageSizeBytes: number;
    maxReadPageSize: number;
    defaultReadPageSize: number;
    maxReadChars: number;
  };
  usage: {
    childrenCount: number;
    assignedCount: number;
    creationsLastHour: number;
    messagesLastMinute: number;
    pendingCreationsGlobal: number;
  };
  relationships: {
    children: Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }>;
    assigned: Array<{ id: string; name: string; kind: 'real' | 'pending' }>;
  };
  availableTargets: Array<{ id: string; name: string; assigned: boolean; child: boolean }>;
};

type FleetAuditPayload = {
  ok: true;
  items: Array<{
    id: string;
    at: string;
    actor: string;
    actorName: string;
    action: string;
    target: string | null;
    targetName: string | null;
    status: string;
    reason: string | null;
    meta?: Record<string, unknown>;
  }>;
};

type FleetQuotaState = {
  maxChildren: string;
  maxCreationsPerHour: string;
  maxPendingCreationsGlobal: string;
  maxMessagesPerMinute: string;
  maxMessageSizeBytes: string;
  maxReadPageSize: string;
  defaultReadPageSize: string;
  maxReadChars: string;
};

function formatWhen(iso: string): string {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return String(iso ?? '');
  return new Date(ms).toLocaleString();
}

function quotaStateFromPayload(data: FleetActorPayload | null): FleetQuotaState {
  return {
    maxChildren: String(data?.limits.maxChildren ?? 5),
    maxCreationsPerHour: String(data?.limits.maxCreationsPerHour ?? 10),
    maxPendingCreationsGlobal: String(data?.limits.maxPendingCreationsGlobal ?? 50),
    maxMessagesPerMinute: String(data?.limits.maxMessagesPerMinute ?? 30),
    maxMessageSizeBytes: String(data?.limits.maxMessageSizeBytes ?? 8192),
    maxReadPageSize: String(data?.limits.maxReadPageSize ?? 50),
    defaultReadPageSize: String(data?.limits.defaultReadPageSize ?? 20),
    maxReadChars: String(data?.limits.maxReadChars ?? 32000),
  };
}

export function DroneFleetDock({
  droneId,
  droneName,
  disabled,
  hubPhase,
  hubMessage,
}: {
  droneId: string;
  droneName: string;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
}) {
  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000fleet`,
    timeoutMs: 18_000,
  });
  const [data, setData] = React.useState<FleetActorPayload | null>(null);
  const [audit, setAudit] = React.useState<FleetAuditPayload['items']>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [capabilities, setCapabilities] = React.useState<Record<string, boolean>>({
    'drone:create': false,
    'drone:message:send': false,
    'drone:message:read': false,
  });
  const [readScopes, setReadScopes] = React.useState<Record<string, boolean>>({
    children: true,
    assigned: false,
    self: false,
  });
  const [quotas, setQuotas] = React.useState<FleetQuotaState>(() => quotaStateFromPayload(null));
  const [selectedTargetId, setSelectedTargetId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  const assignableTargets = (data?.availableTargets ?? []).filter((target) => !target.assigned);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [actor, auditResp] = await Promise.all([
        requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}`),
        requestJson<FleetAuditPayload>(`/api/fleet/audit?actor=${encodeURIComponent(droneId)}&limit=30`),
      ]);
      setData(actor);
      setAudit(auditResp.items ?? []);
      setError(null);
      startup.markReady();
    } catch (err: any) {
      if (!startup.suppressErrors) setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [droneId, startup]);

  React.useEffect(() => {
    let timer: any = null;
    void load();
    timer = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [load]);

  React.useEffect(() => {
    if (!data) return;
    setEnabled(data.config.enabled);
    setCapabilities({
      'drone:create': data.config.capabilities.includes('drone:create'),
      'drone:message:send': data.config.capabilities.includes('drone:message:send'),
      'drone:message:read': data.config.capabilities.includes('drone:message:read'),
    });
    setReadScopes({
      children: data.config.readScopes.includes('children'),
      assigned: data.config.readScopes.includes('assigned'),
      self: data.config.readScopes.includes('self'),
    });
    setQuotas(quotaStateFromPayload(data));
    setSelectedTargetId((prev) => {
      if (prev && data.availableTargets.some((item) => item.id === prev && !item.assigned)) return prev;
      return data.availableTargets.find((item) => !item.assigned)?.id ?? '';
    });
  }, [data]);

  const submitConfig = React.useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const next = await requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          capabilities: Object.entries(capabilities)
            .filter(([, value]) => value)
            .map(([key]) => key),
          readScopes: Object.entries(readScopes)
            .filter(([, value]) => value)
            .map(([key]) => key),
          quotas: Object.fromEntries(Object.entries(quotas).map(([key, value]) => [key, Number(value)])),
        }),
      });
      setData(next);
    } catch (err: any) {
      setSaveError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }, [capabilities, droneId, enabled, quotas, readScopes]);

  const addAssignment = React.useCallback(async () => {
    if (!selectedTargetId) return;
    setAssigning(true);
    setSaveError(null);
    try {
      const next = await requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}/assigned`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: selectedTargetId }),
      });
      setData(next);
    } catch (err: any) {
      setSaveError(err?.message ?? String(err));
    } finally {
      setAssigning(false);
    }
  }, [droneId, selectedTargetId]);

  const removeAssignment = React.useCallback(
    async (targetId: string) => {
      setAssigning(true);
      setSaveError(null);
      try {
        const next = await requestJson<FleetActorPayload>(
          `/api/fleet/actors/${encodeURIComponent(droneId)}/assigned/${encodeURIComponent(targetId)}`,
          { method: 'DELETE' },
        );
        setData(next);
      } catch (err: any) {
        setSaveError(err?.message ?? String(err));
      } finally {
        setAssigning(false);
      }
    },
    [droneId],
  );

  const capabilityToggle = (key: 'drone:create' | 'drone:message:send' | 'drone:message:read') =>
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  const readScopeToggle = (key: 'children' | 'assigned' | 'self') => setReadScopes((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="w-full h-full overflow-auto bg-[var(--panel-alt)]">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Fleet
          </div>
          <div className="text-[11px] text-[var(--muted)]">{droneName}</div>
        </div>
        <div className="text-[10px] text-[var(--muted-dim)] font-mono">{data?.apiVersion ?? 'loading'}</div>
      </div>

      <div className="p-3 flex flex-col gap-3 text-[11px]">
        {startup.waiting && (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[var(--muted)]">
            {provisioningLabel(hubPhase)} fleet surface…
            {hubMessage ? ` ${hubMessage}` : ''}
          </div>
        )}
        {hubPhase === 'error' && hubMessage && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{hubMessage}</div>}
        {error && !startup.suppressErrors && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{error}</div>}
        {saveError && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{saveError}</div>}

        <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
            <div className="font-medium text-[var(--fg)]">Policy</div>
            <label className="inline-flex items-center gap-2 text-[var(--muted)]">
              <input type="checkbox" checked={enabled} onChange={() => setEnabled((prev) => !prev)} />
              Fleet enabled
            </label>
          </div>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Capabilities</div>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:create']} onChange={() => capabilityToggle('drone:create')} /> Create children</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:message:send']} onChange={() => capabilityToggle('drone:message:send')} /> Send messages</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:message:read']} onChange={() => capabilityToggle('drone:message:read')} /> Read messages</label>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Read scopes</div>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.children} onChange={() => readScopeToggle('children')} /> Children</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.assigned} onChange={() => readScopeToggle('assigned')} /> Assigned</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.self} onChange={() => readScopeToggle('self')} /> Self</label>
            </div>
          </div>
          <div className="px-3 pb-3">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Limits</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(quotas).map(([key, value]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--muted-dim)]">{key}</span>
                  <input
                    className="rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-[11px]"
                    value={value}
                    onChange={(event) => setQuotas((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-[10px] text-[var(--muted-dim)]">
                Usage: {data?.usage.childrenCount ?? 0} children, {data?.usage.messagesLastMinute ?? 0} msgs/min, {data?.usage.creationsLastHour ?? 0} creates/hour
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitConfig()}
                className="rounded border border-[var(--border-strong)] px-3 py-1 text-[11px] hover:bg-[rgba(255,255,255,.04)] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save policy'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] font-medium text-[var(--fg)]">Relationships</div>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Children</div>
              <div className="flex flex-col gap-1">
                {(data?.relationships.children ?? []).length === 0 && <div className="text-[var(--muted-dim)]">No children yet</div>}
                {(data?.relationships.children ?? []).map((child) => (
                  <div key={child.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] px-2 py-1">
                    <span className="truncate">{child.name}</span>
                    <span className="text-[10px] text-[var(--muted-dim)] font-mono">{child.kind === 'pending' ? child.phase || 'pending' : 'ready'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Assigned</div>
              <div className="flex gap-2 mb-2">
                <select
                  className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1"
                  value={selectedTargetId}
                  onChange={(event) => setSelectedTargetId(event.target.value)}
                >
                  {assignableTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedTargetId || assigning}
                  onClick={() => void addAssignment()}
                  className="rounded border border-[var(--border-strong)] px-3 py-1 hover:bg-[rgba(255,255,255,.04)] disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {(data?.relationships.assigned ?? []).length === 0 && <div className="text-[var(--muted-dim)]">No assigned drones</div>}
                {(data?.relationships.assigned ?? []).map((target) => (
                  <div key={target.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] px-2 py-1">
                    <span className="truncate">{target.name}</span>
                    <button
                      type="button"
                      onClick={() => void removeAssignment(target.id)}
                      className="text-[var(--muted-dim)] hover:text-[var(--fg)]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] font-medium text-[var(--fg)]">Activity</div>
          <div className="p-3 flex flex-col gap-2">
            {loading && audit.length === 0 && <div className="text-[var(--muted-dim)]">Loading fleet activity…</div>}
            {!loading && audit.length === 0 && <div className="text-[var(--muted-dim)]">No fleet events yet</div>}
            {audit.map((item) => (
              <div key={item.id} className="rounded border border-[var(--border-subtle)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-[var(--fg)]">{item.action}</div>
                  <div className={`text-[10px] uppercase tracking-[0.08em] ${item.status === 'accepted' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                    {item.status}
                  </div>
                </div>
                <div className="text-[var(--muted)] mt-1">
                  {item.targetName ? `${item.targetName}` : 'No target'}
                  {item.reason ? ` · ${item.reason}` : ''}
                </div>
                <div className="text-[10px] text-[var(--muted-dim)] mt-1">{formatWhen(item.at)}</div>
              </div>
            ))}
          </div>
        </section>

        {disabled && <div className="text-[10px] text-[var(--muted-dim)]">Daemon transport is currently unavailable. Policy changes still persist and will sync when the drone is reachable again.</div>}
      </div>
    </div>
  );
}
