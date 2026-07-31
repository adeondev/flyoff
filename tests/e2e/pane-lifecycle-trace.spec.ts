/**
 * Chronological trace of a pane opening and closing beside a long note.
 *
 * Records every scroll write with the code that made it, the anchor line the
 * reader is actually looking at, and the coverage of the viewport, on every
 * frame. Instrumentation is installed before the operation, never after.
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

const installTrace = () => {
  interface Write {
    caller: string;
    from: number;
    t: number;
    to: number;
    width: number;
  }
  interface Frame {
    err: string;
    gen: string;
    passes: string;
    anchor: number;
    anchorPx: number;
    gapPx: number;
    lines: number;
    scrollTop: number;
    t: number;
    width: number;
  }
  const store = {
    frames: [] as Frame[],
    recording: false,
    writes: [] as Write[],
  };
  (window as unknown as { __paneTrace: typeof store }).__paneTrace = store;

  const editor = () =>
    document.querySelector<HTMLElement>(
      '.workspace-pane .markdown-source__editor',
    );

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
        store.recording &&
        this instanceof HTMLElement &&
        this.classList.contains('markdown-source__editor') &&
        store.writes.length < 200
      ) {
        const caller = (new Error().stack ?? '')
          .split('\n')
          .slice(2)
          .map((line) => line.trim())
          .filter((line) => !line.includes('[as scrollTop]'))
          .slice(0, 4)
          .join(' < ');
        store.writes.push({
          caller: caller
            .replace(/^at\s+/, '')
            .replace(/flyoff:\/\/app\/main_window\/index\.js/, 'bundle')
            .slice(0, 240),
          from: Math.round(descriptor.get!.call(this) as number),
          t: Math.round(performance.now()),
          to: Math.round(value),
          width: this.clientWidth,
        });
      }
      descriptor.set!.call(this, value);
    },
  });

  /** The document line drawn at the top edge, from real geometry. */
  const readAnchor = (root: HTMLElement) => {
    const box = root.getBoundingClientRect();
    let best: { line: number; top: number } | undefined;
    const lines = root.querySelectorAll<HTMLElement>('.md-line');
    const bands = 24;
    const covered = new Array<boolean>(bands).fill(false);
    for (const element of lines) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > box.top && rect.top < box.bottom) {
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
      if (rect.bottom <= box.top + 0.5) {
        continue;
      }
      const line = Number.parseInt(element.dataset.line ?? '', 10);
      if (Number.isFinite(line) && (!best || rect.top < best.top)) {
        best = { line, top: rect.top };
      }
    }
    return {
      anchor: best ? best.line : -1,
      anchorPx: best ? Math.round(box.top - best.top) : 0,
      gapPx: Math.round(
        (covered.filter((value) => !value).length / bands) * box.height,
      ),
      lines: lines.length,
    };
  };

  const sample = () => {
    if (store.recording) {
      const root = editor();
      if (root) {
        const read = readAnchor(root);
        store.frames.push({
          ...read,
          passes: root.dataset.anchorPasses ?? "-",
          err: root.dataset.anchorError ?? "-",
          gen: root.dataset.anchorGeneration ?? "-",
          scrollTop: Math.round(descriptor.get!.call(root) as number),
          t: Math.round(performance.now()),
          width: root.clientWidth,
        });
      }
    }
    requestAnimationFrame(() => setTimeout(sample, 0));
  };
  requestAnimationFrame(() => setTimeout(sample, 0));
};

const startTrace = () => {
  const store = (
    window as unknown as {
      __paneTrace: { frames: unknown[]; recording: boolean; writes: unknown[] };
    }
  ).__paneTrace;
  store.frames.length = 0;
  store.writes.length = 0;
  store.recording = true;
};

const collectTrace = () => {
  const store = (
    window as unknown as {
      __paneTrace: {
        frames: {
          err: string;
          gen: string;
          passes: string;
          anchor: number;
          anchorPx: number;
          gapPx: number;
          lines: number;
          scrollTop: number;
          t: number;
          width: number;
        }[];
        recording: boolean;
        writes: {
          caller: string;
          from: number;
          t: number;
          to: number;
          width: number;
        }[];
      };
    }
  ).__paneTrace;
  store.recording = false;
  return { frames: store.frames, writes: store.writes };
};

