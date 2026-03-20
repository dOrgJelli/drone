import { describe, expect, test } from 'bun:test';

import { filterSkillSourceCandidates } from '../src/droneHub/app/skill-library-model';

describe('skill source candidate filtering', () => {
  test('matches query text against name, plugin, path, and reason', () => {
    const candidates = [
      {
        id: 'a',
        sourceId: 'anthropic-skills',
        path: 'skills/frontend-design',
        slug: 'frontend-design',
        name: 'Frontend Design',
        description: 'Build polished frontend interfaces.',
        importStatus: 'importable' as const,
        pluginName: 'example-skills',
      },
      {
        id: 'b',
        sourceId: 'microsoft-skills',
        path: '.github/plugins/azure-sdk-typescript/skills/azure-storage-blob-ts',
        slug: 'azure-storage-blob-ts',
        name: 'Azure Storage Blob TS',
        description: 'Azure SDK helpers.',
        importStatus: 'not_importable' as const,
        importReason: 'unsupported agent-specific package file',
      },
    ];

    expect(filterSkillSourceCandidates(candidates, 'frontend')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'example-skills')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'unsupported agent')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'azure-storage-blob-ts')).toHaveLength(1);
  });
});
