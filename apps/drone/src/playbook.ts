#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import { playbookFindings, type DroneClient } from './host/api';

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
  if (!token) throw new Error(`missing playbook token at ${tokenPath}`);
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
  .name('playbook')
  .description('Local playbook CLI for the drone daemon')
  .showHelpAfterError();

program
  .command('list')
  .description('List findings visible to this playbook-created drone')
  .action(async () => {
    const client = await createClient();
    printJson(await playbookFindings(client));
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
