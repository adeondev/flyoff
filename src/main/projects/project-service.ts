import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  projectSuccess,
  type ChangeProjectPagePasswordRequest,
  type CreateProjectNodeRequest,
  type CreateProjectRequest,
  type GetProjectNodeRequest,
  type GetProjectPagePropertiesRequest,
  type ListProjectChildrenRequest,
  type ListProjectBacklinksRequest,
  type MarkdownDocument,
  type LockProjectPageRequest,
  type MoveProjectNodeRequest,
  type MoveProjectNodesRequest,
  type ProjectLocationSelection,
  type ProjectNodeMutationOutcome,
  type ProjectNodesMutationOutcome,
  type ProjectBacklinksOutcome,
  type ProjectGraphSnapshot,
  type ProjectInternalLinkRequest,
  type ProjectInternalLinkResolution,
  type ProjectLinkTarget,
  type ProjectPathRequest,
  type ProjectPageProperties,
  type ProjectResult,
  type ProjectSearchOutcome,
  type ProjectSearchRequest,
  type ProjectSummary,
  type ProjectTreeNode,
  type ReadMarkdownDocumentRequest,
  type RemoveProjectPagePasswordRequest,
  type RenameProjectNodeRequest,
  type RestoreProjectRequest,
  type SaveMarkdownDocumentRequest,
  type SetProjectPageReadOnlyRequest,
  type ProtectProjectPageRequest,
  type TrashProjectNodeRequest,
  type TrashProjectNodesRequest,
  type TrashProjectNodeOutcome,
  type UnlockProjectPageRequest,
} from '../../shared/contracts/projects';
import type {
  ProjectNoteActivityEntry,
  ProjectNoteActivityEvent,
} from '../../shared/contracts/project-note-activity';
import { ProjectOperationError, normalizeProjectError, projectErrorResult } from './errors';
import type { ProjectCatalogStore } from './project-catalog-store';
import {
  EncryptedNoteKeySession,
  type EncryptedNoteKeyScope,
} from './encrypted-note-key-session';
import type {
  EncryptedNoteCryptoDependencies,
  EncryptedNoteKey,
} from './encrypted-note-crypto';
import {
  ProjectRepository,
  type ProjectRepositoryOptions,
  type TrashItem,
} from './project-repository';
import { ProjectReferenceIndex } from './project-reference-index';
import { rewrittenLinkDestination } from './project-link-maintenance';
import type { ProjectNoteActivityStore } from './project-note-activity-store';

const DEFAULT_LOCATION_TOKEN_TTL_MS = 5 * 60 * 1_000;

interface AppliedLinkRewrite {
  rollback: () => Promise<void>;
  skippedLockedNodeIds: readonly string[];
  updatedDocumentNodeIds: readonly string[];
}

export type ProjectSenderKey = string | number;

export interface ProjectServiceOptions {
  catalogStore: ProjectCatalogStore;
  trashItem: TrashItem;
  activityStore?: ProjectNoteActivityStore;
  createId?: () => string;
  now?: () => Date;
  locationTokenTtlMs?: number;
  encryptedNoteCrypto?: EncryptedNoteCryptoDependencies;
}

interface ActiveProject {
  referenceIndex: ProjectReferenceIndex;
  repository: ProjectRepository;
  summary: ProjectSummary;
}

interface PendingLocation {
  senderKey: ProjectSenderKey;
  path: string;
  expiresAt: number;
}

export class ProjectService {
  private readonly activeProjects = new Map<ProjectSenderKey, ActiveProject>();
  private readonly repositories = new Map<string, ProjectRepository>();
  private readonly catalogStore: ProjectCatalogStore;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly locationTokenTtlMs: number;
  private readonly repositoryOptions: ProjectRepositoryOptions;
  private readonly activityStore: ProjectNoteActivityStore | undefined;
  private readonly locationTokens = new Map<string, PendingLocation>();
  private readonly projectQueues = new Map<string, Promise<void>>();
  private readonly senderEpochs = new Map<ProjectSenderKey, number>();
  private readonly senderTransitions = new Map<ProjectSenderKey, Promise<void>>();
  private readonly transitioningSenders = new Set<ProjectSenderKey>();
  private readonly noteKeys = new EncryptedNoteKeySession();
  private disposed = false;

  constructor(options: ProjectServiceOptions) {
    this.catalogStore = options.catalogStore;
    this.activityStore = options.activityStore;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.locationTokenTtlMs =
      options.locationTokenTtlMs ?? DEFAULT_LOCATION_TOKEN_TTL_MS;
    this.repositoryOptions = {
      trashItem: options.trashItem,
      createId: this.createId,
      now: this.now,
      encryptedNoteCrypto: options.encryptedNoteCrypto,
    };
  }

