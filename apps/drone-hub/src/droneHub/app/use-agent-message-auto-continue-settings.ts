import React from 'react';
import type { AgentMessageAutoContinueSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseAgentMessageAutoContinueSettingsResult = {
  agentMessageAutoContinueSettings: AgentMessageAutoContinueSettingsResponse | null;
  agentMessageAutoContinueSettingsLoading: boolean;
  agentMessageAutoContinueSettingsError: string | null;
  agentMessageAutoContinueSettingsNotice: string | null;
  autoContinuePromptDraft: string;
  savingAgentMessageAutoContinueSettings: boolean;
  setAutoContinuePromptDraft: React.Dispatch<React.SetStateAction<string>>;
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
          body: JSON.stringify({ prompt: autoContinuePromptDraft }),
        },
      );
      setAgentMessageAutoContinueSettings(data);
      setAutoContinuePromptDraft(data.agentMessageAutoContinue.prompt);
      setAgentMessageAutoContinueSettingsNotice('Saved auto-continue prompt.');
    } catch (e: any) {
      setAgentMessageAutoContinueSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentMessageAutoContinueSettings(false);
    }
  }, [autoContinuePromptDraft, requestJson]);

  return {
    agentMessageAutoContinueSettings,
    agentMessageAutoContinueSettingsLoading,
    agentMessageAutoContinueSettingsError,
    agentMessageAutoContinueSettingsNotice,
    autoContinuePromptDraft,
    savingAgentMessageAutoContinueSettings,
    setAutoContinuePromptDraft,
    loadAgentMessageAutoContinueSettings,
    saveAgentMessageAutoContinueSettings,
  };
}
