import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ProjectCatalogStore,
  ProjectNoteActivityStore,
  ProjectService,
} from '../../src/main/projects';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-activity-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectService note activity', () => {
  it('binds activity to the active project and removes protected notes', async () => {
    const parent = createTemporaryDirectory();
    const userData = path.join(parent, 'user-data');
    let timestamp = Date.parse('2026-07-19T12:00:00.000Z');
    const activityStore = new ProjectNoteActivityStore(
      userData,
      () => new Date(timestamp++),
    );
    const service = new ProjectService({
      activityStore,
      catalogStore: new ProjectCatalogStore(userData),
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
    });
    const selection = await service.selectCreateLocation(42, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const project = await service.createProject(42, {
      selectionToken: selection.value.token,
      name: 'Atividade',
    });
    if (!project.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    const note = await service.createNode(42, {
      parentId: null,
      name: 'Nota',
      kind: 'page',
      pageType: 'markdown',
    });
    if (!note.ok) {
      throw new Error('Expected note creation to succeed.');
    }

    await expect(
      service.recordNoteActivity(42, {
        type: 'activated',
        nodeId: note.value.nodeId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: project.value.projectId,
        nodeId: note.value.nodeId,
        activationCount: 1,
      },
    });
    await service.recordNoteActivity(42, {
      type: 'closed',
      nodeId: note.value.nodeId,
    });
    await expect(service.getNoteActivity(42)).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ nodeId: note.value.nodeId })],
    });

    const document = await service.readMarkdown(42, {
      nodeId: note.value.nodeId,
    });
    if (!document.ok) {
      throw new Error('Expected note reading to succeed.');
    }
    await expect(
      service.protectPage(42, {
        nodeId: note.value.nodeId,
        expectedRevision: document.value.revision,
        password: 'segredo',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(activityStore.get(project.value.projectId)).toEqual([]);
    await expect(service.getNoteActivity(42)).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it('rejects activity for non-Markdown project nodes', async () => {
    const parent = createTemporaryDirectory();
    const userData = path.join(parent, 'user-data');
    const service = new ProjectService({
      activityStore: new ProjectNoteActivityStore(userData),
      catalogStore: new ProjectCatalogStore(userData),
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
    });
    const selection = await service.selectCreateLocation(7, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    await service.createProject(7, {
      selectionToken: selection.value.token,
      name: 'Atividade',
    });
    const folder = await service.createNode(7, {
      parentId: null,
      name: 'Pasta',
      kind: 'folder',
    });
    if (!folder.ok) {
      throw new Error('Expected folder creation to succeed.');
    }

    await expect(
      service.recordNoteActivity(7, {
        type: 'activated',
        nodeId: folder.value.nodeId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });
  });
});
