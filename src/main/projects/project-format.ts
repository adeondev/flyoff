import path from 'node:path';

import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  PROJECT_INDEX_FORMAT,
  PROJECT_INDEX_VERSION,
  type ProjectTreeNode,
} from '../../shared/contracts/projects';
import { isPortableProjectName } from './portable-name';

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
}

export interface ContentIndexFolderEntry extends ContentIndexEntryBase {
  kind: 'folder';
}

export interface ContentIndexPageEntry extends ContentIndexEntryBase {
  kind: 'page';
  pageType: 'markdown';
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

function parseContentIndexEntry(value: unknown): ContentIndexEntry | undefined {
  if (
    !isRecord(value) ||
    !isUuid(value.nodeId) ||
    (value.parentId !== null && !isUuid(value.parentId)) ||
    !isPortableProjectName(value.name) ||
    !isSafeProjectLocator(value.locator)
  ) {
    return undefined;
  }

  if (value.kind === 'folder') {
    return {
      nodeId: value.nodeId,
      parentId: value.parentId,
      name: value.name,
      locator: value.locator,
      kind: 'folder',
    };
  }

  if (value.kind === 'page' && value.pageType === 'markdown') {
    return {
      nodeId: value.nodeId,
      parentId: value.parentId,
      name: value.name,
      locator: value.locator,
      kind: 'page',
      pageType: 'markdown',
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
    const validDiskName =
      entry.kind === 'folder'
        ? actualDiskName === entry.name
        : actualDiskName.slice(0, -3) === entry.name &&
          actualDiskName.slice(-3).toLowerCase() === '.md';

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
): ProjectContentIndex | undefined {
  if (
    !isRecord(value) ||
    value.format !== PROJECT_INDEX_FORMAT ||
    value.formatVersion !== PROJECT_INDEX_VERSION ||
    value.projectId !== projectId ||
    !Array.isArray(value.entries)
  ) {
    return undefined;
  }

  const entries = value.entries.map(parseContentIndexEntry);

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
    format: PROJECT_INDEX_FORMAT,
    formatVersion: PROJECT_INDEX_VERSION,
    projectId,
    entries: parsedEntries,
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
