import { contextBridge, ipcRenderer } from 'electron/renderer';

import {
  BOOTSTRAP_STATE_CHANNEL,
  CLOSE_REQUESTED_CHANNEL,
  CLOSE_RESPONSE_CHANNEL,
  GET_RESTORABLE_TAB_SESSION_CHANNEL,
  isApplicationMenuCommand,
  isBootstrapState,
  isCloseRequest,
  isCloseResponse,
  isRendererMenuCommand,
  isTabSessionRestoreDecision,
  isTabSessionSnapshot,
  MENU_COMMAND_CHANNEL,
  RENDERER_MENU_COMMAND_CHANNEL,
  RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
  SAVE_TAB_SESSION_CHANNEL,
  isWindowControlAction,
  isWindowState,
  isWorkspaceLayoutState,
  normalizeWorkspaceLayoutState,
  GET_UI_STATE_CHANNEL,
  SAVE_UI_STATE_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANGED_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type FlyoffApi,
  type WorkspaceLayoutState,
  type ApplicationMenuCommand,
  type CloseRequest,
  type CloseResponse,
  type RendererMenuCommand,
  type TabSessionRestoreDecision,
  type TabSessionSnapshot,
  type WindowControlAction,
  type WindowState,
  PROJECT_IPC_CHANNELS,
  isCreateProjectRequest,
  isGetProjectNodeRequest,
  isRestoreProjectRequest,
  isListProjectChildrenRequest,
  isCreateProjectNodeRequest,
  isRenameProjectNodeRequest,
  isMoveProjectNodeRequest,
  isTrashProjectNodeRequest,
  isTrashProjectNodeOutcome,
  isReadMarkdownDocumentRequest,
  isSaveMarkdownDocumentRequest,
  isProjectResult,
  isProjectLocationSelection,
  isProjectSummary,
  isProjectTreeNode,
  isProjectTreeNodeList,
  isMarkdownDocument,
  type CreateProjectRequest,
  type GetProjectNodeRequest,
  type RestoreProjectRequest,
  type ListProjectChildrenRequest,
  type CreateProjectNodeRequest,
  type RenameProjectNodeRequest,
  type MoveProjectNodeRequest,
  type TrashProjectNodeRequest,
  type ReadMarkdownDocumentRequest,
  type SaveMarkdownDocumentRequest,
} from '../shared/contracts';

function isNull(value: unknown): value is null {
  return value === null;
}

