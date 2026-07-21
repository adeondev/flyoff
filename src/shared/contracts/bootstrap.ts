import { isUiLocale, type UiLocale } from './locales';
import type { ApplicationMenuCommand } from './menu';
import type { RendererMenuCommand } from './menu';
import type { CloseRequest, CloseResponse } from './close';
import type {
  OpenExternalLinkRequest,
  OpenExternalLinkResult,
} from './external-links';
import type {
  TabSessionRestoreDecision,
  WorkspaceSessionSnapshot,
} from './tab-session';
import type { WorkspaceLayoutState } from './ui-state';
import type {
  FlyoffPreferences,
  FlyoffTheme,
  PreferencesSnapshot,
} from './preferences';
import type {
  WindowControlAction,
  WindowState,
} from './window-controls';
import type {
  CreateProjectNodeRequest,
  ChangeProjectPagePasswordRequest,
  CreateProjectRequest,
  GetProjectNodeRequest,
  ListProjectChildrenRequest,
  MarkdownDocument,
  GetProjectPagePropertiesRequest,
  LockProjectPageRequest,
  ListProjectBacklinksRequest,
  MoveProjectNodeRequest,
  MoveProjectNodesRequest,
  ProjectBacklinksOutcome,
  ProjectGraphSnapshot,
  ProjectInternalLinkRequest,
  ProjectInternalLinkResolution,
  ProjectLinkTarget,
  ProjectLocationSelection,
  ProjectNodeMutationOutcome,
  ProjectNodesMutationOutcome,
  ProjectPathRequest,
  ProjectPathsRequest,
  ProjectPageProperties,
  ProjectResult,
  ProjectSearchOutcome,
  ProjectSearchRequest,
  ProjectSummary,
  ProjectTreeNode,
  ReadMarkdownDocumentRequest,
  RemoveProjectPagePasswordRequest,
  RenameProjectNodeRequest,
  RestoreProjectRequest,
  SaveMarkdownDocumentRequest,
  SetProjectPageReadOnlyRequest,
  ProtectProjectPageRequest,
  UnlockProjectPageRequest,
  TrashProjectNodeRequest,
  TrashProjectNodesRequest,
  TrashProjectNodeOutcome,
} from './projects';
import type {
  ProjectNoteActivityEntry,
  ProjectNoteActivityEvent,
} from './project-note-activity';
import {
  isNativeCoreHealth,
  type NativeCoreHealth,
} from './native-core';
import {
  isFlyoffPlatform,
  type FlyoffPlatform,
} from './platform';
import {
  isSpellcheckCapabilities,
  type SpellcheckCapabilities,
  type SpellcheckWordRequest,
  type SpellcheckWordsRequest,
} from './spellcheck';

export const BOOTSTRAP_STATE_CHANNEL = 'flyoff:bootstrap:get' as const;

export interface BootstrapState {
  platform: FlyoffPlatform;
  uiLocale: UiLocale;
  nativeCore: NativeCoreHealth;
  spellcheck: SpellcheckCapabilities;
}

