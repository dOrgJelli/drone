import React from 'react';
import type { PlaybookRunSummary } from '../types';
import { normalizePlaybookArtifactPath } from './playbook-config';

function artifactLabelFromPath(artifactPathRaw: string): string {
  const normalized = normalizePlaybookArtifactPath(artifactPathRaw);
  if (!normalized) return 'artifact';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function resolveArtifactViewerPath(run: PlaybookRunSummary, artifactPathRaw: string): string {
  const artifactPath = normalizePlaybookArtifactPath(artifactPathRaw);
  if (!artifactPath) return '';
  if (run.runtime === 'host') {
    const repoRoot = String(run.repoPath ?? '').trim().replace(/[\\/]+$/g, '');
    return repoRoot ? `${repoRoot}/${artifactPath}` : artifactPath;
  }
  return `/work/repo/${artifactPath}`;
}

export function playbookArtifactKey(runId: string, artifactPathRaw: string): string {
  return `${runId}:${normalizePlaybookArtifactPath(artifactPathRaw)}`;
}

type UsePlaybookArtifactAvailabilityArgs = {
  runs: PlaybookRunSummary[];
};

export function usePlaybookArtifactAvailability({
  runs,
}: UsePlaybookArtifactAvailabilityArgs): Record<string, { exists: boolean; path: string; name: string }> {
  const [artifactAvailabilityByKey, setArtifactAvailabilityByKey] = React.useState<
    Record<string, { exists: boolean; path: string; name: string }>
  >({});
  const artifactAvailabilityRef = React.useRef(artifactAvailabilityByKey);
  const pendingArtifactKeysRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    artifactAvailabilityRef.current = artifactAvailabilityByKey;
  }, [artifactAvailabilityByKey]);

  React.useEffect(() => {
    let cancelled = false;
    const activeKeys = new Set<string>();

    const probe = async (run: PlaybookRunSummary, artifactPathRaw: string) => {
      const normalizedArtifact = normalizePlaybookArtifactPath(artifactPathRaw);
      const resolvedPath = resolveArtifactViewerPath(run, normalizedArtifact);
      if (!normalizedArtifact || !resolvedPath) return;
      const key = playbookArtifactKey(run.id, normalizedArtifact);
      activeKeys.add(key);
      pendingArtifactKeysRef.current.add(key);
      try {
        const response = await fetch(
          `/api/drones/${encodeURIComponent(run.droneId)}/fs/file?path=${encodeURIComponent(resolvedPath)}`,
        );
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (cancelled) return;
        if (!response.ok) {
          setArtifactAvailabilityByKey((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
          return;
        }
        const actualPath = typeof data?.path === 'string' && data.path.trim() ? data.path.trim() : resolvedPath;
        const name = artifactLabelFromPath(normalizedArtifact);
        setArtifactAvailabilityByKey((prev) => {
          const existing = prev[key];
          if (existing?.exists && existing.path === actualPath && existing.name === name) return prev;
          return {
            ...prev,
            [key]: {
              exists: true,
              path: actualPath,
              name,
            },
          };
        });
      } finally {
        pendingArtifactKeysRef.current.delete(key);
      }
    };

    for (const run of runs) {
      for (const artifactPath of run.artifacts ?? []) {
        const normalizedArtifact = normalizePlaybookArtifactPath(artifactPath);
        if (!normalizedArtifact) continue;
        const key = playbookArtifactKey(run.id, normalizedArtifact);
        activeKeys.add(key);
        if (artifactAvailabilityRef.current[key] || pendingArtifactKeysRef.current.has(key)) continue;
        void probe(run, normalizedArtifact);
      }
    }

    setArtifactAvailabilityByKey((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [key, value] of Object.entries(prev)) {
        if (activeKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    return () => {
      cancelled = true;
    };
  }, [runs]);

  return artifactAvailabilityByKey;
}
