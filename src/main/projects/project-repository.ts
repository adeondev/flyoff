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
import {
  getProjectPageStorageAdapter,
  projectPageDiskName,
  requireProjectPageStorageAdapter,
} from './project-storage-adapters';

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

function compareEntryNames(
  left: Pick<ContentIndexEntry, 'name'>,
  right: Pick<ContentIndexEntry, 'name'>,
): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortEntries(entries: readonly ContentIndexEntry[]): ContentIndexEntry[] {
  const manual = entries.some((entry) => entry.sortOrder !== undefined);
  return [...entries].sort((left, right) => {
    if (manual) {
      const order =
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (order !== 0) {
        return order;
      }
    }
    return compareEntryNames(left, right);
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
    } else if (storage.indexNeedsMigration) {
      await repository.persistIndex();
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
      if (
        existing.kind === 'page' &&
        !getProjectPageStorageAdapter(existing.pageType)
      ) {
        try {
          await this.fileSystem.resolveExistingEntry(existing);
          continue;
        } catch (error) {
          if (normalizeProjectError(error).code !== 'not-found') {
            throw error;
          }
        }
      }
      const matchingNode = discoveredByLocator.get(existing.locator);

      if (
        !matchingNode ||
        matchingNode.kind !== existing.kind ||
        (existing.kind === 'page' &&
          matchingNode.pageType !== existing.pageType)
      ) {
        this.removeEntryAndDescendants(existing.nodeId);
        changed = true;
      }
    }

    const entriesByLocator = new Map(
      this.index.entries.map((entry) => [entry.locator, entry]),
    );
    for (const node of discovered) {
      const existing = entriesByLocator.get(node.locator);

      if (existing && existing.kind === node.kind) {
        continue;
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
        continue;
      }

      const entry: ContentIndexEntry = {
        nodeId: this.createId(),
        parentId,
        name: node.name,
        locator: node.locator,
        kind: 'page',
        pageType: node.pageType!,
      };
      this.index.entries.push(entry);
    }

    if (this.normalizeBranchOrder(parentId)) {
      changed = true;
    }

    if (changed) {
      try {
        await this.persistIndex();
      } catch (error) {
        this.index.entries = previousEntries;
        throw error;
      }
    }

    return this.childrenOf(parentId).map(toProjectTreeNode);
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
    return this.createPage(parentId, name, 'markdown');
  }

  async createPage(
    parentId: string | null,
    name: string,
    pageType: string,
  ): Promise<ProjectTreeNode> {
    requireProjectPageStorageAdapter(pageType);
    return this.createNode(parentId, name, 'page', pageType);
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
    const nextDiskName =
      entry.kind === 'page'
        ? projectPageDiskName(name, entry.pageType)
        : name;
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
    beforeNodeId?: string | null,
  ): Promise<ProjectTreeNode> {
    const entry = this.requireEntry(nodeId);
    const nextParent = this.requireFolder(parentId);
    const explicitPlacement = beforeNodeId !== undefined;
    const originalParentId = entry.parentId;

    if (entry.parentId === parentId && !explicitPlacement) {
      await this.fileSystem.resolveExistingEntry(entry);
      return toProjectTreeNode(entry);
    }

    if (beforeNodeId && beforeNodeId === nodeId) {
      throw new ProjectOperationError(
        'invalid-operation',
        'Content cannot be positioned relative to itself.',
      );
    }
    if (beforeNodeId) {
      const reference = this.requireEntry(beforeNodeId);
      if (reference.parentId !== parentId) {
        throw new ProjectOperationError(
          'invalid-operation',
          'The requested order reference is not in the destination folder.',
        );
      }
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
    const parentChanged = entry.parentId !== parentId;
    const nextParentPath = parentChanged
      ? await this.fileSystem.resolveParentDirectory(nextParent)
      : path.dirname(oldAbsolutePath);
    const diskName = diskNameFor(entry);
    if (parentChanged) {
      await this.fileSystem.ensureNameAvailable(nextParentPath, diskName);
    }
    const nextLocator = this.fileSystem.joinLocator(nextParent?.locator, diskName);
    const nextAbsolutePath = path.join(nextParentPath, diskName);
    const previousEntries = cloneEntries(this.index.entries);
    let renamed = false;

    try {
      if (parentChanged) {
        await this.fileSystem.moveWithoutOverwrite(
          oldAbsolutePath,
          nextAbsolutePath,
          entry.kind,
        );
        renamed = true;
      }
      this.replaceEntryAndDescendantLocators(entry.nodeId, {
        parentId,
        locator: nextLocator,
      });
      this.setEntrySortOrder(nodeId, undefined);
      if (originalParentId !== parentId) {
        this.normalizeBranchOrder(originalParentId);
      }
      this.placeEntry(nodeId, parentId, beforeNodeId);
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
    const parentId = entry.parentId;
    const absolutePath = await this.fileSystem.resolveExistingEntry(entry);
    const previousEntries = cloneEntries(this.index.entries);
    const removedNodeIds = this.removeEntryAndDescendants(nodeId);
    this.normalizeBranchOrder(parentId);

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
                pageType: node.pageType!,
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
    pageType?: string,
  ): Promise<ProjectTreeNode> {
    assertPortableProjectName(name);
    const parent = this.requireFolder(parentId);
    const parentPath = await this.fileSystem.resolveParentDirectory(parent);
    const adapter =
      kind === 'page'
        ? requireProjectPageStorageAdapter(pageType ?? '')
        : undefined;
    const diskName = adapter ? projectPageDiskName(name, adapter.pageType) : name;
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
            pageType: adapter!.pageType,
          };
    let createdIdentity: ProjectFileIdentity | undefined;

    try {
      if (kind === 'folder') {
        await mkdir(absolutePath);
      } else {
        await writeFile(absolutePath, adapter!.initialContent, {
          encoding: 'utf8',
          flag: 'wx',
        });
      }

      createdIdentity = await this.fileSystem.captureIdentity(absolutePath);
      const branchWasManual = this.rawChildren(parentId).some(
        (candidate) => candidate.sortOrder !== undefined,
      );
      this.index.entries.push(entry);
      if (branchWasManual) {
        this.placeEntry(entry.nodeId, parentId, null);
      }
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
    this.normalizeAllBranchOrders();
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

  private rawChildren(parentId: string | null): ContentIndexEntry[] {
    return this.index.entries.filter((entry) => entry.parentId === parentId);
  }

  private childrenOf(parentId: string | null): ContentIndexEntry[] {
    return sortEntries(this.rawChildren(parentId));
  }

  private setEntrySortOrder(
    nodeId: string,
    sortOrder: number | undefined,
  ): void {
    const entry = this.requireEntry(nodeId);
    if (sortOrder === undefined) {
      delete entry.sortOrder;
      return;
    }
    entry.sortOrder = sortOrder;
  }

  private normalizeBranchOrder(parentId: string | null): boolean {
    const siblings = this.rawChildren(parentId);
    if (!siblings.some((entry) => entry.sortOrder !== undefined)) {
      return false;
    }

    let changed = false;
    for (const [sortOrder, entry] of sortEntries(siblings).entries()) {
      if (entry.sortOrder !== sortOrder) {
        entry.sortOrder = sortOrder;
        changed = true;
      }
    }
    return changed;
  }

  private normalizeAllBranchOrders(): void {
    const parentIds = new Set(
      this.index.entries.map((entry) => entry.parentId),
    );
    for (const parentId of parentIds) {
      this.normalizeBranchOrder(parentId);
    }
  }

  private placeEntry(
    nodeId: string,
    parentId: string | null,
    beforeNodeId?: string | null,
  ): void {
    const entry = this.requireEntry(nodeId);
    const siblings = this.childrenOf(parentId).filter(
      (candidate) => candidate.nodeId !== nodeId,
    );
    const branchIsManual = siblings.some(
      (candidate) => candidate.sortOrder !== undefined,
    );

    if (beforeNodeId === undefined && !branchIsManual) {
      delete entry.sortOrder;
      return;
    }

    const insertionIndex =
      beforeNodeId === undefined || beforeNodeId === null
        ? siblings.length
        : siblings.findIndex((candidate) => candidate.nodeId === beforeNodeId);
    if (insertionIndex < 0) {
      throw new ProjectOperationError(
        'invalid-operation',
        'The requested order reference is not in the destination folder.',
      );
    }

    siblings.splice(insertionIndex, 0, entry);
    for (const [sortOrder, sibling] of siblings.entries()) {
      sibling.sortOrder = sortOrder;
    }
  }

}
