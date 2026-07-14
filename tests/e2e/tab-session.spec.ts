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

interface Labels {
  closeWindow: string;
  help: string;
  home: string;
  ignore: string;
  restore: string;
  settings: string;
}

interface RunningFlyoff {
  app: ElectronApplication;
  page: Page;
}

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

async function launchFlyoff(
  appPath: string,
  userDataPath: string,
): Promise<RunningFlyoff> {
  const app = await electron.launch({
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
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() =>
    ['pt-BR', 'en-US'].includes(document.documentElement.lang),
  );
  return { app, page };
}

async function getLabels(page: Page): Promise<Labels> {
  const locale = await page.evaluate(() => document.documentElement.lang);

  return locale === 'en-US'
    ? {
        closeWindow: 'Close window',
        help: 'Help',
        home: 'Home',
        ignore: 'Ignore',
        restore: 'Restore',
        settings: 'Settings',
      }
    : {
        closeWindow: 'Fechar janela',
        help: 'Ajuda',
        home: 'Início',
        ignore: 'Ignorar',
        restore: 'Restaurar',
        settings: 'Configurações',
      };
}

async function waitForProcessExit(
  app: ElectronApplication,
  timeoutMs: number,
): Promise<boolean> {
  const child = app.process();

  if (child.exitCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function stopFlyoff(
  running: RunningFlyoff | undefined,
): Promise<void> {
  if (!running) {
    return;
  }

  const child = running.app.process();

  if (child.exitCode === null) {
    const exited = waitForProcessExit(running.app, 3_000);
    terminateProcessTree(child);
    await exited;
  }

  await settleWithin(running.app.close());
}

async function createAndCloseSession(
  appPath: string,
  userDataPath: string,
): Promise<void> {
  const running = await launchFlyoff(appPath, userDataPath);

  try {
    const labels = await getLabels(running.page);
    await running.page
      .getByRole('button', { name: labels.settings, exact: true })
      .click();
    await running.page
      .getByRole('button', { name: labels.help, exact: true })
      .click();
    await running.page
      .getByRole('tab', { name: labels.settings, exact: true })
      .click();

    await expect(running.page.getByRole('tab')).toHaveText([
      labels.home,
      labels.settings,
      labels.help,
    ]);
    await expect(
      running.page.getByRole('tab', {
        name: labels.settings,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');

    const windowClosed = running.page.waitForEvent('close');
    await running.page.getByTestId('window-close').click();
    await expect(running.page.getByRole('dialog')).toBeVisible();
    const confirmation = running.page
      .getByRole('button', { name: labels.closeWindow, exact: true })
      .dispatchEvent('click')
      .catch(() => undefined);
    await windowClosed;
    await confirmation;
  } finally {
    await stopFlyoff(running);
  }
}

test.describe('tab session restoration', () => {
  test('restores tab order and the active tab on the next run', async () => {
    test.setTimeout(60_000);
    const appPath = locatePackagedAsar(repositoryRoot);
    const userDataPath = await mkdtemp(
      path.join(os.tmpdir(), 'flyoff-tab-restore-e2e-'),
    );
    let running: RunningFlyoff | undefined;

    try {
      await createAndCloseSession(appPath, userDataPath);
      running = await launchFlyoff(appPath, userDataPath);
      const labels = await getLabels(running.page);

      await expect(running.page.getByRole('status')).toBeVisible();
      await running.page
        .getByRole('button', { name: labels.restore, exact: true })
        .click();

      await expect(running.page.getByRole('status')).toHaveCount(0);
      await expect(running.page.getByRole('tab')).toHaveText([
        labels.home,
        labels.settings,
        labels.help,
      ]);
      await expect(
        running.page.getByRole('tab', {
          name: labels.settings,
          exact: true,
        }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(() =>
          running?.page.evaluate(() =>
            window.flyoff.getRestorableTabSession(),
          ),
        )
        .toBeNull();
    } finally {
      await stopFlyoff(running);
      await rm(userDataPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  test('ignores the saved session and keeps only Home', async () => {
    test.setTimeout(60_000);
    const appPath = locatePackagedAsar(repositoryRoot);
    const userDataPath = await mkdtemp(
      path.join(os.tmpdir(), 'flyoff-tab-ignore-e2e-'),
    );
    let running: RunningFlyoff | undefined;

    try {
      await createAndCloseSession(appPath, userDataPath);
      running = await launchFlyoff(appPath, userDataPath);
      const labels = await getLabels(running.page);

      await expect(running.page.getByRole('status')).toBeVisible();
      await running.page
        .getByRole('button', { name: labels.ignore, exact: true })
        .click();

      await expect(running.page.getByRole('status')).toHaveCount(0);
      await expect(running.page.getByRole('tab')).toHaveCount(1);
      await expect(
        running.page.getByRole('tab', { name: labels.home, exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(() =>
          running?.page.evaluate(() =>
            window.flyoff.getRestorableTabSession(),
          ),
        )
        .toBeNull();
    } finally {
      await stopFlyoff(running);
      await rm(userDataPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
});
