import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  safeStorage,
  session,
} from 'electron';

import {
  isFlyoffPlatform,
  DIAGRAM_IPC_CHANNELS,
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
  applySpellcheckPreferences,
  registerPreferencesHandlers,
  registerDiagramHandlers,
  registerProjectNoteActivityHandlers,
  registerProjectHandlers,
  registerTabSessionHandlers,
  registerTwineHandlers,
  registerUiStateHandlers,
  registerWindowControlHandlers,
  type SelectProjectDirectory,
  type SelectDiagramExportFile,
  type SelectDiagramImportFile,
} from './ipc';
import { CloseCoordinator } from './lifecycle';
import { createApplicationMenuTemplate } from './menu';
import { NativeCoreClient } from './native/NativeCoreClient';
import {
  applyHardwareAccelerationPreference,
  PreferencesStore,
} from './preferences';
import {
  ProjectCatalogStore,
  ProjectNoteActivityStore,
  ProjectService,
} from './projects';
import {
  configureSessionSecurity,
  createRendererLocation,
  FLYOFF_RENDERER_URL,
  hardenCommandLine,
  hasRemoteDebuggingSwitch,
  registerFlyoffAssetProtocol,
  registerFlyoffProtocol,
  registerFlyoffScheme,
} from './security';
import {
  BundledSpellcheckService,
  ElectronSpellcheckService,
} from './services/spellcheck';
import { TabSessionStore } from './session';
import {
  TwineConversationStore,
  TwineCredentialStore,
  createTwineE2eModelClientFactory,
  TwineGenerationService,
} from './twine';
import {
  createMainWindow,
  applyWindowTheme,
  registerNavigationShortcuts,
  UiStateStore,
  WindowStateStore,
} from './window';
import { handleSquirrelFileAssociationEvent } from './file-associations';
import { queuePendingDiagramOpen } from './diagrams/pending-diagram-open';

const handledSquirrelEvent = handleSquirrelFileAssociationEvent();
const hasSingleInstanceLock =
  handledSquirrelEvent || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}
for (const argument of process.argv.slice(1)) {
  queuePendingDiagramOpen(argument);
}

app.on('open-file', (event, filePath) => {
  if (queuePendingDiagramOpen(filePath)) {
    event.preventDefault();
    notifyPendingDiagramOpen();
  }
});

app.on('second-instance', (_event, commandLine) => {
  for (const argument of commandLine.slice(1)) {
    queuePendingDiagramOpen(argument);
  }
  notifyPendingDiagramOpen();
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
});

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

const preferencesStore = new PreferencesStore(app.getPath('userData'));
applyHardwareAccelerationPreference(app, preferencesStore.get());

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

function notifyPendingDiagramOpen(): void {
  const window = mainWindow;
  if (
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed()
  ) {
    window.webContents.send(DIAGRAM_IPC_CHANNELS.pendingChanged);
  }
}

function e2eAbsolutePath(variable: string): string | undefined {
  const value = process.env[variable];
  if (!value) {
    return undefined;
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`${variable} must be an absolute path.`);
  }
  return value;
}

function createE2eDiagramImportSelector(): SelectDiagramImportFile | undefined {
  if (process.env.FLYOFF_E2E !== '1') {
    return undefined;
  }
  const filePath = e2eAbsolutePath('FLYOFF_E2E_DIAGRAM_IMPORT');
  return filePath ? async () => filePath : undefined;
}

