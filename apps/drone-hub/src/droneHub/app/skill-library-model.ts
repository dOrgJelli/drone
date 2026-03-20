export type SkillFileKind = 'script' | 'reference' | 'asset' | 'extra';

export type SkillFileDraft = {
  localId: string;
  path: string;
  kind: SkillFileKind;
  content: string;
};

export type SkillDraft = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  license: string;
  compatibility: string;
  metadataJson: string;
  markdownBody: string;
  files: SkillFileDraft[];
  codexOpenaiYaml: string;
  claudeArgumentHint: string;
  claudeAllowedTools: string;
  claudeUserInvocable: boolean;
  claudeDisableModelInvocation: boolean;
  claudeModel: string;
  claudeContext: string;
  claudeAgent: string;
  claudeHooksJson: string;
  cursorDisableModelInvocation: boolean;
};

export type SkillDraftScalarKey = Exclude<keyof SkillDraft, 'id' | 'files'>;

export type SkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  markdownBody: string;
  files: Array<{
    path: string;
    content: string;
    kind: SkillFileKind;
  }>;
  overlays?: {
    codex?: {
      openaiYaml?: string;
    };
    claude?: {
      argumentHint?: string;
      disableModelInvocation?: boolean;
      userInvocable?: boolean;
      allowedTools?: string[];
      model?: string;
      context?: string;
      agent?: string;
      hooks?: Record<string, unknown>;
    };
    cursor?: {
      disableModelInvocation?: boolean;
    };
  };
  createdAt: string;
  updatedAt: string;
};

export type SkillImportStatus = 'importable' | 'importable_with_loss' | 'not_importable';

export type SkillSourceRecord = {
  id: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  branch: string;
  repoUrl: string;
};

export type SkillSourceCandidate = {
  id: string;
  sourceId: string;
  path: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  importStatus: SkillImportStatus;
  importReason?: string;
  pluginName?: string;
};

export type SkillSourcePreviewFile = {
  path: string;
  content: string;
  kind: SkillFileKind | 'managed';
};

export type SkillSourceCandidatePreview = {
  candidate: SkillSourceCandidate;
  sourceId: string;
  sourceCommit: string;
  skillMarkdown: string;
  files: SkillSourcePreviewFile[];
  normalized: {
    name: string;
    slug: string;
    description: string;
    license?: string;
    compatibility: string;
    metadata?: Record<string, string>;
    markdownBody: string;
    files: Array<{
      path: string;
      content: string;
      kind: SkillFileKind;
    }>;
    overlays?: SkillRecord['overlays'];
  };
};

export const SKILL_FILE_KIND_OPTIONS: Array<{ value: SkillFileKind; label: string; pathHint: string }> = [
  { value: 'script', label: 'Script', pathHint: 'scripts/run.sh' },
  { value: 'reference', label: 'Reference', pathHint: 'references/guide.md' },
  { value: 'asset', label: 'Asset', pathHint: 'assets/example.txt' },
  { value: 'extra', label: 'Extra', pathHint: 'notes.txt' },
];

