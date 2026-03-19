import React from 'react';
import type {
  ArchiveRuntimePolicy,
  ArchiveRetentionId,
  ArchivedChatsResponse,
  ArchivedDronesResponse,
  DeleteActionSettingsResponse,
  DroneDeleteMode,
} from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseDeleteActionSettingsResult = {
  deleteSettings: DeleteActionSettingsResponse | null;
  deleteSettingsLoading: boolean;
  deleteSettingsError: string | null;
  deleteSettingsNotice: string | null;
  deleteModeDraft: DroneDeleteMode;
  archiveRetentionDraft: ArchiveRetentionId;
  archiveRuntimePolicyDraft: ArchiveRuntimePolicy;
  savingDeleteSettings: boolean;
  archivedDrones: ArchivedDronesResponse | null;
  archivedDronesLoading: boolean;
  archivedDronesError: string | null;
  archivedChats: ArchivedChatsResponse | null;
  archivedChatsLoading: boolean;
  archivedChatsError: string | null;
  archiveNotice: string | null;
  restoringArchivedById: Record<string, boolean>;
  deletingArchivedById: Record<string, boolean>;
  restoringArchivedChatByKey: Record<string, boolean>;
  deletingArchivedChatByKey: Record<string, boolean>;
  setDeleteModeDraft: React.Dispatch<React.SetStateAction<DroneDeleteMode>>;
  setArchiveRetentionDraft: React.Dispatch<React.SetStateAction<ArchiveRetentionId>>;
  setArchiveRuntimePolicyDraft: React.Dispatch<React.SetStateAction<ArchiveRuntimePolicy>>;
  loadDeleteSettings: () => Promise<void>;
  loadArchivedDrones: () => Promise<void>;
  loadArchivedChats: () => Promise<void>;
  saveDeleteSettings: () => Promise<void>;
  restoreArchivedDrone: (droneId: string) => Promise<void>;
  permanentlyDeleteArchivedDrone: (droneId: string) => Promise<void>;
  restoreArchivedChat: (droneId: string, chatName: string) => Promise<void>;
  permanentlyDeleteArchivedChat: (droneId: string, chatName: string) => Promise<void>;
};

