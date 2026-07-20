export const PROJECT_FORMAT = 'flyoff-project' as const;
export const PROJECT_FORMAT_VERSION = 2 as const;
export const PROJECT_FORMAT_LEGACY_VERSION = 1 as const;
export const PROJECT_INDEX_FORMAT = 'flyoff-content-index' as const;
export const PROJECT_INDEX_VERSION = 4 as const;
export const PROJECT_INDEX_LEGACY_VERSION = 1 as const;
export const PROJECT_INDEX_OLDER_VERSION = 2 as const;
export const PROJECT_INDEX_PREVIOUS_VERSION = 3 as const;

export const PROJECT_MANIFEST_MAX_BYTES = 64 * 1024;
export const PROJECT_INDEX_MAX_BYTES = 32 * 1024 * 1024;
export const MARKDOWN_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const PROJECT_PASSWORD_MAX_BYTES = 1_024;
export const PROJECT_PASSWORD_MIN_LENGTH = 1;
export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_INSTANCE_TYPE_MAX_LENGTH = 128;

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
  moveNodes: 'flyoff:projects:nodes:move-batch',
  trashNode: 'flyoff:projects:nodes:trash',
  trashNodes: 'flyoff:projects:nodes:trash-batch',
  revealPath: 'flyoff:projects:path:reveal',
  copyPath: 'flyoff:projects:path:copy',
  copyPaths: 'flyoff:projects:paths:copy',
  readMarkdown: 'flyoff:projects:markdown:read',
  saveMarkdown: 'flyoff:projects:markdown:save',
  listLinkTargets: 'flyoff:projects:links:targets:list',
  getGraph: 'flyoff:projects:graph:get',
  resolveInternalLink: 'flyoff:projects:links:resolve',
  listBacklinks: 'flyoff:projects:links:backlinks:list',
  search: 'flyoff:projects:search',
  getPageProperties: 'flyoff:projects:pages:properties:get',
  setPageReadOnly: 'flyoff:projects:pages:read-only:set',
  protectPage: 'flyoff:projects:pages:protection:enable',
  changePagePassword: 'flyoff:projects:pages:protection:change-password',
  removePagePassword: 'flyoff:projects:pages:protection:disable',
  unlockPage: 'flyoff:projects:pages:protection:unlock',
  lockPage: 'flyoff:projects:pages:protection:lock',
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
  | 'password-required'
  | 'authentication-failed'
  | 'read-only'
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
  formatVersion:
    | typeof PROJECT_FORMAT_LEGACY_VERSION
    | typeof PROJECT_FORMAT_VERSION;
}

interface ProjectTreeNodeBase {
  canContainChildren: boolean;
  hasChildren: boolean;
  nodeId: string;
  parentId: string | null;
  name: string;
}

export interface ProjectFolderNode extends ProjectTreeNodeBase {
  kind: 'folder';
}

export interface ProjectPageNode extends ProjectTreeNodeBase {
  kind: 'page';
  pageType: string;
}

export type ProjectTreeNode = ProjectFolderNode | ProjectPageNode;

export interface MarkdownDocument {
  nodeId: string;
  content: string;
  revision: string;
  readOnly: boolean;
}

export interface ProjectPageProperties {
  nodeId: string;
  pageType: 'markdown';
  contentSizeBytes: number;
  diskSizeBytes: number;
  createdAt: string | null;
  modifiedAt: string;
  revision: string;
  readOnly: boolean;
  passwordProtected: boolean;
  locked: boolean;
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
      pageType: string;
    };

export interface RenameProjectNodeRequest {
  nodeId: string;
  name: string;
}

export interface MoveProjectNodeRequest {
  nodeId: string;
  parentId: string | null;
  beforeNodeId?: string | null;
}

export interface MoveProjectNodesRequest {
  nodeIds: readonly string[];
  parentId: string | null;
  beforeNodeId?: string | null;
}

export interface TrashProjectNodeRequest {
  nodeId: string;
}

export interface TrashProjectNodesRequest {
  nodeIds: readonly string[];
}

