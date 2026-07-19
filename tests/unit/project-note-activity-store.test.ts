import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectNoteActivityStore } from '../../src/main/projects';
import {
  PROJECT_NOTE_ACTIVITY_FORMAT,
  PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT,
  PROJECT_NOTE_ACTIVITY_VERSION,
} from '../../src/shared/contracts';

const temporaryDirectories: string[] = [];
const projectId = '11111111-1111-4111-8111-111111111111';

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-activity-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectNoteActivityStore', () => {
  it('persists main-process timestamps and merges activation and close events', () => {
    const directory = createTemporaryDirectory();
    const times = [
      new Date('2026-07-19T12:00:00.000Z'),
      new Date('2026-07-19T12:01:00.000Z'),
    ];
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const store = new ProjectNoteActivityStore(
      directory,
      () => times.shift() ?? new Date(0),
    );

    store.record(projectId, { type: 'activated', nodeId });
    expect(store.record(projectId, { type: 'closed', nodeId })).toEqual({
      projectId,
      nodeId,
      activationCount: 1,
      lastActivatedAt: '2026-07-19T12:00:00.000Z',
      lastClosedAt: '2026-07-19T12:01:00.000Z',
    });

    expect(new ProjectNoteActivityStore(directory).get(projectId)).toEqual([
      {
        projectId,
        nodeId,
        activationCount: 1,
        lastActivatedAt: '2026-07-19T12:00:00.000Z',
        lastClosedAt: '2026-07-19T12:01:00.000Z',
      },
    ]);
    expect(JSON.parse(readFileSync(store.filePath, 'utf8'))).toEqual({
      format: PROJECT_NOTE_ACTIVITY_FORMAT,
      version: PROJECT_NOTE_ACTIVITY_VERSION,
      entries: expect.any(Array),
    });
  });

  it('keeps only the 500 most recently active entries per project', () => {
    const directory = createTemporaryDirectory();
    let time = Date.parse('2026-07-19T12:00:00.000Z');
    const store = new ProjectNoteActivityStore(
      directory,
      () => new Date(time++),
    );

    for (
      let index = 0;
      index < PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT + 1;
      index += 1
    ) {
      store.record(projectId, {
        type: 'activated',
        nodeId: `00000000-0000-4000-8000-${index
          .toString()
          .padStart(12, '0')}`,
      });
    }

    const entries = store.get(projectId);
    expect(entries).toHaveLength(PROJECT_NOTE_ACTIVITY_MAX_ENTRIES_PER_PROJECT);
    expect(entries.at(-1)?.nodeId).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('ignores malformed snapshots and atomically removes entries', () => {
    const directory = createTemporaryDirectory();
    const filePath = path.join(directory, 'project-note-activity.json');
    writeFileSync(filePath, '{"format":"wrong","entries":[]}', 'utf8');
    const store = new ProjectNoteActivityStore(directory);
    expect(store.get(projectId)).toEqual([]);

    const nodeId = '22222222-2222-4222-8222-222222222222';
    store.record(projectId, { type: 'closed', nodeId });
    expect(store.remove(projectId, nodeId)).toBe(true);
    expect(store.get(projectId)).toEqual([]);
    expect(
      JSON.parse(readFileSync(filePath, 'utf8')).entries,
    ).toEqual([]);
  });
});
