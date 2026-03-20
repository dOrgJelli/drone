import React from 'react';
import {
  createDraftFileTemplate,
  createEmptyDraft,
  draftFromSkill,
  filterSkillSourceCandidates,
  payloadFromDraft,
  sanitizeDraftForComparison,
  sortSkills,
  type SkillDraft,
  type SkillDraftScalarKey,
  type SkillFileDraft,
  type SkillFileKind,
  type SkillRecord,
  type SkillSourceCandidate,
  type SkillSourceCandidatePreview,
  type SkillSourcePreviewFile,
  type SkillSourceRecord,
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

type SkillSourceListResponse = {
  ok: true;
  sources: SkillSourceRecord[];
};

type SkillSourceCandidatesResponse = {
  ok: true;
  sourceId: string;
  skills: SkillSourceCandidate[];
};

type SkillSourcePreviewResponse = {
  ok: true;
  preview: SkillSourceCandidatePreview;
};

type SourceSkillLoadOptions = {
  refresh?: boolean;
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
  SkillSourceCandidate,
  SkillSourceCandidatePreview,
  SkillSourcePreviewFile,
  SkillSourceRecord,
} from './skill-library-model';

export type UseSkillLibraryResult = {
  skills: SkillRecord[];
  skillSources: SkillSourceRecord[];
  sourceSkills: SkillSourceCandidate[];
  filteredSourceSkills: SkillSourceCandidate[];
  sourceSkillPreview: SkillSourceCandidatePreview | null;
  selectedSourcePreviewPath: string | null;
  selectedSourcePreviewFilePath: string | null;
  selectedSourcePreviewFile: SkillSourcePreviewFile | null;
  skillsLoading: boolean;
  skillSourcesLoading: boolean;
  sourceSkillsLoading: boolean;
  sourceSkillPreviewLoading: boolean;
  skillsSaving: boolean;
  skillsDeleting: boolean;
  sourceSkillSearch: string;
  skillsError: string | null;
  skillsNotice: string | null;
  selectedSkillId: string | null;
  selectedSourceId: string | null;
  importingSourceSkillId: string | null;
  selectedSkill: SkillRecord | null;
  draft: SkillDraft;
  draftDirty: boolean;
  selectSkill: (skillId: string | null) => void;
  selectSource: (sourceId: string | null) => void;
  previewSourceSkill: (candidate: SkillSourceCandidate) => Promise<void>;
  selectSourcePreviewFile: (filePath: string | null) => void;
  updateDraftField: <K extends SkillDraftScalarKey>(key: K, value: SkillDraft[K]) => void;
  appendDraftFile: (kind: SkillFileKind) => void;
  updateDraftFile: (localId: string, patch: Partial<SkillFileDraft>) => void;
  removeDraftFile: (localId: string) => void;
  loadSkills: () => Promise<void>;
  loadSkillSources: () => Promise<string | null>;
  loadSourceSkills: (sourceId?: string | null, opts?: SourceSkillLoadOptions) => Promise<void>;
  refreshSkillSources: () => Promise<void>;
  startNewSkill: () => void;
  setSourceSkillSearch: (value: string) => void;
  importSourceSkill: (candidate: SkillSourceCandidate) => Promise<void>;
  saveDraft: () => Promise<void>;
  deleteSelectedSkill: () => Promise<void>;
  resetDraft: () => void;
  clearSkillsNotice: () => void;
  clearSkillsError: () => void;
};

export function useSkillLibrary(requestJson: RequestJsonFn): UseSkillLibraryResult {
  const [skills, setSkills] = React.useState<SkillRecord[]>([]);
  const [skillSources, setSkillSources] = React.useState<SkillSourceRecord[]>([]);
  const [sourceSkills, setSourceSkills] = React.useState<SkillSourceCandidate[]>([]);
  const [sourceSkillPreview, setSourceSkillPreview] = React.useState<SkillSourceCandidatePreview | null>(null);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [skillSourcesLoading, setSkillSourcesLoading] = React.useState(false);
  const [sourceSkillsLoading, setSourceSkillsLoading] = React.useState(false);
  const [sourceSkillPreviewLoading, setSourceSkillPreviewLoading] = React.useState(false);
  const [skillsSaving, setSkillsSaving] = React.useState(false);
  const [skillsDeleting, setSkillsDeleting] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const [skillsNotice, setSkillsNotice] = React.useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = React.useState<string | null>(null);
  const [selectedSourcePreviewPath, setSelectedSourcePreviewPath] = React.useState<string | null>(null);
  const [selectedSourcePreviewFilePath, setSelectedSourcePreviewFilePath] = React.useState<string | null>(null);
  const [sourceSkillSearch, setSourceSkillSearch] = React.useState('');
  const [importingSourceSkillId, setImportingSourceSkillId] = React.useState<string | null>(null);
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

  const filteredSourceSkills = React.useMemo(
    () => filterSkillSourceCandidates(sourceSkills, sourceSkillSearch),
    [sourceSkillSearch, sourceSkills],
  );

  const selectedSourcePreviewFile = React.useMemo(
    () =>
      sourceSkillPreview?.files.find((file) => file.path === selectedSourcePreviewFilePath) ??
      sourceSkillPreview?.files[0] ??
      null,
    [selectedSourcePreviewFilePath, sourceSkillPreview],
  );

  const selectedSkillIdRef = React.useRef<string | null>(selectedSkillId);
  React.useEffect(() => {
    selectedSkillIdRef.current = selectedSkillId;
  }, [selectedSkillId]);

  const selectedSourceIdRef = React.useRef<string | null>(selectedSourceId);
  React.useEffect(() => {
    selectedSourceIdRef.current = selectedSourceId;
  }, [selectedSourceId]);

  const sourceSkillsRequestIdRef = React.useRef(0);
  const sourcePreviewRequestIdRef = React.useRef(0);

  const clearSourcePreviewState = React.useCallback(() => {
    setSourceSkillPreviewLoading(false);
    setSourceSkillPreview(null);
    setSelectedSourcePreviewPath(null);
    setSelectedSourcePreviewFilePath(null);
  }, []);

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

  const loadSkillSources = React.useCallback(async () => {
    setSkillSourcesLoading(true);
    setSkillsError(null);
    try {
      const data = await requestJson<SkillSourceListResponse>('/api/skill-sources');
      const nextSources = [...(data.sources ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      const nextSelectedSourceId =
        selectedSourceIdRef.current && nextSources.some((source) => source.id === selectedSourceIdRef.current)
          ? selectedSourceIdRef.current
          : nextSources[0]?.id ?? null;
      setSkillSources(nextSources);
      setSelectedSourceId(nextSelectedSourceId);
      return nextSelectedSourceId;
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
      return null;
    } finally {
      setSkillSourcesLoading(false);
    }
  }, [requestJson]);

  const loadSourceSkills = React.useCallback(
    async (sourceIdInput?: string | null, opts?: SourceSkillLoadOptions) => {
      const sourceId = String(sourceIdInput ?? selectedSourceId ?? '').trim();
      sourceSkillsRequestIdRef.current += 1;
      const requestId = sourceSkillsRequestIdRef.current;
      sourcePreviewRequestIdRef.current += 1;
      if (!sourceId) {
        setSourceSkillsLoading(false);
        setSourceSkills([]);
        clearSourcePreviewState();
        return;
      }
      setSourceSkillsLoading(true);
      setSkillsError(null);
      clearSourcePreviewState();
      try {
        const qs = new URLSearchParams();
        if (opts?.refresh) qs.set('refresh', '1');
        const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
        const data = await requestJson<SkillSourceCandidatesResponse>(`/api/skill-sources/${encodeURIComponent(sourceId)}/skills${suffix}`);
        if (sourceSkillsRequestIdRef.current !== requestId) return;
        const nextSkills = [...(data.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        setSourceSkills(nextSkills);
      } catch (e: any) {
        if (sourceSkillsRequestIdRef.current !== requestId) return;
        setSkillsError(e?.message ?? String(e));
      } finally {
        if (sourceSkillsRequestIdRef.current !== requestId) return;
        setSourceSkillsLoading(false);
      }
    },
    [clearSourcePreviewState, requestJson, selectedSourceId],
  );

  const refreshSkillSources = React.useCallback(async () => {
    const sourceId = await loadSkillSources();
    if (!sourceId) return;
    await loadSourceSkills(sourceId, { refresh: true });
  }, [loadSkillSources, loadSourceSkills]);

  React.useEffect(() => {
    void loadSkillSources();
  }, [loadSkillSources]);

  React.useEffect(() => {
    if (!selectedSourceId) {
      setSourceSkills([]);
      clearSourcePreviewState();
      return;
    }
    void loadSourceSkills(selectedSourceId);
  }, [clearSourcePreviewState, loadSourceSkills, selectedSourceId]);

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

  const importSourceSkill = React.useCallback(
    async (candidate: SkillSourceCandidate) => {
      setImportingSourceSkillId(candidate.id);
      setSkillsError(null);
      setSkillsNotice(null);
      try {
        const data = await requestJson<SkillMutationResponse>(`/api/skill-sources/${encodeURIComponent(candidate.sourceId)}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: candidate.path }),
        });
        const saved = data.skill;
        setSkills((prev: SkillRecord[]) => replaceSkill(prev, saved));
        applySelectedSkill(saved);
        setSkillsNotice(`Imported ${saved.name}.`);
      } catch (e: any) {
        setSkillsError(e?.message ?? String(e));
      } finally {
        setImportingSourceSkillId(null);
      }
    },
    [applySelectedSkill, requestJson],
  );

  const previewSourceSkill = React.useCallback(
    async (candidate: SkillSourceCandidate) => {
      sourcePreviewRequestIdRef.current += 1;
      const requestId = sourcePreviewRequestIdRef.current;
      setSelectedSourcePreviewPath(candidate.path);
      setSourceSkillPreviewLoading(true);
      setSourceSkillPreview(null);
      setSelectedSourcePreviewFilePath(null);
      setSkillsError(null);
      try {
        const qs = new URLSearchParams({ path: candidate.path });
        const data = await requestJson<SkillSourcePreviewResponse>(
          `/api/skill-sources/${encodeURIComponent(candidate.sourceId)}/preview?${qs.toString()}`,
        );
        if (sourcePreviewRequestIdRef.current !== requestId) return;
        if (selectedSourceIdRef.current !== candidate.sourceId) return;
        setSourceSkillPreview(data.preview);
        setSelectedSourcePreviewFilePath(data.preview.files[0]?.path ?? null);
      } catch (e: any) {
        if (sourcePreviewRequestIdRef.current !== requestId) return;
        setSourceSkillPreview(null);
        setSelectedSourcePreviewFilePath(null);
        setSkillsError(e?.message ?? String(e));
      } finally {
        if (sourcePreviewRequestIdRef.current !== requestId) return;
        setSourceSkillPreviewLoading(false);
      }
    },
    [requestJson],
  );

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
  const selectSource = React.useCallback((sourceId: string | null) => {
    setSelectedSourceId(sourceId);
  }, []);
  const selectSourcePreviewFile = React.useCallback((filePath: string | null) => {
    setSelectedSourcePreviewFilePath(filePath);
  }, []);

  return {
    skills,
    skillSources,
    sourceSkills,
    filteredSourceSkills,
    sourceSkillPreview,
    selectedSourcePreviewPath,
    selectedSourcePreviewFilePath,
    selectedSourcePreviewFile,
    skillsLoading,
    skillSourcesLoading,
    sourceSkillsLoading,
    sourceSkillPreviewLoading,
    skillsSaving,
    skillsDeleting,
    sourceSkillSearch,
    skillsError,
    skillsNotice,
    selectedSkillId,
    selectedSourceId,
    importingSourceSkillId,
    selectedSkill,
    draft,
    draftDirty,
    selectSkill,
    selectSource,
    previewSourceSkill,
    selectSourcePreviewFile,
    updateDraftField,
    appendDraftFile,
    updateDraftFile,
    removeDraftFile,
    loadSkills,
    loadSkillSources,
    loadSourceSkills,
    refreshSkillSources,
    startNewSkill,
    setSourceSkillSearch,
    importSourceSkill,
    saveDraft,
    deleteSelectedSkill,
    resetDraft,
    clearSkillsNotice,
    clearSkillsError,
  };
}