export interface ProjectNodeMutationOutcome {
  node: ProjectTreeNode;
  updatedDocumentNodeIds: readonly string[];
  skippedLockedNodeIds: readonly string[];
}

export interface ProjectNodesMutationOutcome {
  nodes: readonly ProjectTreeNode[];
  updatedDocumentNodeIds: readonly string[];
  skippedLockedNodeIds: readonly string[];
}

export interface ProjectPathRequest {
  nodeId: string | null;
}

export interface ProjectPathsRequest {
  nodeIds: readonly string[];
}

export interface TrashProjectNodeOutcome {
  nodeIds: readonly string[];
}

export type ProjectInternalLinkSyntax = 'markdown' | 'wikilink';

export interface ProjectInternalLinkRequest {
  sourceNodeId: string;
  path: string;
  headingPath: readonly string[];
  syntax: ProjectInternalLinkSyntax;
}

export interface ProjectLinkTarget {
  nodeId: string;
  name: string;
  path: string;
}

export interface ProjectGraphNode extends ProjectLinkTarget {
  connectionCount: number;
}

export interface ProjectGraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
}

export interface ProjectGraphSnapshot {
  nodes: readonly ProjectGraphNode[];
  edges: readonly ProjectGraphEdge[];
}

export interface ProjectInternalLinkHeading {
  line: number;
  offset: number;
  path: readonly string[];
}

export interface ProjectInternalLinkTarget extends ProjectLinkTarget {
  locked: boolean;
  heading?: ProjectInternalLinkHeading;
}

export type ProjectInternalLinkResolution =
  | { status: 'missing' }
  | { status: 'ambiguous'; candidates: readonly ProjectLinkTarget[] }
  | { status: 'resolved'; target: ProjectInternalLinkTarget };

export interface ListProjectBacklinksRequest {
  targetNodeId: string;
}

export interface ProjectReference {
  sourceNodeId: string;
  sourceName: string;
  sourcePath: string;
  line: number;
  column: number;
  start: number;
  end: number;
  excerpt: string;
}

export interface ProjectBacklinksOutcome {
  references: readonly ProjectReference[];
  skippedLockedNodeIds: readonly string[];
}

export interface ProjectSearchRequest {
  query: string;
}

export interface ProjectSearchPreview {
  nodeId: string;
  line: number;
  excerpt: string;
}

export interface ProjectSearchOutcome {
  nodeIds: readonly string[];
  previews: readonly ProjectSearchPreview[];
  skippedLockedNodeIds: readonly string[];
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

export interface GetProjectPagePropertiesRequest {
  nodeId: string;
}

export interface SetProjectPageReadOnlyRequest {
  nodeId: string;
  expectedRevision: string;
  readOnly: boolean;
}

export interface ProtectProjectPageRequest {
  nodeId: string;
  expectedRevision: string;
  password: string;
}

export interface ChangeProjectPagePasswordRequest {
  nodeId: string;
  expectedRevision: string;
  currentPassword: string;
  newPassword: string;
}

export interface RemoveProjectPagePasswordRequest {
  nodeId: string;
  expectedRevision: string;
  password: string;
}

export interface UnlockProjectPageRequest {
  nodeId: string;
  password: string;
}

export interface LockProjectPageRequest {
  nodeId: string;
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
  'password-required',
  'authentication-failed',
  'read-only',
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

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isProjectPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PROJECT_PASSWORD_MAX_BYTES &&
    isWellFormedUnicode(value) &&
    utf8Length(value) <= PROJECT_PASSWORD_MAX_BYTES
  );
}

export function isNewProjectPassword(value: unknown): value is string {
  return (
    isProjectPassword(value) &&
    Array.from(value).length >= PROJECT_PASSWORD_MIN_LENGTH
  );
}

export function isProjectIdentifier(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

const builtInProjectInstanceTypes = new Set([
  'markdown',
  'checklist',
  'kanban',
  'gallery',
]);
const customProjectInstanceTypePattern =
  /^[a-z][a-z0-9._-]{0,62}:[a-z][a-z0-9._-]{0,62}$/;

export function isProjectInstanceTypeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= PROJECT_INSTANCE_TYPE_MAX_LENGTH &&
    (builtInProjectInstanceTypes.has(value) ||
      customProjectInstanceTypePattern.test(value))
  );
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
    (value.formatVersion === PROJECT_FORMAT_LEGACY_VERSION ||
      value.formatVersion === PROJECT_FORMAT_VERSION)
  );
}

