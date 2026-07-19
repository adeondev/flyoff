import { isProjectIdentifier } from './projects';

export const PROJECT_NOTE_ACTIVITY_FORMAT =
  'flyoff-project-note-activity' as const;
export const PROJECT_NOTE_ACTIVITY_VERSION = 1 as const;
export const PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT = 500;

export const PROJECT_NOTE_ACTIVITY_IPC_CHANNELS = {
  get: 'flyoff:projects:note-activity:get',
  record: 'flyoff:projects:note-activity:record',
} as const;

export interface ProjectNoteActivityEntry {
  projectId: string;
  nodeId: string;
  activationCount: number;
  lastActivatedAt: string | null;
  lastClosedAt: string | null;
}

export type ProjectNoteActivityEvent = {
  type: 'activated' | 'closed';
  nodeId: string;
};

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

function isIsoTimestampOrNull(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isProjectNoteActivityEntry(
  value: unknown,
): value is ProjectNoteActivityEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(value, [
      'projectId',
      'nodeId',
      'activationCount',
      'lastActivatedAt',
      'lastClosedAt',
    ]) &&
    isProjectIdentifier(value.projectId) &&
    isProjectIdentifier(value.nodeId) &&
    Number.isSafeInteger(value.activationCount) &&
    Number(value.activationCount) >= 0 &&
    isIsoTimestampOrNull(value.lastActivatedAt) &&
    isIsoTimestampOrNull(value.lastClosedAt) &&
    (Number(value.activationCount) === 0
      ? value.lastActivatedAt === null
      : value.lastActivatedAt !== null)
  );
}

export function isProjectNoteActivityEntryList(
  value: unknown,
): value is readonly ProjectNoteActivityEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT
  ) {
    return false;
  }
  const identities = new Set<string>();
  return value.every((entry) => {
    if (!isProjectNoteActivityEntry(entry)) {
      return false;
    }
    const identity = `${entry.projectId}:${entry.nodeId}`;
    if (identities.has(identity)) {
      return false;
    }
    identities.add(identity);
    return true;
  });
}

export function isProjectNoteActivityEvent(
  value: unknown,
): value is ProjectNoteActivityEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'nodeId']) &&
    (value.type === 'activated' || value.type === 'closed') &&
    isProjectIdentifier(value.nodeId)
  );
}
