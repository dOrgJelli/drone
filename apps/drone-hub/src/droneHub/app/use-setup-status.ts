import React from 'react';
import type { SetupStatusResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseSetupStatusResult = {
  setupStatus: SetupStatusResponse | null;
  setupStatusLoading: boolean;
  setupStatusError: string | null;
  dismissingWelcome: boolean;
  migratingLegacy: boolean;
  reloadSetupStatus: () => Promise<void>;
  dismissWelcome: () => Promise<void>;
  migrateLegacyToDefault: () => Promise<void>;
};

export function useSetupStatus(requestJson: RequestJsonFn): UseSetupStatusResult {
  const [setupStatus, setSetupStatus] = React.useState<SetupStatusResponse | null>(null);
  const [setupStatusLoading, setSetupStatusLoading] = React.useState(false);
  const [setupStatusError, setSetupStatusError] = React.useState<string | null>(null);
  const [dismissingWelcome, setDismissingWelcome] = React.useState(false);
  const [migratingLegacy, setMigratingLegacy] = React.useState(false);

  const reloadSetupStatus = React.useCallback(async () => {
    setSetupStatusLoading(true);
    setSetupStatusError(null);
    try {
      const data = await requestJson<SetupStatusResponse>('/api/setup/status');
      setSetupStatus(data);
    } catch (e: any) {
      setSetupStatusError(e?.message ?? String(e));
    } finally {
      setSetupStatusLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void reloadSetupStatus();
  }, [reloadSetupStatus]);

  const dismissWelcome = React.useCallback(async () => {
    setDismissingWelcome(true);
    setSetupStatusError(null);
    try {
      await requestJson('/api/setup/welcome/dismiss', {
        method: 'POST',
      });
      setSetupStatus((current) =>
        current
          ? {
              ...current,
              welcomeDismissedAt: new Date().toISOString(),
              shouldShowWelcome: false,
            }
          : current,
      );
    } catch (e: any) {
      setSetupStatusError(e?.message ?? String(e));
    } finally {
      setDismissingWelcome(false);
    }
  }, [requestJson]);

  const migrateLegacyToDefault = React.useCallback(async () => {
    setMigratingLegacy(true);
    setSetupStatusError(null);
    try {
      await requestJson('/api/settings/profiles/migrate-legacy', {
        method: 'POST',
      });
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (e: any) {
      setSetupStatusError(e?.message ?? String(e));
    } finally {
      setMigratingLegacy(false);
    }
  }, [requestJson]);

  return {
    setupStatus,
    setupStatusLoading,
    setupStatusError,
    dismissingWelcome,
    migratingLegacy,
    reloadSetupStatus,
    dismissWelcome,
    migrateLegacyToDefault,
  };
}
