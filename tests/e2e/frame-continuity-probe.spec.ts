/**
 * Diagnostic probe for visual continuity, not an assertion.
 *
 * Samples every animation frame during the operations the reader says flicker,
 * recording what is actually on screen rather than where the scroller ended
 * up: how many lines are mounted, whether they cover the viewport, whether the
 * editor still has a box, and whether the layer was emptied before its
 * replacement arrived.
 *
 * Run: npx playwright test tests/e2e/frame-continuity-probe.spec.ts
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
const LINE_COUNT = Number(process.env.FRAME_LINES ?? 11_000);

interface FrameSample {
  clientHeight: number;
  /** Pixels of the viewport with no mounted line over them. */
  gapPx: number;
  lines: number;
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

function fixture(): string {
  if (process.env.FRAME_FIXTURE === 'mixed') {
    const parts: string[] = [];
    for (let index = 0; index < LINE_COUNT; index += 1) {
      const bucket = index % 9;
      if (bucket === 0) {
        parts.push(`## Section ${index}`);
      } else if (bucket === 1) {
        parts.push('```ts\n' + `const v${index} = ${index};\n`.repeat(5) + '```');
      } else if (bucket === 2) {
        parts.push(
          `| A ${index} | B |\n| --- | --- |\n| ${index} | v |\n| ${index + 1} | v |`,
        );
      } else if (bucket === 3) {
        parts.push(
          Array.from({ length: 5 }, (_, i) => `- item ${index}.${i}`).join('\n'),
        );
      } else if (bucket === 4) {
        parts.push(`![x](./missing-${index}.png)`);
      } else {
        parts.push(
          `Paragraph ${index}: ` + 'text that wraps a few times over. '.repeat(6),
        );
      }
    }
    return parts.join('\n\n');
  }
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
 * Coverage is measured against real geometry: the union of the mounted lines'
 * rectangles against the editor's own box. A frame where the layer is empty,
 * or where the mounted lines sit entirely outside the viewport, is a frame the
 * reader sees as blank even though `scrollTop` never moved.
 */
const installFrameProbe = () => {
  const store = { frames: [] as FrameSample[], recording: false };
  (window as unknown as { __frameProbe: typeof store }).__frameProbe = store;

  // Measured after every animation-frame callback registered for this frame,
  // not inside one. The view schedules its render from the scroll event, so a
  // sampler that re-registers itself sits ahead of it in the queue and would
  // read the previous frame's DOM — reporting a lag that the reader never saw.
  const schedule = () => {
    requestAnimationFrame(() => {
      setTimeout(sample, 0);
    });
  };

  const sample = () => {
    if (store.recording) {
      const root = document.querySelector<HTMLElement>(
        '.workspace-pane .markdown-source__editor',
      );
      if (root) {
        const box = root.getBoundingClientRect();
        const lines = root.querySelectorAll<HTMLElement>('.md-line');
        // Walk the viewport in bands and mark the ones a line covers.
        const bands = 24;
        const covered = new Array<boolean>(bands).fill(false);
        for (const line of lines) {
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
        const missing = covered.filter((value) => !value).length;
        store.frames.push({
          clientHeight: root.clientHeight,
          gapPx: Math.round((missing / bands) * box.height),
          lines: lines.length,
          scrollTop: Math.round(root.scrollTop),
          t: Math.round(performance.now()),
          width: root.clientWidth,
        });
      } else {
        store.frames.push({
          clientHeight: -1,
          gapPx: -1,
          lines: -1,
          scrollTop: -1,
          t: Math.round(performance.now()),
          width: -1,
        });
      }
    }
    schedule();
  };
  schedule();
};

const startFrames = () => {
  const store = (
    window as unknown as {
      __frameProbe: { frames: unknown[]; recording: boolean };
    }
  ).__frameProbe;
  store.frames.length = 0;
  store.recording = true;
};

const collectFrames = (): FrameSample[] => {
  const store = (
    window as unknown as {
      __frameProbe: { frames: FrameSample[]; recording: boolean };
    }
  ).__frameProbe;
  store.recording = false;
  return store.frames;
};

function report(label: string, frames: FrameSample[]): void {
  const blank = frames.filter((frame) => frame.lines === 0);
  const missing = frames.filter((frame) => frame.lines === -1);
  const noBox = frames.filter(
    (frame) => frame.lines >= 0 && (frame.width <= 0 || frame.clientHeight <= 0),
  );
  const gaps = frames.filter((frame) => frame.gapPx > 40);
  console.log(
    `\n==== ${label} ==== frames=${frames.length}` +
      ` blank=${blank.length} detached=${missing.length}` +
      ` zeroBox=${noBox.length} underCovered=${gaps.length}`,
  );
  const worst = [...frames]
    .filter((frame) => frame.gapPx > 40 || frame.lines <= 0)
    .slice(0, 12);
  for (const frame of worst) {
    console.log(
      `   t=${frame.t} lines=${frame.lines} gapPx=${frame.gapPx}` +
        ` box=${frame.width}x${frame.clientHeight} scrollTop=${frame.scrollTop}`,
    );
  }
  if (worst.length === 0) {
    const sampled = frames.filter((_, index) => index % 12 === 0).slice(0, 8);
    console.log(
      `   (no bad frames) sample: ${sampled
        .map((frame) => `${frame.lines}L/${frame.gapPx}px`)
        .join(' ')}`,
    );
  }
}

async function scenario(
  page: Page,
  label: string,
  action: () => Promise<void>,
): Promise<FrameSample[]> {
  await page.evaluate(startFrames);
  await action();
  const frames = await page.evaluate(collectFrames);
  report(label, frames);
  return frames;
}

test('probe: frame-by-frame continuity during pane and scroll work', async () => {
  test.setTimeout(300_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-frames-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-frames-project-'),
  );
  const projectName = 'Frames';
  const source = fixture();
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
    await expect
      .poll(
        () => editor.evaluate((root) => root.scrollHeight - root.clientHeight),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(1_000);
    await page.waitForTimeout(1_200);
    console.log(
      `[probe] windowed=${await editor.getAttribute('data-windowed')} lines=${LINE_COUNT} fixture=${process.env.FRAME_FIXTURE ?? 'plain'}`,
    );

    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.35);
    });
    await page.waitForTimeout(900);

    await page.evaluate(installFrameProbe);

    await scenario(page, 'A idle control', async () => {
      await page.waitForTimeout(1_000);
    });

    await scenario(page, 'B split right', async () => {
      await page
        .locator('.workspace-pane--active')
        .getByRole('button', { name: labels.paneMenu })
        .click();
      await page.locator('.flyoff-menu__item[id$="-item-split-right"]').click();
      await expect(page.locator('.workspace-pane')).toHaveCount(2);
      await page.waitForTimeout(1_500);
    });

    await scenario(page, 'C close the split', async () => {
      await page
        .locator('.workspace-pane--active .page-tab__close')
        .first()
        .click();
      await expect(page.locator('.workspace-pane')).toHaveCount(1);
      await page.waitForTimeout(1_500);
    });

    const box = (await editor.boundingBox())!;
    const centre = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };

    await scenario(page, 'D continuous wheel scrolling', async () => {
      await page.mouse.move(centre.x, centre.y);
      for (let step = 0; step < 60; step += 1) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(600);
    });

    await scenario(page, 'E fast wheel bursts', async () => {
      await page.mouse.move(centre.x, centre.y);
      for (let burst = 0; burst < 12; burst += 1) {
        for (let step = 0; step < 6; step += 1) {
          await page.mouse.wheel(0, 1_200);
        }
        await page.waitForTimeout(48);
      }
      await page.waitForTimeout(800);
    });

    await scenario(page, 'F page down', async () => {
      await editor.locator('.source-window__input').focus();
      for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(24);
      }
      await page.waitForTimeout(600);
    });
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
