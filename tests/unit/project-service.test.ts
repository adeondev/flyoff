import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectCatalogStore,
  ProjectRepository,
  ProjectService,
} from '../../src/main/projects';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(
  parentPath: string,
  now: () => Date = () => new Date(),
): ProjectService {
  return new ProjectService({
    catalogStore: new ProjectCatalogStore(path.join(parentPath, 'user-data')),
    trashItem: (absolutePath) =>
      rm(absolutePath, { recursive: true, force: true }),
    now,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectService', () => {
  it('binds one-use creation locations and active projects to the sender', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);

    expect(selection.ok).toBe(true);
    if (!selection.ok) {
      return;
    }

    const wrongSender = await service.createProject(2, {
      selectionToken: selection.value.token,
      name: 'Projeto',
    });
    expect(wrongSender).toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });

    const reused = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Projeto',
    });
    expect(reused).toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });

    const nextSelection = await service.selectCreateLocation(1, parent);
    if (!nextSelection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const created = await service.createProject(1, {
      selectionToken: nextSelection.value.token,
      name: 'Projeto',
    });

    expect(created).toMatchObject({ ok: true, value: { name: 'Projeto' } });
    expect(service.getActiveProject(1)?.name).toBe('Projeto');
    expect(service.getActiveProject(2)).toBeNull();
  });

  it('expires creation tokens after five minutes', async () => {
    const parent = createTemporaryDirectory();
    let time = Date.parse('2026-07-14T12:00:00.000Z');
    const service = createService(parent, () => new Date(time));
    const selection = await service.selectCreateLocation('window', parent);

    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }

    time += 5 * 60 * 1_000;
    await expect(
      service.createProject('window', {
        selectionToken: selection.value.token,
        name: 'Expirado',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });
  });

  it('restores catalogued projects by identity and supports node operations', async () => {
    const parent = createTemporaryDirectory();
    const catalog = new ProjectCatalogStore(path.join(parent, 'user-data'));
    const service = new ProjectService({
      catalogStore: catalog,
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
    });
    const selection = await service.selectCreateLocation(1, parent);

    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }

    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Restaurável',
    });

    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }

    const note = await service.createNode(1, {
      parentId: null,
      name: 'Documento',
      kind: 'page',
      pageType: 'markdown',
    });
    expect(note.ok).toBe(true);

    await service.closeProject(1);
    const restored = await service.restoreProject(2, {
      projectId: created.value.projectId,
    });

    expect(restored).toEqual(created);
    expect(await service.listChildren(2, { parentId: null })).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ name: 'Documento' }),
      ]),
    });
  });

  it('returns typed failures when no project is active', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);

    expect(
      await service.getNode('missing', { nodeId: randomUUID() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });
  });

  it('shares one repository instance for the same project across senders', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);

    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }

    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Compartilhado',
    });

    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }

    await service.openProject(2, created.value.location);
    const note = await service.createNode(1, {
      parentId: null,
      name: 'Sincronizada',
      kind: 'page',
      pageType: 'markdown',
    });
    const listed = await service.listChildren(2, { parentId: null });

    expect(note.ok).toBe(true);
    expect(listed).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          nodeId: note.ok ? note.value.nodeId : '',
          name: 'Sincronizada',
        }),
      ]),
    });
  });

  it('waits for queued project operations before closing the sender context', async () => {
    const parent = createTemporaryDirectory();
    let finishTrash: (() => void) | undefined;
    let notifyTrashStarted: (() => void) | undefined;
    const trashStarted = new Promise<void>((resolve) => {
      notifyTrashStarted = resolve;
    });
    const service = new ProjectService({
      catalogStore: new ProjectCatalogStore(path.join(parent, 'user-data')),
      trashItem: () =>
        new Promise<void>((resolve) => {
          finishTrash = resolve;
          notifyTrashStarted?.();
        }),
    });
    const selection = await service.selectCreateLocation(1, parent);

    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }

    await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Fila',
    });
    const folder = await service.createNode(1, {
      parentId: null,
      name: 'Pendente',
      kind: 'folder',
    });

    if (!folder.ok) {
      throw new Error('Expected folder creation to succeed.');
    }

    const trash = service.trashNode(1, { nodeId: folder.value.nodeId });
    const close = service.closeProject(1);
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    await trashStarted;

    expect(closed).toBe(false);
    finishTrash?.();
    await expect(trash).resolves.toMatchObject({ ok: true });
    await expect(close).resolves.toEqual({ ok: true, value: null });
    expect(service.getActiveProject(1)).toBeNull();
  });

  it('does not activate a project after its sender closes during open', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);

    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }

    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Atrasado',
    });
    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    await service.closeProject(1);

    const repository = await ProjectRepository.open(created.value.location, {
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
    });
    let finishOpen: ((value: ProjectRepository) => void) | undefined;
    const openSpy = vi
      .spyOn(ProjectRepository, 'open')
      .mockImplementation(
        () =>
          new Promise<ProjectRepository>((resolve) => {
            finishOpen = resolve;
          }),
      );

    const opening = service.openProject(1, created.value.location);
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledOnce());
    await expect(service.closeProject(1)).resolves.toEqual({
      ok: true,
      value: null,
    });
    finishOpen?.(repository);

    await expect(opening).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-operation' },
    });
    expect(service.getActiveProject(1)).toBeNull();
    openSpy.mockRestore();
  });
});
