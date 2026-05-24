import * as React from 'react';

export type AssistantSystemPromptMode = 'thread' | 'global';
export type AssistantSystemPromptKind = 'normal' | 'voice';

type AssistantSystemPromptModalProps = {
  open: boolean;
  threadTitle: string;
  threadVoiceEnabled: boolean;
  mode: AssistantSystemPromptMode;
  onModeChange: (mode: AssistantSystemPromptMode) => void;
  globalKind: AssistantSystemPromptKind;
  onGlobalKindChange: (kind: AssistantSystemPromptKind) => void;
  threadDraft: string;
  onThreadDraftChange: (value: string) => void;
  normalDraft: string;
  onNormalDraftChange: (value: string) => void;
  voiceDraft: string;
  onVoiceDraftChange: (value: string) => void;
  inheritedPrompt: string;
  maxChars: number;
  saving: boolean;
  promoteSaving: boolean;
  error: string | null;
  notice: string | null;
  onClose: () => void;
  onSaveThread: () => void;
  onSaveGlobal: () => void;
  onPromoteThread: () => void;
  onUseInherited: () => void;
  onResetGlobal: () => void;
};

function charsLabel(value: string, maxChars: number): string {
  return `${value.length.toLocaleString()} / ${maxChars.toLocaleString()}`;
}

export function AssistantSystemPromptModal({
  open,
  threadTitle,
  threadVoiceEnabled,
  mode,
  onModeChange,
  globalKind,
  onGlobalKindChange,
  threadDraft,
  onThreadDraftChange,
  normalDraft,
  onNormalDraftChange,
  voiceDraft,
  onVoiceDraftChange,
  inheritedPrompt,
  maxChars,
  saving,
  promoteSaving,
  error,
  notice,
  onClose,
  onSaveThread,
  onSaveGlobal,
  onPromoteThread,
  onUseInherited,
  onResetGlobal,
}: AssistantSystemPromptModalProps) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  const activeGlobalDraft = globalKind === 'voice' ? voiceDraft : normalDraft;
  const activeGlobalSetter = globalKind === 'voice' ? onVoiceDraftChange : onNormalDraftChange;
  const activeThreadKind: AssistantSystemPromptKind = threadVoiceEnabled ? 'voice' : 'normal';
  const busy = saving || promoteSaving;

  return (
    <div className="assistant-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="assistant-modal assistant-system-prompt-modal" role="dialog" aria-modal="true" aria-label="Assistant system prompts" onMouseDown={(event) => event.stopPropagation()}>
        <header className="assistant-modal-header">
          <div>
            <span className="hub-kicker">Assistant</span>
            <h2>System Prompt</h2>
            <small>{threadTitle || 'Current thread'} · {activeThreadKind}</small>
          </div>
          <button type="button" className="assistant-modal-close" onClick={onClose} aria-label="Close system prompt editor">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="assistant-modal-tabs" role="tablist" aria-label="System prompt scope">
          <button type="button" className={mode === 'thread' ? 'active' : ''} onClick={() => onModeChange('thread')}>
            Thread
          </button>
          <button type="button" className={mode === 'global' ? 'active' : ''} onClick={() => onModeChange('global')}>
            Defaults
          </button>
        </div>

        {error ? <div className="assistant-modal-banner error">{error}</div> : null}
        {notice ? <div className="assistant-modal-banner notice">{notice}</div> : null}

        {mode === 'thread' ? (
          <div className="assistant-prompt-editor">
            <div className="assistant-prompt-editor-header">
              <div>
                <strong>Thread prompt</strong>
                <small>Overrides the {activeThreadKind} default for this thread only.</small>
              </div>
              <span>{charsLabel(threadDraft, maxChars)}</span>
            </div>
            <textarea
              autoFocus
              value={threadDraft}
              maxLength={maxChars}
              onChange={(event) => onThreadDraftChange(event.currentTarget.value)}
              placeholder={inheritedPrompt}
            />
            <div className="assistant-prompt-compare">
              <div>
                <span>Inherited default</span>
                <pre>{inheritedPrompt}</pre>
              </div>
              <div>
                <span>Thread override</span>
                <pre>{threadDraft.trim() || inheritedPrompt}</pre>
              </div>
            </div>
            <footer className="assistant-modal-footer">
              <button type="button" onClick={onUseInherited} disabled={busy}>
                Use Default
              </button>
              <button type="button" onClick={onPromoteThread} disabled={busy || !threadDraft.trim()}>
                {promoteSaving ? 'Saving...' : `Make ${activeThreadKind} Default`}
              </button>
              <button type="button" className="primary" onClick={onSaveThread} disabled={busy}>
                {saving ? 'Saving...' : 'Save Thread Prompt'}
              </button>
            </footer>
          </div>
        ) : (
          <div className="assistant-prompt-editor">
            <div className="assistant-prompt-kind-switch" role="group" aria-label="Default prompt type">
              <button type="button" className={globalKind === 'normal' ? 'active' : ''} onClick={() => onGlobalKindChange('normal')}>
                Normal
              </button>
              <button type="button" className={globalKind === 'voice' ? 'active' : ''} onClick={() => onGlobalKindChange('voice')}>
                Voice
              </button>
            </div>
            <div className="assistant-prompt-editor-header">
              <div>
                <strong>{globalKind === 'voice' ? 'Voice default' : 'Normal default'}</strong>
                <small>Used by threads that do not have a thread override.</small>
              </div>
              <span>{charsLabel(activeGlobalDraft, maxChars)}</span>
            </div>
            <textarea
              autoFocus
              value={activeGlobalDraft}
              maxLength={maxChars}
              onChange={(event) => activeGlobalSetter(event.currentTarget.value)}
            />
            <footer className="assistant-modal-footer">
              <button type="button" onClick={onResetGlobal} disabled={busy}>
                Reset Draft
              </button>
              <button type="button" className="primary" onClick={onSaveGlobal} disabled={busy || !activeGlobalDraft.trim()}>
                {saving ? 'Saving...' : 'Save Default'}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
