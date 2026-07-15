export const PROJECT_FORMAT = 'flyoff-project' as const;
export const PROJECT_FORMAT_VERSION = 1 as const;
export const PROJECT_INDEX_FORMAT = 'flyoff-content-index' as const;
export const PROJECT_INDEX_VERSION = 1 as const;

export const PROJECT_MANIFEST_MAX_BYTES = 64 * 1024;
export const PROJECT_INDEX_MAX_BYTES = 32 * 1024 * 1024;
export const MARKDOWN_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const PROJECT_NAME_MAX_LENGTH = 100;

export const PROJECT_IPC_CHANNELS = {
  selectCreateLocation: 'flyoff:projects:create-location:select',
  create: 'flyoff:projects:create',
  open: 'flyoff:projects:open',
  restore: 'flyoff:projects:restore',
  close: 'flyoff:projects:close',
  getNode: 'flyoff:projects:nodes:get',
  listChildren: 'flyoff:projects:children:list',
  createNode: 'flyoff:projects:nodes:create',
  renameNode: 'flyoff:projects:nodes:rename',
  moveNode: 'flyoff:projects:nodes:move',
  trashNode: 'flyoff:projects:nodes:trash',
  readMarkdown: 'flyoff:projects:markdown:read',
  saveMarkdown: 'flyoff:projects:markdown:save',
} as const;

export type ProjectErrorCode =
  | 'cancelled'
  | 'invalid-name'
  | 'collision'
  | 'invalid-format'
  | 'incompatible-version'
  | 'permission-denied'
  | 'not-found'
  | 'conflict'
  | 'size-exceeded'
  | 'invalid-operation'
  | 'unsafe-path'
  | 'io-error';

export interface ProjectFailureDetails {
  code: ProjectErrorCode;
  message: string;
  currentRevision?: string;
}

export type ProjectResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFailureDetails };

export interface ProjectSummary {
  projectId: string;
  name: string;
  location: string;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
}

interface ProjectTreeNodeBase {
  nodeId: string;
  parentId: string | null;
  name: string;
}

export interface ProjectFolderNode extends ProjectTreeNodeBase {
  kind: 'folder';
}

export interface ProjectPageNode extends ProjectTreeNodeBase {
  kind: 'page';
  pageType: 'markdown';
}

export type ProjectTreeNode = ProjectFolderNode | ProjectPageNode;

export interface MarkdownDocument {
  nodeId: string;
  content: string;
  revision: string;
}

export interface ProjectLocationSelection {
  token: string;
  location: string;
  expiresAt: string;
}

export interface CreateProjectRequest {
  selectionToken: string;
  name: string;
}

export interface RestoreProjectRequest {
  projectId: string;
}

export interface ListProjectChildrenRequest {
  parentId: string | null;
}

export interface GetProjectNodeRequest {
  nodeId: string;
}

export type CreateProjectNodeRequest =
  | { parentId: string | null; name: string; kind: 'folder' }
  | {
      parentId: string | null;
      name: string;
      kind: 'page';
      pageType: 'markdown';
    };

export interface RenameProjectNodeRequest {
  nodeId: string;
  name: string;
}

export interface MoveProjectNodeRequest {
  nodeId: string;
  parentId: string | null;
}

export interface TrashProjectNodeRequest {
  nodeId: string;
}

export interface TrashProjectNodeOutcome {
  nodeIds: readonly string[];
}

export interface ReadMarkdownDocumentRequest {
  nodeId: string;
}

export interface SaveMarkdownDocumentRequest {
  nodeId: string;
  content: string;
  expectedRevision: string;
  force?: boolean;
}

