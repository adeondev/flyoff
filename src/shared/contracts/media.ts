import {
  isPortableProjectName,
  isProjectIdentifier,
  isProjectTreeNode,
  type ProjectPageNode,
} from './projects';

export const PROJECT_MEDIA_IPC_CHANNELS = {
  selectImport: 'flyoff:projects:media:import:select',
  importPaths: 'flyoff:projects:media:import:paths',
  getAsset: 'flyoff:projects:media:asset:get',
  listUsages: 'flyoff:projects:media:usages:list',
  getSnapshot: 'flyoff:projects:media:snapshot:get',
  createFolder: 'flyoff:projects:media:folder:create',
  createFolderWithEntries:
    'flyoff:projects:media:folder:create-with-entries',
  renameEntry: 'flyoff:projects:media:entry:rename',
  moveEntries: 'flyoff:projects:media:entries:move',
  trashEntries: 'flyoff:projects:media:entries:trash',
  startImport: 'flyoff:projects:media:import:start',
  cancelImport: 'flyoff:projects:media:import:cancel',
  importProgress: 'flyoff:projects:media:import:progress',
} as const;

export type ProjectMediaKind = 'image' | 'video' | 'audio';
export type MediaGalleryViewMode = 'details' | 'grid' | 'list';
export type MediaGalleryDensity = 'compact' | 'large' | 'normal';
export type MediaGallerySearchScope = 'all' | 'folder';

export type MediaGallerySort =
  | 'name-ascending'
  | 'name-descending'
  | 'date-newest'
  | 'date-oldest'
  | 'size-largest'
  | 'size-smallest'
  | 'type';

export interface MediaGalleryViewState {
  version: 1;
  viewMode: MediaGalleryViewMode;
  density: MediaGalleryDensity;
  searchScope: MediaGallerySearchScope;
  sort: MediaGallerySort;
  folderId: string | null;
  history: readonly (string | null)[];
}

export interface MediaFolder {
  folderId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  modifiedAt: string;
  sortOrder: number;
}

export interface MediaAsset {
  assetId: string;
  folderId: string | null;
  name: string;
  extension: string;
  kind: ProjectMediaKind;
  mimeType: string;
  sizeBytes: number;
  pixelWidth: number | null;
  pixelHeight: number | null;
  createdAt: string;
  modifiedAt: string;
  revision: string;
  relativePath: string;
}

export interface MediaGallerySnapshot {
  projectId: string;
  folders: readonly MediaFolder[];
  assets: readonly MediaAsset[];
  revision: string;
}

export interface CreateMediaFolderRequest {
  parentId: string | null;
  name: string;
  expectedRevision?: string;
}

export interface CreateMediaFolderWithEntriesRequest
  extends CreateMediaFolderRequest {
  entries: readonly MediaGalleryEntryRef[];
}

export interface RenameMediaEntryRequest {
  entryId: string;
  kind: 'folder' | 'asset';
  name: string;
  expectedRevision?: string;
}

export interface MediaGalleryEntryRef {
  entryId: string;
  kind: 'folder' | 'asset';
}

export interface MoveMediaEntriesRequest {
  entries: readonly MediaGalleryEntryRef[];
  parentId: string | null;
  expectedRevision?: string;
}

export interface TrashMediaEntriesRequest {
  entries: readonly MediaGalleryEntryRef[];
  confirmed?: boolean;
  expectedRevision?: string;
}

export interface ProjectMediaAsset {
  nodeId: string;
  parentId: string | null;
  name: string;
  extension: string;
  kind: ProjectMediaKind;
  mimeType: string;
  sizeBytes: number;
  relativePath: string;
  pixelWidth?: number | null;
  pixelHeight?: number | null;
  revision?: string;
}

export interface ImportProjectMediaRequest {
  parentId: string | null;
  folderId?: string | null;
}

export interface ImportProjectMediaPathsRequest
  extends ImportProjectMediaRequest {
  paths: readonly string[];
}

export interface ImportProjectMediaOutcome {
  assets: readonly ProjectMediaAsset[];
  nodes: readonly ProjectPageNode[];
}

export interface StartProjectMediaImportOutcome {
  operationId: string;
}

export interface CancelProjectMediaImportRequest {
  operationId: string;
}

