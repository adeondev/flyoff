import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type {
  MediaAsset,
  MediaFolder,
  MediaGalleryEntryRef,
  MediaGallerySnapshot,
  ProjectMediaKind,
} from '../../shared/contracts/media';
import { ProjectOperationError, normalizeProjectError } from './errors';
import { inspectMediaFile } from './media-metadata';
import { writeJsonAtomically } from './persistence';
import {
  PROJECT_MEDIA_DIRECTORY,
  PROJECT_MEDIA_INDEX_FILENAME,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';
import { assertPortableProjectName } from './portable-name';
import type { TrashItem } from './project-repository';

const FORMAT = 'flyoff-media-index' as const;
const VERSION = 2 as const;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MediaIndex {
  format: typeof FORMAT;
  version: typeof VERSION;
  projectId: string;
  migrations: {
    recoveredRootDissolved: boolean;
  };
  folders: MediaFolder[];
  assets: MediaAsset[];
}

export interface MediaImportProgress {
  completed: number;
  currentName: string;
  failed: number;
  total: number;
}

export interface MediaStoreOptions {
  createId?: () => string;
  now?: () => Date;
  trashItem?: TrashItem;
}

export interface LegacyMediaEntry {
  assetId: string;
  absolutePath: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isFolder(value: unknown): value is MediaFolder {
  return (
    isRecord(value) &&
    typeof value.folderId === 'string' &&
    UUID.test(value.folderId) &&
    (value.parentId === null ||
      (typeof value.parentId === 'string' && UUID.test(value.parentId))) &&
    typeof value.name === 'string' &&
    isIso(value.createdAt) &&
    isIso(value.modifiedAt) &&
    Number.isSafeInteger(value.sortOrder) &&
    Number(value.sortOrder) >= 0
  );
}

function isAsset(value: unknown): value is MediaAsset {
  return (
    isRecord(value) &&
    typeof value.assetId === 'string' &&
    UUID.test(value.assetId) &&
    (value.folderId === null ||
      (typeof value.folderId === 'string' && UUID.test(value.folderId))) &&
    typeof value.name === 'string' &&
    typeof value.extension === 'string' &&
    (value.kind === 'image' ||
      value.kind === 'video' ||
      value.kind === 'audio') &&
    typeof value.mimeType === 'string' &&
    Number.isSafeInteger(value.sizeBytes) &&
    Number(value.sizeBytes) >= 0 &&
    ((value.pixelWidth === null && value.pixelHeight === null) ||
      (Number.isSafeInteger(value.pixelWidth) &&
        Number(value.pixelWidth) > 0 &&
        Number.isSafeInteger(value.pixelHeight) &&
        Number(value.pixelHeight) > 0)) &&
    isIso(value.createdAt) &&
    isIso(value.modifiedAt) &&
    typeof value.revision === 'string' &&
    /^[0-9a-f]{64}$/i.test(value.revision) &&
    typeof value.relativePath === 'string'
  );
}

function parseIndex(value: unknown, projectId: string): MediaIndex | undefined {
  if (
    !isRecord(value) ||
    value.format !== FORMAT ||
    (value.version !== 1 && value.version !== VERSION) ||
    value.projectId !== projectId ||
    !Array.isArray(value.folders) ||
    !value.folders.every(isFolder) ||
    !Array.isArray(value.assets) ||
    !value.assets.every(isAsset)
  ) {
    return undefined;
  }
  const folders = value.folders as MediaFolder[];
  const assets = value.assets as MediaAsset[];
  const identifiers = new Set([
    ...folders.map(({ folderId }) => folderId),
    ...assets.map(({ assetId }) => assetId),
  ]);
  if (identifiers.size !== folders.length + assets.length) {
    return undefined;
  }
  const folderIds = new Set(folders.map(({ folderId }) => folderId));
  if (
    folders.some(
      ({ folderId, parentId }) =>
        parentId !== null &&
        (!folderIds.has(parentId) || parentId === folderId),
    ) ||
    assets.some(
      ({ folderId }) => folderId !== null && !folderIds.has(folderId),
    )
  ) {
    return undefined;
  }
  for (const folder of folders) {
    const visited = new Set([folder.folderId]);
    let parentId = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        return undefined;
      }
      visited.add(parentId);
      parentId =
        folders.find(({ folderId }) => folderId === parentId)?.parentId ?? null;
    }
  }
  return {
    format: FORMAT,
    version: VERSION,
    projectId,
    migrations: {
      recoveredRootDissolved:
        value.version === VERSION &&
        isRecord(value.migrations) &&
        value.migrations.recoveredRootDissolved === true,
    },
    folders: folders.map((folder) => ({ ...folder })),
    assets: assets.map((asset) => ({ ...asset })),
  };
}