export function isProjectTreeNode(value: unknown): value is ProjectTreeNode {
  if (
    !isRecord(value) ||
    !isProjectIdentifier(value.nodeId) ||
    (value.parentId !== null && !isProjectIdentifier(value.parentId)) ||
    typeof value.canContainChildren !== 'boolean' ||
    typeof value.hasChildren !== 'boolean' ||
    !isPortableProjectName(value.name)
  ) {
    return false;
  }

  return (
    value.kind === 'folder' ||
    (value.kind === 'page' && isProjectInstanceTypeId(value.pageType))
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
    isMarkdownRevision(value.revision) &&
    typeof value.readOnly === 'boolean'
  );
}

export function isProjectPageProperties(
  value: unknown,
): value is ProjectPageProperties {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'nodeId',
      'pageType',
      'contentSizeBytes',
      'diskSizeBytes',
      'createdAt',
      'modifiedAt',
      'revision',
      'readOnly',
      'passwordProtected',
      'locked',
    ])
  ) {
    return false;
  }

  return (
    isProjectIdentifier(value.nodeId) &&
    value.pageType === 'markdown' &&
    typeof value.contentSizeBytes === 'number' &&
    Number.isSafeInteger(value.contentSizeBytes) &&
    value.contentSizeBytes >= 0 &&
    value.contentSizeBytes <= MARKDOWN_DOCUMENT_MAX_BYTES &&
    typeof value.diskSizeBytes === 'number' &&
    Number.isSafeInteger(value.diskSizeBytes) &&
    value.diskSizeBytes >= value.contentSizeBytes &&
    (value.createdAt === null || isIsoTimestamp(value.createdAt)) &&
    isIsoTimestamp(value.modifiedAt) &&
    isMarkdownRevision(value.revision) &&
    typeof value.readOnly === 'boolean' &&
    typeof value.passwordProtected === 'boolean' &&
    typeof value.locked === 'boolean' &&
    (!value.locked || value.passwordProtected)
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
    (value.kind === 'page' && isProjectInstanceTypeId(value.pageType))
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
    hasNodeParent(value) &&
    (value.beforeNodeId === undefined ||
      value.beforeNodeId === null ||
      isProjectIdentifier(value.beforeNodeId))
  );
}

function isProjectNodeIdBatch(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 500 &&
    value.every(isProjectIdentifier) &&
    new Set(value).size === value.length
  );
}

export function isMoveProjectNodesRequest(
  value: unknown,
): value is MoveProjectNodesRequest {
  return (
    isRecord(value) &&
    isProjectNodeIdBatch(value.nodeIds) &&
    hasNodeParent(value) &&
    (value.beforeNodeId === undefined ||
      value.beforeNodeId === null ||
      isProjectIdentifier(value.beforeNodeId))
  );
}

export function isTrashProjectNodeRequest(
  value: unknown,
): value is TrashProjectNodeRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export function isTrashProjectNodesRequest(
  value: unknown,
): value is TrashProjectNodesRequest {
  return isRecord(value) && isProjectNodeIdBatch(value.nodeIds);
}

export function isProjectNodeMutationOutcome(
  value: unknown,
): value is ProjectNodeMutationOutcome {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'node',
      'updatedDocumentNodeIds',
      'skippedLockedNodeIds',
    ]) &&
    isProjectTreeNode(value.node) &&
    Array.isArray(value.updatedDocumentNodeIds) &&
    value.updatedDocumentNodeIds.length <= 250_000 &&
    value.updatedDocumentNodeIds.every(isProjectIdentifier) &&
    new Set(value.updatedDocumentNodeIds).size ===
      value.updatedDocumentNodeIds.length &&
    Array.isArray(value.skippedLockedNodeIds) &&
    value.skippedLockedNodeIds.length <= 250_000 &&
    value.skippedLockedNodeIds.every(isProjectIdentifier) &&
    new Set(value.skippedLockedNodeIds).size === value.skippedLockedNodeIds.length
  );
}

