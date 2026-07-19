import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');
const e2eProjectName = 'Projeto E2E 🛠️';

let electronApp: ElectronApplication;
let electronProcess: ReturnType<ElectronApplication['process']>;
let page: Page;
let projectParentPath: string;
let projectParentCanonicalPath: string;
let userDataPath: string;

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs = 2_000,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}

async function dispatchWorkspaceDrag(
  source: Locator,
  target: Locator,
  targetPosition?: { x: number; y: number },
): Promise<void> {
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error('Workspace drag target is not visible.');
  }
  const clientX = bounds.x + (targetPosition?.x ?? bounds.width / 2);
  const clientY = bounds.y + (targetPosition?.y ?? bounds.height / 2);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  try {
    await source.dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('dragenter', {
      clientX,
      clientY,
      dataTransfer,
    });
    await target.dispatchEvent('dragover', {
      clientX,
      clientY,
      dataTransfer,
    });
    await target.dispatchEvent('drop', {
      clientX,
      clientY,
      dataTransfer,
    });
    await source.dispatchEvent('dragend', { dataTransfer });
  } finally {
    await dataTransfer.dispose();
  }
}

async function stopElectronApplication(
  application: ElectronApplication | undefined,
  child: ReturnType<ElectronApplication['process']> | undefined,
): Promise<void> {
  if (!application || !child) {
    return;
  }

  if (child.exitCode === null) {
    const exited = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    terminateProcessTree(child);
    await exited;
  }

  await settleWithin(application.close());
}

