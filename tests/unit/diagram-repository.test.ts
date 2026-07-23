import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRepository } from '../../src/main/projects';
import { createDiagramDocument } from '../../src/shared/diagram';

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<ProjectRepository> {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'flyoff-diagrams-'));
  temporaryDirectories.push(parent);
  return ProjectRepository.create(path.join(parent, 'Project'), 'Project', {
    trashItem: (absolutePath) => rm(absolutePath, { recursive: true, force: true }),
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Diagram persistence', () => {
  it('creates .flyd pages and reads their validated SHA-256 revision', async () => {
    const repository = await createRepository();
    const document = createDiagramDocument('class');
    const page = await repository.createDiagramPage(null, 'Domain', document);
    const stored = await repository.readDiagram(page.nodeId);
    const diskPath = path.join(repository.rootPath, 'Domain.flyd');

    expect(readFileSync(diskPath, 'utf8')).toBe(`${JSON.stringify(document, null, 2)}\n`);
    expect(stored.document).toEqual(document);
    expect(stored.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('saves atomically with expectedRevision and detects external conflicts', async () => {
    const repository = await createRepository();
    const page = await repository.createDiagramPage(
      null,
      'Flow',
      createDiagramDocument('activity'),
    );
    const initial = await repository.readDiagram(page.nodeId);
    const next = {
      ...initial.document,
      settings: { ...initial.document.settings, showGrid: false },
    };
    const saved = await repository.saveDiagram({
      nodeId: page.nodeId,
      document: next,
      expectedRevision: initial.revision,
    });
    expect(saved.revision).not.toBe(initial.revision);

    writeFileSync(
      path.join(repository.rootPath, 'Flow.flyd'),
      `${JSON.stringify(initial.document, null, 2)}\n`,
      'utf8',
    );
    await expect(
      repository.saveDiagram({
        nodeId: page.nodeId,
        document: next,
        expectedRevision: saved.revision,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses malformed JSON and never accepts a non-diagram page', async () => {
    const repository = await createRepository();
    const page = await repository.createDiagramPage(
      null,
      'Broken',
      createDiagramDocument('sequence'),
    );
    writeFileSync(path.join(repository.rootPath, 'Broken.flyd'), '{bad', 'utf8');
    await expect(repository.readDiagram(page.nodeId)).rejects.toMatchObject({
      code: 'invalid-format',
    });

    const markdown = await repository.createMarkdownPage(null, 'Note');
    await expect(repository.readDiagram(markdown.nodeId)).rejects.toMatchObject({
      code: 'invalid-operation',
    });
  });

  it('prevents the generic page contract from creating empty diagram files', async () => {
    const repository = await createRepository();
    await expect(repository.createPage(null, 'Unsafe', 'diagram')).rejects.toMatchObject({
      code: 'invalid-operation',
    });
    expect(() => readFileSync(path.join(repository.rootPath, 'Unsafe.flyd'))).toThrow();
  });
});
