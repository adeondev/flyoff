import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  MARKDOWN_DOCUMENT_MAX_BYTES,
  PROJECT_INDEX_FORMAT,
  PROJECT_INDEX_MAX_BYTES,
  PROJECT_INDEX_VERSION,
  type MarkdownDocument,
  type ProjectSummary,
  type ProjectTreeNode,
} from '../../shared/contracts/projects';
import { ProjectOperationError, normalizeProjectError } from './errors';
import { assertPortableProjectName } from './portable-name';
import { ProjectFileSystem } from './project-filesystem';
import type { ProjectFileIdentity } from './project-filesystem';
import {
  toProjectTreeNode,
  type ContentIndexEntry,
  type ProjectContentIndex,
  type ProjectManifest,
} from './project-format';
import {
  PROJECT_INDEX_FILENAME,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';
import { readBoundedFile, writeJsonAtomically } from './persistence';
import { createProjectStorage, openProjectStorage } from './project-storage';

export type TrashItem = (absolutePath: string) => Promise<void>;

export interface ProjectRepositoryOptions {
  trashItem?: TrashItem;
  createId?: () => string;
  now?: () => Date;
}

function revisionFor(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function readMarkdownFile(
  absolutePath: string,
  containmentRoot: string,
): Promise<Buffer> {
  return readBoundedFile(absolutePath, MARKDOWN_DOCUMENT_MAX_BYTES, {
    containmentRoot,
    invalidTypeMessage: 'The Markdown document is not a regular file.',
    sizeExceededMessage:
      'The Markdown document exceeds the supported size limit.',
    unsafePathMessage:
      'The Markdown document changed or resolves through an unsafe path.',
  });
}

async function readMarkdownRevisionForSave(
  absolutePath: string,
  containmentRoot: string,
): Promise<string> {
  try {
    return revisionFor(await readMarkdownFile(absolutePath, containmentRoot));
  } catch (error) {
    const normalized = normalizeProjectError(error);

    if (normalized.code === 'size-exceeded') {
      throw new ProjectOperationError(
        'conflict',
        'The Markdown document changed on disk and now exceeds the supported size limit.',
        { cause: error },
      );
    }

    throw normalized;
  }
}

function cloneEntries(entries: readonly ContentIndexEntry[]): ContentIndexEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function diskNameFor(entry: ContentIndexEntry): string {
  return path.posix.basename(entry.locator);
}

function sortTreeNodes(left: ProjectTreeNode, right: ProjectTreeNode): number {
  if (left.kind !== right.kind) {
    return left.kind === 'folder' ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export class ProjectRepository {
  readonly rootPath: string;

  private index: ProjectContentIndex;
  private readonly manifest: ProjectManifest;
  private readonly trashItem?: TrashItem;
  private readonly createId: () => string;
  private readonly fileSystem: ProjectFileSystem;

  private constructor(
    rootPath: string,
    manifest: ProjectManifest,
    index: ProjectContentIndex,
    options: ProjectRepositoryOptions,
  ) {
    this.rootPath = rootPath;
    this.manifest = manifest;
    this.index = index;
    this.trashItem = options.trashItem;
    this.createId = options.createId ?? randomUUID;
    this.fileSystem = new ProjectFileSystem(rootPath);
  }

  static async create(
    rootPath: string,
    name: string,
    options: ProjectRepositoryOptions = {},
  ): Promise<ProjectRepository> {
    const storage = await createProjectStorage(rootPath, name, options);
    return new ProjectRepository(
      storage.rootPath,
      storage.manifest,
      storage.index,
      { ...options, createId: storage.createId },
    );
  }

  static async open(
    rootPath: string,
    options: ProjectRepositoryOptions = {},
  ): Promise<ProjectRepository> {
    const storage = await openProjectStorage(rootPath, options);
    const index = storage.index ?? {
      format: PROJECT_INDEX_FORMAT,
      formatVersion: PROJECT_INDEX_VERSION,
      projectId: storage.manifest.projectId,
      entries: [],
    };
    const repository = new ProjectRepository(
      storage.rootPath,
      storage.manifest,
      index,
      { ...options, createId: storage.createId },
    );

    if (!storage.index) {
      await repository.rebuildIndex();
    }

    return repository;
  }

  get summary(): ProjectSummary {
    return {
      projectId: this.manifest.projectId,
      name: this.manifest.name,
      location: this.rootPath,
      formatVersion: this.manifest.formatVersion,
    };
  }

  async getNode(nodeId: string): Promise<ProjectTreeNode> {
    const entry = this.requireEntry(nodeId);
    await this.fileSystem.resolveExistingEntry(entry);
    return toProjectTreeNode(entry);
  }

  async listChildren(parentId: string | null): Promise<readonly ProjectTreeNode[]> {
    const parent = this.requireFolder(parentId);
    await this.fileSystem.resolveParentDirectory(parent);

    const discovered = await this.fileSystem.scanChildren(parent);
    const previousEntries = cloneEntries(this.index.entries);
    const existingChildren = this.index.entries.filter(
      (entry) => entry.parentId === parentId,
    );
    const discoveredByLocator = new Map(
      discovered.map((node) => [node.locator, node]),
    );
    let changed = false;

    for (const existing of existingChildren) {
      const matchingNode = discoveredByLocator.get(existing.locator);

      if (!matchingNode || matchingNode.kind !== existing.kind) {
        this.removeEntryAndDescendants(existing.nodeId);
        changed = true;
      }
    }

    const entriesByLocator = new Map(
      this.index.entries.map((entry) => [entry.locator, entry]),
    );
    const children = discovered.map((node): ContentIndexEntry => {
      const existing = entriesByLocator.get(node.locator);

      if (existing && existing.kind === node.kind) {
        return existing;
      }

      changed = true;

      if (node.kind === 'folder') {
        const entry: ContentIndexEntry = {
          nodeId: this.createId(),
          parentId,
          name: node.name,
          locator: node.locator,
          kind: 'folder',
        };
        this.index.entries.push(entry);
        return entry;
      }

      const entry: ContentIndexEntry = {
        nodeId: this.createId(),
        parentId,
        name: node.name,
        locator: node.locator,
        kind: 'page',
        pageType: 'markdown',
      };
      this.index.entries.push(entry);
      return entry;
    });

    if (changed) {
      try {
        await this.persistIndex();
      } catch (error) {
        this.index.entries = previousEntries;
        throw error;
      }
    }

    return children.map(toProjectTreeNode).sort(sortTreeNodes);
  }

  async createFolder(
    parentId: string | null,
    name: string,
  ): Promise<ProjectTreeNode> {
    return this.createNode(parentId, name, 'folder');
  }

  async createMarkdownPage(
    parentId: string | null,
    name: string,
  ): Promise<ProjectTreeNode> {
    return this.createNode(parentId, name, 'page');
  }

  async renameNode(nodeId: string, name: string): Promise<ProjectTreeNode> {
    assertPortableProjectName(name);
    const entry = this.requireEntry(nodeId);

    if (entry.name === name) {
      await this.fileSystem.resolveExistingEntry(entry);
      return toProjectTreeNode(entry);
    }

    const oldAbsolutePath = await this.fileSystem.resolveExistingEntry(entry);
    const parent = this.requireFolder(entry.parentId);
    const parentPath = await this.fileSystem.resolveParentDirectory(parent);
    const nextDiskName = entry.kind === 'page' ? `${name}.md` : name;
    await this.fileSystem.ensureNameAvailable(parentPath, nextDiskName, path.basename(oldAbsolutePath));
    const nextLocator = this.fileSystem.joinLocator(parent?.locator, nextDiskName);
    const nextAbsolutePath = path.join(parentPath, nextDiskName);
    const previousEntries = cloneEntries(this.index.entries);
    let renamed = false;

    try {
      await this.fileSystem.moveWithoutOverwrite(
        oldAbsolutePath,
        nextAbsolutePath,
        entry.kind,
      );
      renamed = true;
      this.replaceEntryAndDescendantLocators(entry.nodeId, {
        name,
        locator: nextLocator,
      });
      await this.persistIndex();
      return await this.getNode(nodeId);
    } catch (error) {
      this.index.entries = previousEntries;

      if (renamed && (await this.fileSystem.pathExists(nextAbsolutePath))) {
        await this.fileSystem
          .moveWithoutOverwrite(nextAbsolutePath, oldAbsolutePath, entry.kind)
          .catch(() => undefined);
      }

      await this.persistIndex().catch(() => undefined);

      throw normalizeProjectError(error, 'The content could not be renamed.');
    }
  }

  async moveNode(
    nodeId: string,
    parentId: string | null,
  ): Promise<ProjectTreeNode> {
    const entry = this.requireEntry(nodeId);
    const nextParent = this.requireFolder(parentId);

    if (entry.parentId === parentId) {
      await this.fileSystem.resolveExistingEntry(entry);
      return toProjectTreeNode(entry);
    }

    if (
      entry.kind === 'folder' &&
      nextParent &&
      (nextParent.nodeId === entry.nodeId ||
        nextParent.locator.startsWith(`${entry.locator}/`))
    ) {
      throw new ProjectOperationError(
        'invalid-operation',
        'A folder cannot be moved into itself or one of its descendants.',
      );
    }

    const oldAbsolutePath = await this.fileSystem.resolveExistingEntry(entry);
    const nextParentPath = await this.fileSystem.resolveParentDirectory(nextParent);
    const diskName = diskNameFor(entry);
    await this.fileSystem.ensureNameAvailable(nextParentPath, diskName);
    const nextLocator = this.fileSystem.joinLocator(nextParent?.locator, diskName);
    const nextAbsolutePath = path.join(nextParentPath, diskName);
    const previousEntries = cloneEntries(this.index.entries);
    let renamed = false;

    try {
      await this.fileSystem.moveWithoutOverwrite(
        oldAbsolutePath,
        nextAbsolutePath,
        entry.kind,
      );
      renamed = true;
      this.replaceEntryAndDescendantLocators(entry.nodeId, {
        parentId,
        locator: nextLocator,
      });
      await this.persistIndex();
      return await this.getNode(nodeId);
    } catch (error) {
      this.index.entries = previousEntries;

      if (renamed && (await this.fileSystem.pathExists(nextAbsolutePath))) {
        await this.fileSystem
          .moveWithoutOverwrite(nextAbsolutePath, oldAbsolutePath, entry.kind)
          .catch(() => undefined);
      }

      await this.persistIndex().catch(() => undefined);

      throw normalizeProjectError(error, 'The content could not be moved.');
    }
  }

  async trashNode(nodeId: string): Promise<readonly string[]> {
    if (!this.trashItem) {
      throw new ProjectOperationError(
        'invalid-operation',
        'Moving project content to the trash is not available.',
      );
    }

    const entry = this.requireEntry(nodeId);
    const absolutePath = await this.fileSystem.resolveExistingEntry(entry);
    const previousEntries = cloneEntries(this.index.entries);
    const removedNodeIds = this.removeEntryAndDescendants(nodeId);

    try {
      await this.persistIndex();
    } catch (error) {
      this.index.entries = previousEntries;
      throw normalizeProjectError(error, 'The content index could not be updated.');
    }

    try {
      await this.trashItem(absolutePath);
    } catch (error) {
      this.index.entries = previousEntries;
      await this.persistIndex().catch(() => undefined);
      throw normalizeProjectError(error, 'The content could not be moved to the trash.');
    }

    return removedNodeIds;
  }

  async readMarkdown(nodeId: string): Promise<MarkdownDocument> {
    const entry = this.requireMarkdownEntry(nodeId);
    const absolutePath = await this.fileSystem.resolveExistingEntry(entry);

    try {
      const content = await readMarkdownFile(absolutePath, this.rootPath);

      let decoded: string;

      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch (error) {
        throw new ProjectOperationError(
          'invalid-format',
          'The Markdown document is not valid UTF-8.',
          { cause: error },
        );
      }

      return {
        nodeId,
        content: decoded,
        revision: revisionFor(content),
      };
    } catch (error) {
      throw normalizeProjectError(error, 'The Markdown document could not be read.');
    }
  }

  async saveMarkdown(
    nodeId: string,
    content: string,
    expectedRevision: string,
    force = false,
  ): Promise<MarkdownDocument> {
    const entry = this.requireMarkdownEntry(nodeId);
    const absolutePath = await this.fileSystem.resolveExistingEntry(entry);
    const encoded = Buffer.from(content, 'utf8');

    if (encoded.byteLength > MARKDOWN_DOCUMENT_MAX_BYTES) {
      throw new ProjectOperationError(
        'size-exceeded',
        'The Markdown document exceeds the supported size limit.',
      );
    }

    if (!force) {
      const currentRevision = await readMarkdownRevisionForSave(
        absolutePath,
        this.rootPath,
      );

      if (currentRevision !== expectedRevision) {
        throw new ProjectOperationError(
          'conflict',
          'The Markdown document changed on disk after it was opened.',
          { currentRevision },
        );
      }
    }

    const temporaryPath = path.join(
      path.dirname(absolutePath),
      `.${path.basename(absolutePath)}.${process.pid}.${this.createId()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, encoded, { flag: 'wx' });

      if (!force) {
        const latestRevision = await readMarkdownRevisionForSave(
          absolutePath,
          this.rootPath,
        );

        if (latestRevision !== expectedRevision) {
          throw new ProjectOperationError(
            'conflict',
            'The Markdown document changed on disk while it was being saved.',
            { currentRevision: latestRevision },
          );
        }
      }

      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw normalizeProjectError(error, 'The Markdown document could not be saved.');
    }

    return {
      nodeId,
      content,
      revision: revisionFor(encoded),
    };
  }

  private async rebuildIndex(): Promise<void> {
    this.index = {
      format: PROJECT_INDEX_FORMAT,
      formatVersion: PROJECT_INDEX_VERSION,
      projectId: this.manifest.projectId,
      entries: [],
    };

    const visit = async (parent: ContentIndexEntry | undefined): Promise<void> => {
      const discovered = await this.fileSystem.scanChildren(parent);

      for (const node of discovered) {
        const entry: ContentIndexEntry =
          node.kind === 'folder'
            ? {
                nodeId: this.createId(),
                parentId: parent?.nodeId ?? null,
                name: node.name,
                locator: node.locator,
                kind: 'folder',
              }
            : {
                nodeId: this.createId(),
                parentId: parent?.nodeId ?? null,
                name: node.name,
                locator: node.locator,
                kind: 'page',
                pageType: 'markdown',
              };

        this.index.entries.push(entry);

        if (entry.kind === 'folder') {
          await visit(entry);
        }
      }
    };

    await visit(undefined);
    await this.persistIndex();
  }

  private async createNode(
    parentId: string | null,
    name: string,
    kind: 'folder' | 'page',
  ): Promise<ProjectTreeNode> {
    assertPortableProjectName(name);
    const parent = this.requireFolder(parentId);
    const parentPath = await this.fileSystem.resolveParentDirectory(parent);
    const diskName = kind === 'page' ? `${name}.md` : name;
    await this.fileSystem.ensureNameAvailable(parentPath, diskName);
    const locator = this.fileSystem.joinLocator(parent?.locator, diskName);
    const absolutePath = path.join(parentPath, diskName);
    const entry: ContentIndexEntry =
      kind === 'folder'
        ? {
            nodeId: this.createId(),
            parentId,
            name,
            locator,
            kind: 'folder',
          }
        : {
            nodeId: this.createId(),
            parentId,
            name,
            locator,
            kind: 'page',
            pageType: 'markdown',
          };
    let createdIdentity: ProjectFileIdentity | undefined;

    try {
      if (kind === 'folder') {
        await mkdir(absolutePath);
      } else {
        await writeFile(absolutePath, '', { encoding: 'utf8', flag: 'wx' });
      }

      createdIdentity = await this.fileSystem.captureIdentity(absolutePath);
      this.index.entries.push(entry);
      await this.persistIndex();
      return toProjectTreeNode(entry);
    } catch (error) {
      this.index.entries = this.index.entries.filter(
        ({ nodeId }) => nodeId !== entry.nodeId,
      );
      if (createdIdentity) {
        await this.fileSystem
          .removeIfUnchanged(absolutePath, createdIdentity, kind)
          .catch(() => undefined);
      }
      throw normalizeProjectError(error, 'The project content could not be created.');
    }
  }

  private get indexFilePath(): string {
    return path.join(
      this.rootPath,
      PROJECT_METADATA_DIRECTORY,
      PROJECT_INDEX_FILENAME,
    );
  }

  private async persistIndex(): Promise<void> {
    await this.fileSystem.validateMetadataFileForWrite(PROJECT_INDEX_FILENAME);
    await writeJsonAtomically(
      this.indexFilePath,
      this.index,
      PROJECT_INDEX_MAX_BYTES,
    );
  }

  private requireEntry(nodeId: string): ContentIndexEntry {
    const entry = this.index.entries.find((candidate) => candidate.nodeId === nodeId);

    if (!entry) {
      throw new ProjectOperationError(
        'not-found',
        'The requested project content no longer exists.',
      );
    }

    return entry;
  }

  private requireFolder(parentId: string | null): ContentIndexEntry | undefined {
    if (parentId === null) {
      return undefined;
    }

    const entry = this.requireEntry(parentId);

    if (entry.kind !== 'folder') {
      throw new ProjectOperationError(
        'invalid-operation',
        'Content can only be created or moved into a folder.',
      );
    }

    return entry;
  }

  private requireMarkdownEntry(nodeId: string): ContentIndexEntry {
    const entry = this.requireEntry(nodeId);

    if (entry.kind !== 'page' || entry.pageType !== 'markdown') {
      throw new ProjectOperationError(
        'invalid-operation',
        'The selected content is not a Markdown document.',
      );
    }

    return entry;
  }

  private removeEntryAndDescendants(nodeId: string): string[] {
    const removed = new Set<string>([nodeId]);
    let changed = true;

    while (changed) {
      changed = false;

      for (const entry of this.index.entries) {
        if (entry.parentId && removed.has(entry.parentId) && !removed.has(entry.nodeId)) {
          removed.add(entry.nodeId);
          changed = true;
        }
      }
    }

    this.index.entries = this.index.entries.filter(
      ({ nodeId: candidate }) => !removed.has(candidate),
    );
    return [...removed];
  }

  private replaceEntryAndDescendantLocators(
    nodeId: string,
    change: Partial<Pick<ContentIndexEntry, 'name' | 'parentId' | 'locator'>>,
  ): void {
    const original = this.requireEntry(nodeId);
    const oldLocator = original.locator;
    const nextLocator = change.locator ?? oldLocator;

    this.index.entries = this.index.entries.map((entry) => {
      if (entry.nodeId === nodeId) {
        return { ...entry, ...change } as ContentIndexEntry;
      }

      if (entry.locator.startsWith(`${oldLocator}/`)) {
        return {
          ...entry,
          locator: `${nextLocator}${entry.locator.slice(oldLocator.length)}`,
        };
      }

      return entry;
    });
  }

}
