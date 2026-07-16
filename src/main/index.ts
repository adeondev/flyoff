import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  session,
} from 'electron';

import {
  isFlyoffPlatform,
  RENDERER_MENU_COMMAND_CHANNEL,
  type BootstrapState,
  type FlyoffPlatform,
} from '../shared/contracts';
import type { FlyoffTranslator } from '../shared/i18n';
import { initializeMainI18n } from './i18n';
import {
  registerBootstrapHandler,
  createSystemTrashItem,
  registerExternalLinkHandler,
  registerMenuCommandHandler,
  registerProjectHandlers,
  registerTabSessionHandlers,
  registerUiStateHandlers,
  registerWindowControlHandlers,
  type SelectProjectDirectory,
} from './ipc';
import { CloseCoordinator } from './lifecycle';
import { createApplicationMenuTemplate } from './menu';
import { NativeCoreClient } from './native/NativeCoreClient';
import { ProjectCatalogStore, ProjectService } from './projects';
import {
  configureSessionSecurity,
  createRendererLocation,
  FLYOFF_RENDERER_URL,
  hardenCommandLine,
  hasRemoteDebuggingSwitch,
  registerFlyoffProtocol,
  registerFlyoffScheme,
} from './security';
import { ElectronSpellcheckService } from './services/spellcheck';
import { TabSessionStore } from './session';
import {
  createMainWindow,
  registerNavigationShortcuts,
  UiStateStore,
  WindowStateStore,
} from './window';

hardenCommandLine(app.commandLine, app.isPackaged);
registerFlyoffScheme();
app.enableSandbox();

const smokeTest = process.argv.includes('--smoke-test');
const usePackagedRenderer = app.isPackaged || process.env.FLYOFF_E2E === '1';
const e2eUserDataPath =
  process.env.FLYOFF_E2E === '1'
    ? process.env.FLYOFF_E2E_USER_DATA
    : undefined;

if (e2eUserDataPath) {
  if (!path.isAbsolute(e2eUserDataPath)) {
    throw new Error('FLYOFF_E2E_USER_DATA must be an absolute path.');
  }

  app.setPath('userData', e2eUserDataPath);
}

function createE2eProjectDirectorySelector():
  | SelectProjectDirectory
  | undefined {
  if (process.env.FLYOFF_E2E !== '1') {
    return undefined;
  }

  const createParent = process.env.FLYOFF_E2E_PROJECT_CREATE_PARENT;
  const openProject = process.env.FLYOFF_E2E_PROJECT_OPEN_ROOT;

  if (!createParent && !openProject) {
    return undefined;
  }

  return async (purpose) =>
    (purpose === 'create-parent' ? createParent : openProject) ?? null;
}

let bootstrapState: BootstrapState | undefined;
let closeCoordinator: CloseCoordinator | undefined;
let coreClient: NativeCoreClient | undefined;
let mainWindow: BrowserWindow | undefined;
let removeBootstrapHandler: (() => void) | undefined;
let removeExternalLinkHandler: (() => void) | undefined;
let removeMenuCommandHandler: (() => void) | undefined;
let removeProjectHandlers: (() => void) | undefined;
let removeTabSessionHandlers: (() => void) | undefined;
let removeUiStateHandlers: (() => void) | undefined;
let removeWindowControlHandlers: (() => void) | undefined;
let translator: FlyoffTranslator | undefined;
let projectService: ProjectService | undefined;
let tabSessionStore: TabSessionStore | undefined;
let uiStateStore: UiStateStore | undefined;
let windowStateStore: WindowStateStore | undefined;
let cleanupStarted = false;
let shutdownExpected = false;

function markShutdownExpected(): void {
  shutdownExpected = true;
}

function cleanupApplication(): void {
  if (cleanupStarted) {
    return;
  }

  cleanupStarted = true;
  markShutdownExpected();

  if (!smokeTest) {
    try {
      tabSessionStore?.flush();
    } catch {
      // The application must still terminate if session persistence fails.
    }
  }

  closeCoordinator?.dispose();
  closeCoordinator = undefined;
  removeBootstrapHandler?.();
  removeBootstrapHandler = undefined;
  removeExternalLinkHandler?.();
  removeExternalLinkHandler = undefined;
  removeMenuCommandHandler?.();
  removeMenuCommandHandler = undefined;
  removeProjectHandlers?.();
  removeProjectHandlers = undefined;
  removeTabSessionHandlers?.();
  removeTabSessionHandlers = undefined;
  removeUiStateHandlers?.();
  removeUiStateHandlers = undefined;
  removeWindowControlHandlers?.();
  removeWindowControlHandlers = undefined;
  coreClient?.stop();
}

function reportFatalError(
  titleKey: 'errors.nativeCoreStartupTitle' | 'errors.nativeCoreStoppedTitle',
  messageKey:
    | 'errors.nativeCoreStartupMessage'
    | 'errors.nativeCoreStoppedMessage',
  error?: unknown,
): void {
  const title = translator?.(titleKey) ?? 'Flyoff could not start';
  const message = translator?.(messageKey) ?? 'The application core failed.';
  const detail = error instanceof Error ? `\n\n${error.message}` : '';

  if (smokeTest) {
    process.stdout.write(
      `FLYOFF_SMOKE ${JSON.stringify({ ok: false, error: `${message}${detail}` })}\n`,
    );
  } else {
    dialog.showErrorBox(title, `${message}${detail}`);
  }
}

function handleUnexpectedNativeExit(code: number): void {
  if (shutdownExpected) {
    return;
  }

  reportFatalError(
    'errors.nativeCoreStoppedTitle',
    'errors.nativeCoreStoppedMessage',
    new Error(`Exit code: ${code}`),
  );
  cleanupApplication();
  app.exit(1);
}

