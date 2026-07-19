import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  PROJECT_NOTE_ACTIVITY_FORMAT,
  PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT,
  PROJECT_NOTE_ACTIVITY_VERSION,
  isProjectNoteActivityEntryList,
  type ProjectNoteActivityEntry,
  type ProjectNoteActivityEvent,
} from '../../shared/contracts';

const PROJECT_NOTE_ACTIVITY_FILENAME = 'project-note-activity.json';
const PROJECT_NOTE_ACTIVITY_MAX_BYTES = 16 * 1024 * 1024;

interface PersistedProjectNoteActivity {
  format: typeof PROJECT_NOTE_ACTIVITY_FORMAT;
  version: typeof PROJECT_NOTE_ACTIVITY_VERSION;
  entries: readonly ProjectNoteActivityEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPersistedProjectNoteActivity(
  value: unknown,
): value is PersistedProjectNoteActivity {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !Object.hasOwn(value, 'format') ||
    !Object.hasOwn(value, 'version') ||
    !Object.hasOwn(value, 'entries') ||
    value.format !== PROJECT_NOTE_ACTIVITY_FORMAT ||
    value.version !== PROJECT_NOTE_ACTIVITY_VERSION ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }

  const byProject = new Map<string, unknown[]>();
  for (const entry of value.entries) {
    if (!isRecord(entry) || typeof entry.projectId !== 'string') {
      return false;
    }
    const projectEntries = byProject.get(entry.projectId) ?? [];
    projectEntries.push(entry);
    byProject.set(entry.projectId, projectEntries);
  }

  return Array.from(byProject.values()).every(isProjectNoteActivityEntryList);
}

function lastActivityAt(entry: ProjectNoteActivityEntry): number {
  return Math.max(
    entry.lastActivatedAt ? Date.parse(entry.lastActivatedAt) : 0,
    entry.lastClosedAt ? Date.parse(entry.lastClosedAt) : 0,
  );
}

function cloneEntry(
  entry: ProjectNoteActivityEntry,
): ProjectNoteActivityEntry {
  return { ...entry };
}

export class ProjectNoteActivityStore {
  readonly filePath: string;

  private readonly entries = new Map<string, Map<string, ProjectNoteActivityEntry>>();
  private readonly now: () => Date;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.filePath = path.join(userDataPath, PROJECT_NOTE_ACTIVITY_FILENAME);
    this.now = now;
    this.load();
  }

  get(projectId: string): readonly ProjectNoteActivityEntry[] {
    const projectEntries = this.entries.get(projectId);
    if (!projectEntries) {
      return [];
    }
    return Array.from(projectEntries.values())
      .sort((left, right) => lastActivityAt(right) - lastActivityAt(left))
      .map(cloneEntry);
  }

  record(
    projectId: string,
    event: ProjectNoteActivityEvent,
  ): ProjectNoteActivityEntry {
    const projectEntries =
      this.entries.get(projectId) ??
      new Map<string, ProjectNoteActivityEntry>();
    this.entries.set(projectId, projectEntries);

    const timestamp = this.now().toISOString();
    const previous = projectEntries.get(event.nodeId);
    const entry: ProjectNoteActivityEntry = {
      projectId,
      nodeId: event.nodeId,
      activationCount:
        (previous?.activationCount ?? 0) + (event.type === 'activated' ? 1 : 0),
      lastActivatedAt:
        event.type === 'activated'
          ? timestamp
          : (previous?.lastActivatedAt ?? null),
      lastClosedAt:
        event.type === 'closed'
          ? timestamp
          : (previous?.lastClosedAt ?? null),
    };
    projectEntries.set(event.nodeId, entry);
    this.prune(projectEntries);
    this.write();
    return cloneEntry(entry);
  }

  remove(projectId: string, nodeId: string): boolean {
    const projectEntries = this.entries.get(projectId);
    if (!projectEntries?.delete(nodeId)) {
      return false;
    }
    if (projectEntries.size === 0) {
      this.entries.delete(projectId);
    }
    this.write();
    return true;
  }

  removeMany(projectId: string, nodeIds: Iterable<string>): boolean {
    const projectEntries = this.entries.get(projectId);
    if (!projectEntries) {
      return false;
    }
    let changed = false;
    for (const nodeId of nodeIds) {
      changed = projectEntries.delete(nodeId) || changed;
    }
    if (!changed) {
      return false;
    }
    if (projectEntries.size === 0) {
      this.entries.delete(projectId);
    }
    this.write();
    return true;
  }

  private prune(
    projectEntries: Map<string, ProjectNoteActivityEntry>,
  ): void {
    if (
      projectEntries.size <= PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT
    ) {
      return;
    }
    const oldest = Array.from(projectEntries.values()).sort(
      (left, right) => lastActivityAt(left) - lastActivityAt(right),
    );
    for (
      let index = 0;
      index <
      oldest.length - PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT;
      index += 1
    ) {
      const entry = oldest[index];
      if (entry) {
        projectEntries.delete(entry.nodeId);
      }
    }
  }

  private load(): void {
    try {
      if (statSync(this.filePath).size > PROJECT_NOTE_ACTIVITY_MAX_BYTES) {
        return;
      }
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!isPersistedProjectNoteActivity(value)) {
        return;
      }
      for (const entry of value.entries) {
        const projectEntries =
          this.entries.get(entry.projectId) ??
          new Map<string, ProjectNoteActivityEntry>();
        projectEntries.set(entry.nodeId, cloneEntry(entry));
        this.entries.set(entry.projectId, projectEntries);
      }
    } catch {
      this.entries.clear();
    }
  }

  private write(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const snapshot: PersistedProjectNoteActivity = {
      format: PROJECT_NOTE_ACTIVITY_FORMAT,
      version: PROJECT_NOTE_ACTIVITY_VERSION,
      entries: Array.from(this.entries.values()).flatMap((entries) =>
        Array.from(entries.values()),
      ),
    };
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > PROJECT_NOTE_ACTIVITY_MAX_BYTES) {
      throw new RangeError('The project note activity exceeds the persistence limit.');
    }
    try {
      writeFileSync(temporaryPath, serialized, 'utf8');
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Ignore cleanup errors so the original persistence error is preserved.
      }
      throw error;
    }
  }
}
