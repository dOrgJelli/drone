import { describe, expect, test } from 'bun:test';

import { resolveContainerManagedEnvVars } from '../src/hub/server';

describe('resolveContainerManagedEnvVars', () => {
  test('pins container agent home to the managed dvm home', () => {
    expect(
      resolveContainerManagedEnvVars(
        {
          runtime: 'container',
          cwd: '/work/repo',
        },
        { OPENAI_API_KEY: 'test' },
      ),
    ).toEqual({
      OPENAI_API_KEY: 'test',
      HOME: '/root',
      XDG_CONFIG_HOME: '/root/.config',
    });
  });

  test('leaves host env untouched', () => {
    expect(resolveContainerManagedEnvVars({ runtime: 'host' }, { OPENAI_API_KEY: 'test' })).toEqual({
      OPENAI_API_KEY: 'test',
    });
  });
});
