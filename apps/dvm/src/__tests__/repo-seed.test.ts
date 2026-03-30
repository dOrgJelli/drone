import { DvmApi } from '../api';

describe('repoSeed checkout target', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates the work branch from the resolved base SHA instead of the short branch name', async () => {
    const execCommand = jest.fn(async () => '');
    const copyToContainer = jest.fn(async () => {});
    const startContainer = jest.fn(async () => {});
    const ensureGit = jest.fn(async () => {});
    const containerExists = jest.fn(async () => true);
    const api = new DvmApi({
      manager: {
        docker: {
          containerExists,
          execCommand,
          copyToContainer,
        },
        startContainer,
        ensureGit,
      } as any,
      baseConfig: {} as any,
    });

    const baseSha = 'c6df507a1f66b3f579507bc5868aff1c32909d3b';
    jest.spyOn(api as any, 'runLocal').mockImplementation(async (...rawArgs: unknown[]) => {
      const [_cmd, args] = rawArgs as [string, string[]];
      if (args.includes('--is-inside-work-tree')) return 'true\n';
      if (args.includes('remote') && args.includes('get-url')) return 'git@github.com:Planet-Mojo/StorySpark.git\n';
      if (args[args.length - 2] === 'rev-parse' && args[args.length - 1] === 'dev') return `${baseSha}\n`;
      if (args.includes('bundle') && args.includes('create')) return '';
      if (args[args.length - 1] === 'remote') return 'origin\n';
      throw new Error(`Unexpected runLocal call: ${args.join(' ')}`);
    });

    await api.repoSeed({
      containerName: 'demo',
      hostRepoPath: '/repo',
      destinationPath: '/work/repo',
      baseRef: 'dev',
      branch: 'dvm/work',
      clean: true,
    });

    expect(execCommand).toHaveBeenLastCalledWith('demo', [
      'bash',
      '-lc',
      expect.stringContaining(`git checkout -b "dvm/work" "${baseSha}"`),
    ]);
    expect(execCommand).toHaveBeenLastCalledWith(
      'demo',
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.not.stringContaining('git checkout -b "dvm/work" "dev"'),
      ]),
    );
  });
});
