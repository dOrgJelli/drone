import React from 'react';
import type { AgentMessageAutoContinueSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseAgentMessageAutoContinueSettingsResult = {
  agentMessageAutoContinueSettings: AgentMessageAutoContinueSettingsResponse | null;
  agentMessageAutoContinueSettingsLoading: boolean;
  agentMessageAutoContinueSettingsError: string | null;
  agentMessageAutoContinueSettingsNotice: string | null;
  autoContinuePromptDraft: string;
  autoContinueEnabledByDefaultDraft: boolean;
  savingAgentMessageAutoContinueSettings: boolean;
  setAutoContinuePromptDraft: React.Dispatch<React.SetStateAction<string>>;
  setAutoContinueEnabledByDefaultDraft: React.Dispatch<React.SetStateAction<boolean>>;
  loadAgentMessageAutoContinueSettings: () => Promise<void>;
  saveAgentMessageAutoContinueSettings: () => Promise<void>;
};

export function useAgentMessageAutoContinueSettings(
  requestJson: RequestJsonFn,
): UseAgentMessageAutoContinueSettingsResult {
  const [agentMessageAutoContinueSettings, setAgentMessageAutoContinueSettings] =
    React.useState<AgentMessageAutoContinueSettingsResponse | null>(null);
  const [agentMessageAutoContinueSettingsLoading, setAgentMessageAutoContinueSettingsLoading] =
    React.useState(false);
  const [agentMessageAutoContinueSettingsError, setAgentMessageAutoContinueSettingsError] =
    React.useState<string | null>(null);
  const [agentMessageAutoContinueSettingsNotice, setAgentMessageAutoContinueSettingsNotice] =
    React.useState<string | null>(null);
  const [autoContinuePromptDraft, setAutoContinuePromptDraft] = React.useState('continue');
  const [autoContinueEnabledByDefaultDraft, setAutoContinueEnabledByDefaultDraft] = React.useState(false);
  const [savingAgentMessageAutoContinueSettings, setSavingAgentMessageAutoContinueSettings] =
    React.useState(false);

  const loadAgentMessageAutoContinueSettings = React.useCallback(async () => {
    setAgentMessageAutoContinueSettingsLoading(true);
    setAgentMessageAutoContinueSettingsError(null);
    setAgentMessageAutoContinueSettingsNotice(null);
    try {
      const data = await requestJson<AgentMessageAutoContinueSettingsResponse>(
        '/api/settings/agent-message-auto-continue',
      );
      setAgentMessageAutoContinueSettings(data);
      setAutoContinuePromptDraft(data.agentMessageAutoContinue.prompt);
      setAutoContinueEnabledByDefaultDraft(data.agentMessageAutoContinue.enabledByDefault);
    } catch (e: any) {
      setAgentMessageAutoContinueSettingsError(e?.message ?? String(e));
    } finally {
      setAgentMessageAutoContinueSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadAgentMessageAutoContinueSettings();
  }, [loadAgentMessageAutoContinueSettings]);

  const saveAgentMessageAutoContinueSettings = React.useCallback(async () => {
    setAgentMessageAutoContinueSettingsError(null);
    setAgentMessageAutoContinueSettingsNotice(null);
    setSavingAgentMessageAutoContinueSettings(true);
    try {
      const data = await requestJson<AgentMessageAutoContinueSettingsResponse>(
        '/api/settings/agent-message-auto-continue',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: autoContinuePromptDraft,
            enabledByDefault: autoContinueEnabledByDefaultDraft,
          }),
        },
      );
      setAgentMessageAutoContinueSettings(data);
      setAutoContinuePromptDraft(data.agentMessageAutoContinue.prompt);
      setAutoContinueEnabledByDefaultDraft(data.agentMessageAutoContinue.enabledByDefault);
      setAgentMessageAutoContinueSettingsNotice('Saved auto-continue settings.');
    } catch (e: any) {
      setAgentMessageAutoContinueSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentMessageAutoContinueSettings(false);
    }
  }, [autoContinueEnabledByDefaultDraft, autoContinuePromptDraft, requestJson]);

  return {
    agentMessageAutoContinueSettings,
    agentMessageAutoContinueSettingsLoading,
    agentMessageAutoContinueSettingsError,
    agentMessageAutoContinueSettingsNotice,
    autoContinuePromptDraft,
    autoContinueEnabledByDefaultDraft,
    savingAgentMessageAutoContinueSettings,
    setAutoContinuePromptDraft,
    setAutoContinueEnabledByDefaultDraft,
    loadAgentMessageAutoContinueSettings,
    saveAgentMessageAutoContinueSettings,
  };
}
