import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';

const repositoryRoot = path.resolve(__dirname, '../..');

async function launchWithUserData(
  appPath: string,
  userDataPath: string,
): Promise<ElectronApplication> {
  return electron.launch({
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
}

async function readWindowState(statePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

test('restores normal bounds, maximized state and minimized state', async () => {
  test.skip(
    process.platform !== 'win32' && Boolean(process.env.CI),
    'Hosted runners do not provide reliable native window-mode transitions.',
  );

  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-window-state-e2e-'),
  );
  const statePath = path.join(userDataPath, 'window-state.json');
  let electronApp: ElectronApplication | undefined;

  try {
    electronApp = await launchWithUserData(appPath, userDataPath);
    const firstPage = await electronApp.firstWindow();

    const expectedBounds = await electronApp.evaluate(
      ({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];

        if (!window) {
          throw new Error('Flyoff window was not created.');
        }

        const workArea = screen.getPrimaryDisplay().workArea;
        const bounds = {
          x: workArea.x + 40,
          y: workArea.y + 40,
          width: Math.min(1_000, workArea.width),
          height: Math.min(680, workArea.height),
        };

        window.setBounds(bounds);
        return bounds;
      },
    );

    await expect
      .poll(() =>
        electronApp?.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getNormalBounds(),
        ),
      )
      .toEqual(expectedBounds);
    await expect
      .poll(() => readWindowState(statePath))
      .toMatchObject({
        bounds: expectedBounds,
        maximized: false,
        minimized: false,
      });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.maximize();
    });
    await expect
      .poll(() =>
        electronApp?.evaluate(({ BrowserWindow }) =>
          Boolean(BrowserWindow.getAllWindows()[0]?.isMaximized()),
        ),
      )
      .toBe(true);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    await expect
      .poll(() =>
        electronApp?.evaluate(({ BrowserWindow }) =>
          Boolean(BrowserWindow.getAllWindows()[0]?.isMinimized()),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => readWindowState(statePath))
      .toMatchObject({
        bounds: expectedBounds,
        maximized: true,
        minimized: true,
      });

    const firstWindowClosed = firstPage.waitForEvent('close');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await firstWindowClosed;
    await electronApp.close().catch(() => undefined);
    await expect
      .poll(() => readWindowState(statePath))
      .toMatchObject({
        bounds: expectedBounds,
        maximized: true,
        minimized: true,
    });
    electronApp = await launchWithUserData(appPath, userDataPath);
    await expect
      .poll(() =>
        electronApp?.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];

          return window
            ? {
                bounds: window.getNormalBounds(),
                maximized: window.isMaximized(),
                minimized: window.isMinimized(),
              }
            : undefined;
        }),
      )
      .toEqual({
        bounds: expectedBounds,
        maximized: false,
        minimized: true,
      });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
    });
    await expect
      .poll(() =>
        electronApp?.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];

          return window
            ? {
                maximized: window.isMaximized(),
                minimized: window.isMinimized(),
              }
            : undefined;
        }),
      )
      .toEqual({ maximized: true, minimized: false });
  } finally {
    await electronApp?.close().catch(() => undefined);
    await rm(userDataPath, { recursive: true, force: true });
  }
});
