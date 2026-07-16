import path from 'node:path';

import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  PROJECT_INDEX_FORMAT,
  PROJECT_INDEX_LEGACY_VERSION,
  PROJECT_INDEX_VERSION,
  isProjectInstanceTypeId,
  type ProjectTreeNode,
} from '../../shared/contracts/projects';
import { isPortableProjectName } from './portable-name';
import { getProjectPageStorageAdapter } from './project-storage-adapters';

export interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  projectId: string;
  name: string;
  createdAt: string;
}

interface ContentIndexEntryBase {
  nodeId: string;
  parentId: string | null;
  name: string;
  locator: string;
  sortOrder?: number;
}

export interface ContentIndexFolderEntry extends ContentIndexEntryBase {
  kind: 'folder';
}

export interface ContentIndexPageEntry extends ContentIndexEntryBase {
  kind: 'page';
  pageType: string;
}

export type ContentIndexEntry =
  | ContentIndexFolderEntry
  | ContentIndexPageEntry;

export interface ProjectContentIndex {
  format: typeof PROJECT_INDEX_FORMAT;
  formatVersion: typeof PROJECT_INDEX_VERSION;
  projectId: string;
  entries: ContentIndexEntry[];
}

export interface ParsedProjectContentIndex {
  index: ProjectContentIndex;
  migrated: boolean;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

export function isProjectManifest(value: unknown): value is ProjectManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.format === PROJECT_FORMAT &&
    value.formatVersion === PROJECT_FORMAT_VERSION &&
    isUuid(value.projectId) &&
    isPortableProjectName(value.name) &&
    isIsoDate(value.createdAt)
  );
}

export function isSafeProjectLocator(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value)
  ) {
    return false;
  }

  const segments = value.split('/');

  return segments.every(
    (segment) =>
      isPortableProjectName(segment) && segment.toLowerCase() !== '.flyoff',
  );
}

function parseContentIndexEntry(
  value: unknown,
  legacy: boolean,
): ContentIndexEntry | undefined {
  if (
    !isRecord(value) ||
    !isUuid(value.nodeId) ||
    (value.parentId !== null && !isUuid(value.parentId)) ||
    !isPortableProjectName(value.name) ||
    !isSafeProjectLocator(value.locator) ||
    (value.sortOrder !== undefined &&
      (typeof value.sortOrder !== 'number' ||
        !Number.isSafeInteger(value.sortOrder) ||
        value.sortOrder < 0))
  ) {
    return undefined;
  }

  const sortOrder = legacy ? undefined : (value.sortOrder as number | undefined);

  if (value.kind === 'folder') {
    return {
      nodeId: value.nodeId,
      parentId: value.parentId,
      name: value.name,
      locator: value.locator,
      kind: 'folder',
      ...(sortOrder === undefined ? {} : { sortOrder }),
    };
  }

  const pageType =
    legacy && value.pageType === 'markdown'
      ? 'markdown'
      : !legacy && isProjectInstanceTypeId(value.pageType)
        ? value.pageType
        : undefined;

  if (value.kind === 'page' && pageType) {
    return {
      nodeId: value.nodeId,
      parentId: value.parentId,
      name: value.name,
      locator: value.locator,
      kind: 'page',
      pageType,
      ...(sortOrder === undefined ? {} : { sortOrder }),
    };
  }

  return undefined;
}

function hasValidRelationships(entries: readonly ContentIndexEntry[]): boolean {
  const byId = new Map(entries.map((entry) => [entry.nodeId, entry]));

  for (const entry of entries) {
    const parent = entry.parentId === null ? undefined : byId.get(entry.parentId);

    if (entry.parentId !== null && parent?.kind !== 'folder') {
      return false;
    }

    const locatorParent = path.posix.dirname(entry.locator);
    const expectedParent = parent?.locator ?? '.';
    const actualDiskName = path.posix.basename(entry.locator);
    const adapter =
      entry.kind === 'page'
        ? getProjectPageStorageAdapter(entry.pageType)
        : undefined;
    const validDiskName = entry.kind === 'folder'
      ? actualDiskName === entry.name
      : adapter
        ? adapter.extensions.some(
            (extension) =>
              actualDiskName.slice(0, -extension.length) === entry.name &&
              actualDiskName.slice(-extension.length).toLocaleLowerCase() ===
                extension,
          )
        : actualDiskName.startsWith(`${entry.name}.`);

    if (locatorParent !== expectedParent || !validDiskName) {
      return false;
    }

    const ancestors = new Set<string>([entry.nodeId]);
    let cursor = parent;

    while (cursor) {
      if (ancestors.has(cursor.nodeId)) {
        return false;
      }

      ancestors.add(cursor.nodeId);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }

  return true;
}

export function parseProjectContentIndex(
  value: unknown,
  projectId: string,
): ParsedProjectContentIndex | undefined {
  const legacy =
    isRecord(value) &&
    value.formatVersion === PROJECT_INDEX_LEGACY_VERSION;
  if (
    !isRecord(value) ||
    value.format !== PROJECT_INDEX_FORMAT ||
    (!legacy && value.formatVersion !== PROJECT_INDEX_VERSION) ||
    value.projectId !== projectId ||
    !Array.isArray(value.entries)
  ) {
    return undefined;
  }

  const entries = value.entries.map((entry) =>
    parseContentIndexEntry(entry, legacy),
  );

  if (entries.some((entry) => !entry)) {
    return undefined;
  }

  const parsedEntries = entries as ContentIndexEntry[];
  const identifiers = new Set(parsedEntries.map(({ nodeId }) => nodeId));
  const locators = new Set(
    parsedEntries.map(({ locator }) => locator.toLowerCase()),
  );

  if (
    identifiers.size !== parsedEntries.length ||
    locators.size !== parsedEntries.length ||
    !hasValidRelationships(parsedEntries)
  ) {
    return undefined;
  }

  return {
    index: {
      format: PROJECT_INDEX_FORMAT,
      formatVersion: PROJECT_INDEX_VERSION,
      projectId,
      entries: parsedEntries,
    },
    migrated: legacy,
  };
}

export function toProjectTreeNode(entry: ContentIndexEntry): ProjectTreeNode {
  if (entry.kind === 'folder') {
    return {
      nodeId: entry.nodeId,
      parentId: entry.parentId,
      name: entry.name,
      kind: 'folder',
    };
  }

  return {
    nodeId: entry.nodeId,
    parentId: entry.parentId,
    name: entry.name,
    kind: 'page',
    pageType: entry.pageType,
  };
}
