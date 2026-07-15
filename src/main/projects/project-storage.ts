import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  PROJECT_INDEX_FORMAT,
  PROJECT_INDEX_MAX_BYTES,
  PROJECT_INDEX_VERSION,
  PROJECT_MANIFEST_MAX_BYTES,
} from '../../shared/contracts/projects';
import { ProjectOperationError, normalizeProjectError } from './errors';
import { readBoundedJson, writeJsonAtomically } from './persistence';
import { assertPortableProjectName } from './portable-name';
import { ProjectFileSystem } from './project-filesystem';
import {
  isProjectManifest,
  parseProjectContentIndex,
  type ProjectContentIndex,
  type ProjectManifest,
} from './project-format';
import {
  PROJECT_DEFAULT_NOTES_DIRECTORY,
  PROJECT_INDEX_FILENAME,
  PROJECT_MANIFEST_FILENAME,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';

export interface ProjectStorageOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface ProjectStorage {
  rootPath: string;
  manifest: ProjectManifest;
  index?: ProjectContentIndex;
  createId: () => string;
}

interface CreatedRootIdentity {
  device: bigint;
  inode: bigint;
  birthtimeMs: bigint;
  ctimeMs: bigint;
}

function matchesCreatedRoot(
  stats: Awaited<ReturnType<typeof lstat>>,
  identity: CreatedRootIdentity,
): boolean {
  if (typeof stats.dev !== 'bigint' || typeof stats.ino !== 'bigint') {
    return false;
  }

  if (
    stats.dev !== 0n ||
    stats.ino !== 0n ||
    identity.device !== 0n ||
    identity.inode !== 0n
  ) {
    return stats.dev === identity.device && stats.ino === identity.inode;
  }

  return (
    stats.birthtimeMs === identity.birthtimeMs &&
    stats.ctimeMs === identity.ctimeMs
  );
}

async function rollbackCreatedRoot(
  rootPath: string,
  identity: CreatedRootIdentity | undefined,
): Promise<void> {
  if (!identity) {
    return;
  }

  const current = await lstat(rootPath, { bigint: true }).catch(() => undefined);
  if (!current || current.isSymbolicLink() || !matchesCreatedRoot(current, identity)) {
    return;
  }

  const rollbackPath = `${rootPath}.flyoff-rollback-${randomUUID()}`;
  try {
    await rename(rootPath, rollbackPath);
    const moved = await lstat(rollbackPath, { bigint: true });

    if (!moved.isSymbolicLink() && matchesCreatedRoot(moved, identity)) {
      await rm(rollbackPath, { recursive: true, force: true });
      return;
    }

    // A swapped root is left intact at the quarantine path; moving it back
    // could overwrite another entry created concurrently at the project path.
  } catch {
    // A root that can no longer be proven to be ours is deliberately preserved.
  }
}

export async function createProjectStorage(
  rootPath: string,
  name: string,
  options: ProjectStorageOptions,
): Promise<ProjectStorage & { index: ProjectContentIndex }> {
  assertPortableProjectName(name);

  if (!path.isAbsolute(rootPath) || path.basename(rootPath) !== name) {
    throw new ProjectOperationError(
      'unsafe-path',
      'The project must be created at an absolute path matching its name.',
    );
  }

  await ProjectFileSystem.validateCreationParent(path.dirname(rootPath));
  let createdRootIdentity: CreatedRootIdentity | undefined;

  try {
    await mkdir(rootPath);
    const createdRootStats = await lstat(rootPath, { bigint: true });
    createdRootIdentity = {
      device: createdRootStats.dev,
      inode: createdRootStats.ino,
      birthtimeMs: createdRootStats.birthtimeMs,
      ctimeMs: createdRootStats.ctimeMs,
    };

    const canonicalRoot = await ProjectFileSystem.canonicalProjectRoot(rootPath);
    const metadataPath = path.join(canonicalRoot, PROJECT_METADATA_DIRECTORY);
    const notesPath = path.join(
      canonicalRoot,
      PROJECT_DEFAULT_NOTES_DIRECTORY,
    );
    const createId = options.createId ?? randomUUID;
    const projectId = createId();
    const manifest: ProjectManifest = {
      format: PROJECT_FORMAT,
      formatVersion: PROJECT_FORMAT_VERSION,
      projectId,
      name,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    const index: ProjectContentIndex = {
      format: PROJECT_INDEX_FORMAT,
      formatVersion: PROJECT_INDEX_VERSION,
      projectId,
      entries: [
        {
          nodeId: createId(),
          parentId: null,
          name: PROJECT_DEFAULT_NOTES_DIRECTORY,
          kind: 'folder',
          locator: PROJECT_DEFAULT_NOTES_DIRECTORY,
        },
      ],
    };

    await mkdir(metadataPath);
    await mkdir(notesPath);
    const fileSystem = new ProjectFileSystem(canonicalRoot);
    await fileSystem.validateMetadataFileForWrite(PROJECT_MANIFEST_FILENAME);
    await writeJsonAtomically(
      path.join(metadataPath, PROJECT_MANIFEST_FILENAME),
      manifest,
      PROJECT_MANIFEST_MAX_BYTES,
    );
    await fileSystem.validateMetadataFileForWrite(PROJECT_INDEX_FILENAME);
    await writeJsonAtomically(
      path.join(metadataPath, PROJECT_INDEX_FILENAME),
      index,
      PROJECT_INDEX_MAX_BYTES,
    );

    return { rootPath: canonicalRoot, manifest, index, createId };
  } catch (error) {
    await rollbackCreatedRoot(rootPath, createdRootIdentity);

    throw normalizeProjectError(error, 'The project could not be created.');
  }
}

export async function openProjectStorage(
  rootPath: string,
  options: ProjectStorageOptions,
): Promise<ProjectStorage> {
  try {
    const canonicalRoot = await ProjectFileSystem.canonicalProjectRoot(rootPath);
    await ProjectFileSystem.validateMetadataDirectory(canonicalRoot);
    const metadataPath = path.join(canonicalRoot, PROJECT_METADATA_DIRECTORY);
    const rawManifest = await readManifest(
      path.join(metadataPath, PROJECT_MANIFEST_FILENAME),
      canonicalRoot,
    );
    const index = await readIndex(
      path.join(metadataPath, PROJECT_INDEX_FILENAME),
      rawManifest.projectId,
      canonicalRoot,
    );

    return {
      rootPath: canonicalRoot,
      manifest: rawManifest,
      index,
      createId: options.createId ?? randomUUID,
    };
  } catch (error) {
    throw normalizeProjectError(error, 'The project could not be opened.');
  }
}

async function readManifest(
  manifestPath: string,
  containmentRoot: string,
): Promise<ProjectManifest> {
  let rawManifest: unknown;

  try {
    rawManifest = await readBoundedJson(
      manifestPath,
      PROJECT_MANIFEST_MAX_BYTES,
      { containmentRoot },
    );
  } catch (error) {
    const normalized = normalizeProjectError(error);

    if (normalized.code === 'not-found') {
      throw new ProjectOperationError(
        'invalid-format',
        'The selected folder is not a Flyoff project.',
        { cause: error },
      );
    }

    throw normalized;
  }

  const manifestRecord =
    rawManifest && typeof rawManifest === 'object'
      ? (rawManifest as Record<string, unknown>)
      : undefined;

  if (
    manifestRecord?.format === PROJECT_FORMAT &&
    typeof manifestRecord.formatVersion === 'number' &&
    manifestRecord.formatVersion > PROJECT_FORMAT_VERSION
  ) {
    throw new ProjectOperationError(
      'incompatible-version',
      'This project was created by a newer version of Flyoff.',
    );
  }

  if (!isProjectManifest(rawManifest)) {
    throw new ProjectOperationError(
      'invalid-format',
      'The selected folder is not a valid Flyoff project.',
    );
  }

  return rawManifest;
}

async function readIndex(
  indexPath: string,
  projectId: string,
  containmentRoot: string,
): Promise<ProjectContentIndex | undefined> {
  try {
    return parseProjectContentIndex(
      await readBoundedJson(indexPath, PROJECT_INDEX_MAX_BYTES, {
        containmentRoot,
      }),
      projectId,
    );
  } catch (error) {
    const normalized = normalizeProjectError(error);

    if (
      normalized.code === 'not-found' ||
      normalized.code === 'invalid-format' ||
      normalized.code === 'size-exceeded'
    ) {
      return undefined;
    }

    throw normalized;
  }
}
