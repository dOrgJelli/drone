import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  collectProviderApiKeyDiagnostics,
  describeSecretValue,
  upsertStoredProviderApiKey,
} from '../src/hub/hub-settings';

async function withTempDroneDataDirAndEnv<T>(
  env: Partial<Record<'OPENAI_API_KEY' | 'GEMINI_API_KEY', string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-llm-settings-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  fs.mkdirSync(droneDataDir, { recursive: true });

  const previousDataDir = process.env.DRONE_DATA_DIR;
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;

  process.env.DRONE_DATA_DIR = droneDataDir;
  if (env.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  resetDroneRootDirForTests();

  try {
    return await fn();
  } finally {
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    if (previousOpenAi == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
    if (previousGemini == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('LLM settings diagnostics', () => {
  test('describes missing and blank secrets without exposing the raw value', () => {
    expect(describeSecretValue(undefined)).toEqual({
      present: false,
      hasValue: false,
      rawLength: null,
      trimmedLength: null,
      fingerprint: null,
    });

    expect(describeSecretValue('   ')).toEqual({
      present: true,
      hasValue: false,
      rawLength: 3,
      trimmedLength: 0,
      fingerprint: null,
    });
  });

  test('reports environment-backed provider keys', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: '  env-openai-key  ' }, async () => {
      const diagnostics = await collectProviderApiKeyDiagnostics('openai');
      expect(diagnostics.envVar).toBe('OPENAI_API_KEY');
      expect(diagnostics.env.present).toBe(true);
      expect(diagnostics.env.hasValue).toBe(true);
      expect(diagnostics.env.trimmedLength).toBe('env-openai-key'.length);
      expect(diagnostics.env.fingerprint).not.toBeNull();
      expect(diagnostics.stored.hasValue).toBe(false);
      expect(diagnostics.effective.source).toBe('environment');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).toBe(diagnostics.env.fingerprint);
    });
  });

  test('reports when a stored key overrides the environment', async () => {
    await withTempDroneDataDirAndEnv({ OPENAI_API_KEY: 'env-openai-key' }, async () => {
      await upsertStoredProviderApiKey('openai', 'stored-openai-key');
      const diagnostics = await collectProviderApiKeyDiagnostics('openai');
      expect(diagnostics.stored.hasValue).toBe(true);
      expect(diagnostics.stored.updatedAt).not.toBeNull();
      expect(diagnostics.stored.fingerprint).not.toBeNull();
      expect(diagnostics.env.fingerprint).not.toBeNull();
      expect(diagnostics.env.fingerprint).not.toBe(diagnostics.stored.fingerprint);
      expect(diagnostics.effective.source).toBe('settings');
      expect(diagnostics.effective.hasValue).toBe(true);
      expect(diagnostics.effective.fingerprint).toBe(diagnostics.stored.fingerprint);
    });
  });
});