export function isProjectNodesMutationOutcome(
  value: unknown,
): value is ProjectNodesMutationOutcome {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'nodes',
      'updatedDocumentNodeIds',
      'skippedLockedNodeIds',
    ]) &&
    Array.isArray(value.nodes) &&
    value.nodes.length > 0 &&
    value.nodes.length <= 500 &&
    value.nodes.every(isProjectTreeNode) &&
    new Set(value.nodes.map((node) => node.nodeId)).size ===
      value.nodes.length &&
    Array.isArray(value.updatedDocumentNodeIds) &&
    value.updatedDocumentNodeIds.length <= 250_000 &&
    value.updatedDocumentNodeIds.every(isProjectIdentifier) &&
    new Set(value.updatedDocumentNodeIds).size ===
      value.updatedDocumentNodeIds.length &&
    Array.isArray(value.skippedLockedNodeIds) &&
    value.skippedLockedNodeIds.length <= 250_000 &&
    value.skippedLockedNodeIds.every(isProjectIdentifier) &&
    new Set(value.skippedLockedNodeIds).size === value.skippedLockedNodeIds.length
  );
}

export function isProjectPathRequest(
  value: unknown,
): value is ProjectPathRequest {
  return (
    isRecord(value) &&
    (value.nodeId === null || isProjectIdentifier(value.nodeId))
  );
}

export function isProjectPathsRequest(
  value: unknown,
): value is ProjectPathsRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeIds']) &&
    Array.isArray(value.nodeIds) &&
    value.nodeIds.length > 0 &&
    value.nodeIds.length <= 500 &&
    value.nodeIds.every(isProjectIdentifier) &&
    new Set(value.nodeIds).size === value.nodeIds.length
  );
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

function isProjectLinkText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximumLength &&
    isWellFormedUnicode(value) &&
    !value.includes('\0')
  );
}

function isProjectLinkHeadingPath(
  value: unknown,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every(
      (part) => isProjectLinkText(part, 512) && part.trim().length > 0,
    )
  );
}

export function isProjectInternalLinkRequest(
  value: unknown,
): value is ProjectInternalLinkRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sourceNodeId', 'path', 'headingPath', 'syntax']) &&
    isProjectIdentifier(value.sourceNodeId) &&
    isProjectLinkText(value.path, 4_096) &&
    isProjectLinkHeadingPath(value.headingPath) &&
    (value.syntax === 'markdown' || value.syntax === 'wikilink') &&
    (value.path.trim().length > 0 || value.headingPath.length > 0)
  );
}

function hasProjectLinkTargetFields(
  value: unknown,
): value is ProjectLinkTarget & Record<string, unknown> {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    isPortableProjectName(value.name) &&
    isProjectLinkText(value.path, 4_096) &&
    value.path.length > 0
  );
}

export function isProjectLinkTarget(value: unknown): value is ProjectLinkTarget {
  return (
    hasProjectLinkTargetFields(value) &&
    hasExactKeys(value, ['nodeId', 'name', 'path'])
  );
}

export function isProjectLinkTargetList(
  value: unknown,
): value is readonly ProjectLinkTarget[] {
  return (
    Array.isArray(value) &&
    value.length <= 250_000 &&
    value.every(isProjectLinkTarget)
  );
}

export function isProjectGraphNode(value: unknown): value is ProjectGraphNode {
  return (
    hasProjectLinkTargetFields(value) &&
    hasExactKeys(value, ['nodeId', 'name', 'path', 'connectionCount']) &&
    Number.isSafeInteger(value.connectionCount) &&
    (value.connectionCount as number) >= 0 &&
    (value.connectionCount as number) <= 1_000_000
  );
}

