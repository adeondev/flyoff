import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as FileSystemPromises from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MARKDOWN_DOCUMENT_MAX_BYTES } from '../../src/shared/contracts';

const mockedFileSystem = vi.hoisted(() => ({
  afterStat: undefined as
    | { operation: () => void; targetPath: string }
    | undefined,
  beforeOpen: undefined as
    | ((filePath: string) => Promise<void> | void)
    | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemPromises>();

  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const openedPath = String(args[0]);
      await mockedFileSystem.beforeOpen?.(openedPath);
      const handle = await actual.open(...args);

      return new Proxy(handle, {
        get(target, property) {
          if (property === 'stat') {
            return async (...statArgs: Parameters<typeof target.stat>) => {
              const stats = await target.stat(...statArgs);
              const hook = mockedFileSystem.afterStat;

              if (
                hook &&
                path.resolve(openedPath) === path.resolve(hook.targetPath)
              ) {
                mockedFileSystem.afterStat = undefined;
                hook.operation();
              }

              return stats;
            };
          }

          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import { readBoundedFile } from '../../src/main/projects/persistence';
import { ProjectRepository } from '../../src/main/projects/project-repository';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-bounded-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runBeforeOpening(targetPath: string, operation: () => void): void {
  mockedFileSystem.beforeOpen = (filePath) => {
    if (path.resolve(filePath) !== path.resolve(targetPath)) {
      return;
    }

    mockedFileSystem.beforeOpen = undefined;
    operation();
  };
}

function runAfterHandleStat(targetPath: string, operation: () => void): void {
  mockedFileSystem.afterStat = { operation, targetPath };
}

afterEach(() => {
  mockedFileSystem.afterStat = undefined;
  mockedFileSystem.beforeOpen = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('bounded project reads', () => {
  it('accepts the exact limit and rejects growth between validation and open', async () => {
    const rootPath = createTemporaryDirectory();
    const filePath = path.join(rootPath, 'bounded.bin');
    writeFileSync(filePath, '1234');

    await expect(
      readBoundedFile(filePath, 4, { containmentRoot: rootPath }),
    ).resolves.toEqual(Buffer.from('1234'));

    runBeforeOpening(filePath, () => appendFileSync(filePath, '5'));

    await expect(
      readBoundedFile(filePath, 4, { containmentRoot: rootPath }),
    ).rejects.toMatchObject({ code: 'size-exceeded' });
  });

  it('stops at limit plus one when a file grows after its handle stat', async () => {
    const rootPath = createTemporaryDirectory();
    const filePath = path.join(rootPath, 'growing.bin');
    writeFileSync(filePath, '1234');
    runAfterHandleStat(filePath, () => appendFileSync(filePath, '5'));

    await expect(
      readBoundedFile(filePath, 4, { containmentRoot: rootPath }),
    ).rejects.toMatchObject({ code: 'size-exceeded' });
  });

  it('rejects a regular file replaced between path validation and open', async () => {
    const rootPath = createTemporaryDirectory();
    const filePath = path.join(rootPath, 'project.json');
    const replacementPath = path.join(rootPath, 'replacement.json');
    const originalPath = path.join(rootPath, 'original.json');
    writeFileSync(filePath, '{"source":"original"}');
    writeFileSync(replacementPath, '{"source":"replacement"}');

    runBeforeOpening(filePath, () => {
      renameSync(filePath, originalPath);
      renameSync(replacementPath, filePath);
    });

    await expect(
      readBoundedFile(filePath, 1_024, { containmentRoot: rootPath }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects an index replaced while a project is reopening', async () => {
    const parentPath = createTemporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(parentPath, 'Indexado'),
      'Indexado',
    );
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    const replacementPath = path.join(repository.rootPath, 'replacement.json');
    const originalPath = path.join(repository.rootPath, 'original-index.json');
    copyFileSync(indexPath, replacementPath);

    runBeforeOpening(indexPath, () => {
      renameSync(indexPath, originalPath);
      renameSync(replacementPath, indexPath);
    });

    await expect(ProjectRepository.open(repository.rootPath)).rejects.toMatchObject(
      { code: 'unsafe-path' },
    );
  });

  it('rejects a Markdown file replaced while it is being opened', async () => {
    const parentPath = createTemporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(parentPath, 'Markdown'),
      'Markdown',
    );
    const note = await repository.createMarkdownPage(null, 'Nota');
    const notePath = path.join(repository.rootPath, 'Nota.md');
    const replacementPath = path.join(repository.rootPath, 'replacement.md');
    const originalPath = path.join(repository.rootPath, 'original.md');
    writeFileSync(replacementPath, '# Replacement');

    runBeforeOpening(notePath, () => {
      renameSync(notePath, originalPath);
      renameSync(replacementPath, notePath);
    });

    await expect(repository.readMarkdown(note.nodeId)).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('bounds the second revision read and preserves an oversized external edit', async () => {
    const parentPath = createTemporaryDirectory();
    const projectPath = path.join(parentPath, 'Conflito');
    const notePath = path.join(projectPath, 'Nota.md');
    let replaceBeforeRevisionCheck = false;
    const repository = await ProjectRepository.create(
      projectPath,
      'Conflito',
      {
        createId: () => {
          if (replaceBeforeRevisionCheck) {
            replaceBeforeRevisionCheck = false;
            writeFileSync(
              notePath,
              Buffer.alloc(MARKDOWN_DOCUMENT_MAX_BYTES + 1, 0x78),
            );
          }
          return randomUUID();
        },
      },
    );
    const note = await repository.createMarkdownPage(null, 'Nota');
    const initial = await repository.readMarkdown(note.nodeId);
    replaceBeforeRevisionCheck = true;

    await expect(
      repository.saveMarkdown(note.nodeId, '# Local\n', initial.revision),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(statSync(notePath).size).toBe(MARKDOWN_DOCUMENT_MAX_BYTES + 1);
    expect(
      readdirSync(repository.rootPath).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });
});
