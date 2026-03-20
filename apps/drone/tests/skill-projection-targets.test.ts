import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { buildContainerSkillProjectionTargets, buildHostSkillProjectionTargets } from '../src/hub/server';

describe('skill projection targets', () => {
  test('uses home-level targets for repo-backed host drones and cleans up old repo-level projections', () => {
    const repoRoot = path.join(os.tmpdir(), 'repo-root');
    const targets = buildHostSkillProjectionTargets({
      repoAttached: true,
      repoPath: repoRoot,
    });

    expect(targets.filter((target) => !target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: path.join(os.homedir(), '.agents', 'skills') },
      { agent: 'claude', rootPath: path.join(os.homedir(), '.claude', 'skills') },
      { agent: 'cursor', rootPath: path.join(os.homedir(), '.cursor', 'skills') },
      { agent: 'opencode', rootPath: path.join(os.homedir(), '.config', 'opencode', 'skills') },
    ]);
    expect(targets.filter((target) => target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: path.join(repoRoot, '.agents', 'skills'), cleanupOnly: true },
      { agent: 'claude', rootPath: path.join(repoRoot, '.claude', 'skills'), cleanupOnly: true },
      { agent: 'cursor', rootPath: path.join(repoRoot, '.cursor', 'skills'), cleanupOnly: true },
      { agent: 'opencode', rootPath: path.join(repoRoot, '.opencode', 'skills'), cleanupOnly: true },
    ]);
  });

  test('uses home-level targets for repo-backed container drones and cleans up old repo-level projections', () => {
    const targets = buildContainerSkillProjectionTargets({
      repoAttached: true,
      repo: { dest: '/work/repo' },
    });

    expect(targets.filter((target) => !target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: '/dvm-data/home/.agents/skills' },
      { agent: 'claude', rootPath: '/dvm-data/home/.claude/skills' },
      { agent: 'cursor', rootPath: '/dvm-data/home/.cursor/skills' },
      { agent: 'opencode', rootPath: '/dvm-data/home/.config/opencode/skills' },
    ]);
    expect(targets.filter((target) => target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: '/work/repo/.agents/skills', cleanupOnly: true },
      { agent: 'claude', rootPath: '/work/repo/.claude/skills', cleanupOnly: true },
      { agent: 'cursor', rootPath: '/work/repo/.cursor/skills', cleanupOnly: true },
      { agent: 'opencode', rootPath: '/work/repo/.opencode/skills', cleanupOnly: true },
    ]);
  });
});
