import { createDroneSDK } from './packages/drone-sdk/src/index.ts';

async function main(): Promise<void> {
  const sdk = createDroneSDK();
  const codexConfig = {
    agent: 'codex' as const,
    model: 'gpt-5.4-mini',
  };

  const suffix = Date.now().toString(36);
  const group = sdk.groups.create('experiment');
  const [firstDrone, secondDrone] = await group.createManyDrones([
    { name: `test-drone-a-${suffix}`, ...codexConfig },
    { name: `test-drone-b-${suffix}`, ...codexConfig },
  ]);

  console.log('Created drones:');
  console.log(`- ${firstDrone.name} (${firstDrone.id})`);
  console.log(`- ${secondDrone.name} (${secondDrone.id})`);

  const responses = await sdk.broadcast
    .drones([firstDrone, secondDrone])
    .chat('default')
    .sendAndWait('hello world', { timeoutMs: 120_000, pollIntervalMs: 500 });

  console.log('\nResponses:');
  for (const response of responses) {
    console.log(`- ${response.droneName}: [${response.status}] ${response.text ?? '(no response text)'}`);
  }

  const transcriptSummaryInput = responses
    .map((response, index) => {
      const text = response.text ?? '(no response text)';
      return `Chat ${index + 1} (${response.droneName}, ${response.chatName}): ${text}`;
    })
    .join('\n');
  if (!sdk.ai) throw new Error('SDK AI client is unavailable.');
  const summary = await sdk.ai.ask(
    `Summarize these two drone chat outputs in 2-3 concise bullet points:\n\n${transcriptSummaryInput}`,
    { timeoutMs: 120_000 },
  );
  console.log('\nLLM summary:');
  console.log(summary || '(no summary)');
}

void main().catch((error: unknown) => {
  console.error('Failed to run drone test:', error);
  process.exitCode = 1;
});
