import { isProjectIdentifier } from './projects';

export const PROJECT_APPEARANCE_FORMAT = 'flyoff-appearance' as const;
export const PROJECT_APPEARANCE_VERSION = 1 as const;
export const PROJECT_APPEARANCE_MAX_BYTES = 4 * 1024 * 1024;
export const PROJECT_APPEARANCE_MAX_ENTRIES = 100_000;

export const PROJECT_APPEARANCE_IPC_CHANNELS = {
  get: 'flyoff:projects:appearance:get',
  setNote: 'flyoff:projects:appearance:note:set',
  setProject: 'flyoff:projects:appearance:project:set',
} as const;

const SEED_PATTERN = /^#[0-9a-f]{6}$/i;

export interface ProjectAppearanceSnapshot {
  projectSeed: string | null;
  noteSeeds: Readonly<Record<string, string>>;
}

export interface SetProjectNoteAppearanceRequest {
  nodeId: string;
  seed: string | null;
}

export interface SetProjectAppearanceRequest {
  seed: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function isAppearanceSeed(value: unknown): value is string {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

/** Returns the canonical uppercase form, or null when the value is unusable. */
export function normalizeAppearanceSeed(value: unknown): string | null {
  return isAppearanceSeed(value) ? value.toUpperCase() : null;
}

function isSeedMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length <= PROJECT_APPEARANCE_MAX_ENTRIES &&
    keys.every(
      (key) => isProjectIdentifier(key) && isAppearanceSeed(value[key]),
    )
  );
}

export function isProjectAppearanceSnapshot(
  value: unknown,
): value is ProjectAppearanceSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['projectSeed', 'noteSeeds']) &&
    (value.projectSeed === null || isAppearanceSeed(value.projectSeed)) &&
    isSeedMap(value.noteSeeds)
  );
}

export function isSetProjectNoteAppearanceRequest(
  value: unknown,
): value is SetProjectNoteAppearanceRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'seed']) &&
    isProjectIdentifier(value.nodeId) &&
    (value.seed === null || isAppearanceSeed(value.seed))
  );
}

export function isSetProjectAppearanceRequest(
  value: unknown,
): value is SetProjectAppearanceRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['seed']) &&
    (value.seed === null || isAppearanceSeed(value.seed))
  );
}

export function emptyProjectAppearanceSnapshot(): ProjectAppearanceSnapshot {
  return { projectSeed: null, noteSeeds: {} };
}
