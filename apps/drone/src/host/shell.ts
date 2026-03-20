export function resolveContainerTerminalShellCommand(env?: NodeJS.ProcessEnv): string {
  const sharedOverride = String(env?.DRONE_HUB_SHELL_CMD ?? '').trim();
  if (sharedOverride) return sharedOverride;
  return 'if command -v bash >/dev/null 2>&1; then exec bash -i; fi; exec sh -i';
}

export function resolveHostTerminalShellCommand(env?: NodeJS.ProcessEnv): string {
  const hostOverride = String(env?.DRONE_HUB_HOST_SHELL_CMD ?? '').trim();
  if (hostOverride) return hostOverride;
  const sharedOverride = String(env?.DRONE_HUB_SHELL_CMD ?? '').trim();
  if (sharedOverride) return sharedOverride;
  return 'bash -i';
}