function snapshotRevision(index: MediaIndex): string {
  return createHash('sha256')
    .update(JSON.stringify(index))
    .digest('hex');
}

function collisionName(
  base: string,
  extension: string,
  existing: ReadonlySet<string>,
): string {
  let candidate = `${base}${extension}`;
  for (let suffix = 2; existing.has(candidate.toLocaleLowerCase()); suffix += 1) {
    candidate = `${base} (${suffix})${extension}`;
  }
  return candidate;
}

export class ProjectMediaStore {
  readonly rootPath: string;
  readonly projectId: string;

  private readonly mediaPath: string;
  private readonly indexPath: string;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly trashItem?: TrashItem;
  private readonly loadError?: ProjectOperationError;
  private index: MediaIndex;

  private constructor(
    rootPath: string,
    projectId: string,
    index: MediaIndex,
    options: MediaStoreOptions,
    loadError?: ProjectOperationError,
  ) {
    this.rootPath = rootPath;
    this.projectId = projectId;
    this.mediaPath = path.join(rootPath, PROJECT_MEDIA_DIRECTORY);
    this.indexPath = path.join(
      rootPath,
      PROJECT_METADATA_DIRECTORY,
      PROJECT_MEDIA_INDEX_FILENAME,
    );
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.trashItem = options.trashItem;
    this.loadError = loadError;
    this.index = index;
  }

