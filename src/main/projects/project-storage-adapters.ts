import { isProjectInstanceTypeId } from '../../shared/contracts/projects';
import { ProjectOperationError } from './errors';

export interface ProjectPageStorageAdapter {
  pageType: string;
  extensions: readonly string[];
  initialContent: string;
  operations: readonly ProjectPageStorageOperation[];
}

export type ProjectPageStorageOperation =
  | 'create'
  | 'rename'
  | 'move'
  | 'trash'
  | 'read'
  | 'write';

const adapters = new Map<string, ProjectPageStorageAdapter>();
const extensionOwners = new Map<string, string>();

function normalizeExtension(extension: string): string {
  const normalized = extension.toLocaleLowerCase();
  if (!/^\.[a-z0-9][a-z0-9._-]{0,15}$/.test(normalized)) {
    throw new Error(`Invalid project page extension: ${extension}`);
  }
  return normalized;
}

export function registerProjectPageStorageAdapter(
  definition: ProjectPageStorageAdapter,
): () => void {
  if (!isProjectInstanceTypeId(definition.pageType)) {
    throw new Error(`Invalid project page type: ${definition.pageType}`);
  }
  if (adapters.has(definition.pageType)) {
    throw new Error(`Project page type already registered: ${definition.pageType}`);
  }

  const extensions = definition.extensions.map(normalizeExtension);
  for (const extension of extensions) {
    if (extensionOwners.has(extension)) {
      throw new Error(`Project page extension already registered: ${extension}`);
    }
  }

  const adapter = { ...definition, extensions };
  adapters.set(adapter.pageType, adapter);
  for (const extension of extensions) {
    extensionOwners.set(extension, adapter.pageType);
  }

  return () => {
    if (adapters.get(adapter.pageType) !== adapter) {
      return;
    }
    adapters.delete(adapter.pageType);
    for (const extension of extensions) {
      if (extensionOwners.get(extension) === adapter.pageType) {
        extensionOwners.delete(extension);
      }
    }
  };
}

export function getProjectPageStorageAdapter(
  pageType: string,
): ProjectPageStorageAdapter | undefined {
  return adapters.get(pageType);
}

export function requireProjectPageStorageAdapter(
  pageType: string,
): ProjectPageStorageAdapter {
  const adapter = getProjectPageStorageAdapter(pageType);
  if (!adapter) {
    throw new ProjectOperationError(
      'invalid-operation',
      `No storage adapter is available for project page type “${pageType}”.`,
    );
  }
  return adapter;
}

export function projectPageTypeForDiskName(
  diskName: string,
): string | undefined {
  return projectPageStorageMatch(diskName)?.pageType;
}

export function projectPageStorageMatch(
  diskName: string,
): { pageType: string; extension: string } | undefined {
  const lower = diskName.toLocaleLowerCase();
  const extension = [...extensionOwners.keys()]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => lower.endsWith(candidate));
  const pageType = extension ? extensionOwners.get(extension) : undefined;
  return extension && pageType ? { extension, pageType } : undefined;
}

export function projectPageDiskName(
  name: string,
  pageType: string,
): string {
  const adapter = requireProjectPageStorageAdapter(pageType);
  const extension = adapter.extensions[0];
  if (!extension) {
    throw new ProjectOperationError(
      'invalid-operation',
      `Project page type “${pageType}” has no file extension.`,
    );
  }
  return `${name}${extension}`;
}

registerProjectPageStorageAdapter({
  pageType: 'markdown',
  extensions: ['.md'],
  initialContent: '',
  operations: ['create', 'rename', 'move', 'trash', 'read', 'write'],
});

registerProjectPageStorageAdapter({
  pageType: 'diagram',
  extensions: ['.flyd'],
  initialContent: '',
  operations: ['create', 'rename', 'move', 'trash', 'read', 'write'],
});

registerProjectPageStorageAdapter({
  pageType: 'media:image',
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'],
  initialContent: '',
  operations: ['rename', 'move', 'trash', 'read'],
});

registerProjectPageStorageAdapter({
  pageType: 'media:video',
  extensions: ['.mp4', '.m4v', '.webm', '.ogv'],
  initialContent: '',
  operations: ['rename', 'move', 'trash', 'read'],
});

registerProjectPageStorageAdapter({
  pageType: 'media:audio',
  extensions: [
    '.mp3',
    '.m4a',
    '.aac',
    '.wav',
    '.ogg',
    '.oga',
    '.opus',
    '.flac',
  ],
  initialContent: '',
  operations: ['rename', 'move', 'trash', 'read'],
});
