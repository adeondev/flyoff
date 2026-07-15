import { isUiLocale, type UiLocale } from './locales';
import type { ApplicationMenuCommand } from './menu';
import type { RendererMenuCommand } from './menu';
import type { CloseRequest, CloseResponse } from './close';
import type {
  TabSessionRestoreDecision,
  TabSessionSnapshot,
} from './tab-session';
import type {
  WindowControlAction,
  WindowState,
} from './window-controls';
import type {
  CreateProjectNodeRequest,
  CreateProjectRequest,
  GetProjectNodeRequest,
  ListProjectChildrenRequest,
  MarkdownDocument,
  MoveProjectNodeRequest,
  ProjectLocationSelection,
  ProjectResult,
  ProjectSummary,
  ProjectTreeNode,
  ReadMarkdownDocumentRequest,
  RenameProjectNodeRequest,
  RestoreProjectRequest,
  SaveMarkdownDocumentRequest,
  TrashProjectNodeRequest,
  TrashProjectNodeOutcome,
} from './projects';
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
  getRestorableTabSession(): Promise<TabSessionSnapshot | null>;
  resolveRestorableTabSession(
    decision: TabSessionRestoreDecision,
    current: TabSessionSnapshot,
  ): Promise<void>;
  saveTabSession(session: TabSessionSnapshot): Promise<void>;
  onCloseRequested(listener: (request: CloseRequest) => void): () => void;
  respondToCloseRequest(response: CloseResponse): Promise<void>;
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
  ): Promise<ProjectResult<ProjectTreeNode>>;
  moveProjectNode(
    request: MoveProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>>;
  trashProjectNode(
    request: TrashProjectNodeRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>>;
  readMarkdownDocument(
    request: ReadMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>>;
  saveMarkdownDocument(
    request: SaveMarkdownDocumentRequest,
  ): Promise<ProjectResult<MarkdownDocument>>;
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
