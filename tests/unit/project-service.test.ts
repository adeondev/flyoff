import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
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
    await expect(service.resolvePath(2, { nodeId: null })).resolves.toEqual({
      ok: true,
      value: created.value.location,
    });
    if (note.ok) {
      await expect(
        service.resolvePath(2, { nodeId: note.value.nodeId }),
      ).resolves.toEqual({
        ok: true,
        value: path.join(created.value.location, 'Documento.md'),
      });
    }
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
    expect(
      await service.resolvePath('missing', { nodeId: null }),
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

  it('updates Markdown and wikilink references when folders are renamed', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const project = await service.createProject(1, {
      name: 'Referências',
      selectionToken: selection.value.token,
    });
    const folder = await service.createNode(1, {
      kind: 'folder',
      name: 'Notes',
      parentId: null,
    });
    if (!project.ok || !folder.ok) {
      throw new Error('Expected project setup to succeed.');
    }
    const target = await service.createNode(1, {
      kind: 'page',
      name: 'Target',
      pageType: 'markdown',
      parentId: folder.value.nodeId,
    });
    const source = await service.createNode(1, {
      kind: 'page',
      name: 'Source',
      pageType: 'markdown',
      parentId: null,
    });
    if (!target.ok || !source.ok) {
      throw new Error('Expected Markdown notes to be created.');
    }
    const initialSource = await service.readMarkdown(1, {
      nodeId: source.value.nodeId,
    });
    const initialTarget = await service.readMarkdown(1, {
      nodeId: target.value.nodeId,
    });
    if (!initialSource.ok || !initialTarget.ok) {
      throw new Error('Expected Markdown notes to be readable.');
    }
    await service.saveMarkdown(1, {
      content:
        '[label](Notes/Target.md#Heading)\n[[Notes/Target#Heading|alias]]',
      expectedRevision: initialSource.value.revision,
      nodeId: source.value.nodeId,
    });
    await service.saveMarkdown(1, {
      content: '# Heading',
      expectedRevision: initialTarget.value.revision,
      nodeId: target.value.nodeId,
    });

    const renamed = await service.renameNode(1, {
      name: 'Archive',
      nodeId: folder.value.nodeId,
    });

    expect(renamed).toMatchObject({
      ok: true,
      value: {
        node: { name: 'Archive' },
        updatedDocumentNodeIds: [source.value.nodeId],
      },
    });
    await expect(
      service.readMarkdown(1, { nodeId: source.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        content:
          '[label](Archive/Target.md#Heading)\n[[Archive/Target#Heading|alias]]',
      },
    });

    const destination = await service.createNode(1, {
      kind: 'folder',
      name: 'Elsewhere',
      parentId: null,
    });
    if (!destination.ok) {
      throw new Error('Expected destination folder to be created.');
    }
    const moved = await service.moveNode(1, {
      nodeId: target.value.nodeId,
      parentId: destination.value.nodeId,
    });

    expect(moved).toMatchObject({
      ok: true,
      value: {
        node: { parentId: destination.value.nodeId },
        updatedDocumentNodeIds: [source.value.nodeId],
      },
    });
    await expect(
      service.readMarkdown(1, { nodeId: source.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        content:
          '[label](Elsewhere/Target.md#Heading)\n[[Elsewhere/Target#Heading|alias]]',
      },
    });

    const container = await service.createNode(1, {
      kind: 'page',
      name: 'Container',
      pageType: 'markdown',
      parentId: null,
    });
    if (!container.ok) {
      throw new Error('Expected note container to be created.');
    }
    const organized = await service.moveNode(1, {
      nodeId: target.value.nodeId,
      parentId: container.value.nodeId,
    });

    expect(organized).toMatchObject({
      ok: true,
      value: {
        node: { parentId: container.value.nodeId },
        updatedDocumentNodeIds: [],
      },
    });
    await expect(
      service.readMarkdown(1, { nodeId: source.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        content:
          '[label](Elsewhere/Target.md#Heading)\n[[Elsewhere/Target#Heading|alias]]',
      },
    });
  });

  it('rolls link rewrites back when the filesystem mutation fails', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    await service.createProject(1, {
      name: 'Rollback',
      selectionToken: selection.value.token,
    });
    const target = await service.createNode(1, {
      kind: 'page',
      name: 'Target',
      pageType: 'markdown',
      parentId: null,
    });
    const source = await service.createNode(1, {
      kind: 'page',
      name: 'Source',
      pageType: 'markdown',
      parentId: null,
    });
    if (!target.ok || !source.ok) {
      throw new Error('Expected Markdown notes to be created.');
    }
    const initial = await service.readMarkdown(1, {
      nodeId: source.value.nodeId,
    });
    if (!initial.ok) {
      throw new Error('Expected source note to be readable.');
    }
    const originalContent = '[target](Target.md)';
    await service.saveMarkdown(1, {
      content: originalContent,
      expectedRevision: initial.value.revision,
      nodeId: source.value.nodeId,
    });
    vi.spyOn(ProjectRepository.prototype, 'renameNode').mockRejectedValueOnce(
      new Error('rename failed'),
    );

    await expect(
      service.renameNode(1, {
        name: 'Renamed',
        nodeId: target.value.nodeId,
      }),
    ).resolves.toMatchObject({
      error: { code: 'io-error' },
      ok: false,
    });
    await expect(
      service.readMarkdown(1, { nodeId: source.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { content: originalContent },
    });
    await expect(
      service.getNode(1, { nodeId: target.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { name: 'Target' },
    });
  });

  it('renames and moves nodes while protected notes remain locked', async () => {
    const parent = createTemporaryDirectory();
    const service = createService(parent);
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const project = await service.createProject(1, {
      name: 'Protegido',
      selectionToken: selection.value.token,
    });
    if (!project.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    const target = await service.createNode(1, {
      kind: 'page',
      name: 'Target',
      pageType: 'markdown',
      parentId: null,
    });
    const secret = await service.createNode(1, {
      kind: 'page',
      name: 'Secret',
      pageType: 'markdown',
      parentId: null,
    });
    const destination = await service.createNode(1, {
      kind: 'folder',
      name: 'Destination',
      parentId: null,
    });
    if (!target.ok || !secret.ok || !destination.ok) {
      throw new Error('Expected Markdown notes to be created.');
    }
    const secretDocument = await service.readMarkdown(1, {
      nodeId: secret.value.nodeId,
    });
    if (!secretDocument.ok) {
      throw new Error('Expected secret note to be readable.');
    }
    const linkedSecret = await service.saveMarkdown(1, {
      content: 'very secret sentence\n[target](Target.md)\n[[Target]]',
      expectedRevision: secretDocument.value.revision,
      nodeId: secret.value.nodeId,
    });
    if (!linkedSecret.ok) {
      throw new Error('Expected secret links to be saved.');
    }
    const readOnlySecret = await service.setPageReadOnly(1, {
      expectedRevision: linkedSecret.value.revision,
      nodeId: secret.value.nodeId,
      readOnly: true,
    });
    if (!readOnlySecret.ok) {
      throw new Error('Expected the secret note to become read-only.');
    }
    await service.protectPage(1, {
      expectedRevision: readOnlySecret.value.revision,
      nodeId: secret.value.nodeId,
      password: 'test password',
    });
    await service.openProject(2, project.value.location);

    const maintenancePath = path.join(
      project.value.location,
      '.flyoff',
      'link-maintenance.json',
    );
    const failedRename = vi
      .spyOn(ProjectRepository.prototype, 'renameNode')
      .mockRejectedValueOnce(new Error('rename failed'));
    await expect(
      service.renameNode(2, {
        name: 'Failed',
        nodeId: target.value.nodeId,
      }),
    ).resolves.toMatchObject({
      error: { code: 'io-error' },
      ok: false,
    });
    expect(existsSync(maintenancePath)).toBe(false);
    failedRename.mockRestore();

    await expect(
      service.renameNode(2, {
        name: 'Renamed',
        nodeId: target.value.nodeId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        node: { name: 'Renamed' },
        skippedLockedNodeIds: [secret.value.nodeId],
        updatedDocumentNodeIds: [],
      },
    });
    await expect(
      service.getNode(2, { nodeId: target.value.nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { name: 'Renamed' },
    });
    await expect(
      service.renameNode(2, {
        name: 'Archive',
        nodeId: destination.value.nodeId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        node: { name: 'Archive' },
        skippedLockedNodeIds: [secret.value.nodeId],
        updatedDocumentNodeIds: [],
      },
    });
    await expect(
      service.moveNode(2, {
        nodeId: target.value.nodeId,
        parentId: destination.value.nodeId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        node: { parentId: destination.value.nodeId },
        skippedLockedNodeIds: [secret.value.nodeId],
        updatedDocumentNodeIds: [],
      },
    });
    expect(existsSync(maintenancePath)).toBe(true);
    expect(readFileSync(maintenancePath, 'utf8')).not.toContain(
      'very secret sentence',
    );

    const reopenedService = createService(parent);
    await expect(
      reopenedService.openProject(3, project.value.location),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      reopenedService.unlockPage(3, {
        nodeId: secret.value.nodeId,
        password: 'test password',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        content:
          'very secret sentence\n[target](Archive/Renamed.md)\n[[Renamed]]',
      },
    });
    expect(existsSync(maintenancePath)).toBe(false);
  }, 10_000);
});