async function trace(
  page: Page,
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  await page.evaluate(startTrace);
  await action();
  const { frames, writes } = await page.evaluate(collectTrace);
  const anchors = frames.map((frame) => frame.anchor).filter((a) => a >= 0);
  const first = anchors[0] ?? -1;
  const last = anchors.at(-1) ?? -1;
  let reversals = 0;
  let direction = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    const delta = anchors[index]! - anchors[index - 1]!;
    if (Math.abs(delta) < 2) {
      continue;
    }
    const next = delta > 0 ? 1 : -1;
    if (direction !== 0 && next !== direction) {
      reversals += 1;
    }
    direction = next;
  }
  console.log(
    `\n######## ${label} ######## frames=${frames.length}` +
      ` anchor ${first} -> ${last} (drift ${last - first} lines)` +
      ` reversals=${reversals}` +
      ` anchorRange=[${Math.min(...anchors)}..${Math.max(...anchors)}]` +
      ` blank=${frames.filter((f) => f.lines === 0).length}` +
      ` underCovered=${frames.filter((f) => f.gapPx > 40).length}` +
      ` writes=${writes.length}`,
  );
  console.log(
    `  --- anchor per frame (line@width) ---\n   ${frames
      .filter(
        (frame, index) =>
          index === 0 ||
          frame.anchor !== frames[index - 1]!.anchor ||
          frame.width !== frames[index - 1]!.width,
      )
      .slice(0, 40)
      .map((frame) => `${frame.t}:${frame.anchor}@${frame.width}/g${frame.gen}p${frame.passes}e${frame.err}`)
      .join(' ')}`,
  );
  console.log('  --- scroll writes, in order ---');
  for (const write of writes.slice(0, 24)) {
    console.log(
      `   t=${write.t} w=${write.width} ${write.from} -> ${write.to}   ${write.caller}`,
    );
  }
  const bad = frames.filter((frame) => frame.gapPx > 40 || frame.lines === 0);
  if (bad.length > 0) {
    console.log('  --- frames the reader sees a hole in ---');
    for (const frame of bad.slice(0, 8)) {
      console.log(
        `   t=${frame.t} w=${frame.width} anchor=${frame.anchor} lines=${frame.lines} gap=${frame.gapPx}px scrollTop=${frame.scrollTop}`,
      );
    }
  }
}

test('trace: opening and closing a pane beside a long note', async () => {
  test.setTimeout(300_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-trace-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-trace-project-'),
  );
  const projectName = 'Trace';
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
    await page.waitForTimeout(1_500);

    // Far from the beginning, with the caret left behind above the viewport —
    // the shape the reader described.
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.45);
    });
    await page.waitForTimeout(700);
    const caret = await editor.evaluate((root) => {
      const box = root.getBoundingClientRect();
      const line = [...root.querySelectorAll<HTMLElement>('.md-line')].find(
        (element) => element.getBoundingClientRect().top > box.top + 80,
      );
      const rect = line!.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.top + 4 };
    });
    await page.mouse.click(caret.x, caret.y);
    await page.waitForTimeout(300);
    await editor.evaluate((root) => {
      root.scrollTop += 2_500;
    });
    await page.waitForTimeout(900);

    await page.evaluate(installTrace);

    await trace(page, 'OPEN pane on the right', async () => {
      await page
        .locator('.workspace-pane--active')
        .getByRole('button', { name: labels.paneMenu })
        .click();
      await page.locator('.flyoff-menu__item[id$="-item-split-right"]').click();
      await expect(page.locator('.workspace-pane')).toHaveCount(2);
      await page.waitForTimeout(2_000);
    });

    await trace(page, 'CLOSE the right pane', async () => {
      await page
        .locator('.workspace-pane--active .page-tab__close')
        .first()
        .click();
      await expect(page.locator('.workspace-pane')).toHaveCount(1);
      await page.waitForTimeout(2_000);
    });
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
