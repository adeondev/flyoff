import { rm } from 'node:fs/promises';
import path from 'node:path';

import { PROJECT_INDEX_MAX_BYTES } from '../../shared/contracts/projects';
import {
  extractMarkdownStructure,
  type InternalLinkOccurrence,
  type InternalLinkSyntax,
} from '../../shared/markdown';
import { ProjectOperationError, normalizeProjectError } from './errors';
import { ProjectFileSystem } from './project-filesystem';
import {
  PROJECT_LINK_MAINTENANCE_FILENAME,
  PROJECT_METADATA_DIRECTORY,
} from './project-paths';
import {
  readBoundedJson,
  syncParentDirectoryBestEffort,
  writeJsonAtomically,
} from './persistence';

const LINK_MAINTENANCE_FORMAT = 'flyoff-link-maintenance';
const LINK_MAINTENANCE_VERSION = 1;
const MARKDOWN_EXTENSION = /\.md$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LinkPathAlias {
  nodeId: string;
  path: string;
  sequence: number;
}

interface PendingLinkMaintenance {
  nodeId: string;
  sourcePath: string;
  since: number;
}

interface LinkMaintenanceState {
  format: typeof LINK_MAINTENANCE_FORMAT;
  formatVersion: typeof LINK_MAINTENANCE_VERSION;
  projectId: string;
  sequence: number;
  aliases: LinkPathAlias[];
  pending: PendingLinkMaintenance[];
}

export interface StagedLinkMaintenance {
  rollback: () => Promise<void>;
}

export interface LinkMaintenanceRewrite {
  content: string;
  pending: boolean;
}

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

