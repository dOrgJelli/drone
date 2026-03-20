import React from 'react';
import { SKILL_FILE_KIND_OPTIONS, type SkillFileDraft, type SkillFileKind } from './skill-library-model';
import type { UseSkillLibraryResult } from './use-skill-library';

function inputClassName() {
  return 'h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors';
}

function textareaClassName() {
  return 'w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono';
}

function buttonClassName(kind: 'primary' | 'secondary' | 'danger' = 'secondary', disabled = false): string {
  if (disabled) {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]';
  }
  if (kind === 'primary') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110';
  }
  if (kind === 'danger') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]';
  }
  return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]';
}

export function SkillLibrarySection({ skillLibrary }: { skillLibrary: UseSkillLibraryResult }) {
  const {
    skills,
    skillsLoading,
    skillsSaving,
    skillsDeleting,
    skillsError,
    skillsNotice,
    selectedSkillId,
    draft,
    draftDirty,
    selectSkill,
    updateDraftField,
    appendDraftFile,
    updateDraftFile,
    removeDraftFile,
    loadSkills,
    startNewSkill,
    saveDraft,
    deleteSelectedSkill,
    resetDraft,
    clearSkillsError,
    clearSkillsNotice,
  } = skillLibrary;

  const fileCountLabel = `${draft.files.length} ${draft.files.length === 1 ? 'file' : 'files'}`;

  const handleSelectSkill = React.useCallback(
    (skillId: string) => {
      if (selectedSkillId === skillId) return;
      if (draftDirty) {
        const ok = window.confirm('Discard unsaved skill edits?');
        if (!ok) return;
      }
      selectSkill(skillId);
    },
    [draftDirty, selectSkill, selectedSkillId],
  );

  const handleCreateNew = React.useCallback(() => {
    if (draftDirty) {
      const ok = window.confirm('Discard unsaved skill edits and start a new skill?');
      if (!ok) return;
    }
    startNewSkill();
  }, [draftDirty, startNewSkill]);

  const handleRefresh = React.useCallback(() => {
    if (draftDirty) {
      const ok = window.confirm('Discard unsaved skill edits and reload the library?');
      if (!ok) return;
    }
    void loadSkills();
  }, [draftDirty, loadSkills]);

  const handleReset = React.useCallback(() => {
    if (!draftDirty) return;
    const ok = window.confirm('Discard unsaved changes?');
    if (!ok) return;
    resetDraft();
  }, [draftDirty, resetDraft]);

  const handleDelete = React.useCallback(() => {
    if (!draft.id) return;
    const label = draft.name.trim() || draft.slug.trim() || 'this skill';
    const ok = window.confirm(`Delete ${label}?`);
    if (!ok) return;
    void deleteSelectedSkill();
  }, [deleteSelectedSkill, draft.id, draft.name, draft.slug]);

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Skill library
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
            Author portable `SKILL.md` packages once, then let the Hub project them into Codex, Claude, Cursor, and OpenCode.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleRefresh} disabled={skillsLoading} className={buttonClassName('secondary', skillsLoading)} style={{ fontFamily: 'var(--display)' }}>
            {skillsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" onClick={handleCreateNew} disabled={skillsSaving || skillsDeleting} className={buttonClassName('secondary', skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
            New skill
          </button>
          <button type="button" onClick={() => void saveDraft()} disabled={skillsSaving || skillsDeleting} className={buttonClassName('primary', skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
            {skillsSaving ? 'Saving…' : draft.id ? 'Save skill' : 'Create skill'}
          </button>
        </div>
      </div>

      {(skillsError || skillsNotice) && (
        <div className="flex flex-col gap-2">
          {skillsError && (
            <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)] flex items-center justify-between gap-3">
              <span>{skillsError}</span>
              <button type="button" onClick={clearSkillsError} className="text-[10px] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
          {skillsNotice && (
            <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399] flex items-center justify-between gap-3">
              <span>{skillsNotice}</span>
              <button type="button" onClick={clearSkillsNotice} className="text-[10px] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-3 min-w-0">
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-2 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Skills
            </div>
            <div className="text-[10px] text-[var(--muted-dim)]">{skills.length}</div>
          </div>
          <div className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto pr-1">
            {skills.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                No skills yet. Start a new one from the editor.
              </div>
            ) : (
              skills.map((skill) => {
                const active = skill.id === selectedSkillId;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => handleSelectSkill(skill.id)}
                    className={`w-full text-left rounded border px-3 py-2 transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[rgba(255,255,255,.05)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.01)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <div className="text-[12px] text-[var(--fg-secondary)] font-medium truncate">{skill.name}</div>
                    <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-1 truncate">{skill.slug}</div>
                    <div className="text-[10px] text-[var(--muted-dim)] mt-2 line-clamp-2">{skill.description}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--fg)] truncate">{draft.id ? draft.name || 'Untitled skill' : 'New skill draft'}</div>
              <div className="text-[10px] text-[var(--muted-dim)] mt-1">
                Projects to `.agents/skills`, `.claude/skills`, `.cursor/skills`, and `.opencode/skills`.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`text-[10px] uppercase tracking-[0.08em] ${draftDirty ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`}>
                {draftDirty ? 'Unsaved changes' : 'Saved'}
              </div>
              <button type="button" onClick={handleReset} disabled={!draftDirty || skillsSaving || skillsDeleting} className={buttonClassName('secondary', !draftDirty || skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
                Revert
              </button>
              <button type="button" onClick={handleDelete} disabled={!draft.id || skillsDeleting || skillsSaving} className={buttonClassName('danger', !draft.id || skillsDeleting || skillsSaving)} style={{ fontFamily: 'var(--display)' }}>
                {skillsDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Name</span>
              <input value={draft.name} onChange={(e) => updateDraftField('name', e.target.value)} className={inputClassName()} placeholder="Repo Review" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Slug</span>
              <input value={draft.slug} onChange={(e) => updateDraftField('slug', e.target.value)} className={`${inputClassName()} font-mono`} placeholder="repo-review" />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Description</span>
              <input value={draft.description} onChange={(e) => updateDraftField('description', e.target.value)} className={inputClassName()} placeholder="Short description used for skill discovery." />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">License</span>
              <input value={draft.license} onChange={(e) => updateDraftField('license', e.target.value)} className={inputClassName()} placeholder="MIT" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Compatibility</span>
              <input value={draft.compatibility} onChange={(e) => updateDraftField('compatibility', e.target.value)} className={inputClassName()} placeholder="codex,claude,cursor,opencode" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Skill body</span>
            <textarea
              value={draft.markdownBody}
              onChange={(e) => updateDraftField('markdownBody', e.target.value)}
              className={`${textareaClassName()} min-h-[180px]`}
              placeholder="Write the Markdown body that will be stored under SKILL.md after the YAML frontmatter."
            />
          </label>

          <div className="flex flex-col gap-3 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Package files</div>
                <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                  Add scripts, references, assets, or other files. `SKILL.md` is generated automatically.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-[var(--muted-dim)]">{fileCountLabel}</span>
                {SKILL_FILE_KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => appendDraftFile(option.value)}
                    className={buttonClassName('secondary')}
                    style={{ fontFamily: 'var(--display)' }}
                    title={`Add ${option.label.toLowerCase()} file`}
                  >
                    Add {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {draft.files.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                  No extra files. Use references for docs, scripts for runnable helpers, and assets for examples or templates.
                </div>
              ) : (
                draft.files.map((file: SkillFileDraft) => {
                  const option = SKILL_FILE_KIND_OPTIONS.find((entry) => entry.value === file.kind) ?? SKILL_FILE_KIND_OPTIONS[3];
                  return (
                    <div key={file.localId} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-3">
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-2 items-end">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Path</span>
                          <input
                            value={file.path}
                            onChange={(e) => updateDraftFile(file.localId, { path: e.target.value })}
                            className={`${inputClassName()} font-mono`}
                            placeholder={option.pathHint}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Kind</span>
                          <select
                            value={file.kind}
                            onChange={(e) => updateDraftFile(file.localId, { kind: e.target.value as SkillFileKind })}
                            className={inputClassName()}
                          >
                            {SKILL_FILE_KIND_OPTIONS.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeDraftFile(file.localId)}
                          className={buttonClassName('danger')}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        value={file.content}
                        onChange={(e) => updateDraftFile(file.localId, { content: e.target.value })}
                        className={`${textareaClassName()} min-h-[140px]`}
                        placeholder="File contents"
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Codex</div>
              <div className="text-[11px] text-[var(--muted-dim)]">Optional `agents/openai.yaml` overlay.</div>
              <textarea
                value={draft.codexOpenaiYaml}
                onChange={(e) => updateDraftField('codexOpenaiYaml', e.target.value)}
                className={`${textareaClassName()} min-h-[180px]`}
                placeholder={'tools:\n  - bash'}
              />
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Claude</div>
              <div className="grid grid-cols-1 gap-2">
                <input value={draft.claudeArgumentHint} onChange={(e) => updateDraftField('claudeArgumentHint', e.target.value)} className={inputClassName()} placeholder="Argument hint" />
                <input value={draft.claudeAllowedTools} onChange={(e) => updateDraftField('claudeAllowedTools', e.target.value)} className={inputClassName()} placeholder="Allowed tools (comma-separated)" />
                <input value={draft.claudeModel} onChange={(e) => updateDraftField('claudeModel', e.target.value)} className={inputClassName()} placeholder="Model" />
                <input value={draft.claudeContext} onChange={(e) => updateDraftField('claudeContext', e.target.value)} className={inputClassName()} placeholder="Context" />
                <input value={draft.claudeAgent} onChange={(e) => updateDraftField('claudeAgent', e.target.value)} className={inputClassName()} placeholder="Agent" />
                <label className="inline-flex items-center gap-2 text-[11px] text-[var(--muted)]">
                  <input type="checkbox" checked={draft.claudeUserInvocable} onChange={(e) => updateDraftField('claudeUserInvocable', e.target.checked)} />
                  User invocable
                </label>
                <label className="inline-flex items-center gap-2 text-[11px] text-[var(--muted)]">
                  <input type="checkbox" checked={draft.claudeDisableModelInvocation} onChange={(e) => updateDraftField('claudeDisableModelInvocation', e.target.checked)} />
                  Disable model invocation
                </label>
                <textarea
                  value={draft.claudeHooksJson}
                  onChange={(e) => updateDraftField('claudeHooksJson', e.target.value)}
                  className={`${textareaClassName()} min-h-[140px]`}
                  placeholder='Hooks JSON, for example {"preToolUse": {"Bash": [{"matcher": ".*"}]}}'
                />
              </div>
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Cursor + advanced</div>
              <label className="inline-flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <input type="checkbox" checked={draft.cursorDisableModelInvocation} onChange={(e) => updateDraftField('cursorDisableModelInvocation', e.target.checked)} />
                Disable model invocation
              </label>
              <div className="text-[11px] text-[var(--muted-dim)]">Optional portable metadata object.</div>
              <textarea
                value={draft.metadataJson}
                onChange={(e) => updateDraftField('metadataJson', e.target.value)}
                className={`${textareaClassName()} min-h-[220px]`}
                placeholder='{"owner":"platform","tags":"review"}'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
