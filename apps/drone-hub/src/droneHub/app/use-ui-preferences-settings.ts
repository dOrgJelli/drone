import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  normalizeAutomationConfigs,
} from './automation-config';
import type {
  SidebarGroupingMode,
  UiPreferencesSettingsResponse,
} from './settings-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { profileStorageKey } from '../../profile-storage';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UiPreferencesSnapshot = UiPreferencesSettingsResponse['uiPreferences'];

type UseUiPreferencesSettingsArgs = {
  requestJson: RequestJson;
};

const SAVE_DEBOUNCE_MS = 400;

function normalizeSidebarGroupingMode(value: unknown): SidebarGroupingMode {
  return value === 'repos' ? 'repos' : 'groups';
}

function normalizeOrderedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = String(item ?? '').trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function normalizeOrderedStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [keyRaw, listRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    const list = normalizeOrderedStringList(listRaw);
    if (list.length === 0) continue;
    out[key] = list;
  }
  return out;
}

function normalizeUiPreferencesSnapshot(value: Partial<UiPreferencesSnapshot> | null | undefined): UiPreferencesSnapshot {
  return {
    sidebarGroupingMode: normalizeSidebarGroupingMode(value?.sidebarGroupingMode),
    sidebarGroupOrder: normalizeOrderedStringList(value?.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(value?.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(value?.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(value?.sidebarChatOrderByDrone),
    hiddenSidebarGroups: normalizeOrderedStringList(value?.hiddenSidebarGroups),
    autoDelete: value?.autoDelete === true,
    automations: normalizeAutomationConfigs(value?.automations),
  };
}

function serializeUiPreferencesSnapshot(value: UiPreferencesSnapshot): string {
  return JSON.stringify(value);
}

function hasMeaningfulUiPreferencesSnapshot(value: UiPreferencesSnapshot): boolean {
  return (
    value.sidebarGroupingMode === 'repos' ||
    value.sidebarGroupOrder.length > 0 ||
    Object.keys(value.sidebarDroneOrderByGroup).length > 0 ||
    Object.keys(value.sidebarNodeOrderByParent).length > 0 ||
    Object.keys(value.sidebarChatOrderByDrone).length > 0 ||
    value.hiddenSidebarGroups.length > 0 ||
    value.autoDelete ||
    value.automations.length > 0
  );
}

function mergeUiPreferencesForRecovery(base: UiPreferencesSnapshot, rescue: UiPreferencesSnapshot): UiPreferencesSnapshot {
  return normalizeUiPreferencesSnapshot({
    sidebarGroupingMode: base.sidebarGroupingMode === 'groups' ? rescue.sidebarGroupingMode : base.sidebarGroupingMode,
    sidebarGroupOrder: base.sidebarGroupOrder.length > 0 ? base.sidebarGroupOrder : rescue.sidebarGroupOrder,
    sidebarDroneOrderByGroup:
      Object.keys(base.sidebarDroneOrderByGroup).length > 0 ? base.sidebarDroneOrderByGroup : rescue.sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent:
      Object.keys(base.sidebarNodeOrderByParent).length > 0 ? base.sidebarNodeOrderByParent : rescue.sidebarNodeOrderByParent,
    sidebarChatOrderByDrone:
      Object.keys(base.sidebarChatOrderByDrone).length > 0 ? base.sidebarChatOrderByDrone : rescue.sidebarChatOrderByDrone,
    hiddenSidebarGroups: base.hiddenSidebarGroups.length > 0 ? base.hiddenSidebarGroups : rescue.hiddenSidebarGroups,
    autoDelete: base.autoDelete || rescue.autoDelete,
    automations: base.automations.length > 0 ? base.automations : rescue.automations,
  });
}

export function restoreUiPreferencesFromPersistedStorage(
  current: Partial<UiPreferencesSnapshot> | null | undefined,
  storageRaw: string | null,
): { snapshot: UiPreferencesSnapshot; restored: boolean } {
  const base = normalizeUiPreferencesSnapshot(current);
  if (!storageRaw) return { snapshot: base, restored: false };
  try {
    const parsed = JSON.parse(storageRaw) as any;
    const persistedState =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'state')
        ? parsed.state
        : parsed;
    const rescue = normalizeUiPreferencesSnapshot(persistedState as Partial<UiPreferencesSnapshot>);
    if (!hasMeaningfulUiPreferencesSnapshot(rescue)) return { snapshot: base, restored: false };
    const merged = mergeUiPreferencesForRecovery(base, rescue);
    return {
      snapshot: merged,
      restored: serializeUiPreferencesSnapshot(merged) !== serializeUiPreferencesSnapshot(base),
    };
  } catch {
    return { snapshot: base, restored: false };
  }
}

export function useUiPreferencesSettings({ requestJson }: UseUiPreferencesSettingsArgs): void {
  const {
    sidebarGroupingMode,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    hiddenSidebarGroups,
    autoDelete,
    automations,
    setSidebarGroupingMode,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setAutoDelete,
    setAutomations,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      autoDelete: s.autoDelete,
      automations: s.automations,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setAutoDelete: s.setAutoDelete,
      setAutomations: s.setAutomations,
    })),
  );

  const readyRef = React.useRef(false);
  const lastSavedSerializedRef = React.useRef('');
  const saveSeqRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<number | null>(null);

  const applyUiPreferences = React.useCallback(
    (value: Partial<UiPreferencesSnapshot> | null | undefined): UiPreferencesSnapshot => {
      const normalized = normalizeUiPreferencesSnapshot(value);
      setSidebarGroupingMode(normalized.sidebarGroupingMode);
      setSidebarGroupOrder(normalized.sidebarGroupOrder);
      setSidebarDroneOrderByGroup(normalized.sidebarDroneOrderByGroup);
      setSidebarNodeOrderByParent(normalized.sidebarNodeOrderByParent);
      setSidebarChatOrderByDrone(normalized.sidebarChatOrderByDrone);
      setHiddenSidebarGroups(normalized.hiddenSidebarGroups);
      setAutoDelete(normalized.autoDelete);
      setAutomations(normalized.automations);
      return normalized;
    },
    [
      setAutoDelete,
      setAutomations,
      setHiddenSidebarGroups,
      setSidebarChatOrderByDrone,
      setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent,
      setSidebarGroupOrder,
      setSidebarGroupingMode,
    ],
  );

  const cancelPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveSeqRef.current += 1;
  }, []);

  const snapshot = React.useMemo(
    () =>
      normalizeUiPreferencesSnapshot({
        sidebarGroupingMode,
        sidebarGroupOrder,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
        sidebarChatOrderByDrone,
        hiddenSidebarGroups,
        autoDelete,
        automations,
      }),
    [
      autoDelete,
      automations,
      hiddenSidebarGroups,
      sidebarChatOrderByDrone,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupOrder,
      sidebarGroupingMode,
    ],
  );

  const reloadUiPreferences = React.useCallback(async () => {
    cancelPendingSave();
    try {
      const data = await requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences');
      const backendSnapshot = normalizeUiPreferencesSnapshot(data.uiPreferences);
      const restored = restoreUiPreferencesFromPersistedStorage(
        backendSnapshot,
        typeof localStorage !== 'undefined' ? localStorage.getItem(profileStorageKey('droneHub.ui')) : null,
      );
      if (data.updatedAt || restored.restored) {
        const normalized = applyUiPreferences(restored.snapshot);
        lastSavedSerializedRef.current = restored.restored
          ? serializeUiPreferencesSnapshot(backendSnapshot)
          : serializeUiPreferencesSnapshot(normalized);
      } else {
        lastSavedSerializedRef.current = '';
      }
    } catch {
      // Keep the local snapshot when the backend copy is unavailable.
    } finally {
      readyRef.current = true;
    }
  }, [applyUiPreferences, cancelPendingSave, requestJson]);

  React.useEffect(() => {
    void reloadUiPreferences();
  }, [reloadUiPreferences]);

  React.useEffect(() => {
    if (!readyRef.current) return;
    const serialized = serializeUiPreferencesSnapshot(snapshot);
    if (serialized === lastSavedSerializedRef.current) return;
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uiPreferences: snapshot }),
      })
        .then((data) => {
          if (saveSeqRef.current !== seq) return;
          const normalized = normalizeUiPreferencesSnapshot(data.uiPreferences);
          lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(normalized);
        })
        .catch(() => {
          if (saveSeqRef.current !== seq) return;
        });
    }, SAVE_DEBOUNCE_MS);
    saveTimeoutRef.current = timeout;
    return () => {
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
      window.clearTimeout(timeout);
    };
  }, [requestJson, snapshot]);
}