function isSequence(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseState(
  value: unknown,
  projectId: string,
): LinkMaintenanceState | undefined {
  if (
    !isRecord(value) ||
    value.format !== LINK_MAINTENANCE_FORMAT ||
    value.formatVersion !== LINK_MAINTENANCE_VERSION ||
    value.projectId !== projectId ||
    !isSequence(value.sequence) ||
    !Array.isArray(value.aliases) ||
    value.aliases.length > 250_000 ||
    !Array.isArray(value.pending) ||
    value.pending.length > 250_000
  ) {
    return undefined;
  }

  const sequence = value.sequence as number;
  const aliases = value.aliases.flatMap((alias) =>
    isRecord(alias) &&
    Object.keys(alias).length === 3 &&
    isIdentifier(alias.nodeId) &&
    isProjectPath(alias.path) &&
    isSequence(alias.sequence) &&
    alias.sequence > 0 &&
    alias.sequence <= sequence
      ? [
          {
            nodeId: alias.nodeId,
            path: alias.path,
            sequence: alias.sequence,
          },
        ]
      : [],
  );
  const pending = value.pending.flatMap((entry) =>
    isRecord(entry) &&
    Object.keys(entry).length === 3 &&
    isIdentifier(entry.nodeId) &&
    isProjectPath(entry.sourcePath) &&
    isSequence(entry.since) &&
    entry.since > 0 &&
    entry.since <= sequence
      ? [
          {
            nodeId: entry.nodeId,
            sourcePath: entry.sourcePath,
            since: entry.since,
          },
        ]
      : [],
  );
  if (
    aliases.length !== value.aliases.length ||
    pending.length !== value.pending.length ||
    new Set(pending.map(({ nodeId }) => nodeId)).size !== pending.length
  ) {
    return undefined;
  }

  return {
    format: LINK_MAINTENANCE_FORMAT,
    formatVersion: LINK_MAINTENANCE_VERSION,
    projectId,
    sequence,
    aliases,
    pending,
  };
}

function emptyState(projectId: string): LinkMaintenanceState {
  return {
    format: LINK_MAINTENANCE_FORMAT,
    formatVersion: LINK_MAINTENANCE_VERSION,
    projectId,
    sequence: 0,
    aliases: [],
    pending: [],
  };
}

function cloneState(state: LinkMaintenanceState): LinkMaintenanceState {
  return {
    ...state,
    aliases: state.aliases.map((alias) => ({ ...alias })),
    pending: state.pending.map((entry) => ({ ...entry })),
  };
}

function withoutMarkdownExtension(value: string): string {
  return value.replace(MARKDOWN_EXTENSION, '');
}

function comparePath(value: string): string {
  return withoutMarkdownExtension(value)
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .toLocaleLowerCase();
}

function normalizedRelativePath(
  sourcePath: string,
  requestedPath: string,
  syntax: InternalLinkSyntax,
): string | null {
  if (!requestedPath) {
    return comparePath(sourcePath);
  }

  const clean = requestedPath.replaceAll('\\', '/');
  const sourceDirectory = path.posix.dirname(sourcePath);
  let candidate: string;
  if (syntax === 'markdown') {
    candidate = clean.startsWith('/')
      ? clean.slice(1)
      : path.posix.join(sourceDirectory, clean);
  } else if (clean.includes('/')) {
    candidate = clean.replace(/^\/+/, '');
  } else {
    return null;
  }

  const normalized = path.posix.normalize(candidate);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return comparePath(normalized);
}

function uniqueNodeId(values: readonly string[]): string | undefined {
  const identifiers = [...new Set(values)];
  return identifiers.length === 1 ? identifiers[0] : undefined;
}

function resolveLinkTarget(
  link: InternalLinkOccurrence,
  pending: PendingLinkMaintenance,
  aliases: readonly LinkPathAlias[],
  currentPaths: ReadonlyMap<string, string>,
): string | undefined {
  if (!link.path) {
    return pending.nodeId;
  }

  const applicableAliases = aliases.filter(
    ({ sequence }) => sequence >= pending.since,
  );
  const normalized = normalizedRelativePath(
    pending.sourcePath,
    link.path,
    link.syntax,
  );
  if (normalized !== null) {
    const historical = uniqueNodeId(
      applicableAliases
        .filter((alias) => comparePath(alias.path) === normalized)
        .map(({ nodeId }) => nodeId),
    );
    if (historical) {
      return historical;
    }
    return uniqueNodeId(
      [...currentPaths]
        .filter(([, targetPath]) => comparePath(targetPath) === normalized)
        .map(([nodeId]) => nodeId),
    );
  }

  if (link.syntax !== 'wikilink' || link.path.includes('/')) {
    return undefined;
  }
  const requestedName = comparePath(path.posix.basename(link.path));
  const historical = uniqueNodeId(
    applicableAliases
      .filter(
        (alias) =>
          comparePath(path.posix.basename(alias.path)) === requestedName,
      )
      .map(({ nodeId }) => nodeId),
  );
  if (historical) {
    return historical;
  }
  return uniqueNodeId(
    [...currentPaths]
      .filter(
        ([, targetPath]) =>
          comparePath(path.posix.basename(targetPath)) === requestedName,
      )
      .map(([nodeId]) => nodeId),
  );
}

function encodeMarkdownPath(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function rewrittenLinkDestination(
  link: InternalLinkOccurrence,
  nextSourcePath: string,
  nextTargetPath: string,
  nextTargetPaths: ReadonlyMap<string, string>,
): string {
  if (!link.path) {
    return link.destination;
  }

  const hashAt = link.destination.indexOf('#');
  const fragment = hashAt === -1 ? '' : link.destination.slice(hashAt);
  const hadExtension = MARKDOWN_EXTENSION.test(link.path);
  const targetWithoutExtension = withoutMarkdownExtension(nextTargetPath);

  if (link.syntax === 'wikilink') {
    let destination: string;
    if (!link.path.includes('/')) {
      const targetName = path.posix.basename(targetWithoutExtension);
      const matches = [...nextTargetPaths.values()].filter(
        (candidate) =>
          path.posix
            .basename(withoutMarkdownExtension(candidate))
            .localeCompare(targetName, undefined, {
              sensitivity: 'base',
            }) === 0,
      );
      destination =
        matches.length === 1 ? targetName : targetWithoutExtension;
    } else {
      destination = targetWithoutExtension;
      if (link.path.startsWith('/')) {
        destination = `/${destination}`;
      }
    }
    if (hadExtension) {
      destination += '.md';
    }
    return `${destination}${fragment}`;
  }

  let destination = link.path.startsWith('/')
    ? `/${targetWithoutExtension}`
    : path.posix.relative(
        path.posix.dirname(nextSourcePath),
        targetWithoutExtension,
      );
  if (!destination) {
    destination = path.posix.basename(targetWithoutExtension);
  }
  if (hadExtension) {
    destination += '.md';
  }
  return `${encodeMarkdownPath(destination)}${fragment}`;
}

export class ProjectLinkMaintenanceStore {
  private readonly fileSystem: ProjectFileSystem;
  private readonly filePath: string;
  private state?: LinkMaintenanceState;

  constructor(
    private readonly rootPath: string,
    private readonly projectId: string,
  ) {
    this.fileSystem = new ProjectFileSystem(rootPath);
    this.filePath = path.join(
      rootPath,
      PROJECT_METADATA_DIRECTORY,
      PROJECT_LINK_MAINTENANCE_FILENAME,
    );
  }

  async stage(
    beforePaths: ReadonlyMap<string, string>,
    afterPaths: ReadonlyMap<string, string>,
    lockedNodeIds: readonly string[],
  ): Promise<StagedLinkMaintenance> {
    if (lockedNodeIds.length === 0) {
      return { rollback: async () => undefined };
    }
    await this.load();
    const previous = cloneState(this.state!);
    const changed = [...beforePaths].filter(
      ([nodeId, before]) => afterPaths.get(nodeId) !== before,
    );
    if (changed.length === 0) {
      return { rollback: async () => undefined };
    }
    const pendingIds = new Set(
      this.state!.pending.map(({ nodeId }) => nodeId),
    );
    const addedPending = lockedNodeIds.filter(
      (nodeId) => beforePaths.has(nodeId) && !pendingIds.has(nodeId),
    ).length;
    if (
      this.state!.aliases.length + changed.length > 250_000 ||
      this.state!.pending.length + addedPending > 250_000
    ) {
      throw new ProjectOperationError(
        'size-exceeded',
        'Project link maintenance history is full.',
      );
    }
    if (this.state!.sequence === Number.MAX_SAFE_INTEGER) {
      throw new ProjectOperationError(
        'size-exceeded',
        'Project link maintenance history is full.',
      );
    }

    const sequence = this.state!.sequence + 1;
    this.state!.sequence = sequence;
    for (const [nodeId, beforePath] of changed) {
      this.state!.aliases.push({ nodeId, path: beforePath, sequence });
    }
    for (const nodeId of lockedNodeIds) {
      const sourcePath = beforePaths.get(nodeId);
      if (sourcePath && !pendingIds.has(nodeId)) {
        this.state!.pending.push({
          nodeId,
          sourcePath,
          since: sequence,
        });
      }
    }
    try {
      await this.persist();
    } catch (error) {
      this.state = previous;
      throw error;
    }

    return {
      rollback: async () => {
        this.state = previous;
        if (previous.pending.length === 0) {
          await this.remove();
        } else {
          await this.persist();
        }
      },
    };
  }

  async rewrite(
    nodeId: string,
    content: string,
    currentPaths: ReadonlyMap<string, string>,
  ): Promise<LinkMaintenanceRewrite> {
    await this.load();
    const pending = this.state!.pending.find(
      (entry) => entry.nodeId === nodeId,
    );
    const nextSourcePath = currentPaths.get(nodeId);
    if (!pending || !nextSourcePath) {
      return { content, pending: false };
    }

    const edits: { end: number; start: number; value: string }[] = [];
    for (const link of extractMarkdownStructure(content).links) {
      const targetNodeId = resolveLinkTarget(
        link,
        pending,
        this.state!.aliases,
        currentPaths,
      );
      const nextTargetPath = targetNodeId
        ? currentPaths.get(targetNodeId)
        : undefined;
      if (!nextTargetPath) {
        continue;
      }
      const value = rewrittenLinkDestination(
        link,
        nextSourcePath,
        nextTargetPath,
        currentPaths,
      );
      if (value !== link.destination) {
        edits.push({
          end: link.destinationEnd,
          start: link.destinationStart,
          value,
        });
      }
    }

    let rewritten = content;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      rewritten =
        rewritten.slice(0, edit.start) +
        edit.value +
        rewritten.slice(edit.end);
    }
    return { content: rewritten, pending: true };
  }

  async complete(nodeId: string): Promise<void> {
    await this.load();
    const nextPending = this.state!.pending.filter(
      (entry) => entry.nodeId !== nodeId,
    );
    if (nextPending.length === this.state!.pending.length) {
      return;
    }
    this.state!.pending = nextPending;
    if (nextPending.length === 0) {
      this.state = emptyState(this.projectId);
      await this.remove();
      return;
    }
    await this.persist();
  }

  async reset(): Promise<void> {
    this.state = emptyState(this.projectId);
    await this.remove();
  }

  private async load(): Promise<void> {
    if (this.state) {
      return;
    }
    try {
      const parsed = parseState(
        await readBoundedJson(this.filePath, PROJECT_INDEX_MAX_BYTES, {
          containmentRoot: this.rootPath,
        }),
        this.projectId,
      );
      if (!parsed) {
        throw new ProjectOperationError(
          'invalid-format',
          'Project link maintenance data is invalid.',
        );
      }
      this.state = parsed;
    } catch (error) {
      const normalized = normalizeProjectError(error);
      if (normalized.code === 'not-found') {
        this.state = emptyState(this.projectId);
        return;
      }
      throw normalized;
    }
  }

  private async persist(): Promise<void> {
    await this.fileSystem.validateMetadataFileForWrite(
      PROJECT_LINK_MAINTENANCE_FILENAME,
    );
    await writeJsonAtomically(
      this.filePath,
      this.state,
      PROJECT_INDEX_MAX_BYTES,
    );
  }

  private async remove(): Promise<void> {
    await this.fileSystem.validateMetadataFileForWrite(
      PROJECT_LINK_MAINTENANCE_FILENAME,
    );
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
