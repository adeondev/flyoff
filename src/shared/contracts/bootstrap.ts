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
  TwineCredentialStatus,
  TwineContentActionResult,
  TwineCopyContentRequest,
  TwineConversationSnapshot,
  TwineConversationMutationRequest,
  TwineConversationQuery,
  TwineConversationQueryResult,
  TwineConversationStoreSnapshot,
  TwineExportMarkdownRequest,
  TwineGenerationEvent,
  TwineGenerationRequest,
} from './twine';
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
  CreateDiagramDocumentRequest,
  CommitDiagramImportOutcome,
  CommitDiagramImportRequest,
  DiagramDocumentEnvelope,
  ExportDiagramOutcome,
  ExportDiagramRequest,
  ReadDiagramDocumentRequest,
  SaveDiagramDocumentRequest,
  SelectDiagramImportOutcome,
} from './diagrams';
import type {
  ProjectNoteActivityEntry,
  ProjectNoteActivityEvent,
} from './project-note-activity';
import type {
  ProjectAppearanceSnapshot,
  SetProjectAppearanceRequest,
  SetProjectNoteAppearanceRequest,
} from './appearance';
import type {
  CreateMediaFolderRequest,
  CreateMediaFolderWithEntriesRequest,
  CancelProjectMediaImportRequest,
  GetProjectMediaAssetRequest,
  ImportProjectMediaOutcome,
  ImportProjectMediaRequest,
  ListProjectMediaUsagesRequest,
  MediaGallerySnapshot,
  ProjectMediaImportProgress,
  MoveMediaEntriesRequest,
  ProjectMediaAsset,
  ProjectMediaUsage,
  RenameMediaEntryRequest,
  TrashMediaEntriesRequest,
  StartProjectMediaImportOutcome,
} from './media';
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
  getTwineCredentialStatus(): Promise<TwineCredentialStatus>;
  saveTwineApiKey(apiKey: string): Promise<TwineCredentialStatus>;
  removeTwineApiKey(): Promise<TwineCredentialStatus>;
  copyTwineContent(
    request: TwineCopyContentRequest,
  ): Promise<TwineContentActionResult>;
  exportTwineMarkdown(
    request: TwineExportMarkdownRequest,
  ): Promise<TwineContentActionResult>;
  listTwineConversations(): Promise<TwineConversationStoreSnapshot>;
  queryTwineConversations(
    query: TwineConversationQuery,
  ): Promise<TwineConversationQueryResult>;
  loadTwineConversation(id: string): Promise<TwineConversationSnapshot | null>;
  saveTwineConversation(
    conversation: TwineConversationSnapshot,
  ): Promise<TwineConversationStoreSnapshot>;
  createTwineConversation(): Promise<TwineConversationSnapshot>;
  updateTwineConversation(
    request: TwineConversationMutationRequest,
  ): Promise<TwineConversationStoreSnapshot>;
  deleteTwineConversation(id: string): Promise<TwineConversationStoreSnapshot>;
  startTwineGeneration(request: TwineGenerationRequest): Promise<void>;
  cancelTwineGeneration(requestId: string): Promise<void>;
  onTwineGenerationEvent(
    listener: (event: TwineGenerationEvent) => void,
  ): () => void;
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
  getProjectAppearance(): Promise<ProjectResult<ProjectAppearanceSnapshot>>;
  setProjectNoteAppearance(
    request: SetProjectNoteAppearanceRequest,
  ): Promise<ProjectResult<ProjectAppearanceSnapshot>>;
  setProjectAppearance(
    request: SetProjectAppearanceRequest,
  ): Promise<ProjectResult<ProjectAppearanceSnapshot>>;
  selectProjectMedia(
    request: ImportProjectMediaRequest,
  ): Promise<ProjectResult<ImportProjectMediaOutcome>>;
  importDroppedProjectMedia(
    files: readonly File[],
    request: ImportProjectMediaRequest,
  ): Promise<ProjectResult<ImportProjectMediaOutcome>>;
  startDroppedProjectMediaImport(
    files: readonly File[],
    request: ImportProjectMediaRequest,
  ): Promise<ProjectResult<StartProjectMediaImportOutcome>>;
  cancelProjectMediaImport(
    request: CancelProjectMediaImportRequest,
  ): Promise<ProjectResult<null>>;
  onProjectMediaImportProgress(
    listener: (progress: ProjectMediaImportProgress) => void,
  ): () => void;
  getProjectMediaAsset(
    request: GetProjectMediaAssetRequest,
  ): Promise<ProjectResult<ProjectMediaAsset>>;
  listProjectMediaUsages(
    request: ListProjectMediaUsagesRequest,
  ): Promise<ProjectResult<readonly ProjectMediaUsage[]>>;
  getMediaGallery(): Promise<ProjectResult<MediaGallerySnapshot>>;
  createMediaFolder(
    request: CreateMediaFolderRequest,
  ): Promise<ProjectResult<MediaGallerySnapshot>>;
  createMediaFolderWithEntries(
    request: CreateMediaFolderWithEntriesRequest,
  ): Promise<ProjectResult<MediaGallerySnapshot>>;
  renameMediaEntry(
    request: RenameMediaEntryRequest,
  ): Promise<ProjectResult<MediaGallerySnapshot>>;
  moveMediaEntries(
    request: MoveMediaEntriesRequest,
  ): Promise<ProjectResult<MediaGallerySnapshot>>;
  trashMediaEntries(
    request: TrashMediaEntriesRequest,
  ): Promise<ProjectResult<MediaGallerySnapshot>>;
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
  createDiagramDocument(
    request: CreateDiagramDocumentRequest,
  ): Promise<ProjectResult<ProjectTreeNode>>;
  readDiagramDocument(
    request: ReadDiagramDocumentRequest,
  ): Promise<ProjectResult<DiagramDocumentEnvelope>>;
  saveDiagramDocument(
    request: SaveDiagramDocumentRequest,
  ): Promise<ProjectResult<DiagramDocumentEnvelope>>;
  selectDiagramImport(): Promise<ProjectResult<SelectDiagramImportOutcome>>;
  commitDiagramImport(
    request: CommitDiagramImportRequest,
  ): Promise<ProjectResult<CommitDiagramImportOutcome>>;
  exportDiagram(
    request: ExportDiagramRequest,
  ): Promise<ProjectResult<ExportDiagramOutcome>>;
  consumePendingDiagramOpen(): Promise<
    ProjectResult<CommitDiagramImportOutcome | null>
  >;
  onPendingDiagramOpen(listener: () => void): () => void;
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