export interface ProjectMediaImportProgress {
  operationId: string;
  completed: number;
  currentName: string;
  failed: number;
  total: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  outcome?: ImportProjectMediaOutcome;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetProjectMediaAssetRequest {
  nodeId: string;
}

export interface ListProjectMediaUsagesRequest {
  nodeId: string;
}

export interface ProjectMediaUsage {
  noteNodeId: string;
  noteName: string;
  notePath: string;
  count: number;
}

interface MediaDefinition {
  kind: ProjectMediaKind;
  mimeType: string;
  pageType: `media:${ProjectMediaKind}`;
}

const definitions: Readonly<Record<string, MediaDefinition>> = {
  '.png': { kind: 'image', mimeType: 'image/png', pageType: 'media:image' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg', pageType: 'media:image' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg', pageType: 'media:image' },
  '.webp': { kind: 'image', mimeType: 'image/webp', pageType: 'media:image' },
  '.gif': { kind: 'image', mimeType: 'image/gif', pageType: 'media:image' },
  '.avif': { kind: 'image', mimeType: 'image/avif', pageType: 'media:image' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4', pageType: 'media:video' },
  '.m4v': { kind: 'video', mimeType: 'video/mp4', pageType: 'media:video' },
  '.webm': { kind: 'video', mimeType: 'video/webm', pageType: 'media:video' },
  '.ogv': { kind: 'video', mimeType: 'video/ogg', pageType: 'media:video' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg', pageType: 'media:audio' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4', pageType: 'media:audio' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac', pageType: 'media:audio' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav', pageType: 'media:audio' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg', pageType: 'media:audio' },
  '.oga': { kind: 'audio', mimeType: 'audio/ogg', pageType: 'media:audio' },
  '.opus': { kind: 'audio', mimeType: 'audio/ogg', pageType: 'media:audio' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac', pageType: 'media:audio' },
};

export const PROJECT_MEDIA_EXTENSIONS = Object.freeze(
  Object.keys(definitions),
);

export function projectMediaDefinition(
  extension: string,
): MediaDefinition | undefined {
  return definitions[extension.toLowerCase()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasParentId(value: Record<string, unknown>): boolean {
  return value.parentId === null || isProjectIdentifier(value.parentId);
}

function hasOptionalFolderId(value: Record<string, unknown>): boolean {
  return (
    value.folderId === undefined ||
    value.folderId === null ||
    isProjectIdentifier(value.folderId)
  );
}

export function isImportProjectMediaRequest(
  value: unknown,
): value is ImportProjectMediaRequest {
  return isRecord(value) && hasParentId(value) && hasOptionalFolderId(value);
}

export function isImportProjectMediaPathsRequest(
  value: unknown,
): value is ImportProjectMediaPathsRequest {
  return (
    isRecord(value) &&
    hasParentId(value) &&
    hasOptionalFolderId(value) &&
    Array.isArray(value.paths) &&
    value.paths.length > 0 &&
    value.paths.length <= 500 &&
    value.paths.every(
      (candidate) =>
        typeof candidate === 'string' &&
        candidate.length > 0 &&
        candidate.length <= 32_768,
    )
  );
}

export function isCancelProjectMediaImportRequest(
  value: unknown,
): value is CancelProjectMediaImportRequest {
  return isRecord(value) && isProjectIdentifier(value.operationId);
}

export function isStartProjectMediaImportOutcome(
  value: unknown,
): value is StartProjectMediaImportOutcome {
  return isRecord(value) && isProjectIdentifier(value.operationId);
}

export function isProjectMediaImportProgress(
  value: unknown,
): value is ProjectMediaImportProgress {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.operationId) &&
    Number.isSafeInteger(value.completed) &&
    Number(value.completed) >= 0 &&
    typeof value.currentName === 'string' &&
    Number.isSafeInteger(value.failed) &&
    Number(value.failed) >= 0 &&
    Number.isSafeInteger(value.total) &&
    Number(value.total) >= 0 &&
    (value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'cancelled' ||
      value.status === 'failed') &&
    (value.outcome === undefined ||
      isImportProjectMediaOutcome(value.outcome)) &&
    (value.error === undefined ||
      (isRecord(value.error) &&
        typeof value.error.code === 'string' &&
        typeof value.error.message === 'string'))
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function hasOptionalExpectedRevision(value: Record<string, unknown>): boolean {
  return value.expectedRevision === undefined || isRevision(value.expectedRevision);
}

export function isMediaFolder(value: unknown): value is MediaFolder {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.folderId) &&
    (value.parentId === null || isProjectIdentifier(value.parentId)) &&
    isPortableProjectName(value.name) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.modifiedAt) &&
    Number.isSafeInteger(value.sortOrder) &&
    Number(value.sortOrder) >= 0
  );
}

export function isMediaAsset(value: unknown): value is MediaAsset {
  if (
    !isRecord(value) ||
    !isProjectIdentifier(value.assetId) ||
    (value.folderId !== null && !isProjectIdentifier(value.folderId)) ||
    !isPortableProjectName(value.name) ||
    typeof value.extension !== 'string' ||
    !projectMediaDefinition(value.extension) ||
    (value.kind !== 'image' &&
      value.kind !== 'video' &&
      value.kind !== 'audio') ||
    typeof value.mimeType !== 'string' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    Number(value.sizeBytes) < 0 ||
    !(
      (value.pixelWidth === null && value.pixelHeight === null) ||
      (Number.isSafeInteger(value.pixelWidth) &&
        Number(value.pixelWidth) > 0 &&
        Number.isSafeInteger(value.pixelHeight) &&
        Number(value.pixelHeight) > 0)
    ) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.modifiedAt) ||
    !isRevision(value.revision) ||
    typeof value.relativePath !== 'string' ||
    value.relativePath.length === 0 ||
    value.relativePath.length > 32_768 ||
    (value.pixelWidth !== undefined &&
      value.pixelWidth !== null &&
      (!Number.isSafeInteger(value.pixelWidth) ||
        Number(value.pixelWidth) <= 0)) ||
    (value.pixelHeight !== undefined &&
      value.pixelHeight !== null &&
      (!Number.isSafeInteger(value.pixelHeight) ||
        Number(value.pixelHeight) <= 0)) ||
    (value.revision !== undefined &&
      (typeof value.revision !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(value.revision)))
  ) {
    return false;
  }
  const definition = projectMediaDefinition(value.extension);
  return definition?.kind === value.kind && definition.mimeType === value.mimeType;
}

export function isMediaGallerySnapshot(
  value: unknown,
): value is MediaGallerySnapshot {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.projectId) &&
    Array.isArray(value.folders) &&
    value.folders.every(isMediaFolder) &&
    Array.isArray(value.assets) &&
    value.assets.every(isMediaAsset) &&
    isRevision(value.revision)
  );
}

