import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

const Type = {
  Object: (value: unknown) => value,
  String: (value?: unknown) => value,
  Optional: (value: unknown) => value,
  Number: (value?: unknown) => value,
  Boolean: (value?: unknown) => value,
  Array: (value: unknown) => value,
};

function seedDrones(): Promise<void> {
  const now = new Date().toISOString();
  return updateRegistry((reg: any) => {
    reg.drones = {
      'drone-a': {
        id: 'drone-a',
        name: 'Drone A',
        runtime: 'host',
        repoPath: '/tmp/drone-a',
        createdAt: now,
        chats: { default: { createdAt: now, turns: [] } },
      },
      'drone-b': {
        id: 'drone-b',
        name: 'Drone B',
        runtime: 'host',
        repoPath: '/tmp/drone-b',
        createdAt: now,
        chats: { default: { createdAt: now, turns: [] } },
      },
    };
  });
}

function makeFileService(files: Map<string, Map<string, string>>): HubAssistantService {
  const droneFiles = (droneId: string) => {
    const existing = files.get(droneId);
    if (existing) return existing;
    const next = new Map<string, string>();
    files.set(droneId, next);
    return next;
  };

  return new HubAssistantService({
    listDrones: async () => [
      { id: 'drone-a', name: 'Drone A', group: null, runtime: 'container', repoPath: '/tmp/drone-a', status: 'ready', chats: ['default'] },
      { id: 'drone-b', name: 'Drone B', group: null, runtime: 'host', repoPath: '/tmp/drone-b', status: 'ready', chats: ['default'] },
    ],
    createDrone: async () => {
      throw new Error('not implemented');
    },
    setDroneGroup: async () => {
      throw new Error('not implemented');
    },
    messageDrone: async () => {
      throw new Error('not implemented');
    },
    listDroneFiles: async ({ droneId, path }) => ({
      droneId,
      path: path || '.',
      entries: [...droneFiles(droneId).keys()].sort().map((filePath) => ({
        name: filePath.split('/').pop() || filePath,
        path: filePath,
        kind: 'file' as const,
      })),
    }),
    readDroneFile: async ({ droneId, path }) => {
      const content = droneFiles(droneId).get(path);
      if (content == null) throw new Error(`file not found: ${path}`);
      if (path.endsWith('.bin')) throw new Error(`file is not text: ${path}`);
      return { droneId, path, kind: 'text' as const, content, size: Buffer.byteLength(content, 'utf8') };
    },
    writeDroneFile: async ({ droneId, path, content }) => {
      droneFiles(droneId).set(path, content);
      return { droneId, path, size: Buffer.byteLength(content, 'utf8') };
    },
    deleteDroneFile: async ({ droneId, path }) => {
      if (!droneFiles(droneId).delete(path)) throw new Error(`file not found: ${path}`);
      return { droneId, path, deleted: true };
    },
    moveDroneFile: async ({ droneId, fromPath, toPath }) => {
      const perDrone = droneFiles(droneId);
      const content = perDrone.get(fromPath);
      if (content == null) throw new Error(`file not found: ${fromPath}`);
      perDrone.delete(fromPath);
      perDrone.set(toPath, content);
      return { droneId, path: fromPath, movedTo: toPath };
    },
    searchDroneFiles: async ({ droneId, query, limit = 20 }) => ({
      droneId,
      path: '.',
      query,
      limit,
      matches: [...droneFiles(droneId).entries()]
        .filter(([, content]) => content.includes(query))
        .slice(0, limit)
        .map(([path, content]) => ({ path, line: 1, text: content.split('\n')[0] ?? '' })),
    }),
    findDroneFiles: async ({ droneId, pattern = '*', limit = 100 }) => {
      const needle = pattern.replace(/\*/g, '');
      return {
        droneId,
        path: '.',
        pattern,
        limit,
        matches: [...droneFiles(droneId).keys()]
          .filter((filePath) => pattern === '*' || filePath.includes(needle))
          .slice(0, limit)
          .map((filePath) => ({ name: filePath.split('/').pop() || filePath, path: filePath, kind: 'file' as const })),
      };
    },
    statDronePath: async ({ droneId, path }) => {
      if (path === 'dir') return { droneId, path, exists: true, kind: 'directory' as const };
      const content = droneFiles(droneId).get(path);
      return content == null
        ? { droneId, path, exists: false }
        : { droneId, path, exists: true, kind: 'file' as const, size: Buffer.byteLength(content, 'utf8') };
    },
    runDroneBash: async ({ droneId, command, cwd, timeoutMs }) => ({
      ok: true as const,
      droneId,
      cwd: cwd || '.',
      command,
      code: command.includes('fail') ? 1 : 0,
      stdout: `ran: ${command}\n`,
      stderr: '',
      timeoutMs: timeoutMs ?? 30_000,
      timedOut: false,
    }),
  });
}

