import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ProjectOperationError,
  ProjectRepository,
} from '../../src/main/projects';
import { ProjectFileSystem } from '../../src/main/projects/project-filesystem';
import { MARKDOWN_DOCUMENT_MAX_BYTES } from '../../src/shared/contracts';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-projects-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(
  trashItem: (absolutePath: string) => Promise<void> = (absolutePath) =>
    rm(absolutePath, { recursive: true, force: true }),
): Promise<ProjectRepository> {
  const parent = createTemporaryDirectory();
  return ProjectRepository.create(path.join(parent, 'Meu Projeto'), 'Meu Projeto', {
    trashItem,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectRepository', () => {
  it('creates a portable folder project with versioned metadata', async () => {
    const repository = await createRepository();
    const manifest = JSON.parse(
      readFileSync(
        path.join(repository.rootPath, '.flyoff', 'project.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const children = await repository.listChildren(null);

    expect(manifest).toMatchObject({
      format: 'flyoff-project',
      formatVersion: 2,
      projectId: repository.summary.projectId,
      name: 'Meu Projeto',
    });
    expect(manifest).not.toHaveProperty('location');
    expect(children).toEqual([
      expect.objectContaining({ name: 'Notas', kind: 'folder' }),
    ]);
  });

  it('keeps node identities through create, rename, and move operations', async () => {
    const repository = await createRepository();
    const folder = await repository.createFolder(null, 'Produto');
    const destination = await repository.createFolder(null, 'Arquivo');
    const note = await repository.createMarkdownPage(folder.nodeId, 'Escopo');
    const renamed = await repository.renameNode(note.nodeId, 'Planejamento');
    const moved = await repository.moveNode(note.nodeId, destination.nodeId);

    expect(renamed).toMatchObject({
      nodeId: note.nodeId,
      parentId: folder.nodeId,
      name: 'Planejamento',
    });
    expect(moved).toMatchObject({
      nodeId: note.nodeId,
      parentId: destination.nodeId,
      name: 'Planejamento',
    });
    expect(
      existsSync(
        path.join(repository.rootPath, 'Arquivo', 'Planejamento.md'),
      ),
    ).toBe(true);
  });

  it('imports binary media and preserves its real extension on rename', async () => {
    const repository = await createRepository();
    const sourceDirectory = createTemporaryDirectory();
    const source = path.join(sourceDirectory, 'Lua.png');
    writeFileSync(
      source,
      Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10,
        0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 2, 128, 0, 0, 1, 104,
      ]),
    );
    const imported = await repository.importMedia(null, source);
    const renamed = await repository.renameNode(
      imported.node.nodeId,
      'Apollo',
    );
    const asset = await repository.getMediaAsset(imported.node.nodeId);

    expect(imported.node).toMatchObject({
      kind: 'page',
      pageType: 'media:image',
      extension: '.png',
    });
    expect(renamed).toMatchObject({ name: 'Apollo', extension: '.png' });
    expect(asset).toMatchObject({
      name: 'Apollo',
      extension: '.png',
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(
      existsSync(path.join(repository.rootPath, 'Media', 'Apollo.png')),
    ).toBe(true);
  });

  it('uses alphabetical order until a branch is manually reordered', async () => {
    const repository = await createRepository();
    const alpha = await repository.createMarkdownPage(null, 'Alpha');
    await repository.createFolder(null, 'Beta');
    const zulu = await repository.createMarkdownPage(null, 'Zulu');

    expect((await repository.listChildren(null)).map(({ name }) => name)).toEqual([
      'Alpha',
      'Beta',
      'Notas',
      'Zulu',
    ]);

    await repository.moveNode(zulu.nodeId, null, alpha.nodeId);
    await repository.renameNode(zulu.nodeId, 'Ômega');
    await repository.createMarkdownPage(null, 'Antes');
    writeFileSync(
      path.join(repository.rootPath, 'Externo.md'),
      '# arquivo externo',
      'utf8',
    );

    expect((await repository.listChildren(null)).map(({ name }) => name)).toEqual([
      'Ômega',
      'Alpha',
      'Beta',
      'Notas',
      'Antes',
      'Externo',
    ]);

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect((await reopened.listChildren(null)).map(({ name }) => name)).toEqual([
      'Ômega',
      'Alpha',
      'Beta',
      'Notas',
      'Antes',
      'Externo',
    ]);
  });

  it('loads a v1 content index and persists v4 on the first mutation', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Legado');
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    const legacy = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      formatVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    legacy.formatVersion = 1;
    for (const entry of legacy.entries) {
      delete entry.sortOrder;
    }
    writeFileSync(indexPath, JSON.stringify(legacy), 'utf8');

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect(await reopened.getNode(note.nodeId)).toMatchObject({
      nodeId: note.nodeId,
      name: 'Legado',
    });
    expect(
      (JSON.parse(readFileSync(indexPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(1);

    const renamed = await reopened.renameNode(note.nodeId, 'Legado atualizado');
    expect(renamed.nodeId).toBe(note.nodeId);
    expect(
      (JSON.parse(readFileSync(indexPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(4);
  });

  it('moves selected notes as a contiguous ordered block', async () => {
    const repository = await createRepository();
    const source = await repository.createFolder(null, 'Origem');
    const destination = await repository.createFolder(null, 'Destino');
    const first = await repository.createMarkdownPage(source.nodeId, 'Primeira');
    const second = await repository.createMarkdownPage(source.nodeId, 'Segunda');
    const marker = await repository.createMarkdownPage(
      destination.nodeId,
      'Marcador',
    );

    const moved = await repository.moveNodes(
      [second.nodeId, first.nodeId],
      destination.nodeId,
      marker.nodeId,
    );

    expect(moved.map(({ nodeId }) => nodeId)).toEqual([
      second.nodeId,
      first.nodeId,
    ]);
    expect(
      (await repository.listChildren(destination.nodeId)).map(
        ({ nodeId }) => nodeId,
      ),
    ).toEqual([second.nodeId, first.nodeId, marker.nodeId]);
  });

  it('organizes content under a Markdown note without moving it on disk', async () => {
    const repository = await createRepository();
    const container = await repository.createMarkdownPage(null, 'Container');
    const storageFolder = await repository.createFolder(null, 'Arquivos');
    const child = await repository.createMarkdownPage(
      storageFolder.nodeId,
      'Filha',
    );
    const originalPath = path.join(
      repository.rootPath,
      'Arquivos',
      'Filha.md',
    );

    const organized = await repository.moveNode(
      child.nodeId,
      container.nodeId,
    );

    expect(organized.parentId).toBe(container.nodeId);
    expect(existsSync(originalPath)).toBe(true);
    expect(repository.projectRelativePath(child.nodeId)).toBe(
      'Arquivos/Filha.md',
    );
    expect(await repository.listChildren(container.nodeId)).toContainEqual(
      organized,
    );
    expect((await repository.getNode(container.nodeId)).hasChildren).toBe(
      true,
    );

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect(await reopened.getNode(child.nodeId)).toMatchObject({
      nodeId: child.nodeId,
      parentId: container.nodeId,
    });
    expect(reopened.projectRelativePath(child.nodeId)).toBe(
      'Arquivos/Filha.md',
    );

    const restored = await reopened.moveNode(child.nodeId, null);

    expect(restored.parentId).toBeNull();
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(path.join(repository.rootPath, 'Filha.md'))).toBe(true);
    expect(reopened.projectRelativePath(child.nodeId)).toBe('Filha.md');
  });

  it('rejects mixed physical and visual hierarchy cycles', async () => {
    const repository = await createRepository();
    const folder = await repository.createFolder(null, 'Pasta');
    const container = await repository.createMarkdownPage(
      folder.nodeId,
      'Container',
    );

    await expect(
      repository.moveNode(folder.nodeId, container.nodeId),
    ).rejects.toMatchObject({ code: 'invalid-operation' });
    expect((await repository.getNode(folder.nodeId)).parentId).toBeNull();
  });

  it('returns orphaned visual children to their physical parent', async () => {
    const repository = await createRepository();
    const storageFolder = await repository.createFolder(null, 'Arquivos');
    const container = await repository.createMarkdownPage(null, 'Container');
    const child = await repository.createMarkdownPage(
      storageFolder.nodeId,
      'Filha',
    );
    await repository.moveNode(child.nodeId, container.nodeId);
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    index.entries.find(
      ({ nodeId }) => nodeId === child.nodeId,
    )!.displayParentId = randomUUID();
    writeFileSync(indexPath, JSON.stringify(index), 'utf8');

    const reopened = await ProjectRepository.open(repository.rootPath);

    expect(await reopened.getNode(child.nodeId)).toMatchObject({
      nodeId: child.nodeId,
      parentId: storageFolder.nodeId,
    });
  });

  it('promotes visual children when their note container is deleted', async () => {
    const repository = await createRepository();
    const storageFolder = await repository.createFolder(null, 'Arquivos');
    const container = await repository.createMarkdownPage(null, 'Container');
    const child = await repository.createMarkdownPage(
      storageFolder.nodeId,
      'Filha',
    );
    await repository.moveNode(child.nodeId, container.nodeId);

    expect(await repository.trashNode(container.nodeId)).toEqual([
      container.nodeId,
    ]);

    expect(await repository.getNode(child.nodeId)).toMatchObject({
      nodeId: child.nodeId,
      parentId: null,
    });
    expect(
      existsSync(
        path.join(repository.rootPath, 'Arquivos', 'Filha.md'),
      ),
    ).toBe(true);
  });

  it('preflights batch name collisions before moving any note', async () => {
    const repository = await createRepository();
    const left = await repository.createFolder(null, 'Esquerda');
    const right = await repository.createFolder(null, 'Direita');
    const destination = await repository.createFolder(null, 'Destino');
    const first = await repository.createMarkdownPage(left.nodeId, 'Igual');
    const second = await repository.createMarkdownPage(right.nodeId, 'Igual');

    await expect(
      repository.moveNodes(
        [first.nodeId, second.nodeId],
        destination.nodeId,
      ),
    ).rejects.toMatchObject({ code: 'collision' });
    expect((await repository.getNode(first.nodeId)).parentId).toBe(left.nodeId);
    expect((await repository.getNode(second.nodeId)).parentId).toBe(right.nodeId);
  });

  it('moves mixed roots and ignores descendants selected with their folder', async () => {
    const repository = await createRepository();
    const source = await repository.createFolder(null, 'Origem mista');
    const nested = await repository.createFolder(source.nodeId, 'Subpasta');
    const nestedNote = await repository.createMarkdownPage(
      nested.nodeId,
      'Interna',
    );
    const looseNote = await repository.createMarkdownPage(
      source.nodeId,
      'Solta',
    );
    const destination = await repository.createFolder(null, 'Destino misto');

    const moved = await repository.moveNodes(
      [nestedNote.nodeId, nested.nodeId, looseNote.nodeId],
      destination.nodeId,
    );

    expect(moved.map(({ nodeId }) => nodeId)).toEqual([
      nested.nodeId,
      looseNote.nodeId,
    ]);
    expect((await repository.getNode(nestedNote.nodeId)).parentId).toBe(
      nested.nodeId,
    );
    expect((await repository.getNode(nested.nodeId)).parentId).toBe(
      destination.nodeId,
    );
  });

  it('rejects moving a selected folder into its descendant before disk changes', async () => {
    const repository = await createRepository();
    const parent = await repository.createFolder(null, 'Pai em lote');
    const child = await repository.createFolder(parent.nodeId, 'Filha em lote');

    await expect(
      repository.moveNodes([parent.nodeId], child.nodeId),
    ).rejects.toMatchObject({ code: 'invalid-operation' });
    expect((await repository.getNode(parent.nodeId)).parentId).toBeNull();
  });

  it('preserves indexed custom page types when their adapter is unavailable', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Plugin');
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = index.entries.find(({ nodeId }) => nodeId === note.nodeId)!;
    entry.pageType = 'example-plugin:canvas';
    entry.locator = 'Plugin.canvas';
    renameSync(
      path.join(repository.rootPath, 'Plugin.md'),
      path.join(repository.rootPath, 'Plugin.canvas'),
    );
    writeFileSync(indexPath, JSON.stringify(index), 'utf8');

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect(await reopened.listChildren(null)).toContainEqual({
      canContainChildren: false,
      extension: '.canvas',
      hasChildren: false,
      nodeId: note.nodeId,
      parentId: null,
      name: 'Plugin',
      kind: 'page',
      pageType: 'example-plugin:canvas',
    });
  });

  it('reads and saves UTF-8 Markdown with revision conflicts', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Diário');
    const initial = await repository.readMarkdown(note.nodeId);
    const saved = await repository.saveMarkdown(
      note.nodeId,
      '# Olá\n',
      initial.revision,
    );
    const notePath = path.join(repository.rootPath, 'Diário.md');

    expect(saved.content).toBe('# Olá\n');
    expect(saved.revision).not.toBe(initial.revision);

    writeFileSync(notePath, '# Alteração externa\n', 'utf8');

    await expect(
      repository.saveMarkdown(note.nodeId, '# Local\n', saved.revision),
    ).rejects.toMatchObject({
      code: 'conflict',
      currentRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    writeFileSync(
      notePath,
      Buffer.alloc(MARKDOWN_DOCUMENT_MAX_BYTES + 1, 0x78),
    );

    await expect(
      repository.saveMarkdown(note.nodeId, '# Local\n', saved.revision, true),
    ).resolves.toMatchObject({ content: '# Local\n' });
  });

  it('reconciles external changes lazily and rebuilds an invalid index', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Original');
    renameSync(
      path.join(repository.rootPath, 'Original.md'),
      path.join(repository.rootPath, 'Externa.md'),
    );
    writeFileSync(path.join(repository.rootPath, 'oculto.bin'), 'ignored');

    const reconciled = await repository.listChildren(null);
    const external = reconciled.find(({ name }) => name === 'Externa');

    expect(external?.nodeId).not.toBe(note.nodeId);
    expect(reconciled.some(({ name }) => name === 'oculto')).toBe(false);

    writeFileSync(
      path.join(repository.rootPath, '.flyoff', 'content-index.json'),
      '{invalid',
      'utf8',
    );
    const reopened = await ProjectRepository.open(repository.rootPath);

    expect(await reopened.listChildren(null)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Externa', kind: 'page' }),
      ]),
    );
  });

  it('replaces stale entries when a locator changes kind and reads uppercase Markdown extensions', async () => {
    const repository = await createRepository();
    const stale = await repository.createMarkdownPage(null, 'Mesmo');
    rmSync(path.join(repository.rootPath, 'Mesmo.md'));
    mkdirSync(path.join(repository.rootPath, 'Mesmo.md'));
    writeFileSync(path.join(repository.rootPath, 'Maiuscula.MD'), '# Nota', 'utf8');

    const children = await repository.listChildren(null);
    const replacement = children.find(({ name }) => name === 'Mesmo.md');
    const uppercase = children.find(({ name }) => name === 'Maiuscula');

    expect(replacement).toMatchObject({ kind: 'folder' });
    expect(replacement?.nodeId).not.toBe(stale.nodeId);
    expect(uppercase).toMatchObject({ kind: 'page', pageType: 'markdown' });
    await expect(repository.getNode(stale.nodeId)).rejects.toMatchObject({
      code: 'not-found',
    });

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect(await reopened.getNode(uppercase?.nodeId ?? '')).toMatchObject({
      name: 'Maiuscula',
    });
  });

  it('rejects portable-name collisions and moving a folder into itself', async () => {
    const repository = await createRepository();
    const parent = await repository.createFolder(null, 'Pai');
    const child = await repository.createFolder(parent.nodeId, 'Filho');

    await expect(repository.createFolder(null, 'CON')).rejects.toMatchObject({
      code: 'invalid-name',
    });
    await expect(repository.createFolder(null, 'notas')).rejects.toMatchObject({
      code: 'collision',
    });
    await expect(
      repository.moveNode(parent.nodeId, child.nodeId),
    ).rejects.toMatchObject({ code: 'invalid-operation' });
  });

  it('moves the physical node to the injected trash and drops its index subtree', async () => {
    const trashed: string[] = [];
    const repository = await createRepository(async (absolutePath) => {
      trashed.push(absolutePath);
      await rm(absolutePath, { recursive: true, force: true });
    });
    const folder = await repository.createFolder(null, 'Descartar');
    const note = await repository.createMarkdownPage(folder.nodeId, 'Interna');

    const removedNodeIds = await repository.trashNode(folder.nodeId);

    expect(trashed).toEqual([
      path.join(repository.rootPath, 'Descartar'),
    ]);
    expect(new Set(removedNodeIds)).toEqual(
      new Set([folder.nodeId, note.nodeId]),
    );
    await expect(repository.getNode(folder.nodeId)).rejects.toBeInstanceOf(
      ProjectOperationError,
    );
  });

  it('trashes selected notes as one staged transaction', async () => {
    const trashed: string[] = [];
    const repository = await createRepository(async (absolutePath) => {
      trashed.push(absolutePath);
      await rm(absolutePath, { recursive: true, force: true });
    });
    const first = await repository.createMarkdownPage(null, 'Primeira');
    const second = await repository.createMarkdownPage(null, 'Segunda');

    const removed = await repository.trashNodes([first.nodeId, second.nodeId]);

    expect(removed).toEqual([first.nodeId, second.nodeId]);
    expect(trashed).toHaveLength(1);
    expect(path.dirname(trashed[0]!)).toBe(
      path.join(repository.rootPath, '.flyoff', 'trash-transactions'),
    );
    await expect(repository.getNode(first.nodeId)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(repository.getNode(second.nodeId)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('restores every selected note when transactional trash fails', async () => {
    const repository = await createRepository(async () => {
      throw new Error('trash unavailable');
    });
    const first = await repository.createMarkdownPage(null, 'Primeira');
    const second = await repository.createMarkdownPage(null, 'Segunda');

    await expect(
      repository.trashNodes([first.nodeId, second.nodeId]),
    ).rejects.toMatchObject({ code: 'io-error' });
    expect(await repository.getNode(first.nodeId)).toMatchObject(first);
    expect(await repository.getNode(second.nodeId)).toMatchObject(second);
    expect(
      existsSync(path.join(repository.rootPath, 'Primeira.md')),
    ).toBe(true);
    expect(
      existsSync(path.join(repository.rootPath, 'Segunda.md')),
    ).toBe(true);
  });

  it('trashes mixed roots once and returns every removed descendant', async () => {
    const trashed: string[] = [];
    const repository = await createRepository(async (absolutePath) => {
      trashed.push(absolutePath);
      await rm(absolutePath, { recursive: true, force: true });
    });
    const folder = await repository.createFolder(null, 'Grupo');
    const nested = await repository.createFolder(folder.nodeId, 'Dentro');
    const nestedNote = await repository.createMarkdownPage(
      nested.nodeId,
      'Nota interna',
    );
    const looseNote = await repository.createMarkdownPage(null, 'Nota solta');

    const removed = await repository.trashNodes([
      nestedNote.nodeId,
      folder.nodeId,
      looseNote.nodeId,
    ]);

    expect(new Set(removed)).toEqual(
      new Set([
        folder.nodeId,
        nested.nodeId,
        nestedNote.nodeId,
        looseNote.nodeId,
      ]),
    );
    expect(trashed).toHaveLength(1);
  });

  it('restores a folder subtree when transactional trash fails', async () => {
    const repository = await createRepository(async () => {
      throw new Error('trash unavailable');
    });
    const folder = await repository.createFolder(null, 'Restaurar grupo');
    const note = await repository.createMarkdownPage(folder.nodeId, 'Interna');

    await expect(repository.trashNodes([folder.nodeId])).rejects.toMatchObject({
      code: 'io-error',
    });
    expect(await repository.getNode(folder.nodeId)).toMatchObject({
      nodeId: folder.nodeId,
      name: folder.name,
      parentId: null,
    });
    expect(await repository.getNode(note.nodeId)).toMatchObject({
      nodeId: note.nodeId,
      name: note.name,
      parentId: folder.nodeId,
    });
    expect(
      existsSync(path.join(repository.rootPath, 'Restaurar grupo', 'Interna.md')),
    ).toBe(true);
  });

  it('rejects project roots opened through symbolic links', async () => {
    const repository = await createRepository();
    const linkedRoot = path.join(createTemporaryDirectory(), 'link');

    try {
      symlinkSync(
        repository.rootPath,
        linkedRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      return;
    }

    await expect(ProjectRepository.open(linkedRoot)).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('revalidates an opened root before root-level operations', async () => {
    const repository = await createRepository();
    const originalRoot = repository.rootPath;
    const parent = path.dirname(originalRoot);
    const movedRoot = path.join(parent, 'moved-root');
    const replacement = path.join(parent, 'replacement');
    renameSync(originalRoot, movedRoot);
    mkdirSync(replacement);

    try {
      symlinkSync(
        replacement,
        originalRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      renameSync(movedRoot, originalRoot);
      return;
    }

    await expect(repository.listChildren(null)).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('rolls back only content it created when index persistence fails', async () => {
    const repository = await createRepository();
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    rmSync(indexPath);
    mkdirSync(indexPath);

    await expect(
      repository.createMarkdownPage(null, 'Rollback'),
    ).rejects.toMatchObject({ code: 'invalid-format' });
    expect(existsSync(path.join(repository.rootPath, 'Rollback.md'))).toBe(false);
  });

  it('does not replace an existing empty folder during a raced move', async () => {
    const repository = await createRepository();
    const source = path.join(repository.rootPath, 'Origem');
    const destination = path.join(repository.rootPath, 'Destino');
    mkdirSync(source);
    writeFileSync(path.join(source, 'conteudo.bin'), 'preservar');
    mkdirSync(destination);
    const fileSystem = new ProjectFileSystem(repository.rootPath);

    await expect(
      fileSystem.moveWithoutOverwrite(source, destination, 'folder'),
    ).rejects.toMatchObject({ code: 'collision' });
    expect(readFileSync(path.join(source, 'conteudo.bin'), 'utf8')).toBe(
      'preservar',
    );
    expect(existsSync(path.join(destination, 'conteudo.bin'))).toBe(false);
  });

  it('renames case-only aliases without overwriting a distinct destination', async () => {
    const repository = await createRepository();
    const source = path.join(repository.rootPath, 'Case.md');
    const destination = path.join(repository.rootPath, 'case.md');
    const fileSystem = new ProjectFileSystem(repository.rootPath);
    writeFileSync(source, 'source', { flag: 'wx' });

    let caseSensitive = false;
    try {
      writeFileSync(destination, 'destination', { flag: 'wx' });
      caseSensitive = true;
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('EEXIST');
    }

    if (caseSensitive) {
      await expect(
        fileSystem.moveWithoutOverwrite(source, destination, 'page'),
      ).rejects.toMatchObject({ code: 'collision' });
      expect(readFileSync(source, 'utf8')).toBe('source');
      expect(readFileSync(destination, 'utf8')).toBe('destination');
      return;
    }

    await fileSystem.moveWithoutOverwrite(source, destination, 'page');
    expect(readFileSync(destination, 'utf8')).toBe('source');
  });

  it('does not remove a pre-existing directory when creation collides', async () => {
    const parent = createTemporaryDirectory();
    const root = path.join(parent, 'Existente');
    writeFileSync(path.join(parent, 'sentinel'), 'keep');
    const existing = ProjectRepository.create(root, 'Existente');
    await existing;

    await expect(
      ProjectRepository.create(root, 'Existente'),
    ).rejects.toMatchObject({ code: 'collision' });
    expect(existsSync(root)).toBe(true);
    expect(readFileSync(path.join(parent, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('removes only the root owned by a failed creation attempt', async () => {
    const parent = createTemporaryDirectory();
    const root = path.join(parent, 'Falha');
    const sentinel = path.join(parent, 'sentinel');
    writeFileSync(sentinel, 'keep');

    await expect(
      ProjectRepository.create(root, 'Falha', {
        createId: () => {
          throw new Error('identifier unavailable');
        },
      }),
    ).rejects.toMatchObject({ code: 'io-error' });
    expect(existsSync(root)).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
  });
});