function getRendererLocation() {
  const rendererUrl = usePackagedRenderer
    ? FLYOFF_RENDERER_URL
    : MAIN_WINDOW_WEBPACK_ENTRY;

  return createRendererLocation(rendererUrl, usePackagedRenderer);
}

async function openMainWindow(
  platform: FlyoffPlatform,
): Promise<BrowserWindow> {
  const rendererLocation = getRendererLocation();
  tabSessionStore?.beginWindowSession();
  const window = await createMainWindow({
    ...rendererLocation,
    onWindowCreated: (createdWindow) => {
      closeCoordinator?.attachWindow(createdWindow);
      const removeNavigationShortcuts = registerNavigationShortcuts(
        createdWindow,
        platform,
      );
      createdWindow.once('closed', removeNavigationShortcuts);
      const senderKey = createdWindow.webContents.id;
      createdWindow.webContents.once('destroyed', () => {
        projectService?.disposeSender(senderKey);
      });
    },
    windowStateStore,
  });

  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  mainWindow = window;
  return window;
}

async function startApplication(): Promise<void> {
  const platform = process.platform;

  if (!isFlyoffPlatform(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  nativeTheme.themeSource = 'dark';
  windowStateStore = smokeTest
    ? undefined
    : new WindowStateStore(app.getPath('userData'));
  tabSessionStore = new TabSessionStore(app.getPath('userData'));
  uiStateStore = new UiStateStore(app.getPath('userData'));
  projectService = new ProjectService({
    catalogStore: new ProjectCatalogStore(app.getPath('userData')),
    trashItem: createSystemTrashItem(),
  });

  const i18n = await initializeMainI18n();
  translator = i18n.t;

  app.setAboutPanelOptions({
    applicationName: 'Flyoff',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });

  if (usePackagedRenderer) {
    registerFlyoffProtocol(MAIN_WINDOW_WEBPACK_ENTRY);
  }

  configureSessionSecurity(session.defaultSession, usePackagedRenderer);

  coreClient = new NativeCoreClient({
    entryPath: path.join(__dirname, 'utility.js'),
    onUnexpectedExit: handleUnexpectedNativeExit,
  });

  const nativeCore = await coreClient.start();
  const spellcheck = new ElectronSpellcheckService(
    session.defaultSession,
    platform,
  );

  const state: BootstrapState = Object.freeze({
    platform,
    uiLocale: i18n.locale,
    nativeCore,
    spellcheck: spellcheck.getCapabilities(),
  });
  bootstrapState = state;

  const { isAllowedUrl } = getRendererLocation();
  closeCoordinator = new CloseCoordinator({
    isAllowedUrl,
    onShutdownApproved: markShutdownExpected,
    smokeTest,
    tabSessionStore,
  });
  removeBootstrapHandler = registerBootstrapHandler(
    state,
    isAllowedUrl,
  );
  removeExternalLinkHandler = registerExternalLinkHandler(isAllowedUrl);

  const applicationMenu = Menu.buildFromTemplate(
    createApplicationMenuTemplate({
      platform,
      t: i18n.t,
      onRendererCommand: (command, targetWindow) => {
        const window =
          (targetWindow instanceof BrowserWindow
            ? targetWindow
            : undefined) ??
          BrowserWindow.getFocusedWindow() ??
          mainWindow;

        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
          return;
        }

        window.webContents.send(RENDERER_MENU_COMMAND_CHANNEL, command);
      },
    }),
  );
  Menu.setApplicationMenu(applicationMenu);
  removeMenuCommandHandler = registerMenuCommandHandler(isAllowedUrl);
  const projectDirectorySelector = createE2eProjectDirectorySelector();
  removeProjectHandlers = registerProjectHandlers({
    dialogLabels: {
      createParent: i18n.t('projects.chooseLocation'),
      openProject: i18n.t('home.openProject'),
    },
    isAllowedUrl,
    projectService,
    ...(projectDirectorySelector
      ? { selectDirectory: projectDirectorySelector }
      : {}),
  });
  removeTabSessionHandlers = registerTabSessionHandlers(
    tabSessionStore,
    isAllowedUrl,
  );
  removeUiStateHandlers = registerUiStateHandlers(uiStateStore, isAllowedUrl);
  removeWindowControlHandlers = registerWindowControlHandlers(isAllowedUrl);

  await openMainWindow(platform);

  if (smokeTest) {
    process.stdout.write(
      `FLYOFF_SMOKE ${JSON.stringify({
        ok: true,
        state: bootstrapState,
        commandLineHardened: !hasRemoteDebuggingSwitch(app.commandLine),
      })}\n`,
    );
    markShutdownExpected();
    app.quit();
  }
}

app.on('will-quit', cleanupApplication);

app.on('activate', () => {
  if (
    bootstrapState &&
    BrowserWindow.getAllWindows().length === 0 &&
    !shutdownExpected &&
    !cleanupStarted
  ) {
    void openMainWindow(bootstrapState.platform).catch((error: unknown) => {
      reportFatalError(
        'errors.nativeCoreStartupTitle',
        'errors.nativeCoreStartupMessage',
        error,
      );
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    markShutdownExpected();
    app.quit();
  }
});

void app
  .whenReady()
  .then(startApplication)
  .catch((error: unknown) => {
    reportFatalError(
      'errors.nativeCoreStartupTitle',
      'errors.nativeCoreStartupMessage',
      error,
    );
    cleanupApplication();
    app.exit(1);
  });