export function isProjectGraphEdge(value: unknown): value is ProjectGraphEdge {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sourceNodeId', 'targetNodeId', 'weight']) &&
    isProjectIdentifier(value.sourceNodeId) &&
    isProjectIdentifier(value.targetNodeId) &&
    value.sourceNodeId !== value.targetNodeId &&
    Number.isSafeInteger(value.weight) &&
    (value.weight as number) >= 1 &&
    (value.weight as number) <= 1_000_000
  );
}

export function isProjectGraphSnapshot(
  value: unknown,
): value is ProjectGraphSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['nodes', 'edges']) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 250_000 ||
    !value.nodes.every(isProjectGraphNode) ||
    !Array.isArray(value.edges) ||
    value.edges.length > 1_000_000 ||
    !value.edges.every(isProjectGraphEdge)
  ) {
    return false;
  }

  const nodeIds = new Set(
    (value.nodes as ProjectGraphNode[]).map(({ nodeId }) => nodeId),
  );
  return (
    nodeIds.size === value.nodes.length &&
    (value.edges as ProjectGraphEdge[]).every(
      ({ sourceNodeId, targetNodeId }) =>
        nodeIds.has(sourceNodeId) && nodeIds.has(targetNodeId),
    )
  );
}

function isProjectInternalLinkHeading(
  value: unknown,
): value is ProjectInternalLinkHeading {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['line', 'offset', 'path']) &&
    Number.isSafeInteger(value.line) &&
    (value.line as number) >= 1 &&
    Number.isSafeInteger(value.offset) &&
    (value.offset as number) >= 0 &&
    isProjectLinkHeadingPath(value.path)
  );
}

export function isProjectInternalLinkTarget(
  value: unknown,
): value is ProjectInternalLinkTarget {
  if (!hasProjectLinkTargetFields(value)) {
    return false;
  }
  const target = value as ProjectLinkTarget &
    Record<string, unknown> & {
      heading?: unknown;
      locked?: unknown;
    };
  return (
    hasExactKeys(
      value,
      target.heading === undefined
        ? ['nodeId', 'name', 'path', 'locked']
        : ['nodeId', 'name', 'path', 'locked', 'heading'],
    ) &&
    typeof target.locked === 'boolean' &&
    (target.heading === undefined ||
      isProjectInternalLinkHeading(target.heading))
  );
}

export function isProjectInternalLinkResolution(
  value: unknown,
): value is ProjectInternalLinkResolution {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === 'missing') {
    return hasExactKeys(value, ['status']);
  }
  if (value.status === 'ambiguous') {
    return (
      hasExactKeys(value, ['status', 'candidates']) &&
      isProjectLinkTargetList(value.candidates) &&
      value.candidates.length > 1
    );
  }
  return (
    value.status === 'resolved' &&
    hasExactKeys(value, ['status', 'target']) &&
    isProjectInternalLinkTarget(value.target)
  );
}

export function isListProjectBacklinksRequest(
  value: unknown,
): value is ListProjectBacklinksRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['targetNodeId']) &&
    isProjectIdentifier(value.targetNodeId)
  );
}

export function isProjectReference(value: unknown): value is ProjectReference {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'sourceNodeId',
      'sourceName',
      'sourcePath',
      'line',
      'column',
      'start',
      'end',
      'excerpt',
    ]) &&
    isProjectIdentifier(value.sourceNodeId) &&
    isPortableProjectName(value.sourceName) &&
    isProjectLinkText(value.sourcePath, 4_096) &&
    Number.isSafeInteger(value.line) &&
    (value.line as number) >= 1 &&
    Number.isSafeInteger(value.column) &&
    (value.column as number) >= 1 &&
    Number.isSafeInteger(value.start) &&
    (value.start as number) >= 0 &&
    Number.isSafeInteger(value.end) &&
    (value.end as number) >= (value.start as number) &&
    isProjectLinkText(value.excerpt, 240)
  );
}

export function isProjectBacklinksOutcome(
  value: unknown,
): value is ProjectBacklinksOutcome {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['references', 'skippedLockedNodeIds']) &&
    Array.isArray(value.references) &&
    value.references.length <= 1_000_000 &&
    value.references.every(isProjectReference) &&
    Array.isArray(value.skippedLockedNodeIds) &&
    value.skippedLockedNodeIds.length <= 250_000 &&
    value.skippedLockedNodeIds.every(isProjectIdentifier)
  );
}