export interface FlyoffApi {
  getBootstrapState(): Promise<BootstrapState>;
  getWindowState(): Promise<WindowState>;
  controlWindow(action: WindowControlAction): Promise<WindowState>;
  onWindowStateChanged(
    listener: (state: WindowState) => void,
  ): () => void;
  executeMenuCommand(command: ApplicationMenuCommand): Promise<void>;
  getRestorableTabSession(): Promise<WorkspaceSessionSnapshot | null>;
  resolveRestorableTabSession(
    decision: TabSessionRestoreDecision,
    current: WorkspaceSessionSnapshot,
  ): Promise<void>;
  saveTabSession(session: WorkspaceSessionSnapshot): Promise<void>;
  getUiState(): Promise<WorkspaceLayoutState>;
  saveUiState(state: WorkspaceLayoutState): Promise<void>;
  getPreferences(): Promise<PreferencesSnapshot>;
  savePreferences(preferences: FlyoffPreferences): Promise<PreferencesSnapshot>;
  resetPreferences(): Promise<PreferencesSnapshot>;
  applyWindowTheme(theme: FlyoffTheme): Promise<void>;
  checkSpellcheckWords(
    request: SpellcheckWordsRequest,
  ): Promise<readonly string[]>;
  getSpellcheckSuggestions(
    request: SpellcheckWordRequest,
  ): Promise<readonly string[]>;
  addSpellcheckWord(request: SpellcheckWordRequest): Promise<boolean>;
  onCloseRequested(listener: (request: CloseRequest) => void): () => void;
  respondToCloseRequest(response: CloseResponse): Promise<void>;
  restartApplication(): Promise<void>;
  openExternalLink(
    request: OpenExternalLinkRequest,
  ): Promise<OpenExternalLinkResult>;
  onRendererMenuCommand(
    listener: (command: RendererMenuCommand) => void,
  ): () => void;
  selectProjectCreateLocation(): Promise<
    ProjectResult<ProjectLocationSelection>
  >;
  createProject(
    request: CreateProjectRequest,
  ): Promise<ProjectResult<ProjectSummary>>;
  openProject(): Promise<ProjectResult<ProjectSummary>>;
  restoreProject(
    request: RestoreProjectRequest,
  ): Promise<ProjectResult<ProjectSummary>>;
  closeProject(): Promise<ProjectResult<null>>;
  getProjectNoteActivity(): Promise<
    ProjectResult<readonly ProjectNoteActivityEntry[]>
  >;
  recordProjectNoteActivity(
    event: ProjectNoteActivityEvent,
  ): Promise<ProjectResult<ProjectNoteActivityEntry>>;
  listProjectChildren(
    request: ListProjectChildrenRequest,
  ): Promise<ProjectResult<readonly ProjectTreeNode[]>>;
  getProjectNode(
    request: GetProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>>;
  createProjectNode(
    request: CreateProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>>;
  renameProjectNode(
    request: RenameProjectNodeRequest,
  ): Promise<ProjectResult<ProjectNodeMutationOutcome>>;
  moveProjectNode(
    request: MoveProjectNodeRequest,
  ): Promise<ProjectResult<ProjectNodeMutationOutcome>>;
  moveProjectNodes(
    request: MoveProjectNodesRequest,
  ): Promise<ProjectResult<ProjectNodesMutationOutcome>>;
  trashProjectNode(
    request: TrashProjectNodeRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>>;
  trashProjectNodes(
    request: TrashProjectNodesRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>>;
  revealProjectPath(
    request: ProjectPathRequest,
  ): Promise<ProjectResult<null>>;
  copyProjectPath(
    request: ProjectPathRequest,
  ): Promise<ProjectResult<null>>;
  copyProjectPaths(
    request: ProjectPathsRequest,
  ): Promise<ProjectResult<null>>;
  readMarkdownDocument(
    request: ReadMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>>;
  saveMarkdownDocument(
    request: SaveMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>>;
  getProjectGraph(): Promise<ProjectResult<ProjectGraphSnapshot>>;
  listProjectLinkTargets(): Promise<
    ProjectResult<readonly ProjectLinkTarget[]>
  >;
  resolveProjectInternalLink(
    request: ProjectInternalLinkRequest,
  ): Promise<ProjectResult<ProjectInternalLinkResolution>>;
  listProjectBacklinks(
    request: ListProjectBacklinksRequest,
  ): Promise<ProjectResult<ProjectBacklinksOutcome>>;
  searchProject(
    request: ProjectSearchRequest,
  ): Promise<ProjectResult<ProjectSearchOutcome>>;
  getProjectPageProperties(
    request: GetProjectPagePropertiesRequest,
  ): Promise<ProjectResult<ProjectPageProperties>>;
  setProjectPageReadOnly(
    request: SetProjectPageReadOnlyRequest,
  ): Promise<ProjectResult<ProjectPageProperties>>;
  protectProjectPage(
    request: ProtectProjectPageRequest,
  ): Promise<ProjectResult<ProjectPageProperties>>;
  changeProjectPagePassword(
    request: ChangeProjectPagePasswordRequest,
  ): Promise<ProjectResult<ProjectPageProperties>>;
  removeProjectPagePassword(
    request: RemoveProjectPagePasswordRequest,
  ): Promise<ProjectResult<ProjectPageProperties>>;
  unlockProjectPage(
    request: UnlockProjectPageRequest,
  ): Promise<ProjectResult<MarkdownDocument>>;
  lockProjectPage(
    request: LockProjectPageRequest,
  ): Promise<ProjectResult<null>>;
}

export function isBootstrapState(value: unknown): value is BootstrapState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Record<string, unknown>;

  return (
    isFlyoffPlatform(state.platform) &&
    isUiLocale(state.uiLocale) &&
    isNativeCoreHealth(state.nativeCore) &&
    isSpellcheckCapabilities(state.spellcheck)
  );
}
