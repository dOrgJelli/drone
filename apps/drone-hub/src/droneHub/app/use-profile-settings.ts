import React from 'react';
import { persistProfileStorageIdOverride } from '../../profile-storage';
import type { ProfileSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseProfileSettingsResult = {
  profileSettings: ProfileSettingsResponse | null;
  profileSettingsLoading: boolean;
  profileSettingsError: string | null;
  profileSettingsNotice: string | null;
  createProfileDraft: string;
  creatingProfile: boolean;
  activatingProfileName: string | null;
  renamingProfileName: string | null;
  deletingProfileName: string | null;
  migratingLegacy: boolean;
  setCreateProfileDraft: React.Dispatch<React.SetStateAction<string>>;
  loadProfileSettings: () => Promise<void>;
  createProfile: () => Promise<void>;
  activateProfile: (name: string) => Promise<void>;
  renameProfile: (name: string, nextName: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  migrateLegacyToDefault: () => Promise<void>;
};

export function useProfileSettings(requestJson: RequestJsonFn): UseProfileSettingsResult {
  const [profileSettings, setProfileSettings] = React.useState<ProfileSettingsResponse | null>(null);
  const [profileSettingsLoading, setProfileSettingsLoading] = React.useState(false);
  const [profileSettingsError, setProfileSettingsError] = React.useState<string | null>(null);
  const [profileSettingsNotice, setProfileSettingsNotice] = React.useState<string | null>(null);
  const [createProfileDraft, setCreateProfileDraft] = React.useState('');
  const [creatingProfile, setCreatingProfile] = React.useState(false);
  const [activatingProfileName, setActivatingProfileName] = React.useState<string | null>(null);
  const [renamingProfileName, setRenamingProfileName] = React.useState<string | null>(null);
  const [deletingProfileName, setDeletingProfileName] = React.useState<string | null>(null);
  const [migratingLegacy, setMigratingLegacy] = React.useState(false);

  const applyResponse = React.useCallback((data: ProfileSettingsResponse) => {
    setProfileSettings(data);
    persistProfileStorageIdOverride(data.activeProfile ?? null);
  }, []);

  const loadProfileSettings = React.useCallback(async () => {
    setProfileSettingsLoading(true);
    setProfileSettingsError(null);
    try {
      const data = await requestJson<ProfileSettingsResponse>('/api/settings/profiles');
      applyResponse(data);
    } catch (e: any) {
      setProfileSettingsError(e?.message ?? String(e));
    } finally {
      setProfileSettingsLoading(false);
    }
  }, [applyResponse, requestJson]);

  React.useEffect(() => {
    void loadProfileSettings();
  }, [loadProfileSettings]);

  const createProfile = React.useCallback(async () => {
    const name = String(createProfileDraft ?? '').trim();
    if (!name) {
      setProfileSettingsError('Profile name is required.');
      return;
    }
    setCreatingProfile(true);
    setProfileSettingsError(null);
    setProfileSettingsNotice(null);
    try {
      const data = await requestJson<ProfileSettingsResponse>('/api/settings/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      applyResponse(data);
      setCreateProfileDraft('');
      setProfileSettingsNotice(`Created profile ${data.createdProfile ?? name}.`);
    } catch (e: any) {
      setProfileSettingsError(e?.message ?? String(e));
    } finally {
      setCreatingProfile(false);
    }
  }, [applyResponse, createProfileDraft, requestJson]);

  const activateProfile = React.useCallback(
    async (nameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      if (!name) return;
      setActivatingProfileName(name);
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await requestJson<ProfileSettingsResponse>('/api/settings/profiles/activate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        applyResponse(data);
        if (data.reloadRequired && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        setProfileSettingsNotice(`Switched to profile ${data.activatedProfile ?? name}.`);
      } catch (e: any) {
        setProfileSettingsError(e?.message ?? String(e));
      } finally {
        setActivatingProfileName((current) => (current === name ? null : current));
      }
    },
    [applyResponse, requestJson],
  );

  const deleteProfile = React.useCallback(
    async (nameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      if (!name) return;
      setDeletingProfileName(name);
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await requestJson<ProfileSettingsResponse>(`/api/settings/profiles/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });
        applyResponse(data);
        const removedContainers = Array.isArray(data.removedContainers) ? data.removedContainers.length : 0;
        const removedHostRoots = Array.isArray(data.removedHostRoots) ? data.removedHostRoots.length : 0;
        setProfileSettingsNotice(
          `Deleted profile ${data.deletedProfile ?? name}${removedContainers || removedHostRoots ? ` (${removedContainers} containers, ${removedHostRoots} host runtimes removed)` : ''}.`,
        );
      } catch (e: any) {
        setProfileSettingsError(e?.message ?? String(e));
      } finally {
        setDeletingProfileName((current) => (current === name ? null : current));
      }
    },
    [applyResponse, requestJson],
  );

  const renameProfile = React.useCallback(
    async (nameRaw: string, nextNameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      const nextName = String(nextNameRaw ?? '').trim();
      if (!name || !nextName) {
        setProfileSettingsError('Both current and new profile names are required.');
        return;
      }
      setRenamingProfileName(name);
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await requestJson<ProfileSettingsResponse>('/api/settings/profiles/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, nextName }),
        });
        applyResponse(data);
        if (data.reloadRequired && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        setProfileSettingsNotice(`Renamed profile ${data.renamedFrom ?? name} to ${data.renamedTo ?? nextName}.`);
      } catch (e: any) {
        setProfileSettingsError(e?.message ?? String(e));
      } finally {
        setRenamingProfileName((current) => (current === name ? null : current));
      }
    },
    [applyResponse, requestJson],
  );

  const migrateLegacyToDefault = React.useCallback(async () => {
    setMigratingLegacy(true);
    setProfileSettingsError(null);
    setProfileSettingsNotice(null);
    try {
      const data = await requestJson<ProfileSettingsResponse>('/api/settings/profiles/migrate-legacy', {
        method: 'POST',
      });
      applyResponse(data);
      if (data.reloadRequired && typeof window !== 'undefined') {
        window.location.reload();
        return;
      }
      setProfileSettingsNotice(`Migrated legacy data into profile ${data.activatedProfile ?? 'default'}.`);
    } catch (e: any) {
      setProfileSettingsError(e?.message ?? String(e));
    } finally {
      setMigratingLegacy(false);
    }
  }, [applyResponse, requestJson]);

  return {
    profileSettings,
    profileSettingsLoading,
    profileSettingsError,
    profileSettingsNotice,
    createProfileDraft,
    creatingProfile,
    activatingProfileName,
    renamingProfileName,
    deletingProfileName,
    migratingLegacy,
    setCreateProfileDraft,
    loadProfileSettings,
    createProfile,
    activateProfile,
    renameProfile,
    deleteProfile,
    migrateLegacyToDefault,
  };
}