const flyoffApi: FlyoffApi = Object.freeze({
  async getBootstrapState() {
    const state: unknown = await ipcRenderer.invoke(BOOTSTRAP_STATE_CHANNEL);

    if (!isBootstrapState(state)) {
      throw new Error('The main process returned an invalid bootstrap state.');
    }

    return state;
  },
  async getWindowState() {
    const state: unknown = await ipcRenderer.invoke(WINDOW_STATE_CHANNEL);

    if (!isWindowState(state)) {
      throw new Error('The main process returned an invalid window state.');
    }

    return state;
  },
  async controlWindow(action: WindowControlAction) {
    if (!isWindowControlAction(action)) {
      throw new TypeError('Invalid window control action.');
    }

    const state: unknown = await ipcRenderer.invoke(
      WINDOW_CONTROL_CHANNEL,
      action,
    );

    if (!isWindowState(state)) {
      throw new Error('The main process returned an invalid window state.');
    }

    return state;
  },
  onWindowStateChanged(listener: (state: WindowState) => void) {
    const handleStateChange = (_event: unknown, state: unknown) => {
      if (isWindowState(state)) {
        listener(state);
      }
    };

    ipcRenderer.on(WINDOW_STATE_CHANGED_CHANNEL, handleStateChange);

    return () => {
      ipcRenderer.removeListener(
        WINDOW_STATE_CHANGED_CHANNEL,
        handleStateChange,
      );
    };
  },
  async executeMenuCommand(command: ApplicationMenuCommand) {
    if (!isApplicationMenuCommand(command)) {
      throw new TypeError('Invalid application menu command.');
    }

    await ipcRenderer.invoke(MENU_COMMAND_CHANNEL, command);
  },
  async getRestorableTabSession() {
    const session: unknown = await ipcRenderer.invoke(
      GET_RESTORABLE_TAB_SESSION_CHANNEL,
    );

    if (session !== null && !isTabSessionSnapshot(session)) {
      throw new Error('The main process returned an invalid tab session.');
    }

    return session;
  },
  async resolveRestorableTabSession(
    decision: TabSessionRestoreDecision,
    current: TabSessionSnapshot,
  ) {
    if (!isTabSessionRestoreDecision(decision)) {
      throw new TypeError('Invalid tab session restoration decision.');
    }

    if (!isTabSessionSnapshot(current)) {
      throw new TypeError('Invalid tab session snapshot.');
    }

    await ipcRenderer.invoke(
      RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
      decision,
      current,
    );
  },
  async saveTabSession(session: TabSessionSnapshot) {
    if (!isTabSessionSnapshot(session)) {
      throw new TypeError('Invalid tab session snapshot.');
    }

    await ipcRenderer.invoke(SAVE_TAB_SESSION_CHANNEL, session);
  },
  async getUiState() {
    const state: unknown = await ipcRenderer.invoke(GET_UI_STATE_CHANNEL);

    return normalizeWorkspaceLayoutState(state);
  },
  async saveUiState(state: WorkspaceLayoutState) {
    if (!isWorkspaceLayoutState(state)) {
      throw new TypeError('Invalid workspace layout state.');
    }

    await ipcRenderer.invoke(SAVE_UI_STATE_CHANNEL, state);
  },
  onCloseRequested(listener: (request: CloseRequest) => void) {
    const handleCloseRequest = (_event: unknown, request: unknown) => {
      if (isCloseRequest(request)) {
        listener(request);
      }
    };

    ipcRenderer.on(CLOSE_REQUESTED_CHANNEL, handleCloseRequest);

    return () => {
      ipcRenderer.removeListener(CLOSE_REQUESTED_CHANNEL, handleCloseRequest);
    };
  },
  async respondToCloseRequest(response: CloseResponse) {
    if (!isCloseResponse(response)) {
      throw new TypeError('Invalid close response.');
    }

    await ipcRenderer.invoke(CLOSE_RESPONSE_CHANNEL, response);
  },
  onRendererMenuCommand(
    listener: (command: RendererMenuCommand) => void,
  ) {
    const handleCommand = (_event: unknown, command: unknown) => {
      if (isRendererMenuCommand(command)) {
        listener(command);
      }
    };

    ipcRenderer.on(RENDERER_MENU_COMMAND_CHANNEL, handleCommand);

    return () => {
      ipcRenderer.removeListener(
        RENDERER_MENU_COMMAND_CHANNEL,
        handleCommand,
      );
    };
  },
  async selectProjectCreateLocation() {
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.selectCreateLocation,
    );

    if (!isProjectResult(result, isProjectLocationSelection)) {
      throw new Error('The main process returned an invalid location selection.');
    }

    return result;
  },
  async createProject(request: CreateProjectRequest) {
    if (!isCreateProjectRequest(request)) {
      throw new TypeError('Invalid project creation request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.create,
      request,
    );

    if (!isProjectResult(result, isProjectSummary)) {
      throw new Error('The main process returned an invalid project.');
    }

    return result;
  },
  async openProject() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_IPC_CHANNELS.open);

    if (!isProjectResult(result, isProjectSummary)) {
      throw new Error('The main process returned an invalid project.');
    }

    return result;
  },
  async restoreProject(request: RestoreProjectRequest) {
    if (!isRestoreProjectRequest(request)) {
      throw new TypeError('Invalid project restoration request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.restore,
      request,
    );

    if (!isProjectResult(result, isProjectSummary)) {
      throw new Error('The main process returned an invalid project.');
    }

    return result;
  },
  async closeProject() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_IPC_CHANNELS.close);

    if (!isProjectResult(result, isNull)) {
      throw new Error('The main process returned an invalid project close result.');
    }

    return result;
  },
  async listProjectChildren(request: ListProjectChildrenRequest) {
    if (!isListProjectChildrenRequest(request)) {
      throw new TypeError('Invalid project directory request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.listChildren,
      request,
    );

    if (!isProjectResult(result, isProjectTreeNodeList)) {
      throw new Error('The main process returned an invalid project directory.');
    }

    return result;
  },
  async getProjectNode(request: GetProjectNodeRequest) {
    if (!isGetProjectNodeRequest(request)) {
      throw new TypeError('Invalid project node request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.getNode,
      request,
    );

    if (!isProjectResult(result, isProjectTreeNode)) {
      throw new Error('The main process returned an invalid project node.');
    }

    return result;
  },
  async createProjectNode(request: CreateProjectNodeRequest) {
    if (!isCreateProjectNodeRequest(request)) {
      throw new TypeError('Invalid project node creation request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.createNode,
      request,
    );

    if (!isProjectResult(result, isProjectTreeNode)) {
      throw new Error('The main process returned an invalid project node.');
    }

    return result;
  },
  async renameProjectNode(request: RenameProjectNodeRequest) {
    if (!isRenameProjectNodeRequest(request)) {
      throw new TypeError('Invalid project node rename request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.renameNode,
      request,
    );

    if (!isProjectResult(result, isProjectTreeNode)) {
      throw new Error('The main process returned an invalid project node.');
    }

    return result;
  },
  async moveProjectNode(request: MoveProjectNodeRequest) {
    if (!isMoveProjectNodeRequest(request)) {
      throw new TypeError('Invalid project node move request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.moveNode,
      request,
    );

    if (!isProjectResult(result, isProjectTreeNode)) {
      throw new Error('The main process returned an invalid project node.');
    }

    return result;
  },
  async trashProjectNode(request: TrashProjectNodeRequest) {
    if (!isTrashProjectNodeRequest(request)) {
      throw new TypeError('Invalid project node trash request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.trashNode,
      request,
    );

    if (!isProjectResult(result, isTrashProjectNodeOutcome)) {
      throw new Error('The main process returned an invalid trash result.');
    }

    return result;
  },
  async readMarkdownDocument(request: ReadMarkdownDocumentRequest) {
    if (!isReadMarkdownDocumentRequest(request)) {
      throw new TypeError('Invalid Markdown document request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.readMarkdown,
      request,
    );

    if (!isProjectResult(result, isMarkdownDocument)) {
      throw new Error('The main process returned an invalid Markdown document.');
    }

    return result;
  },
  async saveMarkdownDocument(request: SaveMarkdownDocumentRequest) {
    if (!isSaveMarkdownDocumentRequest(request)) {
      throw new TypeError('Invalid Markdown document save request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.saveMarkdown,
      request,
    );

    if (!isProjectResult(result, isMarkdownDocument)) {
      throw new Error('The main process returned an invalid Markdown document.');
    }

    return result;
  },
});

contextBridge.exposeInMainWorld('flyoff', flyoffApi);