export function isProjectSearchRequest(
  value: unknown,
): value is ProjectSearchRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['query']) &&
    isProjectLinkText(value.query, 2_048) &&
    value.query.trim().length > 0
  );
}

function isProjectSearchPreview(
  value: unknown,
  nodeIds: readonly string[],
): value is ProjectSearchPreview {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'line', 'excerpt']) &&
    isProjectIdentifier(value.nodeId) &&
    nodeIds.includes(value.nodeId) &&
    typeof value.line === 'number' &&
    Number.isSafeInteger(value.line) &&
    value.line >= 1 &&
    value.line <= 10_000_000 &&
    typeof value.excerpt === 'string' &&
    value.excerpt.length > 0 &&
    value.excerpt.length <= 240 &&
    isWellFormedUnicode(value.excerpt)
  );
}

export function isProjectSearchOutcome(
  value: unknown,
): value is ProjectSearchOutcome {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['nodeIds', 'previews', 'skippedLockedNodeIds']) ||
    !Array.isArray(value.nodeIds) ||
    value.nodeIds.length > 250_000 ||
    !value.nodeIds.every(isProjectIdentifier) ||
    new Set(value.nodeIds).size !== value.nodeIds.length ||
    !Array.isArray(value.previews) ||
    value.previews.length > value.nodeIds.length ||
    !Array.isArray(value.skippedLockedNodeIds) ||
    value.skippedLockedNodeIds.length > 250_000 ||
    !value.skippedLockedNodeIds.every(isProjectIdentifier) ||
    new Set(value.skippedLockedNodeIds).size !==
      value.skippedLockedNodeIds.length
  ) {
    return false;
  }

  const nodeIds = value.nodeIds as string[];
  return (
    value.previews.every((preview) =>
      isProjectSearchPreview(preview, nodeIds),
    ) &&
    new Set(
      value.previews.map(
        (preview) => (preview as ProjectSearchPreview).nodeId,
      ),
    ).size === value.previews.length
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

export function isGetProjectPagePropertiesRequest(
  value: unknown,
): value is GetProjectPagePropertiesRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId']) &&
    isProjectIdentifier(value.nodeId)
  );
}

export function isSetProjectPageReadOnlyRequest(
  value: unknown,
): value is SetProjectPageReadOnlyRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'expectedRevision', 'readOnly']) &&
    isProjectIdentifier(value.nodeId) &&
    isMarkdownRevision(value.expectedRevision) &&
    typeof value.readOnly === 'boolean'
  );
}

export function isProtectProjectPageRequest(
  value: unknown,
): value is ProtectProjectPageRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'expectedRevision', 'password']) &&
    isProjectIdentifier(value.nodeId) &&
    isMarkdownRevision(value.expectedRevision) &&
    isNewProjectPassword(value.password)
  );
}

export function isChangeProjectPagePasswordRequest(
  value: unknown,
): value is ChangeProjectPagePasswordRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'nodeId',
      'expectedRevision',
      'currentPassword',
      'newPassword',
    ]) &&
    isProjectIdentifier(value.nodeId) &&
    isMarkdownRevision(value.expectedRevision) &&
    isProjectPassword(value.currentPassword) &&
    isNewProjectPassword(value.newPassword)
  );
}

export function isRemoveProjectPagePasswordRequest(
  value: unknown,
): value is RemoveProjectPagePasswordRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'expectedRevision', 'password']) &&
    isProjectIdentifier(value.nodeId) &&
    isMarkdownRevision(value.expectedRevision) &&
    isProjectPassword(value.password)
  );
}

export function isUnlockProjectPageRequest(
  value: unknown,
): value is UnlockProjectPageRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId', 'password']) &&
    isProjectIdentifier(value.nodeId) &&
    isProjectPassword(value.password)
  );
}

export function isLockProjectPageRequest(
  value: unknown,
): value is LockProjectPageRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['nodeId']) &&
    isProjectIdentifier(value.nodeId)
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