async function buildAssistantFileTools(service: HubAssistantService): Promise<{ threadId: string; tools: any[] }> {
  const snapshot = await service.createThread({ title: 'files', provider: 'openai', model: 'gpt-5.5' });
  return {
    threadId: snapshot.activeThreadId,
    tools: (service as any).buildTools({ Type }, snapshot.activeThreadId),
  };
}

describe('assistant drone file tools', () => {
  test('enforces read and write scope before touching drone files', async () => {
    await withTempDroneDataDir('assistant-drone-file-scope-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        ['drone-a', new Map([['README.md', 'allowed\n']])],
        ['drone-b', new Map([['README.md', 'blocked\n']])],
      ]);
      const service = makeFileService(files);
      const { threadId, tools } = await buildAssistantFileTools(service);
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const readFile = tools.find((tool) => tool.name === 'read_file');
      const findFiles = tools.find((tool) => tool.name === 'find_files');
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');
      const bash = tools.find((tool) => tool.name === 'bash');

      await expect(readFile.execute('read-b', { droneId: 'drone-b', path: 'README.md' })).rejects.toThrow(
        'assistant scope does not include drone',
      );
      await expect(findFiles.execute('find-b', { droneId: 'drone-b', pattern: '*.md' })).rejects.toThrow(
        'assistant scope does not include drone',
      );
      await expect(
        applyPatch.execute('patch-b', {
          droneId: 'drone-b',
          patch: ['*** Begin Patch', '*** Update File: README.md', '@@', '-blocked', '+changed', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('assistant scope does not include drone');
      await expect(bash.execute('bash-b', { droneId: 'drone-b', command: 'pwd' })).rejects.toThrow(
        'assistant scope does not include drone',
      );

      expect(files.get('drone-b')?.get('README.md')).toBe('blocked\n');
    });
  });

  test('runs bash through the drone bash callback with write scope', async () => {
    await withTempDroneDataDir('assistant-drone-bash-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const { threadId, tools } = await buildAssistantFileTools(service);
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const bash = tools.find((tool) => tool.name === 'bash');
      const result = await bash.execute('bash-a', {
        droneId: 'drone-a',
        command: 'bun test',
        cwd: 'apps/drone',
        timeoutMs: 999_999,
      });

      expect(result.details).toMatchObject({
        ok: true,
        droneId: 'drone-a',
        cwd: 'apps/drone',
        command: 'bun test',
        code: 0,
        stdout: 'ran: bun test\n',
        timeoutMs: 120_000,
        timedOut: false,
      });
    });
  });

  test('requests approval before running bash', async () => {
    await withTempDroneDataDir('assistant-drone-bash-approval-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const snapshot = await service.createThread({ title: 'bash approval', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      const approvals: any[] = [];

      const beforeToolCall = (service as any).beforeToolCall(
        threadId,
        {
          toolCall: { id: 'call-bash', name: 'bash' },
          args: { droneId: 'drone-a', command: 'bun test', cwd: 'apps/drone', timeoutMs: 999_999 },
        },
        async (event: any) => {
          if (event.type !== 'approval_pending') return;
          approvals.push(event.approval);
          await service.approve(event.approval.id, true);
        },
      );

      await expect(beforeToolCall).resolves.toBeUndefined();
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({
        threadId,
        toolCallId: 'call-bash',
        toolName: 'bash',
        label: 'Run bash in drone',
        args: {
          resolved: {
            droneId: 'drone-a',
            droneName: 'Drone A',
            command: 'bun test',
            cwd: 'apps/drone',
            timeoutMs: 120_000,
          },
        },
      });
    });
  });

  test('blocks host-runtime bash before requesting approval', async () => {
    await withTempDroneDataDir('assistant-drone-bash-host-block-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const snapshot = await service.createThread({ title: 'bash host block', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-b'],
      });
      const approvals: any[] = [];

      const result = await (service as any).beforeToolCall(
        threadId,
        {
          toolCall: { id: 'call-bash-host', name: 'bash' },
          args: { droneId: 'drone-b', command: 'pwd' },
        },
        async (event: any) => {
          if (event.type === 'approval_pending') approvals.push(event.approval);
        },
      );

      expect(result).toEqual({ block: true, reason: 'bash is only supported for container drones: Drone B' });
      expect(approvals).toHaveLength(0);
    });
  });

  test('applies add update delete and move patch operations in one call', async () => {
    await withTempDroneDataDir('assistant-drone-file-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['src/a.ts', 'export const value = 1;\n'],
            ['src/old.ts', 'remove me\n'],
            ['src/move.ts', 'old\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      const result = await applyPatch.execute('patch-a', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Update File: src/a.ts',
          '@@',
          '-export const value = 1;',
          '+export const value = 2;',
          '*** Add File: src/b.ts',
          '+hello',
          '*** Delete File: src/old.ts',
          '*** Update File: src/move.ts',
          '*** Move to: src/moved.ts',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      });

      const droneAFiles = files.get('drone-a');
      expect(result.details.operations.map((operation: any) => operation.kind)).toEqual(['update', 'add', 'delete', 'update']);
      expect(droneAFiles?.get('src/a.ts')).toBe('export const value = 2;\n');
      expect(droneAFiles?.get('src/b.ts')).toBe('hello\n');
      expect(droneAFiles?.has('src/old.ts')).toBe(false);
      expect(droneAFiles?.has('src/move.ts')).toBe(false);
      expect(droneAFiles?.get('src/moved.ts')).toBe('new\n');
    });
  });

  test('rejects ambiguous patch context', async () => {
    await withTempDroneDataDir('assistant-drone-file-ambiguous-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['dupe.txt', 'x\nx\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-dupe', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Update File: dupe.txt', '@@', '-x', '+y', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('ambiguous');

      expect(files.get('drone-a')?.get('dupe.txt')).toBe('x\nx\n');
    });
  });

  test('does not partially apply a patch when a later operation fails', async () => {
    await withTempDroneDataDir('assistant-drone-file-atomic-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['ok.txt', 'one\n'],
            ['dupe.txt', 'x\nx\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-partial', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: ok.txt',
            '@@',
            '-one',
            '+two',
            '*** Update File: dupe.txt',
            '@@',
            '-x',
            '+y',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('ambiguous');

      expect(files.get('drone-a')?.get('ok.txt')).toBe('one\n');
      expect(files.get('drone-a')?.get('dupe.txt')).toBe('x\nx\n');
    });
  });

  test('rejects add and move targets that already exist', async () => {
    await withTempDroneDataDir('assistant-drone-file-collision-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['existing.txt', 'keep\n'],
            ['source.txt', 'source\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-add-existing', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Add File: existing.txt', '+replace', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('already exists');
      await expect(
        applyPatch.execute('patch-move-existing', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: source.txt',
            '*** Move to: existing.txt',
            '@@',
            '-source',
            '+moved',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('already exists');

      expect(files.get('drone-a')?.get('existing.txt')).toBe('keep\n');
      expect(files.get('drone-a')?.get('source.txt')).toBe('source\n');
    });
  });

  test('deletes and move-only patches do not require reading file text', async () => {
    await withTempDroneDataDir('assistant-drone-file-binary-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['delete.bin', '\0delete'],
            ['move.bin', '\0move'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await applyPatch.execute('patch-binary-delete-move', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Delete File: delete.bin',
          '*** Update File: move.bin',
          '*** Move to: moved.bin',
          '*** End Patch',
        ].join('\n'),
      });

      expect(files.get('drone-a')?.has('delete.bin')).toBe(false);
      expect(files.get('drone-a')?.has('move.bin')).toBe(false);
      expect(files.get('drone-a')?.get('moved.bin')).toBe('\0move');
    });
  });

  test('moves original file before writing a replacement at the source path', async () => {
    await withTempDroneDataDir('assistant-drone-file-move-readd-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['source.bin', '\0original']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await applyPatch.execute('patch-move-readd', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Update File: source.bin',
          '*** Move to: moved.bin',
          '*** Add File: source.bin',
          '+replacement',
          '*** End Patch',
        ].join('\n'),
      });

      expect(files.get('drone-a')?.get('moved.bin')).toBe('\0original');
      expect(files.get('drone-a')?.get('source.bin')).toBe('replacement\n');
    });
  });

  test('rejects directory delete or move during preflight without partial writes', async () => {
    await withTempDroneDataDir('assistant-drone-file-directory-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['ok.txt', 'one\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-delete-dir', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: ok.txt',
            '@@',
            '-one',
            '+two',
            '*** Delete File: dir',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('directory');
      await expect(
        applyPatch.execute('patch-move-dir', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Update File: dir', '*** Move to: moved-dir', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('directory');

      expect(files.get('drone-a')?.get('ok.txt')).toBe('one\n');
    });
  });
});
