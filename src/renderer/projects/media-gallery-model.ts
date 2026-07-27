import type {
  MediaAsset,
  MediaFolder,
  MediaGallerySnapshot,
  MediaGallerySort,
  MediaGallerySearchScope,
  MediaGalleryEntryRef,
} from '../../shared/contracts';
import {
  mediaAssetMatchesQuery,
  mediaFolderMatchesQuery,
} from './media-gallery-query';

export type {
  MediaGalleryDensity,
  MediaGallerySearchScope,
  MediaGalleryViewMode,
} from '../../shared/contracts';

export type GalleryEntry =
  | { kind: 'folder'; id: string; folder: MediaFolder; path?: string }
  | { kind: 'asset'; id: string; asset: MediaAsset; path?: string };

export interface MediaGalleryModelOptions {
  folderId: string | null;
  query: string;
  scope: MediaGallerySearchScope;
  snapshot?: MediaGallerySnapshot;
  sort: MediaGallerySort;
  usageCounts?: ReadonlyMap<string, number>;
}

export function mediaFolderPath(
  folder: MediaFolder,
  folderById: ReadonlyMap<string, MediaFolder>,
): string {
  const names = [folder.name];
  const visited = new Set([folder.folderId]);
  let parentId = folder.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = folderById.get(parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return `Media/${names.join('/')}`;
}

function entryName(entry: GalleryEntry): string {
  return entry.kind === 'folder'
    ? entry.folder.name
    : `${entry.asset.name}${entry.asset.extension}`;
}

export function compareMediaGalleryEntries(
  sort: MediaGallerySort,
  left: GalleryEntry,
  right: GalleryEntry,
): number {
  if (left.kind !== right.kind) {
    return left.kind === 'folder' ? -1 : 1;
  }
  const leftName = entryName(left);
  const rightName = entryName(right);
  if (left.kind === 'folder' || right.kind === 'folder') {
    return leftName.localeCompare(rightName, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  switch (sort) {
    case 'name-descending':
      return rightName.localeCompare(leftName, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    case 'date-newest':
      return (
        Date.parse(right.asset.modifiedAt) - Date.parse(left.asset.modifiedAt)
      );
    case 'date-oldest':
      return (
        Date.parse(left.asset.modifiedAt) - Date.parse(right.asset.modifiedAt)
      );
    case 'size-largest':
      return right.asset.sizeBytes - left.asset.sizeBytes;
    case 'size-smallest':
      return left.asset.sizeBytes - right.asset.sizeBytes;
    case 'type':
      return (
        left.asset.extension.localeCompare(right.asset.extension) ||
        leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
      );
    case 'name-ascending':
      return leftName.localeCompare(rightName, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
  }
}

export function buildMediaGalleryEntries({
  folderId,
  query,
  scope,
  snapshot,
  sort,
  usageCounts,
}: MediaGalleryModelOptions): readonly GalleryEntry[] {
  if (!snapshot) {
    return [];
  }
  const normalizedQuery = query.trim();
  const folderById = new Map(
    snapshot.folders.map((folder) => [folder.folderId, folder]),
  );
  const folders = snapshot.folders
    .filter((folder) =>
      normalizedQuery
        ? (scope === 'all' || folder.parentId === folderId) &&
          mediaFolderMatchesQuery(
            folder,
            mediaFolderPath(folder, folderById),
            normalizedQuery,
          )
        : folder.parentId === folderId,
    )
    .map(
      (folder): GalleryEntry => ({
        kind: 'folder',
        id: folder.folderId,
        folder,
        path: mediaFolderPath(folder, folderById),
      }),
    );
  const assets = snapshot.assets
    .filter(
      (asset) =>
        asset.kind === 'image' &&
        (normalizedQuery
          ? (scope === 'all' || asset.folderId === folderId) &&
            mediaAssetMatchesQuery(
              asset,
              normalizedQuery,
              usageCounts?.get(asset.assetId),
            )
          : asset.folderId === folderId),
    )
    .map(
      (asset): GalleryEntry => ({
        kind: 'asset',
        id: asset.assetId,
        asset,
        path: asset.relativePath,
      }),
    );
  return [...folders, ...assets].sort((left, right) =>
    compareMediaGalleryEntries(sort, left, right),
  );
}

export function mediaGalleryEntryName(entry: GalleryEntry): string {
  return entryName(entry);
}

export function formatMediaBytes(size: number): string {
  if (size < 1_024) {
    return `${size} B`;
  }
  if (size < 1_024 ** 2) {
    return `${(size / 1_024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  }
  return `${(size / 1_024 ** 2).toFixed(size < 10 * 1_024 ** 2 ? 1 : 0)} MB`;
}

export function formatMediaDimensions(asset: MediaAsset): string {
  return asset.pixelWidth && asset.pixelHeight
    ? `${asset.pixelWidth} × ${asset.pixelHeight}`
    : '—';
}

export function canMoveMediaGalleryEntries(
  entries: readonly MediaGalleryEntryRef[],
  parentId: string | null,
  snapshot?: MediaGallerySnapshot,
): boolean {
  if (!snapshot || entries.length === 0) {
    return false;
  }
  const folders = new Map(
    snapshot.folders.map((folder) => [folder.folderId, folder]),
  );
  for (const entry of entries) {
    if (entry.kind !== 'folder') {
      continue;
    }
    if (entry.entryId === parentId) {
      return false;
    }
    let cursor = parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === entry.entryId) {
        return false;
      }
      visited.add(cursor);
      cursor = folders.get(cursor)?.parentId ?? null;
    }
  }
  return entries.some((entry) => {
    if (entry.kind === 'folder') {
      return folders.get(entry.entryId)?.parentId !== parentId;
    }
    return (
      snapshot.assets.find(({ assetId }) => assetId === entry.entryId)
        ?.folderId !== parentId
    );
  });
}
