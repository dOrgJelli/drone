#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import { tasksCreate, tasksList, tasksSearch, type DroneClient } from './host/api';

function resolveBaseUrl(): string {
  const explicit =
    process.env.FLEET_DAEMON_BASE_URL?.trim() ||
    process.env.DRONE_DAEMON_BASE_URL?.trim() ||
    process.env.DRONE_BASE_URL?.trim();
  if (explicit) return explicit;
  const portRaw = process.env.FLEET_DAEMON_PORT?.trim() || process.env.DRONE_DAEMON_PORT?.trim() || process.env.DRONE_PORT?.trim() || '7777';
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid daemon port: ${portRaw}`);
  return `http://127.0.0.1:${Math.floor(port)}`;
}

async function resolveToken(): Promise<string> {
  const explicit = process.env.FLEET_TOKEN?.trim() || process.env.DRONE_TOKEN?.trim();
  if (explicit) return explicit;
  const tokenPath = process.env.FLEET_TOKEN_FILE?.trim() || '/dvm-data/drone/token';
  const raw = await fs.readFile(tokenPath, 'utf8');
  const token = raw.trim();
  if (!token) throw new Error(`missing tasks token at ${tokenPath}`);
  return token;
}

async function createClient(): Promise<DroneClient> {
  return {
    baseUrl: resolveBaseUrl(),
    token: await resolveToken(),
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const program = new Command()
  .name('tasks')
  .description('Local task CLI for the drone daemon')
  .showHelpAfterError();

program
  .command('list')
  .description('List tasks visible to this drone')
  .option('-t, --type <typeId>', 'Filter by task type', (value, previous: string[]) => [...previous, value], [])
  .action(async (options: { type: string[] }) => {
    const client = await createClient();
    printJson(await tasksList(client, { typeIds: options.type }));
  });

program
  .command('search')
  .description('Fuzzy-search tasks visible to this drone')
  .option('-t, --type <typeId>', 'Filter by task type', (value, previous: string[]) => [...previous, value], [])
  .argument('<query>', 'Search text')
  .action(async (query: string, options: { type: string[] }) => {
    const client = await createClient();
    printJson(await tasksSearch(client, { query, typeIds: options.type }));
  });

program
  .command('create')
  .description('Create a task visible to this drone scope')
  .requiredOption('-t, --type <typeId>', 'Task type id')
  .option('-d, --description <text>', 'Task description')
  .argument('<title>', 'Task title')
  .action(async (title: string, options: { type: string; description?: string }) => {
    const client = await createClient();
    printJson(
      await tasksCreate(client, {
        title,
        typeId: options.type,
        ...(typeof options.description === 'string' ? { description: options.description } : {}),
      }),
    );
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
