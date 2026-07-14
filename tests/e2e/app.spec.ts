import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');

let electronApp: ElectronApplication;
let electronProcess: ReturnType<ElectronApplication['process']>;
let page: Page;
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
    expect(nativeOverlayVisible).toBe(false);
  });

  test('applies the dark theme and exposes a validated bootstrap state', async () => {
    const rendererState = await page.evaluate(async () => ({
      background: getComputedStyle(document.body).backgroundColor,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      htmlLanguage: document.documentElement.lang,
      platformAttribute: document.documentElement.dataset.platform,
      bootstrap: await window.flyoff.getBootstrapState(),
    }));

    expect(rendererState.colorScheme).toBe('dark');
    expect(rendererState.background).toBe('rgb(19, 16, 20)');
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

  test('keeps Node and Electron out of the renderer world', async () => {
    const exposure = await page.evaluate(() => {
      const pageGlobal = globalThis as typeof globalThis & {
        process?: unknown;
        require?: unknown;
      };

      return {
        apiKeys: Object.keys(window.flyoff),
        getBootstrapStateType: typeof window.flyoff.getBootstrapState,
        getWindowStateType: typeof window.flyoff.getWindowState,
        controlWindowType: typeof window.flyoff.controlWindow,
        onWindowStateChangedType: typeof window.flyoff.onWindowStateChanged,
        executeMenuCommandType: typeof window.flyoff.executeMenuCommand,
        getRestorableTabSessionType:
          typeof window.flyoff.getRestorableTabSession,
        resolveRestorableTabSessionType:
          typeof window.flyoff.resolveRestorableTabSession,
        saveTabSessionType: typeof window.flyoff.saveTabSession,
        onCloseRequestedType: typeof window.flyoff.onCloseRequested,
        respondToCloseRequestType:
          typeof window.flyoff.respondToCloseRequest,
        onRendererMenuCommandType:
          typeof window.flyoff.onRendererMenuCommand,
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
        'getRestorableTabSession',
        'resolveRestorableTabSession',
        'saveTabSession',
        'onCloseRequested',
        'respondToCloseRequest',
        'onRendererMenuCommand',
      ],
      getBootstrapStateType: 'function',
      getWindowStateType: 'function',
      controlWindowType: 'function',
      onWindowStateChangedType: 'function',
      executeMenuCommandType: 'function',
      getRestorableTabSessionType: 'function',
      resolveRestorableTabSessionType: 'function',
      saveTabSessionType: 'function',
      onCloseRequestedType: 'function',
      respondToCloseRequestType: 'function',
      onRendererMenuCommandType: 'function',
      processType: 'undefined',
      requireType: 'undefined',
    });
  });

  test('uses Flyoff controls to maximize, restore and minimize', async () => {
    await expect(page.getByTestId('window-minimize')).toBeVisible();
    await expect(page.getByTestId('window-toggle-maximize')).toBeVisible();
    await expect(page.getByTestId('window-close')).toBeVisible();

    const isMaximized = () =>
      electronApp.evaluate(({ BrowserWindow }) =>
        Boolean(BrowserWindow.getAllWindows()[0]?.isMaximized()),
      );

    await page.getByTestId('window-toggle-maximize').click();
    await expect.poll(isMaximized).toBe(true);

    const restoreLabel = await page.evaluate(() =>
      document.documentElement.lang === 'en-US' ? 'Restore' : 'Restaurar',
    );
    await expect(page.getByTestId('window-toggle-maximize')).toHaveAttribute(
      'aria-label',
      restoreLabel,
    );

    await page.getByTestId('window-toggle-maximize').click();
    await expect.poll(isMaximized).toBe(false);

    await page.getByTestId('window-minimize').click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          Boolean(BrowserWindow.getAllWindows()[0]?.isMinimized()),
        ),
      )
      .toBe(true);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
    });
    await page.bringToFront();
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
                (child) => child.role ?? child.type,
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
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectall',
    ]);
    expect(menu.items.find(({ id }) => id === 'view-menu')?.roles).toEqual([
      'resetzoom',
      'zoomin',
      'zoomout',
      'separator',
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
            settings: 'Settings',
          }
        : {
            closeHome: 'Fechar aba: Início',
            help: 'Ajuda',
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

    await page.getByRole('button', { name: labels.closeHome }).click();
    await expect(page.getByRole('tab', { name: labels.home })).toHaveCount(0);
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
    await helpWrapper.dragTo(settingsWrapper, {
      targetPosition: { x: 12, y: 20 },
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
    await page.getByTestId('window-close').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('button', { name: labels.cancel }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.app-shell')).toBeVisible();
  });

  test('closes the window with the Flyoff close control', async () => {
    const labels = await page.evaluate(() =>
      document.documentElement.lang === 'en-US'
        ? { close: 'Close window', settings: 'Settings' }
        : { close: 'Fechar janela', settings: 'Configurações' },
    );
    const windowClosed = page.waitForEvent('close');

    await page
      .getByRole('button', { name: labels.settings, exact: true })
      .click();
    await page.getByTestId('window-close').click();
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
