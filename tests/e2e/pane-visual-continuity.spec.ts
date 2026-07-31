/**
 * Opening and closing a pane beside a long note must not blank the text.
 *
 * This asserts on the frames themselves, not on where the scroller ended up.
 * A blank frame moves no scroll value at all — `scrollTop` reads the same
 * before and after — so every anchor and settling check passes straight
 * through it. What changes is where the mounted lines are, and that is what is
 * sampled here.
 *
 * Two things make the reproduction deterministic rather than lucky:
 *
 *  - the geometry. At 1400x900 the pane halves to 544 px, which is narrow
 *    enough that the re-wrap moves every line to a materially different offset.
 *    Wider windows shift the lines too little for the stale layer to leave a
 *    visible hole, which is why the same check at 1600x1000 passed even with
 *    the defect present.
 *  - the sampling order. The view schedules its render from the resize and
 *    scroll paths, so a sampler that re-registers itself inside
 *    `requestAnimationFrame` sits ahead of it in the callback queue and reads
 *    the previous frame's DOM. Sampling from a task queued by the frame
 *    observes what was actually committed for it.
 */
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

/**
 * A line can legitimately be a pixel or two short of the viewport edge while
 * the next one is being mounted; a hole a reader notices is tens of pixels.
 * The defect this guards produced 810 px on an 810 px viewport, and the
 * close-split case 371 px, so the tolerance is nowhere near either.
 */
const COVERAGE_TOLERANCE_PX = 40;

interface FrameSample {
  clientHeight: number;
  gapPx: number;
  lines: number;
  mountedFrom: number;
  mountedTo: number;
  scrollTop: number;
  t: number;
  width: number;
}

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

const installFrameProbe = () => {
  const store = { frames: [] as FrameSample[], recording: false };
  (window as unknown as { __paneFrames: typeof store }).__paneFrames = store;

  const sample = () => {
    if (store.recording) {
      const root = document.querySelector<HTMLElement>(
        '.workspace-pane .markdown-source__editor',
      );
      if (root) {
        const box = root.getBoundingClientRect();
        const lines = root.querySelectorAll<HTMLElement>('.md-line');
        // Coverage is measured in bands across the editor's own box, from real
        // rectangles, so it reflects what was painted rather than what the
        // height map believes.
        const bands = 24;
        const covered = new Array<boolean>(bands).fill(false);
        let mountedFrom = Number.POSITIVE_INFINITY;
        let mountedTo = -1;
        for (const line of lines) {
          const parsed = Number.parseInt(line.dataset.line ?? '', 10);
          if (Number.isFinite(parsed)) {
            mountedFrom = Math.min(mountedFrom, parsed);
            mountedTo = Math.max(mountedTo, parsed);
          }
          const rect = line.getBoundingClientRect();
          if (rect.bottom <= box.top || rect.top >= box.bottom) {
            continue;
          }
          const from = Math.max(
            0,
            Math.floor(((rect.top - box.top) / box.height) * bands),
          );
          const to = Math.min(
            bands - 1,
            Math.ceil(((rect.bottom - box.top) / box.height) * bands) - 1,
          );
          for (let band = from; band <= to; band += 1) {
            covered[band] = true;
          }
        }
        store.frames.push({
          clientHeight: root.clientHeight,
          gapPx: Math.round(
            (covered.filter((value) => !value).length / bands) * box.height,
          ),
          lines: lines.length,
          mountedFrom: Number.isFinite(mountedFrom) ? mountedFrom : -1,
          mountedTo,
          scrollTop: Math.round(root.scrollTop),
          t: Math.round(performance.now()),
          width: Math.round(box.width),
        });
      }
    }
    requestAnimationFrame(() => setTimeout(sample, 0));
  };
  requestAnimationFrame(() => setTimeout(sample, 0));
};

const startFrames = () => {
  const store = (
    window as unknown as { __paneFrames: { frames: unknown[]; recording: boolean } }
  ).__paneFrames;
  store.frames.length = 0;
  store.recording = true;
};

const collectFrames = (): FrameSample[] => {
  const store = (
    window as unknown as {
      __paneFrames: { frames: FrameSample[]; recording: boolean };
    }
  ).__paneFrames;
  store.recording = false;
  return store.frames;
};

function describeFrame(frame: FrameSample): string {
  return (
    `t=${frame.t} scrollTop=${frame.scrollTop} pane=${frame.width}x${frame.clientHeight}` +
    ` mounted=[${frame.mountedFrom}..${frame.mountedTo}] lines=${frame.lines}` +
    ` uncovered=${frame.gapPx}px`
  );
}

function assertContinuous(label: string, frames: FrameSample[]): void {
  expect(
    frames.length,
    `${label}: the frame sampler produced ${frames.length} frames`,
  ).toBeGreaterThan(20);

  const blank = frames.filter((frame) => frame.lines === 0);
  expect(
    blank.length,
    `${label}: ${blank.length} frames rendered no lines at all\n${blank
      .slice(0, 5)
      .map(describeFrame)
      .join('\n')}`,
  ).toBe(0);

  const uncovered = frames.filter(
    (frame) => frame.gapPx > COVERAGE_TOLERANCE_PX,
  );
  expect(
    uncovered.length,
    `${label}: ${uncovered.length} of ${frames.length} frames left part of the viewport with no text\n${uncovered
      .slice(0, 8)
      .map(describeFrame)
      .join('\n')}`,
  ).toBe(0);
}

async function record(
  page: Page,
  action: () => Promise<void>,
): Promise<FrameSample[]> {
  await page.evaluate(startFrames);
  await action();
  return page.evaluate(collectFrames);
}

test('opening and closing a pane never blanks the note', async () => {
  test.setTimeout(240_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-continuity-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-continuity-project-'),
  );
  const projectName = 'Continuity';
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
    // The geometry is part of the reproduction, not a detail.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_400, 900);
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
    await nameInput.fill('Long note');
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
    await page.waitForTimeout(1_200);

    // Deep enough that the re-anchor has a real offset to move, and settled
    // before anything is recorded.
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.35);
    });
    await page.waitForTimeout(900);

    await page.evaluate(installFrameProbe);

    const idle = await record(page, () => page.waitForTimeout(700));
    assertContinuous('idle', idle);

    const opening = await record(page, async () => {
      await page
        .locator('.workspace-pane--active')
        .getByRole('button', { name: labels.paneMenu })
        .click();
      await page.locator('.flyoff-menu__item[id$="-item-split-right"]').click();
      await expect(page.locator('.workspace-pane')).toHaveCount(2);
      await page.waitForTimeout(1_500);
    });
    console.log(
      `[continuity] opening frames=${opening.length} worst=${Math.max(
        ...opening.map((frame) => frame.gapPx),
      )}px`,
    );
    assertContinuous('opening a pane', opening);

    const closing = await record(page, async () => {
      await page
        .locator('.workspace-pane--active .page-tab__close')
        .first()
        .click();
      await expect(page.locator('.workspace-pane')).toHaveCount(1);
      await page.waitForTimeout(1_500);
    });
    console.log(
      `[continuity] closing frames=${closing.length} worst=${Math.max(
        ...closing.map((frame) => frame.gapPx),
      )}px`,
    );
    assertContinuous('closing a pane', closing);
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
