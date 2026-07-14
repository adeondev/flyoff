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
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANGED_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type FlyoffApi,
  type ApplicationMenuCommand,
  type CloseRequest,
  type CloseResponse,
  type RendererMenuCommand,
  type TabSessionRestoreDecision,
  type TabSessionSnapshot,
  type WindowControlAction,
  type WindowState,
} from '../shared/contracts';

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
});

contextBridge.exposeInMainWorld('flyoff', flyoffApi);
