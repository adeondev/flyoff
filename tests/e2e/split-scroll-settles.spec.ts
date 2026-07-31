/**
 * A note must stop moving after something opens beside it.
 *
 * The existing anchor spec checks where the note ended up, which a view that
 * oscillates forever can still satisfy — it passes whenever the sampling
 * happens to land on the right phase of the loop. This one watches the whole
 * two seconds after the split instead: how many times the view scrolled itself
 * and whether the position was still changing at the end.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');
const LINE_COUNT = 11_000;
const WATCH_MS = 2_000;

/**
 * Writes a settling view can legitimately need: the layout reset for the new
 * width, the re-anchor that follows it, and the measurement pass after that,
 * for each of the two panes. An oscillation produces one per frame — about 120
 * over this window — so the two are nowhere near each other.
 */
const MAX_SELF_SCROLLS = 24;

async function stopApplication(app: ElectronApplication | undefined) {
  if (!app) {
    return;
  }
  let child: ReturnType<ElectronApplication['process']> | undefined;
  try {
    child = app.process();
  } catch {
    return;
  }
  if (child.exitCode === null) {
    const exited = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    terminateProcessTree(child);
    await exited;
  }
  await app.close().catch(() => undefined);
}

function longNoteFixture(): string {
  return Array.from({ length: LINE_COUNT }, (_, index) => {
    if (index % 47 === 0) {
      return `## Section ${index}`;
    }
    if (index % 4 === 0) {
      return `- Item ${index}: **Markdown** with enough text on the line that a narrower pane forces it to wrap onto a second row.`;
    }
    return `Line ${index}: political, religious and everyday record with enough text to react to the pane width.`;
  }).join('\n');
}

