import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  projectSuccess,
  type CreateProjectNodeRequest,
  type CreateProjectRequest,
  type GetProjectNodeRequest,
  type ListProjectChildrenRequest,
  type MarkdownDocument,
  type MoveProjectNodeRequest,
  type ProjectLocationSelection,
  type ProjectResult,
  type ProjectSummary,
  type ProjectTreeNode,
  type ReadMarkdownDocumentRequest,
  type RenameProjectNodeRequest,
  type RestoreProjectRequest,
  type SaveMarkdownDocumentRequest,
  type TrashProjectNodeRequest,
  type TrashProjectNodeOutcome,
} from '../../shared/contracts/projects';
import { ProjectOperationError, normalizeProjectError, projectErrorResult } from './errors';
import type { ProjectCatalogStore } from './project-catalog-store';
import {
  ProjectRepository,
  type ProjectRepositoryOptions,
  type TrashItem,
} from './project-repository';

const DEFAULT_LOCATION_TOKEN_TTL_MS = 5 * 60 * 1_000;

export type ProjectSenderKey = string | number;

export interface ProjectServiceOptions {
  catalogStore: ProjectCatalogStore;
  trashItem: TrashItem;
  createId?: () => string;
  now?: () => Date;
  locationTokenTtlMs?: number;
}

interface ActiveProject {
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
  private readonly locationTokens = new Map<string, PendingLocation>();
  private readonly projectQueues = new Map<string, Promise<void>>();
  private readonly senderEpochs = new Map<ProjectSenderKey, number>();
  private readonly senderTransitions = new Map<ProjectSenderKey, Promise<void>>();
  private readonly transitioningSenders = new Set<ProjectSenderKey>();

  constructor(options: ProjectServiceOptions) {
    this.catalogStore = options.catalogStore;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.locationTokenTtlMs =
      options.locationTokenTtlMs ?? DEFAULT_LOCATION_TOKEN_TTL_MS;
    this.repositoryOptions = {
      trashItem: options.trashItem,
      createId: this.createId,
      now: this.now,
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
    return this.withActiveProject(senderKey, (repository) =>
      request.kind === 'folder'
        ? repository.createFolder(request.parentId, request.name)
        : repository.createMarkdownPage(request.parentId, request.name),
    );
  }

  renameNode(
    senderKey: ProjectSenderKey,
    request: RenameProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.renameNode(request.nodeId, request.name),
    );
  }

  moveNode(
    senderKey: ProjectSenderKey,
    request: MoveProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.moveNode(request.nodeId, request.parentId),
    );
  }

  trashNode(
    senderKey: ProjectSenderKey,
    request: TrashProjectNodeRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>> {
    return this.withActiveProject(senderKey, async (repository) => {
      const nodeIds = await repository.trashNode(request.nodeId);
      return { nodeIds };
    });
  }

  readMarkdown(
    senderKey: ProjectSenderKey,
    request: ReadMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.readMarkdown(request.nodeId),
    );
  }

  saveMarkdown(
    senderKey: ProjectSenderKey,
    request: SaveMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>> {
    return this.withActiveProject(senderKey, (repository) =>
      repository.saveMarkdown(
        request.nodeId,
        request.content,
        request.expectedRevision,
        request.force,
      ),
    );
  }

  disposeSender(senderKey: ProjectSenderKey): void {
    this.invalidateSenderActivation(senderKey);
    const projectId = this.activeProjects.get(senderKey)?.summary.projectId;
    this.activeProjects.delete(senderKey);

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
      const existing = this.repositories.get(repository.summary.projectId);

      if (existing && existing.rootPath !== repository.rootPath) {
        throw new ProjectOperationError(
          'collision',
          'A project with this identity is already open from another location.',
        );
      }

      const sharedRepository = existing ?? repository;
      this.repositories.set(repository.summary.projectId, sharedRepository);
      this.activeProjects.set(senderKey, {
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
    if (this.senderEpochs.get(senderKey) !== expectedEpoch) {
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
