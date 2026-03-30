import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';

type NewDroneContextOptions = {
  repoPath?: string | null;
  group?: string | null;
};

export function shouldInheritNewDroneContextFromCurrentSelection(opts?: NewDroneContextOptions): boolean {
  return !opts || (!Object.prototype.hasOwnProperty.call(opts, 'repoPath') && !Object.prototype.hasOwnProperty.call(opts, 'group'));
}

export function resolveNewDroneContextFromCurrentSelection(
  currentDrone: Pick<DroneSummary, 'group' | 'repoAttached' | 'repoPath'> | null | undefined,
): { repoPath: string; group: string } {
  const repoPath =
    currentDrone && (currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim()))
      ? String(currentDrone.repoPath ?? '').trim()
      : '';
  const rawGroup = String(currentDrone?.group ?? '').trim();
  return {
    repoPath,
    group: !rawGroup || isUngroupedGroupName(rawGroup) ? '' : rawGroup,
  };
}