  async selectCreateLocation(
    senderKey: ProjectSenderKey,
    parentPath: string,
  ): Promise<ProjectResult<ProjectLocationSelection>> {
    try {
      const canonicalPath = await this.validateSelectedDirectory(parentPath);
      const now = this.now();
      const expiresAt = now.getTime() + this.locationTokenTtlMs;
      const token = this.createId();

      this.removeExpiredLocationTokens(now.getTime());
      this.locationTokens.set(token, {
        senderKey,
        path: canonicalPath,
        expiresAt,
      });

      return projectSuccess({
        token,
        location: canonicalPath,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    } catch (error) {
      return projectErrorResult(error);
    }
  }

  async createProject(
    senderKey: ProjectSenderKey,
    request: CreateProjectRequest,
  ): Promise<ProjectResult<ProjectSummary>> {
    const senderEpoch = this.beginSenderActivation(senderKey);
    const selection = this.locationTokens.get(request.selectionToken);
    this.locationTokens.delete(request.selectionToken);

    if (
      !selection ||
      selection.senderKey !== senderKey ||
      selection.expiresAt <= this.now().getTime()
    ) {
      return projectErrorResult(
        new ProjectOperationError(
          'invalid-operation',
          'The selected project location has expired or is no longer valid.',
        ),
      );
    }

    try {
      const canonicalParent = await this.validateSelectedDirectory(selection.path);

      if (canonicalParent !== selection.path) {
        throw new ProjectOperationError(
          'unsafe-path',
          'The selected project location changed before it was used.',
        );
      }

      const repository = await ProjectRepository.create(
        path.join(canonicalParent, request.name),
        request.name,
        this.repositoryOptions,
      );
      await this.activate(senderKey, repository, senderEpoch);
      return projectSuccess(repository.summary);
    } catch (error) {
      return projectErrorResult(error);
    }
  }

  async openProject(
    senderKey: ProjectSenderKey,
    rootPath: string,
  ): Promise<ProjectResult<ProjectSummary>> {
    const senderEpoch = this.beginSenderActivation(senderKey);
    try {
      const repository = await ProjectRepository.open(
        rootPath,
        this.repositoryOptions,
      );
      await this.activate(senderKey, repository, senderEpoch);
      return projectSuccess(repository.summary);
    } catch (error) {
      return projectErrorResult(error);
    }
  }

  async restoreProject(
    senderKey: ProjectSenderKey,
    request: RestoreProjectRequest,
  ): Promise<ProjectResult<ProjectSummary>> {
    const senderEpoch = this.beginSenderActivation(senderKey);
    try {
      const catalogEntry = await this.catalogStore.get(request.projectId);

      if (!catalogEntry) {
        throw new ProjectOperationError(
          'not-found',
          'The project is no longer available at its previous location.',
        );
      }

      const repository = await ProjectRepository.open(
        catalogEntry.location,
        this.repositoryOptions,
      );

      if (repository.summary.projectId !== request.projectId) {
        throw new ProjectOperationError(
          'invalid-format',
          'The project at the saved location has a different identity.',
        );
      }

      await this.activate(senderKey, repository, senderEpoch);
      return projectSuccess(repository.summary);
    } catch (error) {
      return projectErrorResult(error);
    }
  }

  async closeProject(senderKey: ProjectSenderKey): Promise<ProjectResult<null>> {
    this.invalidateSenderActivation(senderKey);
    await this.transitionSender(senderKey, async () => {
      await this.waitForActiveProject(senderKey);
      const previousProjectId = this.activeProjects.get(senderKey)?.summary.projectId;
      if (previousProjectId) {
        this.noteKeys.removeProject(senderKey, previousProjectId);
      }
      this.activeProjects.get(senderKey)?.referenceIndex.clear();
      this.activeProjects.delete(senderKey);

      if (previousProjectId) {
        this.releaseRepositoryIfUnused(previousProjectId);
      }
    });
    return projectSuccess(null);
  }

  getActiveProject(senderKey: ProjectSenderKey): ProjectSummary | null {
    return this.activeProjects.get(senderKey)?.summary ?? null;
  }

  getNode(
    senderKey: ProjectSenderKey,
    request: GetProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.getNode(request.nodeId),
    );
  }

  listChildren(
    senderKey: ProjectSenderKey,
    request: ListProjectChildrenRequest,
  ): Promise<ProjectResult<readonly ProjectTreeNode[]>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.listChildren(request.parentId),
    );
  }

  createNode(
    senderKey: ProjectSenderKey,
    request: CreateProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const node = await (request.kind === 'folder'
        ? repository.createFolder(request.parentId, request.name)
        : repository.createPage(
            request.parentId,
            request.name,
            request.pageType,
          ));
      this.invalidateProjectReferenceIndexes(repository.summary.projectId);
      return node;
    });
  }

  renameNode(
    senderKey: ProjectSenderKey,
    request: RenameProjectNodeRequest,
  ): Promise<ProjectResult<ProjectNodeMutationOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const current = await repository.getNode(request.nodeId);
      if (current.name === request.name) {
        return {
          node: await repository.renameNode(request.nodeId, request.name),
          skippedLockedNodeIds: [],
          updatedDocumentNodeIds: [],
        };
      }
      const currentPath = repository.projectRelativePath(request.nodeId);
      const extension =
        current.kind === 'page' ? path.posix.extname(currentPath) : '';
      const nextPath = path.posix.join(
        path.posix.dirname(currentPath),
        `${request.name}${extension}`,
      );
      const projected = this.projectedMarkdownPaths(
        repository,
        currentPath,
        nextPath,
      );
      const rewrite = await this.applyProjectedLinkRewrites(
        senderKey,
        repository,
        projected,
      );
      let node: ProjectTreeNode;
      try {
        node = await repository.renameNode(request.nodeId, request.name);
      } catch (error) {
        await rewrite.rollback();
        throw error;
      }
      this.invalidateProjectReferenceIndexes(repository.summary.projectId);
      return {
        node,
        skippedLockedNodeIds: rewrite.skippedLockedNodeIds,
        updatedDocumentNodeIds: rewrite.updatedDocumentNodeIds,
      };
    });
  }

  moveNode(
    senderKey: ProjectSenderKey,
    request: MoveProjectNodeRequest,
  ): Promise<ProjectResult<ProjectNodeMutationOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const currentPath = repository.projectRelativePath(request.nodeId);
      const nextPath = repository.projectedPathForMove(
        request.nodeId,
        request.parentId,
      );
      if (nextPath === currentPath) {
        return {
          node: await repository.moveNode(
            request.nodeId,
            request.parentId,
            request.beforeNodeId,
          ),
          skippedLockedNodeIds: [],
          updatedDocumentNodeIds: [],
        };
      }
      const projected = this.projectedMarkdownPaths(
        repository,
        currentPath,
        nextPath,
      );
      const rewrite = await this.applyProjectedLinkRewrites(
        senderKey,
        repository,
        projected,
      );
      let node: ProjectTreeNode;
      try {
        node = await repository.moveNode(
          request.nodeId,
          request.parentId,
          request.beforeNodeId,
        );
      } catch (error) {
        await rewrite.rollback();
        throw error;
      }
      this.invalidateProjectReferenceIndexes(repository.summary.projectId);
      return {
        node,
        skippedLockedNodeIds: rewrite.skippedLockedNodeIds,
        updatedDocumentNodeIds: rewrite.updatedDocumentNodeIds,
      };
    });
  }

  moveNodes(
    senderKey: ProjectSenderKey,
    request: MoveProjectNodesRequest,
  ): Promise<ProjectResult<ProjectNodesMutationOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const rootNodeIds = repository.normalizeNodeRoots(request.nodeIds);
      const projected = new Map(this.markdownPaths(repository));
      let pathsChanged = false;
      for (const nodeId of rootNodeIds) {
        const currentRoot = repository.projectRelativePath(nodeId);
        const nextRoot = repository.projectedPathForMove(
          nodeId,
          request.parentId,
        );
        if (
          nextRoot === currentRoot ||
          nextRoot.startsWith(`${currentRoot}/`)
        ) {
          if (nextRoot.startsWith(`${currentRoot}/`)) {
            throw new ProjectOperationError(
              'invalid-operation',
              'A folder cannot be moved into itself or one of its descendants.',
            );
          }
          continue;
        }
        const prefix = `${currentRoot}/`;
        for (const [markdownNodeId, currentPath] of projected) {
          if (
            currentPath !== currentRoot &&
            !currentPath.startsWith(prefix)
          ) {
            continue;
          }
          projected.set(
            markdownNodeId,
            currentPath === currentRoot
              ? nextRoot
              : `${nextRoot}/${currentPath.slice(prefix.length)}`,
          );
        }
        pathsChanged = true;
      }

      if (!pathsChanged) {
        return {
          nodes: await repository.moveNodes(
            rootNodeIds,
            request.parentId,
            request.beforeNodeId,
          ),
          skippedLockedNodeIds: [],
          updatedDocumentNodeIds: [],
        };
      }

      const rewrite = await this.applyProjectedLinkRewrites(
        senderKey,
        repository,
        projected,
      );
      try {
        const nodes = await repository.moveNodes(
          rootNodeIds,
          request.parentId,
          request.beforeNodeId,
        );
        this.invalidateProjectReferenceIndexes(repository.summary.projectId);
        return {
          nodes,
          skippedLockedNodeIds: rewrite.skippedLockedNodeIds,
          updatedDocumentNodeIds: rewrite.updatedDocumentNodeIds,
        };
      } catch (error) {
        await rewrite.rollback();
        throw error;
      }
    });
  }

  trashNode(
    senderKey: ProjectSenderKey,
    request: TrashProjectNodeRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const nodeIds = await repository.trashNode(request.nodeId);
      await Promise.all(
        nodeIds.map((nodeId) =>
          repository.linkMaintenance.complete(nodeId),
        ),
      ).catch(() => undefined);
      const removed = new Set(nodeIds);
      try {
        this.activityStore?.removeMany(repository.summary.projectId, removed);
      } catch {
        // Stale entries are filtered and removed the next time activity is read.
      }
      for (const [clientId, active] of this.activeProjects) {
        if (active.summary.projectId !== repository.summary.projectId) {
          continue;
        }
        for (const nodeId of removed) {
          this.noteKeys.remove(
            this.keyScope(clientId, repository, nodeId),
          );
          active.referenceIndex.clearNode(nodeId);
        }
        active.referenceIndex.invalidate();
      }
      return { nodeIds };
    });
  }

  trashNodes(
    senderKey: ProjectSenderKey,
    request: TrashProjectNodesRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const nodeIds = await repository.trashNodes(request.nodeIds);
      await Promise.all(
        nodeIds.map((nodeId) =>
          repository.linkMaintenance.complete(nodeId),
        ),
      ).catch(() => undefined);
      const removed = new Set(nodeIds);
      try {
        this.activityStore?.removeMany(repository.summary.projectId, removed);
      } catch {
        // Stale entries are filtered and removed the next time activity is read.
      }
      for (const [clientId, active] of this.activeProjects) {
        if (active.summary.projectId !== repository.summary.projectId) {
          continue;
        }
        for (const nodeId of removed) {
          this.noteKeys.remove(
            this.keyScope(clientId, repository, nodeId),
          );
          active.referenceIndex.clearNode(nodeId);
        }
        active.referenceIndex.invalidate();
      }
      return { nodeIds };
    });
  }

  resolvePath(
    senderKey: ProjectSenderKey,
    request: ProjectPathRequest,
  ): Promise<ProjectResult<string>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.resolvePath(request.nodeId),
    );
  }

  async readMarkdown(
    senderKey: ProjectSenderKey,
    request: ReadMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>> {
    const result = await this.withActiveProject(senderKey, async (repository) => {
      const key = this.noteKeys.peek(
        this.keyScope(senderKey, repository, request.nodeId),
      );
      const document = await repository.readMarkdown(
        request.nodeId,
        key,
      );
      return this.repairPendingLinks(repository, document, key);
    });
    if (!result.ok && result.error.code === 'password-required') {
      this.removeNoteKey(senderKey, request.nodeId);
      const projectId = this.activeProjects.get(senderKey)?.summary.projectId;
      if (projectId) {
        this.clearProjectReferenceNode(projectId, request.nodeId);
      }
    } else if (result.ok) {
      this.activeProjects.get(senderKey)?.referenceIndex.update(result.value);
    }
    return result;
  }

  async saveMarkdown(
    senderKey: ProjectSenderKey,
    request: SaveMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>> {
    const result = await this.withActiveProject(senderKey, async (repository) => {
      const repair = await repository.linkMaintenance.rewrite(
        request.nodeId,
        request.content,
        this.markdownPaths(repository),
      );
      const document = await repository.saveMarkdown(
        request.nodeId,
        repair.content,
        request.expectedRevision,
        request.force,
        this.noteKeys.peek(this.keyScope(senderKey, repository, request.nodeId)),
      );
      if (repair.pending) {
        await repository.linkMaintenance.complete(request.nodeId);
        this.invalidateProjectReferenceIndexes(
          repository.summary.projectId,
        );
      }
      return document;
    });
    if (!result.ok && result.error.code === 'password-required') {
      this.removeNoteKey(senderKey, request.nodeId);
      const projectId = this.activeProjects.get(senderKey)?.summary.projectId;
      if (projectId) {
        this.clearProjectReferenceNode(projectId, request.nodeId);
      }
    } else if (result.ok) {
      this.activeProjects.get(senderKey)?.referenceIndex.update(result.value);
    }
    return result;
  }

  listLinkTargets(
    senderKey: ProjectSenderKey,
  ): Promise<ProjectResult<readonly ProjectLinkTarget[]>> {
    return this.withActiveProject(senderKey, async () =>
      this.requireActiveReferenceIndex(senderKey).listTargets(),
    );
  }

  getGraph(
    senderKey: ProjectSenderKey,
  ): Promise<ProjectResult<ProjectGraphSnapshot>> {
    return this.withActiveProject(senderKey, () =>
      this.requireActiveReferenceIndex(senderKey).graph(),
    );
  }

  resolveInternalLink(
    senderKey: ProjectSenderKey,
    request: ProjectInternalLinkRequest,
  ): Promise<ProjectResult<ProjectInternalLinkResolution>> {
    return this.withActiveProject(senderKey, () =>
      this.requireActiveReferenceIndex(senderKey).resolve(request),
    );
  }

  listBacklinks(
    senderKey: ProjectSenderKey,
    request: ListProjectBacklinksRequest,
  ): Promise<ProjectResult<ProjectBacklinksOutcome>> {
    return this.withActiveProject(senderKey, () =>
      this.requireActiveReferenceIndex(senderKey).backlinks(
        request.targetNodeId,
      ),
    );
  }

  searchProject(
    senderKey: ProjectSenderKey,
    request: ProjectSearchRequest,
  ): Promise<ProjectResult<ProjectSearchOutcome>> {
    return this.withActiveProject(senderKey, () =>
      this.requireActiveReferenceIndex(senderKey).search(request),
    );
  }

  getNoteActivity(
    senderKey: ProjectSenderKey,
  ): Promise<ProjectResult<readonly ProjectNoteActivityEntry[]>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const entries = this.activityStore?.get(repository.summary.projectId) ?? [];
      if (entries.length === 0) {
        return [];
      }

      const invalidNodeIds: string[] = [];
      const eligibleEntries: ProjectNoteActivityEntry[] = [];
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const node = await repository.getNode(entry.nodeId);
            if (node.kind !== 'page' || node.pageType !== 'markdown') {
              invalidNodeIds.push(entry.nodeId);
              return;
            }
            const properties = await repository.getPageProperties(
              entry.nodeId,
              this.noteKeys.peek(
                this.keyScope(senderKey, repository, entry.nodeId),
              ),
            );
            if (properties.passwordProtected) {
              invalidNodeIds.push(entry.nodeId);
              return;
            }
            eligibleEntries.push(entry);
          } catch {
            invalidNodeIds.push(entry.nodeId);
          }
        }),
      );
      if (invalidNodeIds.length > 0) {
        this.activityStore?.removeMany(
          repository.summary.projectId,
          invalidNodeIds,
        );
      }
      const eligibleNodeIds = new Set(
        eligibleEntries.map(({ nodeId }) => nodeId),
      );
      return entries.filter(({ nodeId }) => eligibleNodeIds.has(nodeId));
    });
  }

  recordNoteActivity(
    senderKey: ProjectSenderKey,
    event: ProjectNoteActivityEvent,
  ): Promise<ProjectResult<ProjectNoteActivityEntry>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const node = await repository.getNode(event.nodeId);
      if (node.kind !== 'page' || node.pageType !== 'markdown') {
        throw new ProjectOperationError(
          'invalid-operation',
          'Only Markdown notes can be added to project activity.',
        );
      }
      const properties = await repository.getPageProperties(
        event.nodeId,
        this.noteKeys.peek(this.keyScope(senderKey, repository, event.nodeId)),
      );
      if (properties.passwordProtected) {
        this.activityStore?.remove(repository.summary.projectId, event.nodeId);
        throw new ProjectOperationError(
          'invalid-operation',
          'Protected notes cannot be added to project activity.',
        );
      }
      if (!this.activityStore) {
        throw new ProjectOperationError(
          'io-error',
          'Project note activity storage is unavailable.',
        );
      }
      return this.activityStore.record(repository.summary.projectId, event);
    });
  }

  async getPageProperties(
    senderKey: ProjectSenderKey,
    request: GetProjectPagePropertiesRequest,
  ): Promise<ProjectResult<ProjectPageProperties>> {
    const result = await this.withActiveProject(senderKey, (repository) =>
      repository.getPageProperties(
        request.nodeId,
        this.noteKeys.peek(this.keyScope(senderKey, repository, request.nodeId)),
      ),
    );
    if (
      result.ok &&
      (!result.value.passwordProtected || result.value.locked)
    ) {
      this.removeNoteKey(senderKey, request.nodeId);
    }
    return result;
  }

  async setPageReadOnly(
    senderKey: ProjectSenderKey,
    request: SetProjectPageReadOnlyRequest,
  ): Promise<ProjectResult<ProjectPageProperties>> {
    const result = await this.withActiveProject(senderKey, (repository) =>
      repository.setPageReadOnly(
        request.nodeId,
        request.readOnly,
        request.expectedRevision,
        this.noteKeys.peek(this.keyScope(senderKey, repository, request.nodeId)),
      ),
    );
    if (
      result.ok &&
      (!result.value.passwordProtected || result.value.locked)
    ) {
      this.removeNoteKey(senderKey, request.nodeId);
    }
    if (result.ok) {
      const projectId = this.activeProjects.get(senderKey)?.summary.projectId;
      if (projectId) {
        this.invalidateProjectReferenceIndexes(projectId);
      }
    }
    return result;
  }

  protectPage(
    senderKey: ProjectSenderKey,
    request: ProtectProjectPageRequest,
  ): Promise<ProjectResult<ProjectPageProperties>> {
    return this.withActiveProject(senderKey, async (repository) => {
      this.activityStore?.remove(
        repository.summary.projectId,
        request.nodeId,
      );
      const outcome = await repository.protectPage(
        request.nodeId,
        request.password,
        request.expectedRevision,
      );
      this.noteKeys.removeNode(repository.summary.projectId, request.nodeId);
      this.adoptNoteKey(
        senderKey,
        repository,
        request.nodeId,
        outcome.key,
      );
      this.clearProjectReferenceNode(
        repository.summary.projectId,
        request.nodeId,
      );
      return outcome.properties;
    });
  }

  changePagePassword(
    senderKey: ProjectSenderKey,
    request: ChangeProjectPagePasswordRequest,
  ): Promise<ProjectResult<ProjectPageProperties>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const outcome = await repository.changePagePassword(
        request.nodeId,
        request.currentPassword,
        request.newPassword,
        request.expectedRevision,
      );
      try {
        const repaired = await this.repairPendingLinks(
          repository,
          await repository.readMarkdown(request.nodeId, outcome.key),
          outcome.key,
        );
        const properties =
          repaired.revision === outcome.properties.revision
            ? outcome.properties
            : await repository.getPageProperties(
                request.nodeId,
                outcome.key,
              );
        this.noteKeys.removeNode(
          repository.summary.projectId,
          request.nodeId,
        );
        this.adoptNoteKey(
          senderKey,
          repository,
          request.nodeId,
          outcome.key,
        );
        this.clearProjectReferenceNode(
          repository.summary.projectId,
          request.nodeId,
        );
        return properties;
      } catch (error) {
        outcome.key.destroy();
        throw error;
      }
    });
  }

  removePagePassword(
    senderKey: ProjectSenderKey,
    request: RemoveProjectPagePasswordRequest,
  ): Promise<ProjectResult<ProjectPageProperties>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const properties = await repository.removePagePassword(
        request.nodeId,
        request.password,
        request.expectedRevision,
      );
      this.noteKeys.removeNode(repository.summary.projectId, request.nodeId);
      this.invalidateProjectReferenceIndexes(repository.summary.projectId);
      return properties;
    });
  }

  unlockPage(
    senderKey: ProjectSenderKey,
    request: UnlockProjectPageRequest,
  ): Promise<ProjectResult<MarkdownDocument>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const outcome = await repository.unlockPage(
        request.nodeId,
        request.password,
      );
      try {
        const document = await this.repairPendingLinks(
          repository,
          outcome.document,
          outcome.key,
        );
        this.adoptNoteKey(
          senderKey,
          repository,
          request.nodeId,
          outcome.key,
        );
        this.activeProjects
          .get(senderKey)
          ?.referenceIndex.update(document);
        return document;
      } catch (error) {
        outcome.key.destroy();
        throw error;
      }
    });
  }

  lockPage(
    senderKey: ProjectSenderKey,
    request: LockProjectPageRequest,
  ): Promise<ProjectResult<null>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const node = await repository.getNode(request.nodeId);
      if (node.kind !== 'page' || node.pageType !== 'markdown') {
        throw new ProjectOperationError(
          'invalid-operation',
          'Only Markdown notes can be locked.',
        );
      }
      this.noteKeys.remove(this.keyScope(senderKey, repository, request.nodeId));
      this.activeProjects
        .get(senderKey)
        ?.referenceIndex.clearNode(request.nodeId);
      return null;
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.noteKeys.clear();
    for (const active of this.activeProjects.values()) {
      active.referenceIndex.clear();
    }
    this.activeProjects.clear();
    this.repositories.clear();
    this.locationTokens.clear();
    this.projectQueues.clear();
    this.senderEpochs.clear();
    this.senderTransitions.clear();
    this.transitioningSenders.clear();
  }

  disposeSender(senderKey: ProjectSenderKey): void {
    this.invalidateSenderActivation(senderKey);
    const projectId = this.activeProjects.get(senderKey)?.summary.projectId;
    this.activeProjects.get(senderKey)?.referenceIndex.clear();
    this.activeProjects.delete(senderKey);
    this.noteKeys.removeClient(senderKey);

    if (projectId) {
      this.releaseRepositoryIfUnused(projectId);
    }

    for (const [token, selection] of this.locationTokens) {
      if (selection.senderKey === senderKey) {
        this.locationTokens.delete(token);
      }
    }
  }

  private async activate(
    senderKey: ProjectSenderKey,
    repository: ProjectRepository,
    senderEpoch: number,
  ): Promise<void> {
    this.assertSenderActivationCurrent(senderKey, senderEpoch);
    await this.transitionSender(senderKey, async () => {
      this.assertSenderActivationCurrent(senderKey, senderEpoch);
      await this.waitForActiveProject(senderKey);
      this.assertSenderActivationCurrent(senderKey, senderEpoch);
      const previousProjectId = this.activeProjects.get(senderKey)?.summary.projectId;
      this.activeProjects.get(senderKey)?.referenceIndex.clear();
      const existing = this.repositories.get(repository.summary.projectId);

      if (existing && existing.rootPath !== repository.rootPath) {
        throw new ProjectOperationError(
          'collision',
          'A project with this identity is already open from another location.',
        );
      }

      const sharedRepository = existing ?? repository;
      if (previousProjectId) {
        this.noteKeys.removeProject(senderKey, previousProjectId);
      }
      this.repositories.set(repository.summary.projectId, sharedRepository);
      this.activeProjects.set(senderKey, {
        referenceIndex: new ProjectReferenceIndex({
          readMarkdown: (nodeId) =>
            sharedRepository.readMarkdown(
              nodeId,
              this.noteKeys.peek(
                this.keyScope(senderKey, sharedRepository, nodeId),
              ),
            ),
          repository: sharedRepository,
        }),
        repository: sharedRepository,
        summary: sharedRepository.summary,
      });

      if (previousProjectId && previousProjectId !== repository.summary.projectId) {
        this.releaseRepositoryIfUnused(previousProjectId);
      }

      await this.catalogStore
        .remember(sharedRepository.summary, this.now())
        .catch(() => undefined);
      this.assertSenderActivationCurrent(senderKey, senderEpoch);
    });
  }

  private async withActiveProject<T>(
    senderKey: ProjectSenderKey,
    operation: (repository: ProjectRepository) => Promise<T>,
  ): Promise<ProjectResult<T>> {
    if (this.transitioningSenders.has(senderKey)) {
      return projectErrorResult(
        new ProjectOperationError(
          'invalid-operation',
          'The active Flyoff project is currently changing.',
        ),
      );
    }

    const active = this.activeProjects.get(senderKey);

    if (!active) {
      return projectErrorResult(
        new ProjectOperationError(
          'invalid-operation',
          'No Flyoff project is active in this window.',
        ),
      );
    }

    return this.enqueue(active.summary.projectId, async () => {
      try {
        return projectSuccess(await operation(active.repository));
      } catch (error) {
        return projectErrorResult(error);
      }
    });
  }

  private keyScope(
    senderKey: ProjectSenderKey,
    repository: ProjectRepository,
    nodeId: string,
  ): EncryptedNoteKeyScope {
    return {
      clientId: senderKey,
      projectId: repository.summary.projectId,
      nodeId,
    };
  }

  private adoptNoteKey(
    senderKey: ProjectSenderKey,
    repository: ProjectRepository,
    nodeId: string,
    key: EncryptedNoteKey,
  ): void {
    if (
      this.disposed ||
      this.activeProjects.get(senderKey)?.repository !== repository
    ) {
      key.destroy();
      throw new ProjectOperationError(
        'invalid-operation',
        'The note unlock operation is no longer current for this window.',
      );
    }

    this.noteKeys.store(this.keyScope(senderKey, repository, nodeId), key);
  }

  private removeNoteKey(senderKey: ProjectSenderKey, nodeId: string): void {
    const repository = this.activeProjects.get(senderKey)?.repository;
    if (repository) {
      this.noteKeys.remove(this.keyScope(senderKey, repository, nodeId));
    }
  }

  private markdownPaths(
    repository: ProjectRepository,
  ): ReadonlyMap<string, string> {
    return new Map(
      repository
        .listIndexedNodes()
        .filter(
          (node) => node.kind === 'page' && node.pageType === 'markdown',
        )
        .map((node) => [
          node.nodeId,
          repository.projectRelativePath(node.nodeId),
        ]),
    );
  }

  private async repairPendingLinks(
    repository: ProjectRepository,
    document: MarkdownDocument,
    key?: EncryptedNoteKey,
  ): Promise<MarkdownDocument> {
    const repair = await repository.linkMaintenance.rewrite(
      document.nodeId,
      document.content,
      this.markdownPaths(repository),
    );
    if (!repair.pending) {
      return document;
    }

    const repaired =
      repair.content === document.content
        ? document
        : await repository.saveMarkdownForMaintenance(
            document.nodeId,
            repair.content,
            document.revision,
            key,
          );
    await repository.linkMaintenance.complete(document.nodeId);
    this.invalidateProjectReferenceIndexes(repository.summary.projectId);
    return repaired;
  }

  private projectedMarkdownPaths(
    repository: ProjectRepository,
    currentRoot: string,
    nextRoot: string,
  ): ReadonlyMap<string, string> {
    const paths = new Map<string, string>();
    const prefix = `${currentRoot}/`;
    for (const node of repository.listIndexedNodes()) {
      if (node.kind !== 'page' || node.pageType !== 'markdown') {
        continue;
      }
      const current = repository.projectRelativePath(node.nodeId);
      const next =
        current === currentRoot
          ? nextRoot
          : current.startsWith(prefix)
            ? `${nextRoot}/${current.slice(prefix.length)}`
            : current;
      paths.set(node.nodeId, next);
    }
    return paths;
  }

  private async applyProjectedLinkRewrites(
    senderKey: ProjectSenderKey,
    repository: ProjectRepository,
    nextPaths: ReadonlyMap<string, string>,
  ): Promise<AppliedLinkRewrite> {
    const index = this.requireActiveReferenceIndex(senderKey);
    await index.ensureAvailable();
    const skippedLockedNodeIds = index.lockedNodes();
    const documents = index.indexedDocuments();
    const currentPaths = new Map(
      [...nextPaths.keys()].map((nodeId) => [
        nodeId,
        repository.projectRelativePath(nodeId),
      ]),
    );
    const replacements = new Map<
      string,
      {
        content: string;
        original: (typeof documents)[number]['document'];
      }
    >();

    for (const { document, nodeId } of documents) {
      const currentSourcePath = repository.projectRelativePath(nodeId);
      const nextSourcePath = nextPaths.get(nodeId) ?? currentSourcePath;
      const edits: { end: number; start: number; value: string }[] = [];

      for (const link of document.links) {
        const targetNodeId = index.resolveTargetNodeId(nodeId, link);
        if (!targetNodeId) {
          continue;
        }
        const currentTargetPath = repository.projectRelativePath(targetNodeId);
        const nextTargetPath =
          nextPaths.get(targetNodeId) ?? currentTargetPath;
        if (
          currentSourcePath === nextSourcePath &&
          currentTargetPath === nextTargetPath
        ) {
          continue;
        }
        const value = rewrittenLinkDestination(
          link,
          nextSourcePath,
          nextTargetPath,
          nextPaths,
        );
        if (value !== link.destination) {
          edits.push({
            end: link.destinationEnd,
            start: link.destinationStart,
            value,
          });
        }
      }

      if (edits.length === 0) {
        continue;
      }
      if (document.readOnly) {
        throw new ProjectOperationError(
          'read-only',
          'Disable read-only on linked notes before renaming or moving this content.',
        );
      }
      let content = document.content;
      for (const edit of edits.sort((left, right) => right.start - left.start)) {
        content =
          content.slice(0, edit.start) +
          edit.value +
          content.slice(edit.end);
      }
      replacements.set(nodeId, { content, original: document });
    }

    const stagedMaintenance = await repository.linkMaintenance.stage(
      currentPaths,
      nextPaths,
      skippedLockedNodeIds,
    );
    const applied: {
      nodeId: string;
      originalContent: string;
      revision: string;
    }[] = [];
    const rollback = async (): Promise<void> => {
      try {
        for (const saved of [...applied].reverse()) {
          const restored = await repository.saveMarkdown(
            saved.nodeId,
            saved.originalContent,
            saved.revision,
            false,
            this.noteKeys.peek(
              this.keyScope(senderKey, repository, saved.nodeId),
            ),
          );
          saved.revision = restored.revision;
        }
      } finally {
        index.invalidate();
        await stagedMaintenance.rollback();
      }
    };

    try {
      for (const [nodeId, replacement] of replacements) {
        const saved = await repository.saveMarkdown(
          nodeId,
          replacement.content,
          replacement.original.revision,
          false,
          this.noteKeys.peek(this.keyScope(senderKey, repository, nodeId)),
        );
        applied.push({
          nodeId,
          originalContent: replacement.original.content,
          revision: saved.revision,
        });
      }
    } catch (error) {
      try {
        await rollback();
      } catch (rollbackError) {
        throw new ProjectOperationError(
          'io-error',
          'Project links could not be restored after an update failed.',
          { cause: rollbackError },
        );
      }
      throw error;
    }

    return {
      rollback: async () => {
        try {
          await rollback();
        } catch (error) {
          throw new ProjectOperationError(
            'io-error',
            'Project links could not be restored after the content mutation failed.',
            { cause: error },
          );
        }
      },
      skippedLockedNodeIds,
      updatedDocumentNodeIds: applied.map(({ nodeId }) => nodeId),
    };
  }

  private requireActiveReferenceIndex(
    senderKey: ProjectSenderKey,
  ): ProjectReferenceIndex {
    const index = this.activeProjects.get(senderKey)?.referenceIndex;
    if (!index) {
      throw new ProjectOperationError(
        'invalid-operation',
        'No project is active for this window.',
      );
    }
    return index;
  }

  private invalidateProjectReferenceIndexes(projectId: string): void {
    for (const active of this.activeProjects.values()) {
      if (active.summary.projectId === projectId) {
        active.referenceIndex.invalidate();
      }
    }
  }

  private clearProjectReferenceNode(projectId: string, nodeId: string): void {
    for (const active of this.activeProjects.values()) {
      if (active.summary.projectId === projectId) {
        active.referenceIndex.clearNode(nodeId);
      }
    }
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    const pending = previous.then(operation, operation);
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );
    this.projectQueues.set(projectId, settled);

    void settled.finally(() => {
      if (this.projectQueues.get(projectId) === settled) {
        this.projectQueues.delete(projectId);
      }
    });

    return pending;
  }

  private async validateSelectedDirectory(directoryPath: string): Promise<string> {
    if (!path.isAbsolute(directoryPath)) {
      throw new ProjectOperationError(
        'unsafe-path',
        'Project locations must be absolute paths.',
      );
    }

    try {
      const stats = await lstat(directoryPath);

      if (stats.isSymbolicLink()) {
        throw new ProjectOperationError(
          'unsafe-path',
          'Project locations cannot be symbolic links or junctions.',
        );
      }

      if (!stats.isDirectory()) {
        throw new ProjectOperationError(
          'not-found',
          'The selected project location is not a directory.',
        );
      }

      return await realpath(directoryPath);
    } catch (error) {
      throw normalizeProjectError(error);
    }
  }

  private async waitForActiveProject(senderKey: ProjectSenderKey): Promise<void> {
    const projectId = this.activeProjects.get(senderKey)?.summary.projectId;

    if (projectId) {
      await (this.projectQueues.get(projectId) ?? Promise.resolve());
    }
  }

  private transitionSender(
    senderKey: ProjectSenderKey,
    operation: () => Promise<void>,
  ): Promise<void> {
    this.transitioningSenders.add(senderKey);
    const previous = this.senderTransitions.get(senderKey) ?? Promise.resolve();
    const pending = previous.then(operation, operation);
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );
    this.senderTransitions.set(senderKey, settled);

    void settled.finally(() => {
      if (this.senderTransitions.get(senderKey) === settled) {
        this.senderTransitions.delete(senderKey);
        this.transitioningSenders.delete(senderKey);
      }
    });

    return pending;
  }

  private removeExpiredLocationTokens(now: number): void {
    for (const [token, selection] of this.locationTokens) {
      if (selection.expiresAt <= now) {
        this.locationTokens.delete(token);
      }
    }
  }

  private beginSenderActivation(senderKey: ProjectSenderKey): number {
    const epoch = (this.senderEpochs.get(senderKey) ?? 0) + 1;
    this.senderEpochs.set(senderKey, epoch);
    return epoch;
  }

  private invalidateSenderActivation(senderKey: ProjectSenderKey): void {
    this.senderEpochs.set(senderKey, (this.senderEpochs.get(senderKey) ?? 0) + 1);
  }

  private assertSenderActivationCurrent(
    senderKey: ProjectSenderKey,
    expectedEpoch: number,
  ): void {
    if (this.disposed || this.senderEpochs.get(senderKey) !== expectedEpoch) {
      throw new ProjectOperationError(
        'invalid-operation',
        'The project opening operation is no longer current for this window.',
      );
    }
  }

  private releaseRepositoryIfUnused(projectId: string): void {
    const inUse = Array.from(this.activeProjects.values()).some(
      ({ summary }) => summary.projectId === projectId,
    );

    if (!inUse) {
      this.repositories.delete(projectId);
    }
  }
}