test.describe('Flyoff desktop shell', () => {
  test.beforeAll(async () => {
    const appPath = locatePackagedAsar(repositoryRoot);
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-e2e-'));
    projectParentPath = await mkdtemp(
      path.join(os.tmpdir(), 'flyoff-e2e-projects-'),
    );
    projectParentCanonicalPath = await realpath(projectParentPath);

    electronApp = await electron.launch({
      args: [
        appPath,
        ...(process.platform === 'linux' && process.env.CI
          ? ['--no-sandbox']
          : []),
      ],
      env: {
        ...process.env,
        FLYOFF_E2E: '1',
        FLYOFF_E2E_PROJECT_CREATE_PARENT: projectParentCanonicalPath,
        FLYOFF_E2E_PROJECT_OPEN_ROOT: path.join(
          projectParentCanonicalPath,
          e2eProjectName,
        ),
        FLYOFF_E2E_USER_DATA: userDataPath,
      },
    });
    electronProcess = electronApp.process();
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.beforeEach(async () => {
    await page.bringToFront();
  });

  test.afterAll(async () => {
    try {
      await stopElectronApplication(electronApp, electronProcess);
    } finally {
      await rm(userDataPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      await rm(projectParentPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  test('opens the expected window and initial identity', async () => {
    await expect(page.locator('.home__actions-wordmark')).toBeVisible();
    await expect(page.locator('.home__actions-mark')).toBeVisible();
    await expect(page.locator('.titlebar')).toHaveCount(1);
    await expect(page.getByRole('menuitem')).toHaveCount(
      process.platform === 'darwin' ? 0 : 4,
    );

    const geometry = await electronApp.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];

      if (!window) {
        return undefined;
      }

      const bounds = window.getBounds();
      return {
        bounds,
        workArea: screen.getDisplayMatching(bounds).workAreaSize,
      };
    });

    expect(geometry).toBeDefined();
    expect(geometry?.bounds).toMatchObject({
      width: Math.min(1_200, geometry?.workArea.width ?? 1_200),
      height: Math.min(760, geometry?.workArea.height ?? 760),
    });

    const nativeOverlayVisible = await page.evaluate(() => {
      const overlay = (
        navigator as Navigator & {
          windowControlsOverlay?: { visible: boolean };
        }
      ).windowControlsOverlay;

      return overlay?.visible ?? false;
    });
    expect(nativeOverlayVisible).toBe(process.platform !== 'darwin');
  });

  test('applies the dark theme and exposes a validated bootstrap state', async () => {
    const rendererState = await page.evaluate(async () => ({
      background: getComputedStyle(document.body).backgroundColor,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      interfaceFont: getComputedStyle(document.documentElement).fontFamily,
      htmlLanguage: document.documentElement.lang,
      platformAttribute: document.documentElement.dataset.platform,
      bootstrap: await window.flyoff.getBootstrapState(),
    }));

    expect(rendererState.colorScheme).toBe('dark');
    expect(rendererState.background).toBe('rgb(34, 34, 38)');
    expect(rendererState.interfaceFont).toContain('Inter');
    expect(['pt-BR', 'en-US']).toContain(rendererState.htmlLanguage);
    expect(rendererState.platformAttribute).toBe(process.platform);
    expect(rendererState.bootstrap).toMatchObject({
      platform: process.platform,
      uiLocale: rendererState.htmlLanguage,
      nativeCore: {
        coreVersion: '0.1.0',
        protocolVersion: 1,
      },
    });
  });

  test('checks Brazilian Portuguese with the packaged dictionary', async () => {
    test.skip(
      process.platform === 'darwin',
      'macOS delegates spelling to the operating system.',
    );
    const result = await page.evaluate(async () => {
      const snapshot = await window.flyoff.getPreferences();
      await window.flyoff.savePreferences({
        ...snapshot.preferences,
        spellcheck: {
          ...snapshot.preferences.spellcheck,
          enabled: true,
          languages: ['pt-BR'],
        },
      });
      return {
        misspelled: await window.flyoff.checkSpellcheckWords({
          words: ['casa', 'caza'],
        }),
        suggestions: await window.flyoff.getSpellcheckSuggestions({
          word: 'caza',
        }),
      };
    });

    expect(result.misspelled).toEqual(['caza']);
    expect(result.suggestions).toContain('casa');
  });

  test('switches and persists the Flyoff and Basalt themes', async () => {
    const settingsLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? 'Settings'
        : 'Configurações',
    );
    await page.getByRole('button', { name: settingsLabel }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: settingsLabel }),
    ).toBeVisible();
    const appearanceLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? 'Appearance'
        : 'Apar\u00eancia',
    );
    await page
      .getByRole('button', { name: appearanceLabel, exact: true })
      .click();

    await page.getByRole('radio', { name: /^Basalt/ }).click();
    await expect.poll(
      () =>
        page.evaluate(async () => ({
          background: getComputedStyle(document.body).backgroundColor,
          stored: (await window.flyoff.getPreferences()).preferences
            .appearance.theme,
          theme: document.documentElement.dataset.theme,
        })),
    ).toEqual({
      background: 'rgb(19, 16, 20)',
      stored: 'basalt',
      theme: 'basalt',
    });

    await page.getByRole('radio', { name: /^Flyoff/ }).click();
    await expect.poll(
      () =>
        page.evaluate(() =>
          window.flyoff
            .getPreferences()
            .then(({ preferences }) => preferences.appearance.theme),
        ),
    ).toBe('flyoff');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'flyoff');

    const homeLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US' ? 'Home' : 'Início',
    );
    await page.getByRole('button', { name: homeLabel, exact: true }).click();
  });

  test('keeps Node and Electron out of the renderer world', async () => {
    const exposure = await page.evaluate(() => {
      const pageGlobal = globalThis as typeof globalThis & {
        Buffer?: unknown;
        electron?: unknown;
        ipcRenderer?: unknown;
        module?: unknown;
        process?: unknown;
        require?: unknown;
      };

      return {
        apiKeys: Object.keys(window.flyoff).sort(),
        getBootstrapStateType: typeof window.flyoff.getBootstrapState,
        getWindowStateType: typeof window.flyoff.getWindowState,
        controlWindowType: typeof window.flyoff.controlWindow,
        onWindowStateChangedType: typeof window.flyoff.onWindowStateChanged,
        executeMenuCommandType: typeof window.flyoff.executeMenuCommand,
        getPreferencesType: typeof window.flyoff.getPreferences,
        savePreferencesType: typeof window.flyoff.savePreferences,
        resetPreferencesType: typeof window.flyoff.resetPreferences,
        applyWindowThemeType: typeof window.flyoff.applyWindowTheme,
        getSpellcheckSuggestionsType:
          typeof window.flyoff.getSpellcheckSuggestions,
        checkSpellcheckWordsType:
          typeof window.flyoff.checkSpellcheckWords,
        addSpellcheckWordType: typeof window.flyoff.addSpellcheckWord,
        getRestorableTabSessionType:
          typeof window.flyoff.getRestorableTabSession,
        resolveRestorableTabSessionType:
          typeof window.flyoff.resolveRestorableTabSession,
        saveTabSessionType: typeof window.flyoff.saveTabSession,
        onCloseRequestedType: typeof window.flyoff.onCloseRequested,
        respondToCloseRequestType:
          typeof window.flyoff.respondToCloseRequest,
        restartApplicationType:
          typeof window.flyoff.restartApplication,
        openExternalLinkType: typeof window.flyoff.openExternalLink,
        onRendererMenuCommandType:
          typeof window.flyoff.onRendererMenuCommand,
        selectProjectCreateLocationType:
          typeof window.flyoff.selectProjectCreateLocation,
        createProjectType: typeof window.flyoff.createProject,
        openProjectType: typeof window.flyoff.openProject,
        restoreProjectType: typeof window.flyoff.restoreProject,
        closeProjectType: typeof window.flyoff.closeProject,
        listProjectChildrenType: typeof window.flyoff.listProjectChildren,
        getProjectNodeType: typeof window.flyoff.getProjectNode,
        createProjectNodeType: typeof window.flyoff.createProjectNode,
        renameProjectNodeType: typeof window.flyoff.renameProjectNode,
        moveProjectNodeType: typeof window.flyoff.moveProjectNode,
        trashProjectNodeType: typeof window.flyoff.trashProjectNode,
        copyProjectPathType: typeof window.flyoff.copyProjectPath,
        revealProjectPathType: typeof window.flyoff.revealProjectPath,
        getProjectPagePropertiesType:
          typeof window.flyoff.getProjectPageProperties,
        setProjectPageReadOnlyType:
          typeof window.flyoff.setProjectPageReadOnly,
        protectProjectPageType: typeof window.flyoff.protectProjectPage,
        changeProjectPagePasswordType:
          typeof window.flyoff.changeProjectPagePassword,
        removeProjectPagePasswordType:
          typeof window.flyoff.removeProjectPagePassword,
        unlockProjectPageType: typeof window.flyoff.unlockProjectPage,
        lockProjectPageType: typeof window.flyoff.lockProjectPage,
        readMarkdownDocumentType:
          typeof window.flyoff.readMarkdownDocument,
        saveMarkdownDocumentType:
          typeof window.flyoff.saveMarkdownDocument,
        listProjectLinkTargetsType:
          typeof window.flyoff.listProjectLinkTargets,
        getProjectGraphType: typeof window.flyoff.getProjectGraph,
        getProjectNoteActivityType:
          typeof window.flyoff.getProjectNoteActivity,
        recordProjectNoteActivityType:
          typeof window.flyoff.recordProjectNoteActivity,
        resolveProjectInternalLinkType:
          typeof window.flyoff.resolveProjectInternalLink,
        listProjectBacklinksType:
          typeof window.flyoff.listProjectBacklinks,
        searchProjectType: typeof window.flyoff.searchProject,
        bufferType: typeof pageGlobal.Buffer,
        electronType: typeof pageGlobal.electron,
        ipcRendererType: typeof pageGlobal.ipcRenderer,
        moduleType: typeof pageGlobal.module,
        processType: typeof pageGlobal.process,
        requireType: typeof pageGlobal.require,
      };
    });

    expect(exposure).toEqual({
      apiKeys: [
        'getBootstrapState',
        'getWindowState',
        'controlWindow',
        'onWindowStateChanged',
        'executeMenuCommand',
        'getPreferences',
        'savePreferences',
        'resetPreferences',
        'applyWindowTheme',
        'getSpellcheckSuggestions',
        'checkSpellcheckWords',
        'addSpellcheckWord',
        'getRestorableTabSession',
        'getUiState',
        'resolveRestorableTabSession',
        'saveTabSession',
        'saveUiState',
        'onCloseRequested',
        'respondToCloseRequest',
        'restartApplication',
        'openExternalLink',
        'onRendererMenuCommand',
        'selectProjectCreateLocation',
        'createProject',
        'openProject',
        'restoreProject',
        'closeProject',
        'listProjectChildren',
        'getProjectNode',
        'createProjectNode',
        'renameProjectNode',
        'moveProjectNode',
        'trashProjectNode',
        'copyProjectPath',
        'revealProjectPath',
        'getProjectPageProperties',
        'setProjectPageReadOnly',
        'protectProjectPage',
        'changeProjectPagePassword',
        'removeProjectPagePassword',
        'unlockProjectPage',
        'lockProjectPage',
        'readMarkdownDocument',
        'saveMarkdownDocument',
        'listProjectLinkTargets',
        'getProjectGraph',
        'getProjectNoteActivity',
        'recordProjectNoteActivity',
        'resolveProjectInternalLink',
        'listProjectBacklinks',
        'searchProject',
      ].sort(),
      getBootstrapStateType: 'function',
      getWindowStateType: 'function',
      controlWindowType: 'function',
      onWindowStateChangedType: 'function',
      executeMenuCommandType: 'function',
      getPreferencesType: 'function',
      savePreferencesType: 'function',
      resetPreferencesType: 'function',
      applyWindowThemeType: 'function',
      getSpellcheckSuggestionsType: 'function',
      checkSpellcheckWordsType: 'function',
      addSpellcheckWordType: 'function',
      getRestorableTabSessionType: 'function',
      resolveRestorableTabSessionType: 'function',
      saveTabSessionType: 'function',
      onCloseRequestedType: 'function',
      respondToCloseRequestType: 'function',
      restartApplicationType: 'function',
      openExternalLinkType: 'function',
      onRendererMenuCommandType: 'function',
      selectProjectCreateLocationType: 'function',
      createProjectType: 'function',
      openProjectType: 'function',
      restoreProjectType: 'function',
      closeProjectType: 'function',
      listProjectChildrenType: 'function',
      getProjectNodeType: 'function',
      createProjectNodeType: 'function',
      renameProjectNodeType: 'function',
      moveProjectNodeType: 'function',
      trashProjectNodeType: 'function',
      copyProjectPathType: 'function',
      revealProjectPathType: 'function',
      getProjectPagePropertiesType: 'function',
      setProjectPageReadOnlyType: 'function',
      protectProjectPageType: 'function',
      changeProjectPagePasswordType: 'function',
      removeProjectPagePasswordType: 'function',
      unlockProjectPageType: 'function',
      lockProjectPageType: 'function',
      readMarkdownDocumentType: 'function',
      saveMarkdownDocumentType: 'function',
      listProjectLinkTargetsType: 'function',
      getProjectGraphType: 'function',
      getProjectNoteActivityType: 'function',
      recordProjectNoteActivityType: 'function',
      resolveProjectInternalLinkType: 'function',
      listProjectBacklinksType: 'function',
      searchProjectType: 'function',
      bufferType: 'undefined',
      electronType: 'undefined',
      ipcRendererType: 'undefined',
      moduleType: 'undefined',
      processType: 'undefined',
      requireType: 'undefined',
    });
  });

  test('creates a project and saves a Markdown note through the packaged bridge', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? {
            chooseLocation: 'Choose location',
            closePrefix: 'Close tab',
            closeProject: 'Close den',
            create: 'Create',
            editor: 'Markdown editor',
            graph: 'Graph',
            graphCanvas: 'Graph of connections between notes',
            home: 'Home',
            name: 'Name',
            newNote: 'New note',
            newTab: 'New tab',
            newProject: 'New den',
            openProject: 'Open den',
            paneMenu: 'Pane actions',
            projectName: 'Den name',
            projectRail: 'Den',
            projectSections: 'Den sections',
            searchOptions: 'Search options',
            searchProject: 'Search this den',
          }
        : {
            chooseLocation: 'Escolher local',
            closePrefix: 'Fechar aba',
            closeProject: 'Fechar toca',
            create: 'Criar',
            editor: 'Editor Markdown',
            graph: 'Grafo',
            graphCanvas: 'Grafo de conexões entre notas',
            home: 'Início',
            name: 'Nome',
            newNote: 'Nova nota',
            newTab: 'Nova aba',
            newProject: 'Nova toca',
            openProject: 'Abrir toca',
            paneMenu: 'Ações do painel',
            projectName: 'Nome da toca',
            projectRail: 'Toca',
            projectSections: 'Seções da toca',
            searchOptions: 'Opções de busca',
            searchProject: 'Pesquisar nesta toca',
          },
    );
    const projectName = e2eProjectName;
    const noteName = 'Visão geral';
    const noteContent = '# Salvo pelo Flyoff\n\nOlá, mundo 🌎\n';

    await page.getByRole('button', { name: labels.newProject }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await dialog
      .getByRole('button', { name: labels.chooseLocation })
      .click();
    await expect(dialog.getByText(projectParentCanonicalPath)).toBeVisible();
    await dialog.getByRole('button', { name: labels.create }).click();

    await expect(page.getByRole('tab', { name: projectName })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.titlebar')).toHaveCount(0);
    const projectChrome = await page.evaluate(() => {
      const sidebarHeader = document.querySelector(
        '.project-sidebar__header',
      )?.getBoundingClientRect();
      const tabs = document
        .querySelector('.pages-bar')
        ?.getBoundingClientRect();

      return {
        sidebarHeader: sidebarHeader
          ? { height: sidebarHeader.height, top: sidebarHeader.top }
          : undefined,
        tabs: tabs ? { height: tabs.height, top: tabs.top } : undefined,
      };
    });
    expect(projectChrome).toEqual({
      sidebarHeader: { height: 48, top: 0 },
      tabs: { height: 48, top: 0 },
    });
    await page.getByRole('button', { name: labels.newNote }).click();
    const inlineName = page.getByRole('textbox', { name: labels.name });
    await inlineName.fill(noteName);
    await inlineName.press('Enter');

    const editor = page.getByRole('textbox', { name: labels.editor });
    await expect
      .poll(() => editor.evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain('Arial');
    const editorSource = () =>
      editor.evaluate((root) =>
        [...root.querySelectorAll(':scope > .md-line')]
          .map(
            (line) =>
              line.querySelector(':scope > .md-line__content')?.textContent ??
              '',
          )
          .join('\n'),
      );
    await editor.fill(noteContent);
    await expect.poll(editorSource).toBe(noteContent);
    await expect(
      page.locator('.markdown-editor__status--dirty'),
    ).toBeVisible();
    await editor.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await expect(page.locator('.markdown-editor__status')).toHaveCount(0);
    const notePath = path.join(
      projectParentCanonicalPath,
      projectName,
      `${noteName}.md`,
    );
    await expect
      .poll(() => readFile(notePath, 'utf8').catch(() => ''))
      .toBe(noteContent);
    await dispatchWorkspaceDrag(
      page.locator('.workspace-pane--active .page-tab--active'),
      editor,
    );
    await expect.poll(editorSource).toBe(noteContent);
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-workspace-dragging',
    );

    const rail = page.getByRole('navigation', {
      name: labels.projectSections,
    });
    await expect(rail.getByRole('button')).toHaveCount(5);
    const graphResult = await page.evaluate(() => window.flyoff.getProjectGraph());
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(
        graphResult.value.nodes.some(({ name }) => name === noteName),
      ).toBe(true);
    }
    await rail
      .getByRole('button', { exact: true, name: labels.graph })
      .click();
    await expect(
      page.getByRole('img', { name: labels.graphCanvas }),
    ).toBeVisible();
    await rail
      .getByRole('button', { exact: true, name: labels.projectRail })
      .click();
    const search = page.getByRole('searchbox', {
      name: labels.searchProject,
    });
    await search.focus();
    await expect(
      page.getByRole('listbox', { name: labels.searchOptions }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('listbox', { name: labels.searchOptions })
        .getByRole('option'),
    ).toHaveCount(6);
    const tree = page.getByRole('tree', {
      name: /toca|den/i,
    });
    await search.fill('tag:missing');
    await expect(
      page.getByRole('listbox', { name: labels.searchOptions }),
    ).toHaveCount(0);
    await expect(
      tree.getByRole('button', { exact: true, name: noteName }),
    ).toHaveCount(0);
    await search.fill('line:(Salvo Flyoff)');
    await expect(
      tree.getByRole('button', { exact: true, name: noteName }),
    ).toBeVisible();
    await search.fill('');
    await expect(
      page.getByRole('listbox', { name: labels.searchOptions }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    const treeNote = tree.locator('.project-tree__item').filter({
      has: page.getByRole('button', { exact: true, name: noteName }),
    });
    await page
      .getByRole('button', {
        name: `${labels.closePrefix}: ${noteName}`,
      })
      .click();
    await expect(page.getByRole('tab', { name: noteName })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: projectName })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const originalPane = page
      .locator('.workspace-pane')
      .filter({ has: page.getByRole('tab', { name: projectName }) });
    await originalPane
      .getByRole('button', { exact: true, name: labels.newTab })
      .click();
    const originalPaneBounds = await originalPane.boundingBox();
    expect(originalPaneBounds).not.toBeNull();
    await dispatchWorkspaceDrag(
      originalPane.locator('.page-tab--active'),
      originalPane,
      {
        x: originalPaneBounds!.width - 18,
        y: originalPaneBounds!.height / 2,
      },
    );
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .locator('.workspace-pane')
          .evaluateAll((panes) => {
            const paneIds = panes.map(
              (pane) => (pane as HTMLElement).dataset.paneId,
            );
            return new Set(paneIds).size === paneIds.length;
          }),
      )
      .toBe(true);
    const splitDestination = page
      .locator('.workspace-pane')
      .filter({ hasNot: page.getByRole('tab', { name: projectName }) });
    await originalPane
      .getByRole('button', { exact: true, name: labels.newTab })
      .click();
    await expect(
      originalPane.getByRole('tab', { name: labels.newTab }),
    ).toHaveCount(1);
    await expect(
      splitDestination.getByRole('tab', { name: labels.newTab }),
    ).toHaveCount(1);
    await treeNote.getByRole('button', { exact: true, name: noteName }).click();
    await expect(page.getByRole('tab', { name: noteName })).toHaveCount(1);
    await expect(
      originalPane.getByRole('tab', { name: noteName }),
    ).toHaveCount(1);
    await expect(
      originalPane.getByRole('tab', { name: labels.newTab }),
    ).toHaveCount(1);
    await expect(
      splitDestination.getByRole('tab', { name: noteName }),
    ).toHaveCount(0);
    await originalPane
      .getByRole('button', { name: `${labels.closePrefix}: ${noteName}` })
      .click();
    await splitDestination.locator('.page-tab__close').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(1);

    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { name: labels.paneMenu })
      .click();
    await page
      .locator('.flyoff-menu__item[id$="-item-split-right"]')
      .click();
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(
      page.locator('.workspace-split[data-split-entry]'),
    ).toHaveCount(0);
    const destinationPane = page.locator('.workspace-pane--active');
    const destinationPaneBounds = await destinationPane.boundingBox();
    expect(destinationPaneBounds).not.toBeNull();
    const previewDrag = await page.evaluateHandle(() => new DataTransfer());
    await treeNote.dispatchEvent('dragstart', {
      dataTransfer: previewDrag,
    });
    await destinationPane.dispatchEvent('dragover', {
      clientX:
        destinationPaneBounds!.x + destinationPaneBounds!.width / 2,
      clientY:
        destinationPaneBounds!.y + destinationPaneBounds!.height / 2,
      dataTransfer: previewDrag,
    });
    await expect(
      page.locator(
        '.workspace-pane-host__drop-target[data-drop-edge="center"]',
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.workspace-pane__drop-preview')
          .evaluate((preview) => getComputedStyle(preview).backgroundColor),
      )
      .not.toBe('rgba(0, 0, 0, 0)');
    const previewCoverage = await page
      .locator('.workspace-pane__drop-preview')
      .evaluate((preview) => {
        const previewBounds = preview.getBoundingClientRect();
        const targetBounds =
          preview.parentElement?.getBoundingClientRect() ?? previewBounds;
        return {
          height: previewBounds.height / Math.max(1, targetBounds.height),
          width: previewBounds.width / Math.max(1, targetBounds.width),
        };
      });
    expect(previewCoverage.width).toBeGreaterThan(0.8);
    expect(previewCoverage.height).toBeGreaterThan(0.75);
    await treeNote.dispatchEvent('dragend', {
      dataTransfer: previewDrag,
    });
    await expect(page.locator('.workspace-pane-host__drop-target')).toHaveCount(
      0,
    );
    await dispatchWorkspaceDrag(treeNote, destinationPane, {
      x: destinationPaneBounds!.width / 2,
      y: destinationPaneBounds!.height / 2,
    });
    await expect(page.getByRole('tab', { name: noteName })).toHaveCount(1);
    await expect(
      destinationPane.getByRole('tab', { name: noteName }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page
        .locator('.workspace-pane')
        .first()
        .getByRole('tab', { name: labels.newTab }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-workspace-dragging',
    );
    await expect.poll(editorSource).toBe(noteContent);

    await page
      .getByRole('button', {
        name: `${labels.closePrefix}: ${noteName}`,
      })
      .click();
    await expect(page.getByRole('tab', { name: noteName })).toHaveCount(0);
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { name: labels.paneMenu })
      .click();
    await page
      .locator('.flyoff-menu__item[id$="-item-close-all-tabs"]')
      .click();
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
    await expect(
      page.locator('.workspace-pane-host:visible [role="tab"]'),
    ).toHaveCount(0);
    await expect(page.locator('.project-empty')).toBeVisible();
    const recentNoteName = 'Nota recente';
    await page
      .locator('.project-empty')
      .getByRole('button', { name: labels.newNote })
      .click();
    await page.getByRole('textbox', { name: labels.name }).fill(recentNoteName);
    await page.getByRole('textbox', { name: labels.name }).press('Enter');
    await page
      .getByRole('button', {
        name: `${labels.closePrefix}: ${recentNoteName}`,
      })
      .click();
    await expect(page.locator('.project-empty')).toBeVisible();
    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { name: labels.newTab, exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: new RegExp(recentNoteName) }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: labels.closeProject })
      .click();
    await expect(page.getByRole('tab', { name: labels.home })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.titlebar')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(async () =>
          window.flyoff.listProjectChildren({ parentId: null }),
        ),
      )
      .toMatchObject({
        ok: false,
        error: { code: 'invalid-operation' },
      });

    await page.getByRole('button', { name: labels.openProject }).click();
    await expect(page.getByRole('tab', { name: projectName })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page
      .getByRole('button', {
        name: `${labels.closePrefix}: ${projectName}`,
      })
      .click();
    await page
      .getByRole('button', { name: labels.closeProject })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          window.flyoff.listProjectChildren({ parentId: null }),
        ),
      )
      .toMatchObject({
        ok: false,
        error: { code: 'invalid-operation' },
      });
  });

  test('opens a Flyoff-styled titlebar dropdown instead of a native popup', async () => {
    test.skip(
      process.platform === 'darwin',
      'macOS uses the global application menu.',
    );

    const fileLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US' ? 'File' : 'Arquivo',
    );
    const closeLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? 'Close Window'
        : 'Fechar janela',
    );

    await page.getByRole('menuitem', { name: fileLabel }).click();
    const dropdown = page.locator('.flyoff-menu');
    await expect(dropdown).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: new RegExp(closeLabel) }),
    ).toBeVisible();

    const colors = await page.evaluate(() => {
      const dropdownElement = document.querySelector('.flyoff-menu');
      const titlebarElement = document.querySelector('.titlebar');

      return {
        dropdown: dropdownElement
          ? getComputedStyle(dropdownElement).backgroundColor
          : undefined,
        titlebar: titlebarElement
          ? getComputedStyle(titlebarElement).backgroundColor
          : undefined,
      };
    });
    expect(colors.dropdown).toBe(colors.titlebar);

    await page.keyboard.press('Escape');
    await expect(dropdown).toHaveCount(0);
  });

  test('installs the platform menu with native roles', async () => {
    const menu = await electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const applicationMenu = Menu.getApplicationMenu();

      return {
        menuBarVisible: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible(),
        items:
          applicationMenu?.items.map((item) => ({
            id: item.id,
            label: item.label,
            roles:
              item.submenu?.items.map(
                (child) => child.role ?? child.id ?? child.type,
              ) ?? [],
          })) ?? [],
      };
    });

    const expectedIds = ['file-menu', 'edit-menu', 'view-menu', 'help-menu'];
    if (process.platform === 'darwin') {
      expectedIds.unshift('app-menu');
    }

    expect(menu.items.map(({ id }) => id)).toEqual(expectedIds);
    expect(menu.items.find(({ id }) => id === 'edit-menu')?.roles).toEqual([
      'editor.undo',
      'editor.redo',
      'edit-history-separator',
      'cut',
      'copy',
      'paste',
      'edit-selection-separator',
      'selectall',
    ]);
    expect(menu.items.find(({ id }) => id === 'view-menu')?.roles).toEqual([
      'resetzoom',
      'zoomin',
      'zoomout',
      'view-display-separator',
      'togglefullscreen',
    ]);

    if (process.platform !== 'darwin') {
      expect(menu.menuBarVisible).toBe(false);
    }
  });

  test('opens, selects, reorders and closes internal page tabs', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? {
            closeHome: 'Close tab: Home',
            help: 'Help',
            home: 'Home',
            newTab: 'New tab',
            settings: 'Settings',
          }
        : {
            closeHome: 'Fechar aba: Início',
            help: 'Ajuda',
            newTab: 'Nova aba',
            home: 'Início',
            settings: 'Configurações',
          },
    );

    await page.getByRole('button', { name: labels.settings, exact: true }).click();
    await page.getByRole('button', { name: labels.settings, exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('button', { name: labels.help, exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);

    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+1' : 'Control+1',
    );
    await expect(page.getByRole('tab', { name: labels.home })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+9' : 'Control+9',
    );
    await expect(page.getByRole('tab', { name: labels.help })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        const tab = document.querySelector<HTMLElement>(
          '.page-tab--closing',
        );
        if (!tab) {
          return;
        }
        requestAnimationFrame(() => {
          const animation = tab.getAnimations().at(-1);
          animation?.pause();
          if (animation) {
            animation.currentTime = 82;
          }
          const content = tab.querySelector('.page-tab__content');
          const footTransform = getComputedStyle(tab, '::before').transform;
          const footScale =
            footTransform === 'none'
              ? 1
              : new DOMMatrixReadOnly(footTransform).a;
          document.documentElement.dataset.testTabExit = JSON.stringify({
            busy: tab.getAttribute('aria-busy'),
            contentOverflow: content
              ? getComputedStyle(content).overflow
              : '',
            duration: animation?.effect?.getTiming().duration,
            footScale,
            mounted: tab.isConnected,
            reveal: Number(
              getComputedStyle(tab).getPropertyValue('--page-tab-reveal'),
            ),
            zIndex: getComputedStyle(tab).zIndex,
          });
          animation?.play();
        });
        observer.disconnect();
      });
      observer.observe(document.body, {
        attributeFilter: ['class'],
        attributes: true,
        subtree: true,
      });
    });
    await page.getByRole('button', { name: labels.closeHome }).click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-test-tab-exit',
      /"mounted":true/,
    );
    const closingTabComposition = await page.locator('html').evaluate((root) =>
      JSON.parse(root.dataset.testTabExit ?? '{}'),
    );
    expect(closingTabComposition.busy).toBe('true');
    expect(closingTabComposition.duration).toBe(120);
    expect(closingTabComposition.contentOverflow).toBe('hidden');
    expect(closingTabComposition.footScale).toBeLessThan(0.4);
    expect(
      Math.abs(
        closingTabComposition.footScale - closingTabComposition.reveal,
      ),
    ).toBeLessThan(0.01);
    expect(closingTabComposition.zIndex).toBe('0');
    await expect(page.getByRole('tab', { name: labels.home })).toHaveCount(0);
    await expect(
      page.locator('[aria-hidden="true"].page-tab'),
    ).toHaveCount(0);
    await page.locator('.pages-bar').evaluate(
      (_element) =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const helpWrapper = page.locator('.page-tab').filter({ hasText: labels.help });
    const settingsWrapper = page
      .locator('.page-tab')
      .filter({ hasText: labels.settings });
    await dispatchWorkspaceDrag(helpWrapper, settingsWrapper, {
      x: 12,
      y: 20,
    });
    await expect(page.getByRole('tab').first()).toHaveText(labels.help);

    await electronApp.evaluate(({ BrowserWindow }, platform) => {
      const window = BrowserWindow.getAllWindows()[0];
      const modifiers: ('control' | 'meta')[] =
        platform === 'darwin' ? ['meta'] : ['control'];

      window?.focus();
      window?.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'W',
        modifiers,
      });
      window?.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'W',
        modifiers,
      });
    }, process.platform);
    await expect(page.getByRole('tab', { name: labels.help })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: labels.settings })).toHaveCount(1);

    const newTabButton = page.locator('.pages-bar__new-tab');
    await newTabButton.click();
    await newTabButton.click();
    await newTabButton.click();
    await expect(page.getByRole('tab', { name: labels.newTab })).toHaveCount(3);
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      await page
        .locator('.page-tab')
        .filter({
          has: page.getByRole('tab', { name: labels.newTab }),
        })
        .last()
        .locator('.page-tab__close')
        .click();
      await expect(page.getByRole('tab', { name: labels.newTab })).toHaveCount(
        remaining - 1,
      );
    }
  });

  test('splits, resizes, limits and closes workspace panes', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? {
            newTab: 'New tab',
            openInPane: 'Open in this pane',
            paneMenu: 'Pane actions',
          }
        : {
            newTab: 'Nova aba',
            openInPane: 'Abrir neste painel',
            paneMenu: 'Ações do painel',
          },
    );
    const activePaneMenu = () =>
      page
        .locator('.workspace-pane--active')
        .getByRole('button', { name: labels.paneMenu });
    const menuItem = (id: string) =>
      page.locator(`.flyoff-menu__item[id$="-item-${id}"]`);

    await activePaneMenu().click();
    await menuItem('split-right').click();
    await expect(
      page.locator('.workspace-pane[data-pane-entry="row-end"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.workspace-split[data-split-entry="row-end"]'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator('.workspace-split')
          .first()
          .evaluate((split) =>
            split
              .getAnimations()
              .some(
                (animation) =>
                  (animation as CSSAnimation).animationName ===
                    'workspace-split-enter-row-end' &&
                  animation.effect?.getTiming().duration === 120,
              ),
          ),
      )
      .toBe(true);
    const splitMotion = await page
      .locator('.workspace-split[data-split-entry="row-end"]')
      .evaluate((split) => {
        const animation = split
          .getAnimations()
          .find(
            (candidate) =>
              (candidate as CSSAnimation).animationName ===
              'workspace-split-enter-row-end',
          );
        if (!animation) {
          return undefined;
        }
        const widthsAt = (time: number) => {
          animation.currentTime = time;
          return {
            first: split.children[0]?.getBoundingClientRect().width ?? 0,
            second: split.children[2]?.getBoundingClientRect().width ?? 0,
          };
        };
        animation.pause();
        const start = widthsAt(0);
        const middle = widthsAt(60);
        const end = widthsAt(120);
        animation.play();
        return { end, middle, start };
      });
    expect(splitMotion).toBeDefined();
    expect(splitMotion!.start.first).toBeGreaterThan(splitMotion!.middle.first);
    expect(splitMotion!.middle.first).toBeGreaterThan(splitMotion!.end.first);
    expect(splitMotion!.start.second).toBeLessThan(splitMotion!.middle.second);
    expect(splitMotion!.middle.second).toBeLessThan(splitMotion!.end.second);
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(
      page
        .locator('.workspace-pane--active')
        .getByRole('tab', { name: labels.newTab }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('.workspace-pane:not(.workspace-pane--active)')
        .getByRole('tab', { name: labels.newTab }),
    ).toHaveCount(0);
    await expect(page.locator('.workspace-split--row')).toHaveCount(1);
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        const split = document.querySelector<HTMLElement>(
          '.workspace-split[data-split-exit]',
        );
        if (!split) {
          return;
        }
        requestAnimationFrame(() => {
          const animation = split
            .getAnimations()
            .find(
              (candidate) =>
                (candidate as CSSAnimation).animationName ===
                'workspace-split-enter-row-end',
            );
          animation?.pause();
          const widthAt = (time: number) => {
            if (!animation) {
              return 0;
            }
            animation.currentTime = time;
            return split.children[2]?.getBoundingClientRect().width ?? 0;
          };
          const widths = [0, 20, 60, 80].map(widthAt);
          document.documentElement.dataset.testPaneExit = JSON.stringify({
            direction: animation?.effect?.getTiming().direction,
            duration: animation?.effect?.getTiming().duration,
            easing: getComputedStyle(split).animationTimingFunction,
            placement: split.dataset.splitExit,
            widths,
          });
          animation?.play();
        });
        observer.disconnect();
      });
      observer.observe(document.body, {
        attributeFilter: ['data-split-exit'],
        attributes: true,
        subtree: true,
      });
    });
    await page
      .locator('.workspace-pane--active .page-tab__close')
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-test-pane-exit',
      /"placement":"row-end"/,
    );
    const closingSplitMotion = await page.locator('html').evaluate((root) =>
      JSON.parse(root.dataset.testPaneExit ?? '{}'),
    );
    expect(closingSplitMotion).toMatchObject({
      direction: 'reverse',
      duration: 80,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      placement: 'row-end',
    });
    const widths = closingSplitMotion.widths as number[];
    expect(widths).toHaveLength(4);
    const startWidth = widths[0]!;
    const earlyWidth = widths[1]!;
    const lateWidth = widths[2]!;
    const endWidth = widths[3]!;
    expect(Math.abs(startWidth - earlyWidth)).toBeGreaterThan(
      Math.abs(lateWidth - endWidth),
    );
    await expect(page.locator('.workspace-pane-exit-clone')).toHaveCount(0);
    await expect(page.locator('.workspace-pane')).toHaveCount(1);

    const edgePreviewSource = page.locator(
      '.workspace-pane--active .page-tab--active',
    );
    const edgePreviewPane = page.locator('.workspace-pane--active');
    const edgePreviewBounds = await edgePreviewPane.boundingBox();
    expect(edgePreviewBounds).not.toBeNull();
    const edgePreviewDrag = await page.evaluateHandle(
      () => new DataTransfer(),
    );
    await edgePreviewSource.dispatchEvent('dragstart', {
      dataTransfer: edgePreviewDrag,
    });
    await edgePreviewPane.dispatchEvent('dragover', {
      clientX: edgePreviewBounds!.x + edgePreviewBounds!.width - 18,
      clientY: edgePreviewBounds!.y + edgePreviewBounds!.height / 2,
      dataTransfer: edgePreviewDrag,
    });
    await expect(
      page.locator(
        '.workspace-pane-host__drop-target[data-drop-edge="right"]',
      ),
    ).toBeVisible();
    const dropMotion = await page
      .locator('.workspace-pane-host__drop-target')
      .evaluate((target) => {
        const preview = target.querySelector(
          '.workspace-pane__drop-preview',
        );
        return {
          previewProperties: preview
            ? getComputedStyle(preview).transitionProperty
            : '',
          targetProperties: getComputedStyle(target).transitionProperty,
        };
      });
    expect(dropMotion.targetProperties).toContain('top');
    expect(dropMotion.targetProperties).toContain('left');
    expect(dropMotion.targetProperties).toContain('width');
    expect(dropMotion.targetProperties).toContain('height');
    expect(dropMotion.previewProperties).toContain('inset');
    await page.evaluate(() => {
      document.dispatchEvent(new Event('dragend', { bubbles: true }));
    });
    await expect(page.locator('.workspace-pane-host__drop-target')).toHaveCount(
      0,
    );
    await expect(page.locator('.workspace-pane')).toHaveCount(1);

    await activePaneMenu().click();
    await menuItem('split-right').click();
    await expect(
      page.locator('.workspace-split[data-split-entry]'),
    ).toHaveCount(0);
    const duplicateSource = page.locator(
      '.workspace-pane--active .page-tab--active',
    );
    const duplicateTarget = page.locator('.workspace-pane').first();
    const duplicateTargetBounds = await duplicateTarget.boundingBox();
    expect(duplicateTargetBounds).not.toBeNull();
    const duplicateDrag = await page.evaluateHandle(() => new DataTransfer());
    await duplicateSource.dispatchEvent('dragstart', {
      dataTransfer: duplicateDrag,
    });
    await duplicateTarget.dispatchEvent('dragover', {
      clientX:
        duplicateTargetBounds!.x + duplicateTargetBounds!.width / 2,
      clientY:
        duplicateTargetBounds!.y + duplicateTargetBounds!.height / 2,
      dataTransfer: duplicateDrag,
    });
    await expect(page.getByText(labels.openInPane, { exact: true })).toBeVisible();
    await duplicateTarget.dispatchEvent('dragleave', {
      clientX:
        duplicateTargetBounds!.x + duplicateTargetBounds!.width / 2,
      clientY:
        duplicateTargetBounds!.y + duplicateTargetBounds!.height / 2,
      dataTransfer: duplicateDrag,
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(page.getByText(labels.openInPane, { exact: true })).toBeVisible();
    await duplicateTarget.dispatchEvent('drop', {
      clientX:
        duplicateTargetBounds!.x + duplicateTargetBounds!.width / 2,
      clientY:
        duplicateTargetBounds!.y + duplicateTargetBounds!.height / 2,
      dataTransfer: duplicateDrag,
    });
    await expect(page.locator('.workspace-pane')).toHaveCount(1);

    await activePaneMenu().click();
    await menuItem('split-right').click();

    const divider = page
      .locator('.workspace-pane-host:visible .workspace-split__divider')
      .first();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await divider.focus();
    await expect(divider).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(divider).toHaveAttribute('aria-valuenow', '48');
    await divider.dblclick();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');

    await activePaneMenu().click();
    await menuItem('split-below').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(3);
    await expect(page.locator('.workspace-split--column')).toHaveCount(1);

    await activePaneMenu().click();
    await menuItem('split-right').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(4);

    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { exact: true, name: labels.newTab })
      .click();
    const edgeSource = page.locator(
      '.workspace-pane--active .page-tab--active',
    );
    const edgeTarget = page.locator('.workspace-pane').first();
    const edgeTargetBounds = await edgeTarget.boundingBox();
    expect(edgeTargetBounds).not.toBeNull();
    const differentTargetDrag = await page.evaluateHandle(
      () => new DataTransfer(),
    );
    await edgeSource.dispatchEvent('dragstart', {
      dataTransfer: differentTargetDrag,
    });
    await edgeTarget.dispatchEvent('dragover', {
      clientX: edgeTargetBounds!.x + edgeTargetBounds!.width / 2,
      clientY: edgeTargetBounds!.y + edgeTargetBounds!.height / 2,
      dataTransfer: differentTargetDrag,
    });
    await expect(page.getByText(labels.openInPane, { exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.dispatchEvent(new Event('dragend', { bubbles: true }));
    });
    await expect(page.getByText(labels.openInPane, { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-workspace-dragging',
    );
    const unrelatedDrag = await page.evaluateHandle(() => new DataTransfer());
    await edgeTarget.dispatchEvent('dragover', {
      clientX: edgeTargetBounds!.x + edgeTargetBounds!.width / 2,
      clientY: edgeTargetBounds!.y + edgeTargetBounds!.height / 2,
      dataTransfer: unrelatedDrag,
    });
    await expect(page.getByText(labels.openInPane, { exact: true })).toHaveCount(
      0,
    );
    await activePaneMenu().click();
    await menuItem('split-right').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(5);
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-workspace-dragging',
    );

    await activePaneMenu().click();
    await expect(menuItem('split-right')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');

    for (let paneCount = 4; paneCount >= 1; paneCount -= 1) {
      await activePaneMenu().click();
      await menuItem('close-pane').click();
      await expect(page.locator('.workspace-pane')).toHaveCount(paneCount);
    }
  });

  test('cancels a guarded close without closing the window', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? { cancel: 'Cancel', settings: 'Settings' }
        : { cancel: 'Cancelar', settings: 'Configurações' },
    );

    await page
      .getByRole('button', { name: labels.settings, exact: true })
      .click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const dialogPosition = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        horizontal:
          Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2),
        vertical:
          Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
      };
    });
    expect(dialogPosition.horizontal).toBeLessThanOrEqual(2);
    expect(dialogPosition.vertical).toBeLessThanOrEqual(2);
    await expect(
      page.getByRole('button', { name: labels.cancel }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.app-shell')).toBeVisible();
  });

  test('closes the window from the native window control', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? { close: 'Close window', settings: 'Settings' }
        : { close: 'Fechar janela', settings: 'Configurações' },
    );
    const windowClosed = page.waitForEvent('close');

    await page
      .getByRole('button', { name: labels.settings, exact: true })
      .click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    const confirmation = page
      .getByRole('button', { name: labels.close })
      .dispatchEvent('click')
      .catch(() => undefined);
    await windowClosed;
    await confirmation;

    if (process.platform !== 'darwin') {
      await expect
        .poll(() => electronProcess.exitCode, { timeout: 5_000 })
        .not.toBeNull();
    }
  });
});
