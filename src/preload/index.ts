import { contextBridge, ipcRenderer, webFrame } from 'electron/renderer';

import {
  BOOTSTRAP_STATE_CHANNEL,
  OPEN_EXTERNAL_LINK_CHANNEL,
  CLOSE_REQUESTED_CHANNEL,
  CLOSE_RESPONSE_CHANNEL,
  RESTART_APPLICATION_CHANNEL,
  GET_RESTORABLE_TAB_SESSION_CHANNEL,
  isApplicationMenuCommand,
  isBootstrapState,
  isCloseRequest,
  isCloseResponse,
  isRendererMenuCommand,
  isTabSessionRestoreDecision,
  isWorkspaceSessionSnapshot,
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
  GET_PREFERENCES_CHANNEL,
  SAVE_PREFERENCES_CHANNEL,
  RESET_PREFERENCES_CHANNEL,
  ADD_SPELLCHECK_WORD_CHANNEL,
  APPLY_WINDOW_THEME_CHANNEL,
  CHECK_SPELLCHECK_WORDS_CHANNEL,
  GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
  isFlyoffPreferences,
  isFlyoffTheme,
  isPreferencesSnapshot,
  isSpellcheckWordRequest,
  isSpellcheckWordList,
  isSpellcheckWordsRequest,
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANGED_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type FlyoffApi,
  type FlyoffPreferences,
  type FlyoffTheme,
  type WorkspaceLayoutState,
  type ApplicationMenuCommand,
  type CloseRequest,
  type CloseResponse,
  type RendererMenuCommand,
  type TabSessionRestoreDecision,
  type WorkspaceSessionSnapshot,
  type WindowControlAction,
  type WindowState,
  PROJECT_IPC_CHANNELS,
  DIAGRAM_IPC_CHANNELS,
  PROJECT_NOTE_ACTIVITY_IPC_CHANNELS,
  isCreateProjectRequest,
  isGetProjectNodeRequest,
  isRestoreProjectRequest,
  isListProjectChildrenRequest,
  isListProjectBacklinksRequest,
  isCreateProjectNodeRequest,
  isRenameProjectNodeRequest,
  isMoveProjectNodeRequest,
  isMoveProjectNodesRequest,
  isProjectPathRequest,
  isProjectPathsRequest,
  isTrashProjectNodeRequest,
  isTrashProjectNodesRequest,
  isTrashProjectNodeOutcome,
  isReadMarkdownDocumentRequest,
  isSaveMarkdownDocumentRequest,
  isProjectBacklinksOutcome,
  isProjectGraphSnapshot,
  isProjectInternalLinkRequest,
  isProjectInternalLinkResolution,
  isProjectSearchOutcome,
  isProjectSearchRequest,
  isProjectLinkTargetList,
  isProjectNodeMutationOutcome,
  isProjectNodesMutationOutcome,
  isProjectNoteActivityEntry,
  isProjectNoteActivityEntryList,
  isProjectNoteActivityEvent,
  isProjectResult,
  isProjectLocationSelection,
  isProjectSummary,
  isProjectTreeNode,
  isProjectTreeNodeList,
  isMarkdownDocument,
  isProjectPageProperties,
  isCreateDiagramDocumentRequest,
  isReadDiagramDocumentRequest,
  isSaveDiagramDocumentRequest,
  isDiagramDocumentEnvelope,
  isSelectDiagramImportOutcome,
  isCommitDiagramImportRequest,
  isCommitDiagramImportOutcome,
  isExportDiagramRequest,
  isExportDiagramOutcome,
  isGetProjectPagePropertiesRequest,
  isSetProjectPageReadOnlyRequest,
  isProtectProjectPageRequest,
  isChangeProjectPagePasswordRequest,
  isRemoveProjectPagePasswordRequest,
  isUnlockProjectPageRequest,
  isLockProjectPageRequest,
  isOpenExternalLinkRequest,
  isOpenExternalLinkResult,
  isTwineApiKeyInput,
  isTwineConversationId,
  isTwineConversationSnapshot,
  isTwineConversationStoreSnapshot,
  isTwineCredentialStatus,
  isTwineDocumentToolResultSubmission,
  isTwineGenerationEvent,
  isTwineGenerationRequest,
  isTwineRequestId,
  TWINE_CANCEL_GENERATION_CHANNEL,
  TWINE_CREATE_CONVERSATION_CHANNEL,
  TWINE_CREDENTIAL_STATUS_CHANNEL,
  TWINE_DELETE_CONVERSATION_CHANNEL,
  TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
  TWINE_GENERATION_EVENT_CHANNEL,
  TWINE_LIST_CONVERSATIONS_CHANNEL,
  TWINE_LOAD_CONVERSATION_CHANNEL,
  TWINE_REMOVE_API_KEY_CHANNEL,
  TWINE_SAVE_CONVERSATION_CHANNEL,
  TWINE_SAVE_API_KEY_CHANNEL,
  TWINE_START_GENERATION_CHANNEL,
  type CreateProjectRequest,
  type GetProjectNodeRequest,
  type RestoreProjectRequest,
  type ListProjectChildrenRequest,
  type ListProjectBacklinksRequest,
  type CreateProjectNodeRequest,
  type RenameProjectNodeRequest,
  type MoveProjectNodeRequest,
  type MoveProjectNodesRequest,
  type ProjectPathRequest,
  type ProjectPathsRequest,
  type TrashProjectNodeRequest,
  type TrashProjectNodesRequest,
  type ReadMarkdownDocumentRequest,
  type SaveMarkdownDocumentRequest,
  type ProjectInternalLinkRequest,
  type ProjectSearchRequest,
  type GetProjectPagePropertiesRequest,
  type SetProjectPageReadOnlyRequest,
  type ProtectProjectPageRequest,
  type ChangeProjectPagePasswordRequest,
  type RemoveProjectPagePasswordRequest,
  type UnlockProjectPageRequest,
  type LockProjectPageRequest,
  type CreateDiagramDocumentRequest,
  type ReadDiagramDocumentRequest,
  type SaveDiagramDocumentRequest,
  type CommitDiagramImportRequest,
  type CommitDiagramImportOutcome,
  type ExportDiagramRequest,
  type ProjectNoteActivityEvent,
  type OpenExternalLinkRequest,
  type SpellcheckWordRequest,
  type SpellcheckWordsRequest,
  type TwineConversationSnapshot,
  type TwineDocumentToolResultSubmission,
  type TwineGenerationEvent,
  type TwineGenerationRequest,
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

    if (session !== null && !isWorkspaceSessionSnapshot(session)) {
      throw new Error('The main process returned an invalid tab session.');
    }

    return session;
  },
  async resolveRestorableTabSession(
    decision: TabSessionRestoreDecision,
    current: WorkspaceSessionSnapshot,
  ) {
    if (!isTabSessionRestoreDecision(decision)) {
      throw new TypeError('Invalid tab session restoration decision.');
    }

    if (!isWorkspaceSessionSnapshot(current)) {
      throw new TypeError('Invalid tab session snapshot.');
    }

    await ipcRenderer.invoke(
      RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
      decision,
      current,
    );
  },
  async saveTabSession(session: WorkspaceSessionSnapshot) {
    if (!isWorkspaceSessionSnapshot(session)) {
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
  async getPreferences() {
    const snapshot: unknown = await ipcRenderer.invoke(
      GET_PREFERENCES_CHANNEL,
    );
    if (!isPreferencesSnapshot(snapshot)) {
      throw new Error('The main process returned invalid preferences.');
    }
    return snapshot;
  },
  async savePreferences(preferences: FlyoffPreferences) {
    if (!isFlyoffPreferences(preferences)) {
      throw new TypeError('Invalid Flyoff preferences.');
    }
    const snapshot: unknown = await ipcRenderer.invoke(
      SAVE_PREFERENCES_CHANNEL,
      preferences,
    );
    if (!isPreferencesSnapshot(snapshot)) {
      throw new Error('The main process returned invalid preferences.');
    }
    return snapshot;
  },
  async resetPreferences() {
    const snapshot: unknown = await ipcRenderer.invoke(
      RESET_PREFERENCES_CHANNEL,
    );
    if (!isPreferencesSnapshot(snapshot)) {
      throw new Error('The main process returned invalid preferences.');
    }
    return snapshot;
  },
  async applyWindowTheme(theme: FlyoffTheme) {
    if (!isFlyoffTheme(theme)) {
      throw new TypeError('Invalid Flyoff theme.');
    }
    await ipcRenderer.invoke(APPLY_WINDOW_THEME_CHANNEL, theme);
  },
  async checkSpellcheckWords(request: SpellcheckWordsRequest) {
    if (!isSpellcheckWordsRequest(request)) {
      throw new TypeError('Invalid spellcheck words request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      CHECK_SPELLCHECK_WORDS_CHANNEL,
      request,
    );
    if (!isSpellcheckWordList(result)) {
      throw new Error('The main process returned invalid spelling results.');
    }
    return result;
  },
  async getSpellcheckSuggestions(request: SpellcheckWordRequest) {
    if (!isSpellcheckWordRequest(request)) {
      throw new TypeError('Invalid spellcheck word request.');
    }
    const result: unknown =
      process.platform === 'darwin'
        ? webFrame.getWordSuggestions(request.word)
        : await ipcRenderer.invoke(
            GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
            request,
          );
    if (!isSpellcheckWordList(result)) {
      throw new Error('The main process returned invalid spelling suggestions.');
    }
    return result.slice(0, 8);
  },
  async addSpellcheckWord(request: SpellcheckWordRequest) {
    if (!isSpellcheckWordRequest(request)) {
      throw new TypeError('Invalid spellcheck word request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      ADD_SPELLCHECK_WORD_CHANNEL,
      request,
    );
    if (typeof result !== 'boolean') {
      throw new Error('The main process returned an invalid dictionary result.');
    }
    return result;
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
  async restartApplication() {
    await ipcRenderer.invoke(RESTART_APPLICATION_CHANNEL);
  },
  async openExternalLink(request: OpenExternalLinkRequest) {
    if (!isOpenExternalLinkRequest(request)) {
      throw new TypeError('Invalid external link request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      OPEN_EXTERNAL_LINK_CHANNEL,
      request,
    );
    if (!isOpenExternalLinkResult(result)) {
      throw new Error('The main process returned an invalid link result.');
    }
    return result;
  },
  async getTwineCredentialStatus() {
    const status: unknown = await ipcRenderer.invoke(
      TWINE_CREDENTIAL_STATUS_CHANNEL,
    );
    if (!isTwineCredentialStatus(status)) {
      throw new Error('The main process returned invalid Twine credentials.');
    }
    return status;
  },
  async saveTwineApiKey(apiKey: string) {
    if (!isTwineApiKeyInput(apiKey)) {
      throw new TypeError('Invalid Twine API key.');
    }
    const status: unknown = await ipcRenderer.invoke(
      TWINE_SAVE_API_KEY_CHANNEL,
      apiKey,
    );
    if (!isTwineCredentialStatus(status)) {
      throw new Error('The main process returned invalid Twine credentials.');
    }
    return status;
  },
  async removeTwineApiKey() {
    const status: unknown = await ipcRenderer.invoke(
      TWINE_REMOVE_API_KEY_CHANNEL,
    );
    if (!isTwineCredentialStatus(status)) {
      throw new Error('The main process returned invalid Twine credentials.');
    }
    return status;
  },
  async listTwineConversations() {
    const snapshot: unknown = await ipcRenderer.invoke(
      TWINE_LIST_CONVERSATIONS_CHANNEL,
    );
    if (!isTwineConversationStoreSnapshot(snapshot)) {
      throw new Error('The main process returned invalid Twine conversations.');
    }
    return snapshot;
  },
  async loadTwineConversation(id: string) {
    if (!isTwineConversationId(id)) {
      throw new TypeError('Invalid Twine conversation id.');
    }
    const conversation: unknown = await ipcRenderer.invoke(
      TWINE_LOAD_CONVERSATION_CHANNEL,
      id,
    );
    if (
      conversation !== null &&
      !isTwineConversationSnapshot(conversation)
    ) {
      throw new Error('The main process returned an invalid Twine conversation.');
    }
    return conversation;
  },
  async saveTwineConversation(conversation: TwineConversationSnapshot) {
    if (!isTwineConversationSnapshot(conversation)) {
      throw new TypeError('Invalid Twine conversation snapshot.');
    }
    const snapshot: unknown = await ipcRenderer.invoke(
      TWINE_SAVE_CONVERSATION_CHANNEL,
      conversation,
    );
    if (!isTwineConversationStoreSnapshot(snapshot)) {
      throw new Error('The main process returned invalid Twine conversations.');
    }
    return snapshot;
  },
  async createTwineConversation() {
    const conversation: unknown = await ipcRenderer.invoke(
      TWINE_CREATE_CONVERSATION_CHANNEL,
    );
    if (!isTwineConversationSnapshot(conversation)) {
      throw new Error('The main process returned an invalid Twine conversation.');
    }
    return conversation;
  },
  async deleteTwineConversation(id: string) {
    if (!isTwineConversationId(id)) {
      throw new TypeError('Invalid Twine conversation id.');
    }
    const snapshot: unknown = await ipcRenderer.invoke(
      TWINE_DELETE_CONVERSATION_CHANNEL,
      id,
    );
    if (!isTwineConversationStoreSnapshot(snapshot)) {
      throw new Error('The main process returned invalid Twine conversations.');
    }
    return snapshot;
  },
  async startTwineGeneration(request: TwineGenerationRequest) {
    if (!isTwineGenerationRequest(request)) {
      throw new TypeError('Invalid Twine generation request.');
    }
    await ipcRenderer.invoke(TWINE_START_GENERATION_CHANNEL, request);
  },
  async cancelTwineGeneration(requestId: string) {
    if (!isTwineRequestId(requestId)) {
      throw new TypeError('Invalid Twine request id.');
    }
    await ipcRenderer.invoke(TWINE_CANCEL_GENERATION_CHANNEL, requestId);
  },
  async submitTwineDocumentToolResult(
    submission: TwineDocumentToolResultSubmission,
  ) {
    if (!isTwineDocumentToolResultSubmission(submission)) {
      throw new TypeError('Invalid Twine document tool result.');
    }
    await ipcRenderer.invoke(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL, submission);
  },
  onTwineGenerationEvent(listener: (event: TwineGenerationEvent) => void) {
    const handleEvent = (_event: unknown, event: unknown) => {
      if (isTwineGenerationEvent(event)) {
        listener(event);
      }
    };

    ipcRenderer.on(TWINE_GENERATION_EVENT_CHANNEL, handleEvent);

    return () => {
      ipcRenderer.removeListener(
        TWINE_GENERATION_EVENT_CHANNEL,
        handleEvent,
      );
    };
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
  async getProjectNoteActivity() {
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.get,
    );

    if (!isProjectResult(result, isProjectNoteActivityEntryList)) {
      throw new Error('The main process returned invalid project note activity.');
    }

    return result;
  },
  async recordProjectNoteActivity(event: ProjectNoteActivityEvent) {
    if (!isProjectNoteActivityEvent(event)) {
      throw new TypeError('Invalid project note activity event.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.record,
      event,
    );

    if (!isProjectResult(result, isProjectNoteActivityEntry)) {
      throw new Error(
        'The main process returned invalid project note activity.',
      );
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

    if (!isProjectResult(result, isProjectNodeMutationOutcome)) {
      throw new Error('The main process returned an invalid project mutation.');
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

    if (!isProjectResult(result, isProjectNodeMutationOutcome)) {
      throw new Error('The main process returned an invalid project mutation.');
    }

    return result;
  },
  async moveProjectNodes(request: MoveProjectNodesRequest) {
    if (!isMoveProjectNodesRequest(request)) {
      throw new TypeError('Invalid project nodes move request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.moveNodes,
      request,
    );

    if (!isProjectResult(result, isProjectNodesMutationOutcome)) {
      throw new Error('The main process returned an invalid batch mutation.');
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
  async trashProjectNodes(request: TrashProjectNodesRequest) {
    if (!isTrashProjectNodesRequest(request)) {
      throw new TypeError('Invalid project nodes trash request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.trashNodes,
      request,
    );

    if (!isProjectResult(result, isTrashProjectNodeOutcome)) {
      throw new Error('The main process returned an invalid batch trash result.');
    }

    return result;
  },
  async revealProjectPath(request: ProjectPathRequest) {
    if (!isProjectPathRequest(request)) {
      throw new TypeError('Invalid project path request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.revealPath,
      request,
    );

    if (!isProjectResult(result, isNull)) {
      throw new Error('The main process returned an invalid path reveal result.');
    }

    return result;
  },
  async copyProjectPath(request: ProjectPathRequest) {
    if (!isProjectPathRequest(request)) {
      throw new TypeError('Invalid project path request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.copyPath,
      request,
    );

    if (!isProjectResult(result, isNull)) {
      throw new Error('The main process returned an invalid path copy result.');
    }

    return result;
  },
  async copyProjectPaths(request: ProjectPathsRequest) {
    if (!isProjectPathsRequest(request)) {
      throw new TypeError('Invalid project paths request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.copyPaths,
      request,
    );

    if (!isProjectResult(result, isNull)) {
      throw new Error('The main process returned an invalid paths copy result.');
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
  async createDiagramDocument(request: CreateDiagramDocumentRequest) {
    if (!isCreateDiagramDocumentRequest(request)) {
      throw new TypeError('Invalid diagram creation request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.create,
      request,
    );
    if (!isProjectResult(result, isProjectTreeNode)) {
      throw new Error('The main process returned an invalid diagram page.');
    }
    return result;
  },
  async readDiagramDocument(request: ReadDiagramDocumentRequest) {
    if (!isReadDiagramDocumentRequest(request)) {
      throw new TypeError('Invalid diagram read request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.read,
      request,
    );
    if (!isProjectResult(result, isDiagramDocumentEnvelope)) {
      throw new Error('The main process returned an invalid diagram document.');
    }
    return result;
  },
  async saveDiagramDocument(request: SaveDiagramDocumentRequest) {
    if (!isSaveDiagramDocumentRequest(request)) {
      throw new TypeError('Invalid diagram save request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.save,
      request,
    );
    if (!isProjectResult(result, isDiagramDocumentEnvelope)) {
      throw new Error('The main process returned an invalid diagram document.');
    }
    return result;
  },
  async selectDiagramImport() {
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.selectImport,
    );
    if (!isProjectResult(result, isSelectDiagramImportOutcome)) {
      throw new Error('The main process returned an invalid diagram import selection.');
    }
    return result;
  },
  async commitDiagramImport(request: CommitDiagramImportRequest) {
    if (!isCommitDiagramImportRequest(request)) {
      throw new TypeError('Invalid diagram import request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.commitImport,
      request,
    );
    if (!isProjectResult(result, isCommitDiagramImportOutcome)) {
      throw new Error('The main process returned an invalid diagram import result.');
    }
    return result;
  },
  async exportDiagram(request: ExportDiagramRequest) {
    if (!isExportDiagramRequest(request)) {
      throw new TypeError('Invalid diagram export request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.export,
      request,
    );
    if (!isProjectResult(result, isExportDiagramOutcome)) {
      throw new Error('The main process returned an invalid diagram export result.');
    }
    return result;
  },
  async consumePendingDiagramOpen() {
    const result: unknown = await ipcRenderer.invoke(
      DIAGRAM_IPC_CHANNELS.openPending,
    );
    if (
      !isProjectResult(
        result,
        (value): value is CommitDiagramImportOutcome | null =>
          value === null || isCommitDiagramImportOutcome(value),
      )
    ) {
      throw new Error('The main process returned an invalid pending diagram result.');
    }
    return result;
  },
  onPendingDiagramOpen(listener: () => void) {
    const handlePending = () => listener();
    ipcRenderer.on(DIAGRAM_IPC_CHANNELS.pendingChanged, handlePending);
    return () => {
      ipcRenderer.removeListener(
        DIAGRAM_IPC_CHANNELS.pendingChanged,
        handlePending,
      );
    };
  },
  async getProjectGraph() {
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.getGraph,
    );

    if (!isProjectResult(result, isProjectGraphSnapshot)) {
      throw new Error('The main process returned an invalid project graph.');
    }

    return result;
  },
  async listProjectLinkTargets() {
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.listLinkTargets,
    );

    if (!isProjectResult(result, isProjectLinkTargetList)) {
      throw new Error('The main process returned invalid project link targets.');
    }

    return result;
  },
  async searchProject(request: ProjectSearchRequest) {
    if (!isProjectSearchRequest(request)) {
      throw new TypeError('Invalid project search request.');
    }

    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.search,
      request,
    );

    if (!isProjectResult(result, isProjectSearchOutcome)) {
      throw new Error('The main process returned an invalid project search.');
    }

    return result;
  },
  async resolveProjectInternalLink(request: ProjectInternalLinkRequest) {
    if (!isProjectInternalLinkRequest(request)) {
      throw new TypeError('Invalid project internal link request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.resolveInternalLink,
      request,
    );

    if (!isProjectResult(result, isProjectInternalLinkResolution)) {
      throw new Error(
        'The main process returned an invalid project link resolution.',
      );
    }

    return result;
  },
  async listProjectBacklinks(request: ListProjectBacklinksRequest) {
    if (!isListProjectBacklinksRequest(request)) {
      throw new TypeError('Invalid project backlinks request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.listBacklinks,
      request,
    );

    if (!isProjectResult(result, isProjectBacklinksOutcome)) {
      throw new Error('The main process returned invalid project backlinks.');
    }

    return result;
  },
  async getProjectPageProperties(request: GetProjectPagePropertiesRequest) {
    if (!isGetProjectPagePropertiesRequest(request)) {
      throw new TypeError('Invalid project page properties request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.getPageProperties,
      request,
    );
    if (!isProjectResult(result, isProjectPageProperties)) {
      throw new Error('The main process returned invalid page properties.');
    }
    return result;
  },
  async setProjectPageReadOnly(request: SetProjectPageReadOnlyRequest) {
    if (!isSetProjectPageReadOnlyRequest(request)) {
      throw new TypeError('Invalid project page read-only request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.setPageReadOnly,
      request,
    );
    if (!isProjectResult(result, isProjectPageProperties)) {
      throw new Error('The main process returned invalid page properties.');
    }
    return result;
  },
  async protectProjectPage(request: ProtectProjectPageRequest) {
    if (!isProtectProjectPageRequest(request)) {
      throw new TypeError('Invalid project page protection request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.protectPage,
      request,
    );
    if (!isProjectResult(result, isProjectPageProperties)) {
      throw new Error('The main process returned invalid page properties.');
    }
    return result;
  },
  async changeProjectPagePassword(
    request: ChangeProjectPagePasswordRequest,
  ) {
    if (!isChangeProjectPagePasswordRequest(request)) {
      throw new TypeError('Invalid project page password change request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.changePagePassword,
      request,
    );
    if (!isProjectResult(result, isProjectPageProperties)) {
      throw new Error('The main process returned invalid page properties.');
    }
    return result;
  },
  async removeProjectPagePassword(
    request: RemoveProjectPagePasswordRequest,
  ) {
    if (!isRemoveProjectPagePasswordRequest(request)) {
      throw new TypeError('Invalid project page password removal request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.removePagePassword,
      request,
    );
    if (!isProjectResult(result, isProjectPageProperties)) {
      throw new Error('The main process returned invalid page properties.');
    }
    return result;
  },
  async unlockProjectPage(request: UnlockProjectPageRequest) {
    if (!isUnlockProjectPageRequest(request)) {
      throw new TypeError('Invalid project page unlock request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.unlockPage,
      request,
    );
    if (!isProjectResult(result, isMarkdownDocument)) {
      throw new Error('The main process returned an invalid Markdown document.');
    }
    return result;
  },
  async lockProjectPage(request: LockProjectPageRequest) {
    if (!isLockProjectPageRequest(request)) {
      throw new TypeError('Invalid project page lock request.');
    }
    const result: unknown = await ipcRenderer.invoke(
      PROJECT_IPC_CHANNELS.lockPage,
      request,
    );
    if (!isProjectResult(result, isNull)) {
      throw new Error('The main process returned an invalid page lock result.');
    }
    return result;
  },
});

contextBridge.exposeInMainWorld('flyoff', flyoffApi);
