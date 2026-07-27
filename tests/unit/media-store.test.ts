import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRepository } from '../../src/main/projects';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-media-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writePng(absolutePath: string, width: number, height: number): void {
  const bytes = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    (width >>> 24) & 255,
    (width >>> 16) & 255,
    (width >>> 8) & 255,
    width & 255,
    (height >>> 24) & 255,
    (height >>> 16) & 255,
    (height >>> 8) & 255,
    height & 255,
  ]);
  writeFileSync(absolutePath, bytes);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectMediaStore', () => {
  it('keeps gallery folders outside the project tree and preserves IDs on move', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const source = path.join(root, 'Lua.png');
    writePng(source, 640, 360);
    const folder = await repository.media.createFolder(null, 'Fotos');
    const [asset] = await repository.media.importPaths(
      [source],
      folder.folderId,
    );

    expect(asset).toMatchObject({
      pixelWidth: 640,
      pixelHeight: 360,
      relativePath: 'Media/Fotos/Lua.png',
    });
    expect(
      (await repository.listChildren(null)).some(({ name }) => name === 'Media'),
    ).toBe(false);

    await repository.media.moveEntries(
      [{ entryId: asset!.assetId, kind: 'asset' }],
      null,
    );
    const moved = repository.media.getAsset(asset!.assetId);
    expect(moved.relativePath).toBe('Media/Lua.png');
    expect(existsSync(path.join(repository.rootPath, 'Media', 'Lua.png'))).toBe(
      true,
    );
  });

  it('resolves collisions without overwriting completed imports', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    mkdirSync(left);
    mkdirSync(right);
    writePng(path.join(left, 'Foto.png'), 20, 10);
    writePng(path.join(right, 'Foto.png'), 40, 20);

    const assets = await repository.media.importPaths(
      [path.join(left, 'Foto.png'), path.join(right, 'Foto.png')],
      null,
    );

    expect(assets.map(({ name }) => name)).toEqual(['Foto', 'Foto (2)']);
    expect(repository.media.snapshot().assets).toHaveLength(2);
  });

  it('moves mixed folder and asset selections atomically', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const source = await repository.media.createFolder(null, 'Origem');
    const destination = await repository.media.createFolder(null, 'Destino');
    const nested = await repository.media.createFolder(source.folderId, 'Álbum');
    const imagePath = path.join(root, 'Lua.png');
    writePng(imagePath, 320, 180);
    const [asset] = await repository.media.importPaths(
      [imagePath],
      source.folderId,
    );

    await repository.media.moveEntries(
      [
        { entryId: nested.folderId, kind: 'folder' },
        { entryId: asset!.assetId, kind: 'asset' },
      ],
      destination.folderId,
    );

    const snapshot = repository.media.snapshot();
    expect(
      snapshot.folders.find(({ folderId }) => folderId === nested.folderId)
        ?.parentId,
    ).toBe(destination.folderId);
    expect(repository.media.getAsset(asset!.assetId).folderId).toBe(
      destination.folderId,
    );
  });

  it('creates a folder with the current selection in one operation', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const imagePath = path.join(root, 'Lua.png');
    writePng(imagePath, 320, 180);
    const [asset] = await repository.media.importPaths([imagePath], null);

    const folder = await repository.media.createFolderWithEntries(
      null,
      'Missão',
      [{ entryId: asset!.assetId, kind: 'asset' }],
      repository.media.snapshot().revision,
    );

    expect(repository.media.getAsset(asset!.assetId).folderId).toBe(
      folder.folderId,
    );
    expect(
      existsSync(
        path.join(repository.rootPath, 'Media', 'Missão', 'Lua.png'),
      ),
    ).toBe(true);
  });

  it('dissolves the legacy Recuperados root once without changing asset IDs', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const recovered = await repository.media.createFolder(
      null,
      'Recuperados',
    );
    const imagePath = path.join(root, 'Lua.png');
    writePng(imagePath, 320, 180);
    const [asset] = await repository.media.importPaths(
      [imagePath],
      recovered.folderId,
    );
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'media-index.json',
    );
    const legacy = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<
      string,
      unknown
    >;
    legacy.version = 1;
    delete legacy.migrations;
    writeFileSync(indexPath, JSON.stringify(legacy), 'utf8');

    const reopened = await ProjectRepository.open(repository.rootPath);
    const snapshot = reopened.media.snapshot();

    expect(snapshot.folders.some(({ name }) => name === 'Recuperados')).toBe(
      false,
    );
    expect(reopened.media.getAsset(asset!.assetId)).toMatchObject({
      assetId: asset!.assetId,
      folderId: null,
      relativePath: 'Media/Lua.png',
    });
  });

  it('rolls the Recuperados migration back when the legacy folder is not empty', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const recovered = await repository.media.createFolder(
      null,
      'Recuperados',
    );
    const imagePath = path.join(root, 'Lua.png');
    writePng(imagePath, 320, 180);
    await repository.media.importPaths([imagePath], recovered.folderId);
    writeFileSync(
      path.join(repository.rootPath, 'Media', 'Recuperados', 'preservar.txt'),
      'não indexado',
      'utf8',
    );
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'media-index.json',
    );
    const legacy = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<
      string,
      unknown
    >;
    legacy.version = 1;
    delete legacy.migrations;
    writeFileSync(indexPath, JSON.stringify(legacy), 'utf8');

    await expect(ProjectRepository.open(repository.rootPath)).rejects.toThrow();
    expect(
      existsSync(
        path.join(repository.rootPath, 'Media', 'Recuperados', 'Lua.png'),
      ),
    ).toBe(true);
    expect(existsSync(path.join(repository.rootPath, 'Media', 'Lua.png'))).toBe(
      false,
    );
  });

  it('keeps the project available without overwriting a corrupted index', async () => {
    const root = temporaryDirectory();
    const repository = await ProjectRepository.create(
      path.join(root, 'Toca'),
      'Toca',
    );
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'media-index.json',
    );
    writeFileSync(indexPath, '{broken', 'utf8');

    const reopened = await ProjectRepository.open(repository.rootPath);

    expect(() => reopened.media.snapshot()).toThrow(/corrupted/i);
    expect(
      await reopened.listChildren(null),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Notas' })]));
  });
});