export function useDeleteActionSettings(requestJson: RequestJsonFn): UseDeleteActionSettingsResult {
  const [deleteSettings, setDeleteSettings] = React.useState<DeleteActionSettingsResponse | null>(null);
  const [deleteSettingsLoading, setDeleteSettingsLoading] = React.useState(false);
  const [deleteSettingsError, setDeleteSettingsError] = React.useState<string | null>(null);
  const [deleteSettingsNotice, setDeleteSettingsNotice] = React.useState<string | null>(null);
  const [deleteModeDraft, setDeleteModeDraft] = React.useState<DroneDeleteMode>('permanent');
  const [archiveRetentionDraft, setArchiveRetentionDraft] = React.useState<ArchiveRetentionId>('1d');
  const [archiveRuntimePolicyDraft, setArchiveRuntimePolicyDraft] = React.useState<ArchiveRuntimePolicy>('keep-running');
  const [savingDeleteSettings, setSavingDeleteSettings] = React.useState(false);

  const [archivedDrones, setArchivedDrones] = React.useState<ArchivedDronesResponse | null>(null);
  const [archivedDronesLoading, setArchivedDronesLoading] = React.useState(false);
  const [archivedDronesError, setArchivedDronesError] = React.useState<string | null>(null);
  const [archivedChats, setArchivedChats] = React.useState<ArchivedChatsResponse | null>(null);
  const [archivedChatsLoading, setArchivedChatsLoading] = React.useState(false);
  const [archivedChatsError, setArchivedChatsError] = React.useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = React.useState<string | null>(null);
  const [restoringArchivedById, setRestoringArchivedById] = React.useState<Record<string, boolean>>({});
  const [deletingArchivedById, setDeletingArchivedById] = React.useState<Record<string, boolean>>({});
  const [restoringArchivedChatByKey, setRestoringArchivedChatByKey] = React.useState<Record<string, boolean>>({});
  const [deletingArchivedChatByKey, setDeletingArchivedChatByKey] = React.useState<Record<string, boolean>>({});

  const loadDeleteSettings = React.useCallback(async () => {
    setDeleteSettingsLoading(true);
    setDeleteSettingsError(null);
    try {
      const data = await requestJson<DeleteActionSettingsResponse>('/api/settings/delete-action');
      setDeleteSettings(data);
      setDeleteModeDraft(data.deleteAction.mode);
      setArchiveRetentionDraft(data.deleteAction.archiveRetention);
      setArchiveRuntimePolicyDraft(data.deleteAction.archiveRuntimePolicy ?? 'keep-running');
    } catch (e: any) {
      setDeleteSettingsError(e?.message ?? String(e));
    } finally {
      setDeleteSettingsLoading(false);
    }
  }, [requestJson]);

  const loadArchivedDrones = React.useCallback(async () => {
    setArchivedDronesLoading(true);
    setArchivedDronesError(null);
    try {
      const data = await requestJson<ArchivedDronesResponse>('/api/archive/drones');
      setArchivedDrones(data);
    } catch (e: any) {
      setArchivedDronesError(e?.message ?? String(e));
    } finally {
      setArchivedDronesLoading(false);
    }
  }, [requestJson]);

  const loadArchivedChats = React.useCallback(async () => {
    setArchivedChatsLoading(true);
    setArchivedChatsError(null);
    try {
      const data = await requestJson<ArchivedChatsResponse>('/api/archive/chats');
      setArchivedChats(data);
    } catch (e: any) {
      setArchivedChatsError(e?.message ?? String(e));
    } finally {
      setArchivedChatsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadDeleteSettings();
    void loadArchivedDrones();
    void loadArchivedChats();
  }, [loadArchivedChats, loadDeleteSettings, loadArchivedDrones]);

  const saveDeleteSettings = React.useCallback(async () => {
    setSavingDeleteSettings(true);
    setDeleteSettingsError(null);
    setDeleteSettingsNotice(null);
    try {
      const data = await requestJson<DeleteActionSettingsResponse>('/api/settings/delete-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: deleteModeDraft,
          archiveRetention: archiveRetentionDraft,
          archiveRuntimePolicy: archiveRuntimePolicyDraft,
        }),
      });
      setDeleteSettings(data);
      setDeleteModeDraft(data.deleteAction.mode);
      setArchiveRetentionDraft(data.deleteAction.archiveRetention);
      setArchiveRuntimePolicyDraft(data.deleteAction.archiveRuntimePolicy ?? 'keep-running');
      setDeleteSettingsNotice(
        data.deleteAction.mode === 'archive'
          ? `Trash now archives drones and chats (${data.deleteAction.archiveRuntimePolicy === 'stop' ? 'stop drones on archive' : 'keep archived drones running'}). Auto-delete after ${data.deleteAction.archiveRetention}.`
          : 'Trash now permanently deletes drones and chats.',
      );
    } catch (e: any) {
      setDeleteSettingsError(e?.message ?? String(e));
    } finally {
      setSavingDeleteSettings(false);
    }
  }, [archiveRetentionDraft, archiveRuntimePolicyDraft, deleteModeDraft, requestJson]);

  const restoreArchivedDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (restoringArchivedById[droneId] || deletingArchivedById[droneId]) return;
      setRestoringArchivedById((prev) => ({ ...prev, [droneId]: true }));
      setArchiveNotice(null);
      setArchivedDronesError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}/restore`, {
          method: 'POST',
        });
        setArchiveNotice('Drone restored from archive.');
        await loadArchivedDrones();
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedDronesError(e?.message ?? String(e));
      } finally {
        setRestoringArchivedById((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingArchivedById, loadArchivedChats, loadArchivedDrones, requestJson, restoringArchivedById],
  );

  const permanentlyDeleteArchivedDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (deletingArchivedById[droneId] || restoringArchivedById[droneId]) return;
      const ok = window.confirm(
        'Permanently delete this archived drone now?\n\nThis removes the container and cannot be undone.',
      );
      if (!ok) return;
      setDeletingArchivedById((prev) => ({ ...prev, [droneId]: true }));
      setArchiveNotice(null);
      setArchivedDronesError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}`, {
          method: 'DELETE',
        });
        setArchiveNotice('Archived drone permanently deleted.');
        await loadArchivedDrones();
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedDronesError(e?.message ?? String(e));
      } finally {
        setDeletingArchivedById((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingArchivedById, loadArchivedChats, loadArchivedDrones, requestJson, restoringArchivedById],
  );

  const archivedChatKey = React.useCallback((droneIdRaw: string, chatNameRaw: string): string => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim();
    return droneId && chatName ? `${droneId}\u0000${chatName}` : '';
  }, []);

  const restoreArchivedChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      const key = archivedChatKey(droneId, chatName);
      if (!key) return;
      if (restoringArchivedChatByKey[key] || deletingArchivedChatByKey[key]) return;
      setRestoringArchivedChatByKey((prev) => ({ ...prev, [key]: true }));
      setArchiveNotice(null);
      setArchivedChatsError(null);
      try {
        const data = await requestJson<{ chat?: string; renamed?: boolean }>(
          `/api/archive/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/restore`,
          { method: 'POST' },
        );
        const restoredChat = String(data?.chat ?? chatName).trim() || chatName;
        setArchiveNotice(
          data?.renamed
            ? `Chat restored as "${restoredChat}" on ${droneId}.`
            : `Chat "${restoredChat}" restored on ${droneId}.`,
        );
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedChatsError(e?.message ?? String(e));
      } finally {
        setRestoringArchivedChatByKey((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [archivedChatKey, deletingArchivedChatByKey, loadArchivedChats, requestJson, restoringArchivedChatByKey],
  );

  const permanentlyDeleteArchivedChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      const key = archivedChatKey(droneId, chatName);
      if (!key) return;
      if (deletingArchivedChatByKey[key] || restoringArchivedChatByKey[key]) return;
      const ok = window.confirm(
        `Permanently delete archived chat "${chatName}" from "${droneId}" now?\n\nThis cannot be undone.`,
      );
      if (!ok) return;
      setDeletingArchivedChatByKey((prev) => ({ ...prev, [key]: true }));
      setArchiveNotice(null);
      setArchivedChatsError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`, {
          method: 'DELETE',
        });
        setArchiveNotice(`Archived chat "${chatName}" permanently deleted.`);
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedChatsError(e?.message ?? String(e));
      } finally {
        setDeletingArchivedChatByKey((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [archivedChatKey, deletingArchivedChatByKey, loadArchivedChats, requestJson, restoringArchivedChatByKey],
  );

  return {
    deleteSettings,
    deleteSettingsLoading,
    deleteSettingsError,
    deleteSettingsNotice,
    deleteModeDraft,
    archiveRetentionDraft,
    archiveRuntimePolicyDraft,
    savingDeleteSettings,
    archivedDrones,
    archivedDronesLoading,
    archivedDronesError,
    archivedChats,
    archivedChatsLoading,
    archivedChatsError,
    archiveNotice,
    restoringArchivedById,
    deletingArchivedById,
    restoringArchivedChatByKey,
    deletingArchivedChatByKey,
    setDeleteModeDraft,
    setArchiveRetentionDraft,
    setArchiveRuntimePolicyDraft,
    loadDeleteSettings,
    loadArchivedDrones,
    loadArchivedChats,
    saveDeleteSettings,
    restoreArchivedDrone,
    permanentlyDeleteArchivedDrone,
    restoreArchivedChat,
    permanentlyDeleteArchivedChat,
  };
}
