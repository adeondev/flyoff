import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRepository } from '../../src/main/projects';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-appearance-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(): Promise<ProjectRepository> {
  const parent = createTemporaryDirectory();
  return ProjectRepository.create(path.join(parent, 'Meu Projeto'), 'Meu Projeto', {
    trashItem: (absolutePath) =>
      rm(absolutePath, { recursive: true, force: true }),
  });
}

function appearancePath(repository: ProjectRepository): string {
  return path.join(repository.rootPath, '.flyoff', 'appearance.json');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('project appearance', () => {
  it('starts empty and writes no sidecar', async () => {
    const repository = await createRepository();

    expect(await repository.getAppearance()).toEqual({
      projectSeed: null,
      noteSeeds: {},
    });
    expect(existsSync(appearancePath(repository))).toBe(false);
  });

  it('stores a note colour and normalizes it to uppercase', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');

    const snapshot = await repository.setNoteAppearance(note.nodeId, '#3568a4');

    expect(snapshot.noteSeeds[note.nodeId]).toBe('#3568A4');
    expect(
      JSON.parse(readFileSync(appearancePath(repository), 'utf8')),
    ).toMatchObject({
      format: 'flyoff-appearance',
      formatVersion: 1,
      nodes: [
        expect.objectContaining({
          nodeId: note.nodeId,
          locator: 'Planejamento.md',
          seed: '#3568A4',
        }),
      ],
    });
  });

  it('rejects folder colours', async () => {
    const repository = await createRepository();
    const folder = await repository.createFolder(null, 'Produto');
    const note = await repository.createPage(
      folder.nodeId,
      'Planejamento',
      'markdown',
    );

    await expect(
      repository.setNoteAppearance(folder.nodeId, '#26766E'),
    ).rejects.toMatchObject({ code: 'invalid-operation' });
    expect((await repository.getAppearance()).noteSeeds[note.nodeId]).toBeUndefined();
  });

  it('covers uncoloured nodes with the project seed', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');

    await repository.setProjectAppearance('#806421');
    const snapshot = await repository.getAppearance();

    expect(snapshot.projectSeed).toBe('#806421');
    expect(snapshot.noteSeeds[note.nodeId]).toBeUndefined();
  });

  it('keeps the colour through a rename and a move', async () => {
    const repository = await createRepository();
    const destination = await repository.createFolder(null, 'Arquivo');
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');

    await repository.renameNode(note.nodeId, 'Plano');
    await repository.moveNode(note.nodeId, destination.nodeId);

    const snapshot = await repository.getAppearance();
    expect(snapshot.noteSeeds[note.nodeId]).toBe('#3568A4');
  });

  it('does not hand a colour to a new item that reuses a freed path', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');
    await repository.renameNode(note.nodeId, 'Plano');

    const replacement = await repository.createPage(
      null,
      'Planejamento',
      'markdown',
    );

    const snapshot = await repository.getAppearance();
    expect(snapshot.noteSeeds[note.nodeId]).toBe('#3568A4');
    expect(snapshot.noteSeeds[replacement.nodeId]).toBeUndefined();
  });

  it('recovers colours by path when every identity was regenerated', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');

    rmSync(path.join(repository.rootPath, '.flyoff', 'content-index.json'));
    const rebuilt = await ProjectRepository.open(repository.rootPath);
    const [, rebuiltNote] = await rebuilt.listChildren(null);

    expect(rebuiltNote?.nodeId).not.toBe(note.nodeId);
    expect((await rebuilt.getAppearance()).noteSeeds).toEqual({
      [rebuiltNote!.nodeId]: '#3568A4',
    });
  });

  it('removes the sidecar once the last colour is cleared', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');

    await repository.setNoteAppearance(note.nodeId, null);

    expect(existsSync(appearancePath(repository))).toBe(false);
    expect((await repository.getAppearance()).noteSeeds).toEqual({});
  });

  it('rejects a colour for a node that does not exist', async () => {
    const repository = await createRepository();

    await expect(
      repository.setNoteAppearance(
        '00000000-0000-4000-8000-000000000000',
        '#3568A4',
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('falls back to the global accent when the sidecar is corrupt, leaving the tree intact', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');

    writeFileSync(appearancePath(repository), '{"format":"flyoff-app', 'utf8');
    const reopened = await ProjectRepository.open(repository.rootPath);

    expect(await reopened.getAppearance()).toEqual({
      projectSeed: null,
      noteSeeds: {},
    });
    expect(await reopened.listChildren(null)).toEqual([
      expect.objectContaining({ name: 'Notas', kind: 'folder' }),
      expect.objectContaining({ nodeId: note.nodeId, name: 'Planejamento' }),
    ]);
  });

  it('drops unknown entries without discarding the valid ones', async () => {
    const repository = await createRepository();
    const note = await repository.createPage(null, 'Planejamento', 'markdown');
    await repository.setNoteAppearance(note.nodeId, '#3568A4');

    const stored = JSON.parse(
      readFileSync(appearancePath(repository), 'utf8'),
    ) as { nodes: unknown[] };
    stored.nodes.push({ nodeId: 'not-a-uuid', locator: 'x.md', seed: 'red' });
    writeFileSync(
      appearancePath(repository),
      JSON.stringify(stored),
      'utf8',
    );

    const reopened = await ProjectRepository.open(repository.rootPath);
    expect((await reopened.getAppearance()).noteSeeds).toEqual({
      [note.nodeId]: '#3568A4',
    });
  });
});
