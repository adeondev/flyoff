import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const LINE_COUNT = 11_000;

interface AnchorReading {
  clientHeight: number;
  line: number;
  mountedLines: number;
  offsetWithinPx: number;
  scrollHeight: number;
  scrollTop: number;
  width: number;
}

async function stopApplication(app: ElectronApplication | undefined) {
  if (!app) {
    return;
  }
  const child = app.process();
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

/**
 * Which document line is drawn at the top edge of the editor, read from real
 * geometry rather than from the engine's height map. The map is what the bug
 * corrupts, so trusting it here would hide the failure.
 */
const readAnchorInPage = () => {
  const root = document.querySelector<HTMLElement>(
    '.markdown-source__editor',
  );
  if (!root) {
    return null;
  }
  const rootRect = root.getBoundingClientRect();
  let best: { line: number; top: number } | undefined;
  const lines = root.querySelectorAll<HTMLElement>('.md-line');
  for (const element of lines) {
    const line = Number.parseInt(element.dataset.line ?? '', 10);
    if (!Number.isFinite(line)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= rootRect.top + 0.5) {
      continue;
    }
    if (!best || rect.top < best.top) {
      best = { line, top: rect.top };
    }
  }
  return {
    clientHeight: root.clientHeight,
    line: best ? best.line : -1,
    mountedLines: lines.length,
    offsetWithinPx: best ? rootRect.top - best.top : 0,
    scrollHeight: root.scrollHeight,
    scrollTop: root.scrollTop,
    width: root.clientWidth,
  };
};

async function readAnchor(page: Page): Promise<AnchorReading> {
  const reading = await page.evaluate(readAnchorInPage);
  expect(reading, 'the source editor should be mounted').not.toBeNull();
  return reading as AnchorReading;
}

async function settle(page: Page, ms = 900): Promise<void> {
  await page.waitForTimeout(ms);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test('keeps the reading position when a note is split into an adjacent pane', async () => {
  test.setTimeout(240_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-scroll-anchor-e2e-'),
  );
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-scroll-anchor-project-'),
  );
  const projectName = 'Scroll Anchor';
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
        // Every other spec gates this on Linux CI, and for a reason: the main
        // process calls `app.enableSandbox()`, and passing `--no-sandbox`
        // alongside it takes the browser process down with an access violation
        // on Windows before the first window is created.
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

    // Put the caret where a reader would leave it, then read on past it. The
    // caret being far above the viewport is what used to drag the note back.
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.4);
    });
    await settle(page, 600);
    // The window only holds a screen of lines, and it is rebuilt a frame after
    // the scroll. Reading before it settles picks up whichever lines happened
    // to be mounted, which made the setup — not the behaviour — decide the run.
    await expect
      .poll(async () => (await readAnchor(page)).line, { timeout: 15_000 })
      .toBeGreaterThan(100);
    const caretTarget = await editor.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const line = [...root.querySelectorAll<HTMLElement>('.md-line')].find(
        (element) => element.getBoundingClientRect().top > rootRect.top + 120,
      );
      const box = line!.getBoundingClientRect();
      return { x: box.left + 24, y: box.top + 4 };
    });
    await page.mouse.click(caretTarget.x, caretTarget.y);
    await settle(page, 400);
    await editor.evaluate((root) => {
      root.scrollTop += 600;
    });
    await settle(page);
    await expect
      .poll(async () => (await readAnchor(page)).line, { timeout: 15_000 })
      .toBeGreaterThan(100);
    const anchored = await readAnchor(page);

    // Focus leaving and returning to the editor is what a tab or pane
    // operation does; on its own it must not move the reading position.
    await page.locator('.workspace-pane--active .page-tab').first().focus();
    await settle(page, 300);
    await editor.locator('.source-window__input').focus();
    await settle(page);
    const refocused = await readAnchor(page);
    const refocusDrift = refocused.line - anchored.line;
    console.log(
      `[scroll-anchor] refocus drift=${refocusDrift} ${JSON.stringify({
        anchored,
        refocused,
      })}`,
    );
    expect(
      Math.abs(refocusDrift),
      `refocusing the editor moved the note by ${refocusDrift} lines`,
    ).toBeLessThanOrEqual(1);

    const before = refocused;

    await page
      .locator('.workspace-pane--active')
      .getByRole('button', { name: labels.paneMenu })
      .click();
    await page.locator('.flyoff-menu__item[id$="-item-split-right"]').click();
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await settle(page, 1_500);

    const original = page
      .locator('.workspace-pane')
      .first()
      .locator('.markdown-source__editor');
    const after = (await original.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      let best: { line: number; top: number } | undefined;
      const lines = root.querySelectorAll<HTMLElement>('.md-line');
      for (const element of lines) {
        const line = Number.parseInt(element.dataset.line ?? '', 10);
        if (!Number.isFinite(line)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= rootRect.top + 0.5) {
          continue;
        }
        if (!best || rect.top < best.top) {
          best = { line, top: rect.top };
        }
      }
      return {
        clientHeight: root.clientHeight,
        line: best ? best.line : -1,
        mountedLines: lines.length,
        offsetWithinPx: best ? rootRect.top - best.top : 0,
        scrollHeight: root.scrollHeight,
        scrollTop: root.scrollTop,
        width: root.clientWidth,
      };
    })) as AnchorReading;

    const drift = after.line - before.line;
    console.log(
      `[scroll-anchor] split-right drift=${drift} ${JSON.stringify({
        after,
        before,
      })}`,
    );
    expect(
      Math.abs(drift),
      `anchor drifted ${drift} lines: ${JSON.stringify({ after, before })}`,
    ).toBeLessThanOrEqual(1);

    // Closing the extra pane widens the surviving one back, which is the same
    // class of layout change as the split and must hold the reading position
    // just as well.
    await page
      .locator('.workspace-pane--active .page-tab__close')
      .first()
      .click();
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
    await settle(page, 1_500);
    const restored = await readAnchor(page);
    const closeDrift = restored.line - after.line;
    console.log(
      `[scroll-anchor] close-split drift=${closeDrift} ${JSON.stringify({
        after,
        restored,
      })}`,
    );
    expect(
      Math.abs(closeDrift),
      `closing the pane moved the note by ${closeDrift} lines`,
    ).toBeLessThanOrEqual(1);

    const rightNoteName = 'Right pane note';
    await page.getByRole('button', { name: labels.add }).click();
    await page
      .getByRole('dialog', { name: labels.add })
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    await nameInput.fill(rightNoteName);
    await nameInput.press('Enter');
    const rightNoteTab = page.getByRole('tab', {
      exact: true,
      name: rightNoteName,
    });
    await expect(rightNoteTab).toHaveAttribute('aria-selected', 'true');
    const rightNotePane = page
      .locator('.workspace-pane')
      .filter({ has: rightNoteTab });
    const rightEditor = rightNotePane.locator(
      '.markdown-source__editor:visible',
    );
    await expect(rightEditor).toBeVisible();
    await rightEditor.locator('.md-line').first().click();
    await page.keyboard.insertText('Right pane content');
    await expect(rightEditor).toContainText('Right pane content');
    await settle(page, 800);
    await expect(
      page.locator(
        '.markdown-editor__status--dirty, .markdown-editor__status--saving',
      ),
    ).toHaveCount(0, { timeout: 15_000 });
    await rightNotePane
      .locator('.page-tab')
      .filter({ has: rightNoteTab })
      .locator('.page-tab__close')
      .click();
    await expect(page.getByRole('tab', { name: rightNoteName })).toHaveCount(0);
    await expect(editor).toBeVisible();
    await settle(page);

    const beforeDraggedSplit = await readAnchor(page);
    const tree = page.getByRole('tree');
    const rightTreeNote = tree.locator('.project-tree__item').filter({
      has: page.getByRole('button', {
        exact: true,
        name: rightNoteName,
      }),
    });
    await expect(rightTreeNote).toBeVisible();
    const survivingPane = page.locator('.workspace-pane').first();
    const survivingPaneBounds = await survivingPane.boundingBox();
    expect(survivingPaneBounds).not.toBeNull();
    const drag = await page.evaluateHandle(() => new DataTransfer());
    await rightTreeNote.dispatchEvent('dragstart', { dataTransfer: drag });
    const dropPoint = {
      x: survivingPaneBounds!.x + survivingPaneBounds!.width - 18,
      y: survivingPaneBounds!.y + survivingPaneBounds!.height / 2,
    };
    await survivingPane.dispatchEvent('dragover', {
      clientX: dropPoint.x,
      clientY: dropPoint.y,
      dataTransfer: drag,
    });
    await survivingPane.dispatchEvent('drop', {
      clientX: dropPoint.x,
      clientY: dropPoint.y,
      dataTransfer: drag,
    });
    await rightTreeNote.dispatchEvent('dragend', { dataTransfer: drag });
    await drag.dispose();

    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(rightNoteTab).toHaveAttribute('aria-selected', 'true');
    await expect(
      rightNotePane.locator('.markdown-source__editor:visible'),
    ).toContainText('Right pane content');
    await settle(page, 1_500);
    const afterDraggedSplit = await readAnchor(page);
    expect(
      Math.abs(afterDraggedSplit.line - beforeDraggedSplit.line),
      `dragging a note right moved the surviving note: ${JSON.stringify({
        afterDraggedSplit,
        beforeDraggedSplit,
      })}`,
    ).toBeLessThanOrEqual(1);

    const survivingPaneId = await survivingPane.getAttribute('data-pane-id');
    expect(survivingPaneId).toBeTruthy();
    await page.evaluate((paneId) => {
      const watchWindow = window as typeof window & {
        __flyoffCloseAnchorWatch?: { done: boolean; lines: number[] };
      };
      const report = { done: false, lines: [] as number[] };
      watchWindow.__flyoffCloseAnchorWatch = report;
      const deadline = performance.now() + 2_000;
      const schedule = () => {
        requestAnimationFrame(() => window.setTimeout(sample, 0));
      };
      const sample = () => {
        const pane = document.querySelector<HTMLElement>(
          `.workspace-pane[data-pane-id="${CSS.escape(paneId!)}"]`,
        );
        const root = pane?.querySelector<HTMLElement>(
          '.markdown-source__editor',
        );
        if (root) {
          const rootRect = root.getBoundingClientRect();
          let line = Number.POSITIVE_INFINITY;
          for (const element of root.querySelectorAll<HTMLElement>('.md-line')) {
            const candidate = Number.parseInt(element.dataset.line ?? '', 10);
            const rect = element.getBoundingClientRect();
            if (
              Number.isFinite(candidate) &&
              rect.bottom > rootRect.top + 0.5 &&
              rect.top < rootRect.bottom - 0.5
            ) {
              line = Math.min(line, candidate);
            }
          }
          if (Number.isFinite(line)) {
            report.lines.push(line);
          }
        }
        if (performance.now() < deadline) {
          schedule();
        } else {
          report.done = true;
        }
      };
      schedule();
    }, survivingPaneId);

    await rightNotePane
      .locator('.page-tab')
      .filter({ has: rightNoteTab })
      .locator('.page-tab__close')
      .click();
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              Boolean(
                (
                  window as typeof window & {
                    __flyoffCloseAnchorWatch?: { done: boolean };
                  }
                ).__flyoffCloseAnchorWatch?.done,
              ),
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await settle(page, 1_500);
    const restoredAfterDrag = await readAnchor(page);
    const closeAfterDragDrift =
      restoredAfterDrag.line - afterDraggedSplit.line;
    expect(
      Math.abs(closeAfterDragDrift),
      `closing the dragged note moved the survivor by ${closeAfterDragDrift} lines`,
    ).toBeLessThanOrEqual(1);
    const transientLines = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __flyoffCloseAnchorWatch?: { lines: number[] };
          }
        ).__flyoffCloseAnchorWatch?.lines ?? [],
    );
    expect(transientLines.length).toBeGreaterThan(0);
    expect(
      Math.max(...transientLines) - Math.min(...transientLines),
      `closing the dragged note produced a transient anchor jump: ${JSON.stringify(
        transientLines,
      )}`,
    ).toBeLessThanOrEqual(1);
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
