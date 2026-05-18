export function buildVoiceStreamProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
  opts: { port: number; groqApiKey?: string | null },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PORT: String(opts.port),
  };

  const groqApiKey = String(opts.groqApiKey ?? '').trim();
  if (groqApiKey) {
    env.GROQ_API_KEY = groqApiKey;
    if (!String(env.GROQ_TTS_API_KEY ?? '').trim()) {
      env.GROQ_TTS_API_KEY = groqApiKey;
    }
  }

  return env;
}