function createE2eDiagramExportSelector(): SelectDiagramExportFile | undefined {
  if (process.env.FLYOFF_E2E !== '1') {
    return undefined;
  }
  const filePath = e2eAbsolutePath('FLYOFF_E2E_DIAGRAM_EXPORT');
  return filePath ? async () => filePath : undefined;
}
let removeBootstrapHandler: (() => void) | undefined;
let removeExternalLinkHandler: (() => void) | undefined;
let removeMenuCommandHandler: (() => void) | undefined;
let removePreferencesHandlers: (() => void) | undefined;
let removeDiagramHandlers: (() => void) | undefined;
let removeProjectNoteActivityHandlers: (() => void) | undefined;
let removeProjectHandlers: (() => void) | undefined;
let removeTabSessionHandlers: (() => void) | undefined;
let removeTwineHandlers: (() => void) | undefined;
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
  removePreferencesHandlers?.();
  removePreferencesHandlers = undefined;
  removeDiagramHandlers?.();
  removeDiagramHandlers = undefined;
  removeProjectNoteActivityHandlers?.();
  removeProjectNoteActivityHandlers = undefined;
  removeProjectHandlers?.();
  removeProjectHandlers = undefined;
  removeTabSessionHandlers?.();
  removeTabSessionHandlers = undefined;
  removeTwineHandlers?.();
  removeTwineHandlers = undefined;
  removeUiStateHandlers?.();
  removeUiStateHandlers = undefined;
  removeWindowControlHandlers?.();
  removeWindowControlHandlers = undefined;
  projectService?.dispose();
  projectService = undefined;
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
    theme: preferencesStore.get().appearance.theme,
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
    activityStore: new ProjectNoteActivityStore(app.getPath('userData')),
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

  registerFlyoffAssetProtocol(
    usePackagedRenderer
      ? path.join(path.dirname(app.getAppPath()), 'twemoji', 'svg')
      : path.join(
          app.getAppPath(),
          'public',
          'images',
          'twemoji',
          'svg',
        ),
  );
  configureSessionSecurity(session.defaultSession, usePackagedRenderer);

  coreClient = new NativeCoreClient({
    entryPath: path.join(__dirname, 'utility.js'),
    onUnexpectedExit: handleUnexpectedNativeExit,
  });

  const nativeCore = await coreClient.start();
  const spellcheck =
    platform === 'darwin'
      ? new ElectronSpellcheckService(session.defaultSession, platform)
      : new BundledSpellcheckService(app.getPath('userData'));
  const activeSpellcheckLanguages = spellcheck.getActiveLanguages();
  const defaultSpellcheckLanguages =
    activeSpellcheckLanguages.length > 0
      ? activeSpellcheckLanguages
      : [i18n.locale];
  applySpellcheckPreferences(
    spellcheck,
    preferencesStore.get(),
    defaultSpellcheckLanguages,
  );

  const state: BootstrapState = Object.freeze({
    platform,
    uiLocale: i18n.locale,
    nativeCore,
    spellcheck: spellcheck.getCapabilities(),
  });
  bootstrapState = state;

  const { isAllowedUrl } = getRendererLocation();
  const twineCredentialStore = new TwineCredentialStore(
    app.getPath('userData'),
    safeStorage,
  );
  const twineConversationStore = new TwineConversationStore(
    app.getPath('userData'),
  );
  const twineE2eModelClientFactory =
    process.env.FLYOFF_E2E === '1'
      ? createTwineE2eModelClientFactory(
          process.env.FLYOFF_E2E_TWINE_MODEL_SCENARIO,
        )
      : undefined;
  const twineGenerationService = twineE2eModelClientFactory
    ? new TwineGenerationService(twineE2eModelClientFactory)
    : new TwineGenerationService();
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
  removePreferencesHandlers = registerPreferencesHandlers({
    defaultSpellcheckLanguages,
    isAllowedUrl,
    onThemeChanged: (theme, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        applyWindowTheme(window, theme);
      }
    },
    spellcheck,
    store: preferencesStore,
    runtimeHardwareAccelerationEnabled:
      app.isHardwareAccelerationEnabled(),
  });
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
  const diagramImportSelector = createE2eDiagramImportSelector();
  const diagramExportSelector = createE2eDiagramExportSelector();
  removeDiagramHandlers = registerDiagramHandlers({
    projectService,
    isAllowedUrl,
    ...(diagramImportSelector ? { selectImportFile: diagramImportSelector } : {}),
    ...(diagramExportSelector ? { selectExportFile: diagramExportSelector } : {}),
  });
  removeProjectNoteActivityHandlers = registerProjectNoteActivityHandlers(
    projectService,
    isAllowedUrl,
  );
  removeTabSessionHandlers = registerTabSessionHandlers(
    tabSessionStore,
    isAllowedUrl,
  );
  removeTwineHandlers = registerTwineHandlers({
    conversationStore: twineConversationStore,
    credentialStore: twineCredentialStore,
    generationService: twineGenerationService,
    isAllowedUrl,
  });
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

if (!handledSquirrelEvent && hasSingleInstanceLock) {
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
}
