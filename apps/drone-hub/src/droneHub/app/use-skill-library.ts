import React from 'react';
import {
  createDraftFileTemplate,
  createEmptyDraft,
  draftFromSkill,
  payloadFromDraft,
  sanitizeDraftForComparison,
  sortSkills,
  type SkillDraft,
  type SkillDraftScalarKey,
  type SkillFileDraft,
  type SkillFileKind,
  type SkillRecord,
} from './skill-library-model';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type SkillsListResponse = {
  ok: true;
  skills: SkillRecord[];
};

type SkillMutationResponse = {
  ok: true;
  skill: SkillRecord;
};

function replaceSkill(skills: SkillRecord[], skill: SkillRecord): SkillRecord[] {
  const next = skills.filter((entry) => entry.id !== skill.id);
  next.push(skill);
  return sortSkills(next);
}

export type {
  SkillDraft,
  SkillDraftScalarKey,
  SkillFileDraft,
  SkillFileKind,
  SkillRecord,
} from './skill-library-model';

export type UseSkillLibraryResult = {
  skills: SkillRecord[];
  skillsLoading: boolean;
  skillsSaving: boolean;
  skillsDeleting: boolean;
  skillsError: string | null;
  skillsNotice: string | null;
  selectedSkillId: string | null;
  selectedSkill: SkillRecord | null;
  draft: SkillDraft;
  draftDirty: boolean;
  selectSkill: (skillId: string | null) => void;
  updateDraftField: <K extends SkillDraftScalarKey>(key: K, value: SkillDraft[K]) => void;
  appendDraftFile: (kind: SkillFileKind) => void;
  updateDraftFile: (localId: string, patch: Partial<SkillFileDraft>) => void;
  removeDraftFile: (localId: string) => void;
  loadSkills: () => Promise<void>;
  startNewSkill: () => void;
  saveDraft: () => Promise<void>;
  deleteSelectedSkill: () => Promise<void>;
  resetDraft: () => void;
  clearSkillsNotice: () => void;
  clearSkillsError: () => void;
};

export function useSkillLibrary(requestJson: RequestJsonFn): UseSkillLibraryResult {
  const [skills, setSkills] = React.useState<SkillRecord[]>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [skillsSaving, setSkillsSaving] = React.useState(false);
  const [skillsDeleting, setSkillsDeleting] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const [skillsNotice, setSkillsNotice] = React.useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<SkillDraft>(() => createEmptyDraft());
  const [baselineDraft, setBaselineDraft] = React.useState<SkillDraft>(() => createEmptyDraft());

  const selectedSkill = React.useMemo(
    () => skills.find((skill: SkillRecord) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills],
  );

  const draftDirty = React.useMemo(
    () => sanitizeDraftForComparison(draft) !== sanitizeDraftForComparison(baselineDraft),
    [baselineDraft, draft],
  );

  const selectedSkillIdRef = React.useRef<string | null>(selectedSkillId);
  React.useEffect(() => {
    selectedSkillIdRef.current = selectedSkillId;
  }, [selectedSkillId]);

  const applySelectedSkill = React.useCallback((skill: SkillRecord | null) => {
    setSelectedSkillId(skill?.id ?? null);
    const nextDraft = skill ? draftFromSkill(skill) : createEmptyDraft();
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
  }, []);

  const selectSkill = React.useCallback(
    (skillId: string | null) => {
      const next = skillId ? skills.find((skill: SkillRecord) => skill.id === skillId) ?? null : null;
      applySelectedSkill(next);
    },
    [applySelectedSkill, skills],
  );

  const updateDraftField = React.useCallback(<K extends SkillDraftScalarKey>(key: K, value: SkillDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const appendDraftFile = React.useCallback((kind: SkillFileKind) => {
    setDraft((prev) => ({
      ...prev,
      files: [...prev.files, createDraftFileTemplate(kind, prev.files.length)],
    }));
  }, []);

  const updateDraftFile = React.useCallback((localId: string, patch: Partial<SkillFileDraft>) => {
    setDraft((prev) => ({
      ...prev,
      files: prev.files.map((file) => (file.localId === localId ? { ...file, ...patch } : file)),
    }));
  }, []);

  const removeDraftFile = React.useCallback((localId: string) => {
    setDraft((prev) => ({
      ...prev,
      files: prev.files.filter((file) => file.localId !== localId),
    }));
  }, []);

  const loadSkills = React.useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const data = await requestJson<SkillsListResponse>('/api/skills');
      const nextSkills = sortSkills(data.skills ?? []);
      setSkills(nextSkills);
      const nextSelected =
        nextSkills.find((skill: SkillRecord) => skill.id === selectedSkillIdRef.current) ??
        nextSkills[0] ??
        null;
      applySelectedSkill(nextSelected);
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
    } finally {
      setSkillsLoading(false);
    }
  }, [applySelectedSkill, requestJson]);

  React.useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const startNewSkill = React.useCallback(() => {
    applySelectedSkill(null);
    setSkillsError(null);
    setSkillsNotice('Creating a new skill draft.');
  }, [applySelectedSkill]);

  const resetDraft = React.useCallback(() => {
    const nextDraft = selectedSkill ? draftFromSkill(selectedSkill) : createEmptyDraft();
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setSkillsError(null);
    setSkillsNotice(selectedSkill ? `Reverted changes for ${selectedSkill.name}.` : 'Cleared draft.');
  }, [selectedSkill]);

  const saveDraft = React.useCallback(async () => {
    setSkillsSaving(true);
    setSkillsError(null);
    setSkillsNotice(null);
    try {
      const payload = payloadFromDraft(draft);
      const data = draft.id
        ? await requestJson<SkillMutationResponse>(`/api/skills/${encodeURIComponent(draft.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await requestJson<SkillMutationResponse>('/api/skills', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const saved = data.skill;
      setSkills((prev: SkillRecord[]) => replaceSkill(prev, saved));
      applySelectedSkill(saved);
      setSkillsNotice(draft.id ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
    } finally {
      setSkillsSaving(false);
    }
  }, [applySelectedSkill, draft, requestJson]);

  const deleteSelectedSkill = React.useCallback(async () => {
    if (!selectedSkillId) return;
    setSkillsDeleting(true);
    setSkillsError(null);
    setSkillsNotice(null);
    try {
      await requestJson<{ ok: true; deleted: true; id: string }>(`/api/skills/${encodeURIComponent(selectedSkillId)}`, {
        method: 'DELETE',
      });
      const nextSkills = skills.filter((skill: SkillRecord) => skill.id !== selectedSkillId);
      setSkills(nextSkills);
      applySelectedSkill(nextSkills[0] ?? null);
      setSkillsNotice('Deleted skill.');
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
    } finally {
      setSkillsDeleting(false);
    }
  }, [applySelectedSkill, requestJson, selectedSkillId, skills]);

  const clearSkillsNotice = React.useCallback(() => setSkillsNotice(null), []);
  const clearSkillsError = React.useCallback(() => setSkillsError(null), []);

  return {
    skills,
    skillsLoading,
    skillsSaving,
    skillsDeleting,
    skillsError,
    skillsNotice,
    selectedSkillId,
    selectedSkill,
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
    clearSkillsNotice,
    clearSkillsError,
  };
}