/** Counts scroll writes and samples every scroller once per frame. */
const installWatcher = () => {
  const store = {
    samples: new Map<string, number[]>(),
    writes: 0,
  };
  (window as unknown as { __settleWatch: typeof store }).__settleWatch = store;

  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollTop',
  )!;
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get(this: Element) {
      return descriptor.get!.call(this);
    },
    set(this: Element, value: number) {
      if (
        this instanceof HTMLElement &&
        this.closest('.workspace-pane') !== null
      ) {
        store.writes += 1;
      }
      descriptor.set!.call(this, value);
    },
  });

  const sample = () => {
    const panes = document.querySelectorAll<HTMLElement>('.workspace-pane');
    panes.forEach((pane, paneIndex) => {
      pane
        .querySelectorAll<HTMLElement>(
          '.markdown-source__editor, .markdown-view',
        )
        .forEach((scroller, scrollerIndex) => {
          // Both tabs of a pane stay mounted, so the index is part of the key:
          // without it a visible and a hidden editor share one series and their
          // alternation reads as oscillation.
          const key = `${paneIndex}:${scrollerIndex}:${scroller.className}`;
          const track = store.samples.get(key) ?? [];
          track.push(Math.round(descriptor.get!.call(scroller) as number));
          store.samples.set(key, track);
        });
    });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

const collectWatcher = () => {
  const store = (
    window as unknown as {
      __settleWatch: { samples: Map<string, number[]>; writes: number };
    }
  ).__settleWatch;
  return {
    tracks: [...store.samples].map(([key, values]) => {
      let reversals = 0;
      let direction = 0;
      for (let index = 1; index < values.length; index += 1) {
        const delta = (values[index] ?? 0) - (values[index - 1] ?? 0);
        if (Math.abs(delta) < 2) {
          continue;
        }
        const next = delta > 0 ? 1 : -1;
        if (direction !== 0 && next !== direction) {
          reversals += 1;
        }
        direction = next;
      }
      // "Settled" is about the end of the window, not the whole of it: the
      // re-anchor after a split is a legitimate move early on.
      const tail = values.slice(-30);
      return {
        key,
        reversals,
        settled: new Set(tail).size <= 1,
        tail,
      };
    }),
    writes: store.writes,
  };
};

test('the note stops moving after a pane opens beside it', async () => {
  test.setTimeout(240_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-settle-e2e-'),
  );
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-settle-project-'),
  );
  const projectName = 'Settle';
  const source = longNoteFixture();
  let app: ElectronApplication | undefined;

  try {
    await writeFile(
      path.join(userDataPath, 'preferences.json'),
      JSON.stringify({ general: { focusEditorOnOpen: true } }),
      'utf8',
    );
    app = await electron.launch({
      args: [
        appPath,
        `--user-data-dir=${userDataPath}`,
        ...(process.platform === 'linux' && process.env.CI
          ? ['--no-sandbox']
          : []),
        ...(process.env.FLYOFF_E2E_HEADLESS
          ? ['--ozone-platform=headless', '--disable-gpu']
          : []),
      ],
      env: {
        ...process.env,
        FLYOFF_E2E: '1',
        FLYOFF_E2E_PROJECT_CREATE_PARENT: projectParent,
        FLYOFF_E2E_PROJECT_OPEN_ROOT: path.join(projectParent, projectName),
        FLYOFF_E2E_USER_DATA: userDataPath,
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_600, 1_000);
    });
    await page.waitForFunction(() =>
      ['pt-BR', 'en-US'].includes(document.documentElement.lang),
    );
    const english =
      (await page.evaluate(() => document.documentElement.lang)) === 'en-US';
    const labels = english
      ? {
          add: 'Add instance',
          choose: 'Choose location',
          create: 'Create',
          name: 'Name',
          newProject: 'New den',
          note: 'Note',
          paneMenu: 'Pane actions',
          projectName: 'Den name',
        }
      : {
          add: 'Adicionar instância',
          choose: 'Escolher local',
          create: 'Criar',
          name: 'Nome',
          newProject: 'Nova toca',
          note: 'Nota',
          paneMenu: 'Ações do painel',
          projectName: 'Nome da toca',
        };

    await page.getByRole('button', { name: labels.newProject }).click();
    const projectDialog = page.getByRole('dialog');
    await projectDialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await projectDialog.getByRole('button', { name: labels.choose }).click();
    await projectDialog.getByRole('button', { name: labels.create }).click();
    await page.getByRole('button', { name: labels.add }).click();
    await page
      .getByRole('dialog', { name: labels.add })
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    const nameInput = page.getByRole('textbox', { name: labels.name });
    await nameInput.fill('Eleven thousand lines');
    await nameInput.press('Enter');

    const editor = page.locator('.markdown-source__editor:visible');
    await expect(editor).toBeVisible();
    await app.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      source,
    );
    await editor.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+V' : 'Control+V',
    );
    await expect(editor).toHaveAttribute('data-windowed', 'true', {
      timeout: 60_000,
    });
    await expect
      .poll(() => editor.getAttribute('data-source-line-count'), {
        timeout: 60_000,
      })
      .toBe(String(LINE_COUNT));

    // Read into the middle and leave the caret behind, as a reader would.
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.4);
    });
    await page.waitForTimeout(900);
    await editor.evaluate((root) => {
      root.scrollTop += 600;
    });
    await page.waitForTimeout(900);

    await page.evaluate(installWatcher);
    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { name: labels.paneMenu })
      .click();
    await page.locator('.flyoff-menu__item[id$="-item-split-right"]').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await page.waitForTimeout(WATCH_MS);

    const report = await page.evaluate(collectWatcher);
    console.log(`[settle] ${JSON.stringify(report)}`);

    expect(
      report.writes,
      `the split produced ${report.writes} scroll writes in ${WATCH_MS} ms`,
    ).toBeLessThanOrEqual(MAX_SELF_SCROLLS);

    for (const track of report.tracks) {
      expect(
        track.reversals,
        `${track.key} changed direction ${track.reversals} times: ${JSON.stringify(track.tail)}`,
      ).toBeLessThanOrEqual(2);
      expect(
        track.settled,
        `${track.key} was still moving at the end: ${JSON.stringify(track.tail)}`,
      ).toBe(true);
    }
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