export function isCreateMediaFolderRequest(
  value: unknown,
): value is CreateMediaFolderRequest {
  return (
    isRecord(value) &&
    (value.parentId === null || isProjectIdentifier(value.parentId)) &&
    isPortableProjectName(value.name) &&
    hasOptionalExpectedRevision(value)
  );
}

export function isCreateMediaFolderWithEntriesRequest(
  value: unknown,
): value is CreateMediaFolderWithEntriesRequest {
  return (
    isRecord(value) &&
    isCreateMediaFolderRequest(value) &&
    isEntryBatch(value.entries)
  );
}

export function isRenameMediaEntryRequest(
  value: unknown,
): value is RenameMediaEntryRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.entryId) &&
    (value.kind === 'folder' || value.kind === 'asset') &&
    isPortableProjectName(value.name) &&
    hasOptionalExpectedRevision(value)
  );
}

function isEntryBatch(
  value: unknown,
): value is readonly MediaGalleryEntryRef[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 500 &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        isProjectIdentifier(entry.entryId) &&
        (entry.kind === 'folder' || entry.kind === 'asset'),
    ) &&
    new Set(
      value.map(
        (entry) =>
          `${(entry as MediaGalleryEntryRef).kind}:${(entry as MediaGalleryEntryRef).entryId}`,
      ),
    ).size === value.length
  );
}

export function isMoveMediaEntriesRequest(
  value: unknown,
): value is MoveMediaEntriesRequest {
  return (
    isRecord(value) &&
    isEntryBatch(value.entries) &&
    (value.parentId === null || isProjectIdentifier(value.parentId)) &&
    hasOptionalExpectedRevision(value)
  );
}

export function isTrashMediaEntriesRequest(
  value: unknown,
): value is TrashMediaEntriesRequest {
  return (
    isRecord(value) &&
    isEntryBatch(value.entries) &&
    (value.confirmed === undefined || typeof value.confirmed === 'boolean') &&
    hasOptionalExpectedRevision(value)
  );
}

export function isGetProjectMediaAssetRequest(
  value: unknown,
): value is GetProjectMediaAssetRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export const isListProjectMediaUsagesRequest =
  isGetProjectMediaAssetRequest;

export function isProjectMediaAsset(
  value: unknown,
): value is ProjectMediaAsset {
  if (
    !isRecord(value) ||
    !isProjectIdentifier(value.nodeId) ||
    (value.parentId !== null && !isProjectIdentifier(value.parentId)) ||
    !isPortableProjectName(value.name) ||
    typeof value.extension !== 'string' ||
    !projectMediaDefinition(value.extension) ||
    (value.kind !== 'image' &&
      value.kind !== 'video' &&
      value.kind !== 'audio') ||
    typeof value.mimeType !== 'string' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    Number(value.sizeBytes) < 0 ||
    typeof value.relativePath !== 'string' ||
    value.relativePath.length === 0 ||
    value.relativePath.length > 32_768
  ) {
    return false;
  }
  const definition = projectMediaDefinition(value.extension);
  return definition?.kind === value.kind && definition.mimeType === value.mimeType;
}

export function isImportProjectMediaOutcome(
  value: unknown,
): value is ImportProjectMediaOutcome {
  return (
    isRecord(value) &&
    Array.isArray(value.assets) &&
    value.assets.length > 0 &&
    value.assets.length <= 500 &&
    value.assets.every(isProjectMediaAsset) &&
    Array.isArray(value.nodes) &&
    value.nodes.length === value.assets.length &&
    value.nodes.every(
      (node) =>
        isProjectTreeNode(node) &&
        node.kind === 'page' &&
        node.pageType.startsWith('media:'),
    )
  );
}

export function isProjectMediaUsage(
  value: unknown,
): value is ProjectMediaUsage {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.noteNodeId) &&
    isPortableProjectName(value.noteName) &&
    typeof value.notePath === 'string' &&
    value.notePath.length > 0 &&
    value.notePath.length <= 32_768 &&
    Number.isSafeInteger(value.count) &&
    Number(value.count) > 0
  );
}

export function isProjectMediaUsageList(
  value: unknown,
): value is readonly ProjectMediaUsage[] {
  return (
    Array.isArray(value) &&
    value.length <= 250_000 &&
    value.every(isProjectMediaUsage)
  );
}