function makeLocalId(): string {
  return `skill-file-${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyJson(value: unknown): string {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return '';
  return JSON.stringify(value, null, 2);
}

function safeJsonParse(value: string, label: string): Record<string, unknown> | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function draftFromSkill(skill: SkillRecord): SkillDraft {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    license: skill.license ?? '',
    compatibility: skill.compatibility ?? '',
    metadataJson: stringifyJson(skill.metadata),
    markdownBody: skill.markdownBody ?? '',
    files: Array.isArray(skill.files)
      ? skill.files.map((file) => ({
          localId: makeLocalId(),
          path: file.path,
          kind: file.kind,
          content: file.content ?? '',
        }))
      : [],
    codexOpenaiYaml: skill.overlays?.codex?.openaiYaml ?? '',
    claudeArgumentHint: skill.overlays?.claude?.argumentHint ?? '',
    claudeAllowedTools: Array.isArray(skill.overlays?.claude?.allowedTools) ? skill.overlays.claude.allowedTools.join(', ') : '',
    claudeUserInvocable: skill.overlays?.claude?.userInvocable === true,
    claudeDisableModelInvocation: skill.overlays?.claude?.disableModelInvocation === true,
    claudeModel: skill.overlays?.claude?.model ?? '',
    claudeContext: skill.overlays?.claude?.context ?? '',
    claudeAgent: skill.overlays?.claude?.agent ?? '',
    claudeHooksJson: stringifyJson(skill.overlays?.claude?.hooks),
    cursorDisableModelInvocation: skill.overlays?.cursor?.disableModelInvocation === true,
  };
}

export function createEmptyDraft(): SkillDraft {
  return {
    id: null,
    name: '',
    slug: '',
    description: '',
    license: '',
    compatibility: '',
    metadataJson: '',
    markdownBody: '',
    files: [],
    codexOpenaiYaml: '',
    claudeArgumentHint: '',
    claudeAllowedTools: '',
    claudeUserInvocable: false,
    claudeDisableModelInvocation: false,
    claudeModel: '',
    claudeContext: '',
    claudeAgent: '',
    claudeHooksJson: '',
    cursorDisableModelInvocation: false,
  };
}

export function sortSkills(skills: SkillRecord[]): SkillRecord[] {
  return [...skills].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function filterSkillSourceCandidates(candidates: SkillSourceCandidate[], query: string): SkillSourceCandidate[] {
  const trimmed = String(query ?? '').trim().toLowerCase();
  if (!trimmed) return [...candidates];
  return candidates.filter((candidate) => {
    const haystack = [
      candidate.name,
      candidate.slug,
      candidate.description,
      candidate.path,
      candidate.pluginName ?? '',
      candidate.importReason ?? '',
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function sanitizeDraftForComparison(draft: SkillDraft): string {
  return JSON.stringify({
    ...draft,
    files: draft.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
    })),
  });
}

export function payloadFromDraft(draft: SkillDraft): Record<string, unknown> {
  const metadata = safeJsonParse(draft.metadataJson, 'Metadata');
  const claudeHooks = safeJsonParse(draft.claudeHooksJson, 'Claude hooks');
  const allowedTools = draft.claudeAllowedTools
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const overlays: Record<string, unknown> = {};
  if (draft.codexOpenaiYaml.trim()) {
    overlays.codex = { openaiYaml: draft.codexOpenaiYaml };
  }
  const claudeOverlay: Record<string, unknown> = {};
  if (draft.claudeArgumentHint.trim()) claudeOverlay.argumentHint = draft.claudeArgumentHint.trim();
  if (allowedTools.length > 0) claudeOverlay.allowedTools = allowedTools;
  if (draft.claudeUserInvocable) claudeOverlay.userInvocable = true;
  if (draft.claudeDisableModelInvocation) claudeOverlay.disableModelInvocation = true;
  if (draft.claudeModel.trim()) claudeOverlay.model = draft.claudeModel.trim();
  if (draft.claudeContext.trim()) claudeOverlay.context = draft.claudeContext.trim();
  if (draft.claudeAgent.trim()) claudeOverlay.agent = draft.claudeAgent.trim();
  if (claudeHooks && Object.keys(claudeHooks).length > 0) claudeOverlay.hooks = claudeHooks;
  if (Object.keys(claudeOverlay).length > 0) overlays.claude = claudeOverlay;
  if (draft.cursorDisableModelInvocation) {
    overlays.cursor = { disableModelInvocation: true };
  }

  return {
    name: draft.name,
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    description: draft.description,
    ...(draft.license.trim() ? { license: draft.license.trim() } : {}),
    ...(draft.compatibility.trim() ? { compatibility: draft.compatibility.trim() } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    markdownBody: draft.markdownBody,
    files: draft.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
    })),
    ...(Object.keys(overlays).length > 0 ? { overlays } : {}),
  };
}

export function createDraftFileTemplate(kind: SkillFileKind, index: number): SkillFileDraft {
  const suffix = String(index + 1);
  if (kind === 'script') {
    return {
      localId: makeLocalId(),
      kind,
      path: `scripts/task-${suffix}.sh`,
      content: '#!/usr/bin/env bash\nset -euo pipefail\n',
    };
  }
  if (kind === 'reference') {
    return {
      localId: makeLocalId(),
      kind,
      path: `references/context-${suffix}.md`,
      content: '# Context\n',
    };
  }
  if (kind === 'asset') {
    return {
      localId: makeLocalId(),
      kind,
      path: `assets/example-${suffix}.txt`,
      content: '',
    };
  }
  return {
    localId: makeLocalId(),
    kind,
    path: `extra-${suffix}.txt`,
    content: '',
  };
}