const projectErrorCodes = new Set<string>([
  'cancelled',
  'invalid-name',
  'collision',
  'invalid-format',
  'incompatible-version',
  'permission-denied',
  'not-found',
  'conflict',
  'size-exceeded',
  'invalid-operation',
  'unsafe-path',
  'io-error',
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revisionPattern = /^[0-9a-f]{64}$/;
const invalidPortableCharacters = /[<>:"/\\|?*]/;
const reservedDosName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isProjectIdentifier(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function isPortableProjectName(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PROJECT_NAME_MAX_LENGTH ||
    value.trim().length === 0 ||
    value === '.' ||
    value === '..' ||
    value.toLowerCase() === '.flyoff' ||
    value.endsWith('.') ||
    value.endsWith(' ') ||
    invalidPortableCharacters.test(value) ||
    reservedDosName.test(value)
  ) {
    return false;
  }

  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export function isMarkdownRevision(value: unknown): value is string {
  return typeof value === 'string' && revisionPattern.test(value);
}

export function isProjectErrorCode(value: unknown): value is ProjectErrorCode {
  return typeof value === 'string' && projectErrorCodes.has(value);
}

export function isProjectFailureDetails(
  value: unknown,
): value is ProjectFailureDetails {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isProjectErrorCode(value.code) &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 1_024 &&
    (value.currentRevision === undefined ||
      isMarkdownRevision(value.currentRevision))
  );
}

export function isProjectResult<T>(
  value: unknown,
  isValue: (candidate: unknown) => candidate is T,
): value is ProjectResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  return value.ok
    ? isValue(value.value)
    : isProjectFailureDetails(value.error);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isProjectIdentifier(value.projectId) &&
    isPortableProjectName(value.name) &&
    typeof value.location === 'string' &&
    value.location.length > 0 &&
    value.formatVersion === PROJECT_FORMAT_VERSION
  );
}

export function isProjectTreeNode(value: unknown): value is ProjectTreeNode {
  if (
    !isRecord(value) ||
    !isProjectIdentifier(value.nodeId) ||
    (value.parentId !== null && !isProjectIdentifier(value.parentId)) ||
    !isPortableProjectName(value.name)
  ) {
    return false;
  }

  return (
    value.kind === 'folder' ||
    (value.kind === 'page' && value.pageType === 'markdown')
  );
}

export function isProjectTreeNodeList(
  value: unknown,
): value is readonly ProjectTreeNode[] {
  return Array.isArray(value) && value.every(isProjectTreeNode);
}

export function isMarkdownDocument(
  value: unknown,
): value is MarkdownDocument {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    typeof value.content === 'string' &&
    value.content.length <= MARKDOWN_DOCUMENT_MAX_BYTES &&
    new TextEncoder().encode(value.content).byteLength <=
      MARKDOWN_DOCUMENT_MAX_BYTES &&
    isMarkdownRevision(value.revision)
  );
}

export function isProjectLocationSelection(
  value: unknown,
): value is ProjectLocationSelection {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.token) &&
    typeof value.location === 'string' &&
    value.location.length > 0 &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function hasNodeParent(value: Record<string, unknown>): boolean {
  return value.parentId === null || isProjectIdentifier(value.parentId);
}

export function isCreateProjectRequest(
  value: unknown,
): value is CreateProjectRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.selectionToken) &&
    isPortableProjectName(value.name)
  );
}

export function isRestoreProjectRequest(
  value: unknown,
): value is RestoreProjectRequest {
  return isRecord(value) && isProjectIdentifier(value.projectId);
}

export function isListProjectChildrenRequest(
  value: unknown,
): value is ListProjectChildrenRequest {
  return isRecord(value) && hasNodeParent(value);
}

export function isGetProjectNodeRequest(
  value: unknown,
): value is GetProjectNodeRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export function isCreateProjectNodeRequest(
  value: unknown,
): value is CreateProjectNodeRequest {
  if (
    !isRecord(value) ||
    !hasNodeParent(value) ||
    !isPortableProjectName(value.name)
  ) {
    return false;
  }

  return (
    value.kind === 'folder' ||
    (value.kind === 'page' && value.pageType === 'markdown')
  );
}

export function isRenameProjectNodeRequest(
  value: unknown,
): value is RenameProjectNodeRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    isPortableProjectName(value.name)
  );
}

export function isMoveProjectNodeRequest(
  value: unknown,
): value is MoveProjectNodeRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    hasNodeParent(value)
  );
}

export function isTrashProjectNodeRequest(
  value: unknown,
): value is TrashProjectNodeRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export function isTrashProjectNodeOutcome(
  value: unknown,
): value is TrashProjectNodeOutcome {
  if (!isRecord(value) || !Array.isArray(value.nodeIds)) {
    return false;
  }

  const nodeIds = value.nodeIds;
  return (
    nodeIds.length > 0 &&
    nodeIds.length <= 250_000 &&
    nodeIds.every(isProjectIdentifier) &&
    new Set(nodeIds).size === nodeIds.length
  );
}

export function isReadMarkdownDocumentRequest(
  value: unknown,
): value is ReadMarkdownDocumentRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export function isSaveMarkdownDocumentRequest(
  value: unknown,
): value is SaveMarkdownDocumentRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    typeof value.content === 'string' &&
    value.content.length <= MARKDOWN_DOCUMENT_MAX_BYTES &&
    new TextEncoder().encode(value.content).byteLength <=
      MARKDOWN_DOCUMENT_MAX_BYTES &&
    isMarkdownRevision(value.expectedRevision) &&
    (value.force === undefined || typeof value.force === 'boolean')
  );
}

export function projectSuccess<T>(value: T): ProjectResult<T> {
  return { ok: true, value };
}

export function projectFailure(
  code: ProjectErrorCode,
  message: string,
  currentRevision?: string,
): ProjectResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(currentRevision === undefined ? {} : { currentRevision }),
    },
  };
}
