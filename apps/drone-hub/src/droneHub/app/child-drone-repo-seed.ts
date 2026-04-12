import type { DroneSummary } from '../types';
import type { CreateRuntime } from './drone-create-runtime';

type ResolveRepoSeedFromParentDroneIdArgs = {
  drones: Array<Pick<DroneSummary, 'id' | 'repoAttached' | 'repoPath'>>;
  parentDroneId: string | null;
  repoPath: string;
  runtime: CreateRuntime;
};

export function resolveRepoSeedFromParentDroneId({
  drones,
  parentDroneId,
  repoPath,
  runtime,
}: ResolveRepoSeedFromParentDroneIdArgs): string | null {
  const normalizedParentDroneId = String(parentDroneId ?? '').trim();
  const normalizedRepoPath = String(repoPath ?? '').trim();
  if (!normalizedParentDroneId || !normalizedRepoPath || runtime !== 'container') return null;

  const parentDrone = drones.find((drone) => String(drone?.id ?? '').trim() === normalizedParentDroneId) ?? null;
  if (!parentDrone) return null;

  const parentRepoPath =
    parentDrone.repoAttached ?? Boolean(String(parentDrone.repoPath ?? '').trim())
      ? String(parentDrone.repoPath ?? '').trim()
      : '';
  return parentRepoPath === normalizedRepoPath ? normalizedParentDroneId : null;
}
