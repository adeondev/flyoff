import { rm } from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_APPEARANCE_FORMAT,
  PROJECT_APPEARANCE_MAX_BYTES,
  PROJECT_APPEARANCE_MAX_ENTRIES,
  PROJECT_APPEARANCE_VERSION,
  normalizeAppearanceSeed,
} from '../../shared/contracts/appearance';
import { normalizeProjectError } from './errors';
import { ProjectFileSystem } from './project-filesystem';
import {
  PROJECT_APPEARANCE_FILENAME,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';
import {
  readBoundedJson,
  syncParentDirectoryBestEffort,
  writeJsonAtomically,
} from './persistence';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AppearanceEntry {
  locator: string;
  nodeId: string;
  seed: string;
}

interface AppearanceState {
  format: typeof PROJECT_APPEARANCE_FORMAT;
  formatVersion: typeof PROJECT_APPEARANCE_VERSION;
  projectId: string;
  projectSeed: string | null;
  nodes: AppearanceEntry[];
}

/** Current index position of every node, as `nodeId` to locator. */
export type NodeLocators = ReadonlyMap<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isProjectPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized !== '..' && !normalized.startsWith('../');
}

function emptyState(projectId: string): AppearanceState {
  return {
    format: PROJECT_APPEARANCE_FORMAT,
    formatVersion: PROJECT_APPEARANCE_VERSION,
    projectId,
    projectSeed: null,
    nodes: [],
  };
}

/**
 * Lenient by design: appearance is cosmetic, so anything unreadable degrades to
 * the global accent instead of failing the project. Unknown or malformed
 * entries are dropped individually.
 */
function parseState(value: unknown, projectId: string): AppearanceState {
  if (
    !isRecord(value) ||
    value.format !== PROJECT_APPEARANCE_FORMAT ||
    value.formatVersion !== PROJECT_APPEARANCE_VERSION ||
    value.projectId !== projectId ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > PROJECT_APPEARANCE_MAX_ENTRIES
  ) {
    return emptyState(projectId);
  }

  const seen = new Set<string>();
  const nodes = value.nodes.flatMap((entry) => {
    if (!isRecord(entry) || !isIdentifier(entry.nodeId) || seen.has(entry.nodeId)) {
      return [];
    }
    const seed = normalizeAppearanceSeed(entry.seed);
    if (!seed || !isProjectPath(entry.locator)) {
      return [];
    }
    seen.add(entry.nodeId);
    return [{ locator: entry.locator, nodeId: entry.nodeId, seed }];
  });

  return {
    format: PROJECT_APPEARANCE_FORMAT,
    formatVersion: PROJECT_APPEARANCE_VERSION,
    projectId,
    projectSeed: normalizeAppearanceSeed(value.projectSeed),
    nodes,
  };
}

export interface ProjectAppearanceState {
  projectSeed: string | null;
  seedsByNodeId: ReadonlyMap<string, string>;
}

export class ProjectAppearanceStore {
  private readonly fileSystem: ProjectFileSystem;
  private readonly filePath: string;
  private state?: AppearanceState;

  constructor(
    private readonly rootPath: string,
    private readonly projectId: string,
  ) {
    this.fileSystem = new ProjectFileSystem(rootPath);
    this.filePath = path.join(
      rootPath,
      PROJECT_METADATA_DIRECTORY,
      PROJECT_APPEARANCE_FILENAME,
    );
  }

  async read(locators: NodeLocators): Promise<ProjectAppearanceState> {
    await this.load();
    this.reconcile(locators);
    return {
      projectSeed: this.state!.projectSeed,
      seedsByNodeId: new Map(
        this.state!.nodes
          .filter((entry) => locators.has(entry.nodeId))
          .map((entry) => [entry.nodeId, entry.seed]),
      ),
    };
  }

  async setNode(
    nodeId: string,
    seed: string | null,
    locators: NodeLocators,
  ): Promise<void> {
    await this.load();
    this.reconcile(locators);

    const locator = locators.get(nodeId);
    const nodes = this.state!.nodes.filter((entry) => entry.nodeId !== nodeId);
    const normalized = normalizeAppearanceSeed(seed);
    if (normalized && locator) {
      if (nodes.length >= PROJECT_APPEARANCE_MAX_ENTRIES) {
        return;
      }
      nodes.push({ locator, nodeId, seed: normalized });
    }

    this.state!.nodes = nodes;
    await this.flush();
  }

  async setProject(seed: string | null, locators: NodeLocators): Promise<void> {
    await this.load();
    this.reconcile(locators);
    this.state!.projectSeed = normalizeAppearanceSeed(seed);
    await this.flush();
  }

  /**
   * Realigns stored entries with the index. A nodeId still present in the index
   * is authoritative, which covers in-app renames and moves; the locator is only
   * a recovery hint for when `rebuildIndex` regenerated every identity. Doing it
   * the other way round would hand a colour to a new item that happens to reuse
   * a freed path. Entries matching neither are kept as-is so that trashing and
   * restoring an item does not discard its colour; `read` filters them out until
   * they exist again.
   */
  private reconcile(locators: NodeLocators): void {
    const nodeIdByLocator = new Map(
      [...locators].map(([nodeId, locator]) => [locator, nodeId]),
    );
    const claimed = new Set(
      this.state!.nodes
        .filter((entry) => locators.has(entry.nodeId))
        .map((entry) => entry.nodeId),
    );

    this.state!.nodes = this.state!.nodes.map((entry) => {
      const currentLocator = locators.get(entry.nodeId);
      if (currentLocator) {
        return currentLocator === entry.locator
          ? entry
          : { ...entry, locator: currentLocator };
      }
      const adoptedNodeId = nodeIdByLocator.get(entry.locator);
      if (adoptedNodeId && !claimed.has(adoptedNodeId)) {
        claimed.add(adoptedNodeId);
        return { ...entry, nodeId: adoptedNodeId };
      }
      return entry;
    });
  }

  private async load(): Promise<void> {
    if (this.state) {
      return;
    }
    try {
      this.state = parseState(
        await readBoundedJson(this.filePath, PROJECT_APPEARANCE_MAX_BYTES, {
          containmentRoot: this.rootPath,
        }),
        this.projectId,
      );
    } catch {
      this.state = emptyState(this.projectId);
    }
  }

  private async flush(): Promise<void> {
    await this.fileSystem.validateMetadataFileForWrite(
      PROJECT_APPEARANCE_FILENAME,
    );
    if (this.state!.nodes.length === 0 && this.state!.projectSeed === null) {
      await this.remove();
      return;
    }
    await writeJsonAtomically(
      this.filePath,
      this.state,
      PROJECT_APPEARANCE_MAX_BYTES,
    );
  }

  private async remove(): Promise<void> {
    try {
      await rm(this.filePath);
      await syncParentDirectoryBestEffort(path.dirname(this.filePath));
    } catch (error) {
      const normalized = normalizeProjectError(error);
      if (normalized.code !== 'not-found') {
        throw normalized;
      }
    }
  }
}