  static async open(
    rootPath: string,
    projectId: string,
    options: MediaStoreOptions = {},
  ): Promise<ProjectMediaStore> {
    const indexPath = path.join(
      rootPath,
      PROJECT_METADATA_DIRECTORY,
      PROJECT_MEDIA_INDEX_FILENAME,
    );
    const bytes = await readFile(indexPath).catch(() => undefined);
    let index: MediaIndex;
    let loadError: ProjectOperationError | undefined;
    if (bytes) {
      if (bytes.byteLength > MAX_INDEX_BYTES) {
        loadError = new ProjectOperationError(
          'size-exceeded',
          'The media index exceeds the supported size limit.',
        );
      } else {
        let value: unknown;
        try {
          value = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          );
        } catch (error) {
          loadError = new ProjectOperationError(
            'invalid-format',
            'The media index is corrupted.',
            { cause: error },
          );
        }
        const parsed = loadError ? undefined : parseIndex(value, projectId);
        if (!parsed && !loadError) {
          loadError = new ProjectOperationError(
            'invalid-format',
            'The media index is corrupted.',
          );
        }
        index =
          parsed ?? {
            format: FORMAT,
            version: VERSION,
            projectId,
            migrations: { recoveredRootDissolved: true },
            folders: [],
            assets: [],
          };
      }
      index ??= {
        format: FORMAT,
        version: VERSION,
        projectId,
        migrations: { recoveredRootDissolved: true },
        folders: [],
        assets: [],
      };
    } else {
      index = {
        format: FORMAT,
        version: VERSION,
        projectId,
        migrations: { recoveredRootDissolved: true },
        folders: [],
        assets: [],
      };
    }
    const store = new ProjectMediaStore(
      rootPath,
      projectId,
      index,
      options,
      loadError,
    );
    await mkdir(store.mediaPath, { recursive: true });
    if (!bytes) {
      await store.persist();
    }
    if (!loadError) {
      await store.validateFiles();
      await store.dissolveRecoveredRoot();
    }
    return store;
  }

  snapshot(): MediaGallerySnapshot {
    this.assertAvailable();
    return {
      projectId: this.projectId,
      folders: this.index.folders.map((folder) => ({ ...folder })),
      assets: this.index.assets.map((asset) => ({ ...asset })),
      revision: snapshotRevision(this.index),
    };
  }

  getAsset(assetId: string): MediaAsset {
    this.assertAvailable();
    const asset = this.index.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) {
      throw new ProjectOperationError('not-found', 'The media asset was not found.');
    }
    return { ...asset };
  }

  resolveAssetPath(assetId: string): string {
    const asset = this.getAsset(assetId);
    const absolutePath = path.resolve(this.rootPath, ...asset.relativePath.split('/'));
    const relative = path.relative(this.mediaPath, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'The media asset resolves outside the media library.',
      );
    }
    return absolutePath;
  }

  async resolveReadableAssetPath(assetId: string): Promise<string> {
    const absolutePath = this.resolveAssetPath(assetId);
    const [root, resolved] = await Promise.all([
      realpath(this.mediaPath),
      realpath(absolutePath),
    ]).catch((error: unknown) => {
      throw normalizeProjectError(error);
    });
    const relative = path.relative(root, resolved);
    const stats = await lstat(absolutePath).catch((error: unknown) => {
      throw normalizeProjectError(error);
    });
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    ) {
      throw new ProjectOperationError(
        'unsafe-path',
        'The media asset resolves outside the media library.',
      );
    }
    return resolved;
  }

  async createFolder(
    parentId: string | null,
    name: string,
    expectedRevision?: string,
  ): Promise<MediaFolder> {
    this.assertAvailable();
    this.assertRevision(expectedRevision);
    assertPortableProjectName(name);
    const parentPath = await this.resolveReadableFolderPath(parentId);
    this.requireAvailableName(parentId, name, 'folder');
    const now = this.now().toISOString();
    const folder: MediaFolder = {
      folderId: this.createId(),
      parentId,
      name,
      createdAt: now,
      modifiedAt: now,
      sortOrder: this.index.folders.filter((entry) => entry.parentId === parentId).length,
    };
    const absolutePath = path.join(parentPath, name);
    await mkdir(absolutePath);
    this.index.folders.push(folder);
    try {
      await this.persist();
    } catch (error) {
      this.index.folders = this.index.folders.filter(
        ({ folderId }) => folderId !== folder.folderId,
      );
      await rm(absolutePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { ...folder };
  }

  async createFolderWithEntries(
    parentId: string | null,
    name: string,
    entries: readonly MediaGalleryEntryRef[],
    expectedRevision?: string,
  ): Promise<MediaFolder> {
    this.assertAvailable();
    this.assertRevision(expectedRevision);
    assertPortableProjectName(name);
    const parentPath = await this.resolveReadableFolderPath(parentId);
    this.requireAvailableName(parentId, name, 'folder');
    const now = this.now().toISOString();
    const folder: MediaFolder = {
      folderId: this.createId(),
      parentId,
      name,
      createdAt: now,
      modifiedAt: now,
      sortOrder: this.index.folders.filter(
        (entry) => entry.parentId === parentId,
      ).length,
    };
    const absolutePath = path.join(parentPath, name);
    await mkdir(absolutePath);
    this.index.folders.push(folder);
    try {
      await this.moveEntries(entries, folder.folderId);
      return { ...folder };
    } catch (error) {
      this.index.folders = this.index.folders.filter(
        ({ folderId }) => folderId !== folder.folderId,
      );
      await rm(absolutePath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async importPaths(
    paths: readonly string[],
    folderId: string | null,
    onProgress?: (progress: MediaImportProgress) => void,
    signal?: AbortSignal,
  ): Promise<readonly MediaAsset[]> {
    this.assertAvailable();
    const destination = await this.resolveReadableFolderPath(folderId);
    const imported: MediaAsset[] = [];
    let failed = 0;
    for (const sourcePath of paths) {
      if (signal?.aborted) {
        break;
      }
      const currentName = path.basename(sourcePath);
      onProgress?.({
        completed: imported.length,
        currentName,
        failed,
        total: paths.length,
      });
      let temporaryPath: string | undefined;
      try {
        const metadata = await inspectMediaFile(sourcePath);
        if (metadata.kind !== 'image') {
          throw new ProjectOperationError(
            'invalid-format',
            'The gallery currently accepts image files only.',
          );
        }
        const base = path.basename(sourcePath, path.extname(sourcePath));
        assertPortableProjectName(base);
        const existing = new Set(
          this.index.assets
            .filter((asset) => asset.folderId === folderId)
            .map((asset) => `${asset.name}${asset.extension}`.toLocaleLowerCase()),
        );
        const diskName = collisionName(base, metadata.extension, existing);
        const name = diskName.slice(0, -metadata.extension.length);
        temporaryPath = path.join(
          destination,
          `.flyoff-import-${this.createId()}.tmp${metadata.extension}`,
        );
        const absolutePath = path.join(destination, diskName);
        await pipeline(
          createReadStream(sourcePath),
          createWriteStream(temporaryPath, { flags: 'wx' }),
          { signal },
        );
        if (signal?.aborted) {
          await rm(temporaryPath, { force: true });
          break;
        }
        const copied = await inspectMediaFile(temporaryPath);
        if (copied.revision !== metadata.revision) {
          await rm(temporaryPath, { force: true });
          throw new ProjectOperationError(
            'conflict',
            'The image changed while it was being imported.',
          );
        }
        await rename(temporaryPath, absolutePath);
        temporaryPath = undefined;
        const timestamp = this.now().toISOString();
        const asset: MediaAsset = {
          assetId: this.createId(),
          folderId,
          name,
          extension: metadata.extension,
          kind: metadata.kind,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          pixelWidth: metadata.pixelWidth,
          pixelHeight: metadata.pixelHeight,
          createdAt: timestamp,
          modifiedAt: timestamp,
          revision: metadata.revision,
          relativePath: this.relativePath(absolutePath),
        };
        this.index.assets.push(asset);
        try {
          await this.persist();
          imported.push({ ...asset });
        } catch (error) {
          this.index.assets = this.index.assets.filter(
            ({ assetId }) => assetId !== asset.assetId,
          );
          await rm(absolutePath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (temporaryPath) {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
        if (signal?.aborted) {
          break;
        }
        failed += 1;
        if (paths.length === 1) {
          throw error;
        }
      }
    }
    onProgress?.({
      completed: imported.length,
      currentName: '',
      failed,
      total: paths.length,
    });
    if (imported.length === 0 && !signal?.aborted) {
      throw new ProjectOperationError(
        'invalid-format',
        'No supported image could be imported.',
      );
    }
    return imported;
  }

  async migrateLegacy(entries: readonly LegacyMediaEntry[]): Promise<readonly string[]> {
    this.assertAvailable();
    if (entries.length === 0) {
      return [];
    }
    const migrated: string[] = [];
    for (const entry of entries) {
      if (this.index.assets.some(({ assetId }) => assetId === entry.assetId)) {
        migrated.push(entry.assetId);
        continue;
      }
      const metadata = await inspectMediaFile(entry.absolutePath);
      const destination = await this.resolveReadableFolderPath(null);
      const existing = new Set(
        this.index.assets
          .filter(({ folderId }) => folderId === null)
          .map((asset) => `${asset.name}${asset.extension}`.toLocaleLowerCase()),
      );
      const diskName = collisionName(entry.name, metadata.extension, existing);
      const name = diskName.slice(0, -metadata.extension.length);
      const absolutePath = path.join(destination, diskName);
      await copyFile(entry.absolutePath, absolutePath);
      const timestamp = this.now().toISOString();
      this.index.assets.push({
        assetId: entry.assetId,
        folderId: null,
        name,
        extension: metadata.extension,
        kind: metadata.kind,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        pixelWidth: metadata.pixelWidth,
        pixelHeight: metadata.pixelHeight,
        createdAt: timestamp,
        modifiedAt: timestamp,
        revision: metadata.revision,
        relativePath: this.relativePath(absolutePath),
      });
      try {
        await this.persist();
        migrated.push(entry.assetId);
      } catch (error) {
        this.index.assets = this.index.assets.filter(
          ({ assetId }) => assetId !== entry.assetId,
        );
        await rm(absolutePath, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    return migrated;
  }

  private async dissolveRecoveredRoot(): Promise<void> {
    if (this.index.migrations.recoveredRootDissolved) {
      return;
    }
    const recovered = this.index.folders.find(
      ({ parentId, name }) => parentId === null && name === 'Recuperados',
    );
    if (!recovered) {
      this.index.migrations.recoveredRootDissolved = true;
      await this.persist();
      return;
    }
    const previous = structuredClone(this.index);
    const existing = new Set(
      [
        ...this.index.folders
          .filter(
            ({ folderId, parentId }) =>
              parentId === null && folderId !== recovered.folderId,
          )
          .map(({ name }) => name),
        ...this.index.assets
          .filter(({ folderId }) => folderId === null)
          .map(({ name, extension }) => `${name}${extension}`),
      ].map((name) => name.toLocaleLowerCase()),
    );
    const moves: {
      currentPath: string;
      nextPath: string;
      apply: () => void;
    }[] = [];
    const destination = await this.resolveReadableFolderPath(null);
    for (const folder of this.index.folders.filter(
      ({ parentId }) => parentId === recovered.folderId,
    )) {
      const nextName = collisionName(folder.name, '', existing);
      existing.add(nextName.toLocaleLowerCase());
      moves.push({
        currentPath: await this.resolveReadableFolderPath(folder.folderId),
        nextPath: path.join(destination, nextName),
        apply: () => {
          folder.name = nextName;
          folder.parentId = null;
          folder.modifiedAt = this.now().toISOString();
        },
      });
    }
    for (const asset of this.index.assets.filter(
      ({ folderId }) => folderId === recovered.folderId,
    )) {
      const nextFilename = collisionName(
        asset.name,
        asset.extension,
        existing,
      );
      existing.add(nextFilename.toLocaleLowerCase());
      moves.push({
        currentPath: await this.resolveReadableAssetPath(asset.assetId),
        nextPath: path.join(destination, nextFilename),
        apply: () => {
          asset.name = nextFilename.slice(0, -asset.extension.length);
          asset.folderId = null;
          asset.relativePath = this.relativePath(
            path.join(destination, nextFilename),
          );
          asset.modifiedAt = this.now().toISOString();
        },
      });
    }
    const completedMoves: typeof moves = [];
    try {
      for (const move of moves) {
        await rename(move.currentPath, move.nextPath);
        completedMoves.push(move);
        move.apply();
      }
      await rmdir(await this.resolveReadableFolderPath(recovered.folderId));
      this.index.folders = this.index.folders.filter(
        ({ folderId }) => folderId !== recovered.folderId,
      );
      this.refreshRelativePaths();
      this.index.migrations.recoveredRootDissolved = true;
      await this.persist();
    } catch (error) {
      this.index = previous;
      await mkdir(
        await this.resolveReadableFolderPath(recovered.folderId),
        { recursive: true },
      ).catch(() => undefined);
      for (const move of completedMoves.reverse()) {
        await rename(move.nextPath, move.currentPath).catch(() => undefined);
      }
      throw normalizeProjectError(
        error,
        'Recovered media could not be reorganized safely.',
      );
    }
  }

  async renameEntry(
    kind: 'folder' | 'asset',
    entryId: string,
    name: string,
    expectedRevision?: string,
  ): Promise<MediaFolder | MediaAsset> {
    this.assertAvailable();
    this.assertRevision(expectedRevision);
    assertPortableProjectName(name);
    if (kind === 'folder') {
      const folder = this.requireFolder(entryId);
      this.requireAvailableName(folder.parentId, name, 'folder', folder.folderId);
      const currentPath = await this.resolveReadableFolderPath(
        folder.folderId,
      );
      const nextPath = path.join(path.dirname(currentPath), name);
      const previous = { ...folder };
      await rename(currentPath, nextPath);
      folder.name = name;
      folder.modifiedAt = this.now().toISOString();
      this.refreshRelativePaths();
      try {
        await this.persist();
      } catch (error) {
        Object.assign(folder, previous);
        this.refreshRelativePaths();
        await rename(nextPath, currentPath).catch(() => undefined);
        throw error;
      }
      return { ...folder };
    }
    const asset = this.requireAsset(entryId);
    this.requireAvailableName(asset.folderId, name, 'asset', asset.assetId);
    const currentPath = await this.resolveReadableAssetPath(asset.assetId);
    const nextPath = path.join(path.dirname(currentPath), `${name}${asset.extension}`);
    const previous = { ...asset };
    await rename(currentPath, nextPath);
    asset.name = name;
    asset.modifiedAt = this.now().toISOString();
    asset.relativePath = this.relativePath(nextPath);
    try {
      await this.persist();
    } catch (error) {
      Object.assign(asset, previous);
      await rename(nextPath, currentPath).catch(() => undefined);
      throw error;
    }
    return { ...asset };
  }

  async moveEntries(
    entries: readonly MediaGalleryEntryRef[],
    parentId: string | null,
    expectedRevision?: string,
  ): Promise<void> {
    this.assertAvailable();
    this.assertRevision(expectedRevision);
    const destination = await this.resolveReadableFolderPath(parentId);
    const roots = this.normalizeEntryRoots(entries);
    const previous = structuredClone(this.index);
    const moves: {
      currentPath: string;
      entry: MediaGalleryEntryRef;
      nextPath: string;
    }[] = [];
    const selectedNames = new Set<string>();

    for (const entry of roots) {
      if (entry.kind === 'folder') {
        const folder = this.requireFolder(entry.entryId);
        if (folder.parentId === parentId) {
          continue;
        }
        if (this.isFolderDescendant(parentId, folder.folderId)) {
          throw new ProjectOperationError(
            'invalid-operation',
            'A media folder cannot be moved into itself.',
          );
        }
        this.requireAvailableName(
          parentId,
          folder.name,
          'folder',
          folder.folderId,
        );
        const normalizedName = folder.name.toLocaleLowerCase();
        if (selectedNames.has(normalizedName)) {
          throw new ProjectOperationError(
            'collision',
            'Selected media entries have conflicting names.',
          );
        }
        selectedNames.add(normalizedName);
        moves.push({
          currentPath: await this.resolveReadableFolderPath(folder.folderId),
          entry,
          nextPath: path.join(destination, folder.name),
        });
      } else {
        const asset = this.requireAsset(entry.entryId);
        if (asset.folderId === parentId) {
          continue;
        }
        this.requireAvailableName(
          parentId,
          asset.name,
          'asset',
          asset.assetId,
        );
        const filename = `${asset.name}${asset.extension}`;
        const normalizedName = filename.toLocaleLowerCase();
        if (selectedNames.has(normalizedName)) {
          throw new ProjectOperationError(
            'collision',
            'Selected media entries have conflicting names.',
          );
        }
        selectedNames.add(normalizedName);
        moves.push({
          currentPath: await this.resolveReadableAssetPath(asset.assetId),
          entry,
          nextPath: path.join(destination, filename),
        });
      }
    }
    if (moves.length === 0) {
      return;
    }
    try {
      for (const move of moves) {
        await rename(move.currentPath, move.nextPath);
        if (move.entry.kind === 'folder') {
          const folder = this.requireFolder(move.entry.entryId);
          folder.parentId = parentId;
          folder.modifiedAt = this.now().toISOString();
        } else {
          const asset = this.requireAsset(move.entry.entryId);
          asset.folderId = parentId;
          asset.relativePath = this.relativePath(move.nextPath);
          asset.modifiedAt = this.now().toISOString();
        }
      }
      this.refreshRelativePaths();
      await this.persist();
    } catch (error) {
      this.index = previous;
      for (const move of moves.reverse()) {
        await rename(move.nextPath, move.currentPath).catch(() => undefined);
      }
      throw normalizeProjectError(error);
    }
  }

  async trashEntries(
    entries: readonly MediaGalleryEntryRef[],
    expectedRevision?: string,
  ): Promise<void> {
    this.assertAvailable();
    this.assertRevision(expectedRevision);
    const roots = this.normalizeEntryRoots(entries);
    const targets = await Promise.all(
      roots.map((entry) =>
        entry.kind === 'folder'
          ? this.resolveReadableFolderPath(
              this.requireFolder(entry.entryId).folderId,
            )
          : this.resolveReadableAssetPath(
              this.requireAsset(entry.entryId).assetId,
            ),
      ),
    );
    const stagedRoot = path.join(
      this.rootPath,
      PROJECT_METADATA_DIRECTORY,
      `media-trash-${this.createId()}`,
    );
    await mkdir(stagedRoot);
    const previous = structuredClone(this.index);
    try {
      for (const [index, target] of targets.entries()) {
        await rename(target, path.join(stagedRoot, String(index)));
      }
      const removedFolders = new Set<string>();
      const removedAssets = new Set<string>();
      for (const entry of roots) {
        if (entry.kind === 'folder') {
          removedFolders.add(entry.entryId);
          for (const folder of this.index.folders) {
            if (this.isFolderDescendant(folder.folderId, entry.entryId)) {
              removedFolders.add(folder.folderId);
            }
          }
        } else {
          removedAssets.add(entry.entryId);
        }
      }
      this.index.folders = this.index.folders.filter(
        ({ folderId }) => !removedFolders.has(folderId),
      );
      this.index.assets = this.index.assets.filter(
        ({ assetId, folderId }) =>
          !removedAssets.has(assetId) &&
          (folderId === null || !removedFolders.has(folderId)),
      );
      await this.persist();
    } catch (error) {
      this.index = previous;
      for (const [index, target] of targets.entries()) {
        await rename(path.join(stagedRoot, String(index)), target).catch(() => undefined);
      }
      await rm(stagedRoot, { recursive: true, force: true });
      throw normalizeProjectError(error);
    }
    if (this.trashItem) {
      await this.trashItem(stagedRoot).catch(() =>
        rm(stagedRoot, { recursive: true, force: true }),
      );
    } else {
      await rm(stagedRoot, { recursive: true, force: true });
    }
  }

  private assertRevision(expectedRevision?: string): void {
    if (
      expectedRevision !== undefined &&
      expectedRevision !== snapshotRevision(this.index)
    ) {
      throw new ProjectOperationError(
        'conflict',
        'The media library changed before the operation could be completed.',
        { currentRevision: snapshotRevision(this.index) },
      );
    }
  }

  private normalizeEntryRoots(
    entries: readonly MediaGalleryEntryRef[],
  ): readonly MediaGalleryEntryRef[] {
    const unique = new Map(
      entries.map((entry) => [`${entry.kind}:${entry.entryId}`, entry]),
    );
    const folderIds = new Set(
      [...unique.values()]
        .filter((entry) => entry.kind === 'folder')
        .map(({ entryId }) => entryId),
    );
    return [...unique.values()].filter((entry) => {
      if (entry.kind === 'folder') {
        this.requireFolder(entry.entryId);
        let parentId = this.requireFolder(entry.entryId).parentId;
        while (parentId) {
          if (folderIds.has(parentId)) {
            return false;
          }
          parentId = this.requireFolder(parentId).parentId;
        }
        return true;
      }
      const asset = this.requireAsset(entry.entryId);
      let parentId = asset.folderId;
      while (parentId) {
        if (folderIds.has(parentId)) {
          return false;
        }
        parentId = this.requireFolder(parentId).parentId;
      }
      return true;
    });
  }

  private requireFolder(folderId: string): MediaFolder {
    const folder = this.index.folders.find((candidate) => candidate.folderId === folderId);
    if (!folder) {
      throw new ProjectOperationError('not-found', 'The media folder was not found.');
    }
    return folder;
  }

  private assertAvailable(): void {
    if (this.loadError) {
      throw this.loadError;
    }
  }

  private requireAsset(assetId: string): MediaAsset {
    const asset = this.index.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) {
      throw new ProjectOperationError('not-found', 'The media asset was not found.');
    }
    return asset;
  }

  private folderPath(folderId: string | null): string {
    if (folderId === null) {
      return this.mediaPath;
    }
    const names: string[] = [];
    const visited = new Set<string>();
    let cursor: string | null = folderId;
    while (cursor) {
      if (visited.has(cursor)) {
        throw new ProjectOperationError('invalid-format', 'The media folder tree is cyclic.');
      }
      visited.add(cursor);
      const folder = this.requireFolder(cursor);
      names.unshift(folder.name);
      cursor = folder.parentId;
    }
    return path.join(this.mediaPath, ...names);
  }

  private async resolveReadableFolderPath(
    folderId: string | null,
  ): Promise<string> {
    const absolutePath = this.folderPath(folderId);
    const rootStats = await lstat(this.mediaPath).catch(
      (error: unknown) => {
        throw normalizeProjectError(error);
      },
    );
    const targetStats = await lstat(absolutePath).catch(
      (error: unknown) => {
        throw normalizeProjectError(error);
      },
    );
    const [root, resolved] = await Promise.all([
      realpath(this.mediaPath),
      realpath(absolutePath),
    ]);
    const relative = path.relative(root, resolved);
    if (
      rootStats.isSymbolicLink() ||
      !rootStats.isDirectory() ||
      targetStats.isSymbolicLink() ||
      !targetStats.isDirectory() ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    ) {
      throw new ProjectOperationError(
        'unsafe-path',
        'The media folder resolves outside the media library.',
      );
    }
    return resolved;
  }

  private relativePath(absolutePath: string): string {
    const relative = path.relative(this.rootPath, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'The media asset resolves outside the project.',
      );
    }
    return relative.split(path.sep).join('/');
  }

  private isFolderDescendant(
    candidateId: string | null,
    ancestorId: string,
  ): boolean {
    let cursor = candidateId;
    while (cursor) {
      if (cursor === ancestorId) {
        return true;
      }
      cursor = this.requireFolder(cursor).parentId;
    }
    return false;
  }

  private requireAvailableName(
    parentId: string | null,
    name: string,
    kind: 'folder' | 'asset',
    exceptId?: string,
  ): void {
    const collision =
      kind === 'folder'
        ? this.index.folders.some(
            (folder) =>
              folder.folderId !== exceptId &&
              folder.parentId === parentId &&
              folder.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
          )
        : this.index.assets.some(
            (asset) =>
              asset.assetId !== exceptId &&
              asset.folderId === parentId &&
              asset.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
          );
    if (collision) {
      throw new ProjectOperationError(
        'collision',
        'An item with this name already exists in the media folder.',
      );
    }
  }

  private refreshRelativePaths(): void {
    for (const asset of this.index.assets) {
      asset.relativePath = this.relativePath(
        path.join(
          this.folderPath(asset.folderId),
          `${asset.name}${asset.extension}`,
        ),
      );
    }
  }

  private async validateFiles(): Promise<void> {
    let changed = false;
    for (const asset of this.index.assets) {
      const absolutePath = this.resolveAssetPath(asset.assetId);
      const stats = await lstat(absolutePath).catch(() => undefined);
      if (!stats?.isFile() || stats.isSymbolicLink()) {
        continue;
      }
      if (stats.size !== asset.sizeBytes) {
        const metadata = await inspectMediaFile(absolutePath);
        asset.sizeBytes = metadata.sizeBytes;
        asset.pixelWidth = metadata.pixelWidth;
        asset.pixelHeight = metadata.pixelHeight;
        asset.modifiedAt = this.now().toISOString();
        asset.revision = metadata.revision;
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  private persist(): Promise<void> {
    return writeJsonAtomically(this.indexPath, this.index, MAX_INDEX_BYTES);
  }
}

export type { ProjectMediaKind };
