import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_FORMAT_VERSION,
  type ProjectSummary,
} from '../../shared/contracts/projects';
import { normalizeProjectError } from './errors';
import { readBoundedJson, writeJsonAtomically } from './persistence';
import { isPortableProjectName } from './portable-name';

const PROJECT_CATALOG_VERSION = 1 as const;
const PROJECT_CATALOG_FILENAME = 'project-catalog.json';
const PROJECT_CATALOG_MAX_ENTRIES = 50;
const PROJECT_CATALOG_MAX_BYTES = 1024 * 1024;

export interface ProjectCatalogEntry {
  projectId: string;
  name: string;
  location: string;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  lastOpenedAt: string;
}

interface ProjectCatalogFile {
  version: typeof PROJECT_CATALOG_VERSION;
  projects: ProjectCatalogEntry[];
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCatalogEntry(value: unknown): value is ProjectCatalogEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.projectId === 'string' &&
    uuidPattern.test(entry.projectId) &&
    isPortableProjectName(entry.name) &&
    typeof entry.location === 'string' &&
    path.isAbsolute(entry.location) &&
    entry.formatVersion === PROJECT_FORMAT_VERSION &&
    typeof entry.lastOpenedAt === 'string' &&
    Number.isFinite(Date.parse(entry.lastOpenedAt))
  );
}

function parseCatalog(value: unknown): ProjectCatalogFile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const catalog = value as Record<string, unknown>;

  if (
    catalog.version !== PROJECT_CATALOG_VERSION ||
    !Array.isArray(catalog.projects) ||
    catalog.projects.length > PROJECT_CATALOG_MAX_ENTRIES ||
    !catalog.projects.every(isCatalogEntry)
  ) {
    return undefined;
  }

  const projects = catalog.projects as ProjectCatalogEntry[];
  const identifiers = new Set(projects.map(({ projectId }) => projectId));

  if (identifiers.size !== projects.length) {
    return undefined;
  }

  return {
    version: PROJECT_CATALOG_VERSION,
    projects,
  };
}

export class ProjectCatalogStore {
  readonly filePath: string;

  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, PROJECT_CATALOG_FILENAME);
  }

  async list(): Promise<readonly ProjectCatalogEntry[]> {
    await this.mutationQueue;
    return this.load();
  }

  async get(projectId: string): Promise<ProjectCatalogEntry | undefined> {
    const projects = await this.list();
    return projects.find((project) => project.projectId === projectId);
  }

  async remember(summary: ProjectSummary, openedAt = new Date()): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.load();
      const entry: ProjectCatalogEntry = {
        ...summary,
        lastOpenedAt: openedAt.toISOString(),
      };
      const projects = [
        entry,
        ...current.filter(({ projectId }) => projectId !== summary.projectId),
      ]
        .sort((left, right) =>
          right.lastOpenedAt.localeCompare(left.lastOpenedAt),
        )
        .slice(0, PROJECT_CATALOG_MAX_ENTRIES);

      await this.write(projects);
    });
  }

  async forget(projectId: string): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.load();
      const projects = current.filter(
        (project) => project.projectId !== projectId,
      );

      if (projects.length !== current.length) {
        await this.write(projects);
      }
    });
  }

  private async load(): Promise<ProjectCatalogEntry[]> {
    try {
      const parsed = parseCatalog(
        await readBoundedJson(this.filePath, PROJECT_CATALOG_MAX_BYTES),
      );
      return parsed?.projects.map((entry) => ({ ...entry })) ?? [];
    } catch (error) {
      const normalized = normalizeProjectError(error);

      if (
        normalized.code === 'not-found' ||
        normalized.code === 'invalid-format' ||
        normalized.code === 'size-exceeded'
      ) {
        return [];
      }

      throw normalized;
    }
  }

  private async write(projects: readonly ProjectCatalogEntry[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeJsonAtomically(
      this.filePath,
      {
        version: PROJECT_CATALOG_VERSION,
        projects: [...projects],
      } satisfies ProjectCatalogFile,
      PROJECT_CATALOG_MAX_BYTES,
    );
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.mutationQueue.then(operation, operation);
    this.mutationQueue = pending.catch(() => undefined);
    return pending;
  }
}
