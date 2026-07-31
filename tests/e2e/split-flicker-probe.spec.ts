/**
 * Diagnostic probe, not an assertion. It walks through every way the app opens
 * something to the right of a long note and records, for each one:
 *
 *  - every write to `Element.prototype.scrollTop` with its stack,
 *  - every `scrollTo` / `scrollBy` / `scrollIntoView`,
 *  - a per-frame sample of each scroller's real `scrollTop`.
 *
 * The per-frame sampler is what decides whether the view flickers: it sees
 * oscillation regardless of which API produced it, including a scroll the
 * compositor applied without any of the patched setters being called.
 *
 * Run with: npx playwright test tests/e2e/split-flicker-probe.spec.ts
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
const LINE_COUNT = Number(process.env.FLICKER_LINES ?? 11_000);
const SAMPLE_MS = 2_500;

interface ScrollWrite {
  cls: string;
  kind: string;
  prev: number;
  stack: string;
  t: number;
  value: number;
}

interface TrackReport {
  key: string;
  reversals: number;
  spread: number;
  tail: number[];
  unique: number;
}

interface ProbeReport {
  frames: number;
  tracks: TrackReport[];
  writes: ScrollWrite[];
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

function uniformNoteFixture(): string {
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
 * Blocks whose real height is nothing like the estimate, and whose height per
 * row differs sharply between kinds. The reading view calibrates its estimator
 * from whatever it has measured so far, so content that keeps moving that
 * average is what stops the estimate from converging.
 */
function mixedNoteFixture(): string {
  const parts: string[] = [];
  for (let index = 0; index < LINE_COUNT; index += 1) {
    const bucket = index % 11;
    if (bucket === 0) {
      parts.push(`# Chapter ${index}`);
    } else if (bucket === 1) {
      parts.push(`### Sub ${index}`);
    } else if (bucket === 2) {
      parts.push(
        `| Column ${index} | Second | Third |\n| --- | --- | --- |\n| ${index} | value | another |\n| ${index + 1} | value | another |`,
      );
    } else if (bucket === 3) {
      parts.push(
        '```ts\n' +
          `const value${index} = ${index};\n`.repeat(6) +
          '```',
      );
    } else if (bucket === 4) {
      parts.push(`> Quote ${index} that runs on for a while. `.repeat(3));
    } else if (bucket === 5) {
      parts.push(
        Array.from(
          { length: 6 },
          (_, item) => `- Item ${index}.${item} with a reasonably long label`,
        ).join('\n'),
      );
    } else if (bucket === 6) {
      // A very long paragraph: many wrapped rows, far above the average.
      parts.push(
        `Paragraph ${index}: ` +
          'text that keeps going and wraps many times over. '.repeat(24),
      );
    } else if (bucket === 7) {
      parts.push(`Tiny ${index}.`);
    } else if (bucket === 8) {
      parts.push('---');
    } else {
      parts.push(
        `Paragraph ${index} with a middling amount of text on it, enough to wrap once or twice at a normal pane width.`,
      );
    }
  }
  return parts.join('\n\n');
}

/**
 * Blocks whose height is only known after an asynchronous load. Emoji render
 * through `flyoff-asset://`, so the row they sit on is one height while the
 * request is in flight and another once it resolves. A measurement taken
 * before the load and trusted afterwards is what a converging loop cannot
 * survive.
 */
function asyncNoteFixture(): string {
  const emoji = '😀🌍🚀🧭📚🎯🔥🌈🧪🛠️';
  const parts: string[] = [];
  for (let index = 0; index < LINE_COUNT; index += 1) {
    const bucket = index % 7;
    if (bucket === 0) {
      parts.push(`## Section ${index} ${emoji}`);
    } else if (bucket === 1) {
      parts.push(
        `Paragraph ${index} ${emoji.repeat(4)} with emoji throughout that only settle once every glyph has been fetched. ${emoji}`,
      );
    } else if (bucket === 2) {
      parts.push(`![missing ${index}](./assets/does-not-exist-${index}.png)`);
    } else if (bucket === 3) {
      parts.push(
        `| ${emoji} | Column ${index} |\n| --- | --- |\n| ${emoji} | value |`,
      );
    } else if (bucket === 4) {
      parts.push('```ts\n' + `const v${index} = ${index}; // ${emoji}\n`.repeat(4) + '```');
    } else if (bucket === 5) {
      parts.push(
        Array.from(
          { length: 5 },
          (_, item) => `- ${emoji} item ${index}.${item} with a long enough label to wrap`,
        ).join('\n'),
      );
    } else {
      parts.push(
        `Paragraph ${index}: ` + 'plain text that wraps a few times. '.repeat(10),
      );
    }
  }
  return parts.join('\n\n');
}

function noteFixture(): string {
  if (process.env.FLICKER_FIXTURE === 'mixed') {
    return mixedNoteFixture();
  }
  if (process.env.FLICKER_FIXTURE === 'async') {
    return asyncNoteFixture();
  }
  return uniformNoteFixture();
}

/** Patches the scroll APIs once; the store is reset between scenarios. */
const installProbe = () => {
  interface ScrollWrite {
    cls: string;
    kind: string;
    prev: number;
    stack: string;
    t: number;
    value: number;
  }
  const store = {
    frames: 0,
    recording: false,
    tracks: new Map<string, number[]>(),
    writes: [] as ScrollWrite[],
  };
  (window as unknown as { __flickerProbe: typeof store }).__flickerProbe =
    store;

  const describe = (element: Element): string => {
    const cls =
      typeof element.className === 'string' ? element.className : '';
    return `${element.tagName.toLowerCase()}.${cls.split(/\s+/).slice(0, 2).join('.')}`;
  };
  const note = (kind: string, element: Element, value: number, prev: number) => {
    if (!store.recording || store.writes.length >= 600) {
      return;
    }
    store.writes.push({
      cls: describe(element),
      kind,
      prev: Math.round(prev),
      stack: new Error().stack ?? '',
      t: Math.round(performance.now()),
      value: Math.round(value * 100) / 100,
    });
  };

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
      note('scrollTop=', this, value, descriptor.get!.call(this) as number);
      descriptor.set!.call(this, value);
    },
  });

  for (const name of ['scrollTo', 'scrollBy', 'scrollIntoView'] as const) {
    const original = Element.prototype[name] as (...args: unknown[]) => unknown;
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value(this: Element, ...args: unknown[]) {
        const first = args[0];
        const top =
          typeof first === 'object' && first !== null && 'top' in first
            ? Number((first as { top?: number }).top ?? Number.NaN)
            : Number.NaN;
        note(name, this, top, descriptor.get!.call(this) as number);
        return original.apply(this, args);
      },
      writable: true,
    });
  }

  // Everything that can scroll in the workspace, sampled per frame. Keyed by
  // pane index so the second pane's editor is distinguishable from the first.
  const sample = () => {
    if (store.recording) {
      store.frames += 1;
      const panes = document.querySelectorAll<HTMLElement>('.workspace-pane');
      panes.forEach((pane, paneIndex) => {
        const scrollers = pane.querySelectorAll<HTMLElement>(
          '.markdown-source__editor, .markdown-view, .page-panel',
        );
        scrollers.forEach((scroller, scrollerIndex) => {
          // Both tabs of a pane stay mounted, so two editors can answer the
          // same selector. Keying only by class merged them into one track and
          // made the alternation between a visible and a hidden editor look
          // like the view oscillating.
          const key = `pane${paneIndex}:#${scrollerIndex}:${describe(scroller)}:h${scroller.clientHeight}`;
          let track = store.tracks.get(key);
          if (!track) {
            track = [];
            store.tracks.set(key, track);
          }
          track.push(Math.round(descriptor.get!.call(scroller) as number));
        });
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

const startRecording = () => {
  const store = (
    window as unknown as {
      __flickerProbe: {
        frames: number;
        recording: boolean;
        tracks: Map<string, number[]>;
        writes: unknown[];
      };
    }
  ).__flickerProbe;
  store.frames = 0;
  store.tracks.clear();
  store.writes.length = 0;
  store.recording = true;
};

const collectProbe = (): ProbeReport => {
  const store = (
    window as unknown as {
      __flickerProbe: {
        frames: number;
        recording: boolean;
        tracks: Map<string, number[]>;
        writes: ScrollWrite[];
      };
    }
  ).__flickerProbe;
  store.recording = false;
  const tracks: TrackReport[] = [];
  for (const [key, values] of store.tracks) {
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
    tracks.push({
      key,
      reversals,
      spread: values.length ? Math.max(...values) - Math.min(...values) : 0,
      tail: values.slice(-24),
      unique: new Set(values).size,
    });
  }
  return { frames: store.frames, tracks, writes: store.writes };
};

function reportScenario(label: string, report: ProbeReport): void {
  const worst = report.tracks.reduce(
    (max, track) => Math.max(max, track.reversals),
    0,
  );
  console.log(
    `\n======== ${label} ======== frames=${report.frames} writes=${report.writes.length} worstReversals=${worst}`,
  );
  for (const track of report.tracks) {
    console.log(
      `  ${track.key}: reversals=${track.reversals} spread=${track.spread} unique=${track.unique} tail=${JSON.stringify(track.tail)}`,
    );
  }
  if (report.writes.length > 0) {
    const bySignature = new Map<string, number>();
    for (const write of report.writes) {
      const key = write.stack
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !line.includes('at note ') &&
            !line.includes('[as scrollTop]') &&
            !line.includes('[as scrollIntoView]'),
        )
        .slice(0, 4)
        .join('  <-  ')
        .replace(/flyoff:\/\/app\/main_window\/index\.js:\d+:/g, 'bundle:');
      bySignature.set(key, (bySignature.get(key) ?? 0) + 1);
    }
    console.log(`  --- writes by stack (${report.writes.length} total) ---`);
    for (const [signature, count] of [...bySignature.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)) {
      console.log(`   ${String(count).padStart(4)}x  ${signature}`);
    }
    console.log('  --- first 12 writes ---');
    for (const [index, write] of report.writes.slice(0, 12).entries()) {
      console.log(
        `   #${index} t=${write.t} ${write.kind} ${write.cls} ${write.prev} -> ${write.value}`,
      );
    }
  }
}

async function runScenario(
  page: Page,
  label: string,
  action: () => Promise<void>,
): Promise<ProbeReport> {
  await page.evaluate(startRecording);
  await action();
  await page.waitForTimeout(SAMPLE_MS);
  const report = await page.evaluate(collectProbe);
  reportScenario(label, report);
  return report;
}

test('probe: what writes scrollTop when something opens to the right', async () => {
  test.setTimeout(300_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-flicker-probe-'),
  );
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-flicker-project-'),
  );
  const projectName = 'Flicker Probe';
  const source = noteFixture();
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
    const windowSize = Number(process.env.FLICKER_WINDOW ?? 0);
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(
        size || 1_600,
        size ? Math.round(size * 0.62) : 1_000,
      );
    }, windowSize);
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
          modeMenu: 'Note options',
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
          modeMenu: 'Opções da nota',
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
    await app.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      source,
    );

    const createNote = async (name: string): Promise<void> => {
      await page.getByRole('button', { name: labels.add }).click();
      await page
        .getByRole('dialog', { name: labels.add })
        .getByRole('option', { name: new RegExp(`^${labels.note}`) })
        .click();
      const nameInput = page.getByRole('textbox', { name: labels.name });
      await nameInput.fill(name);
      await nameInput.press('Enter');
      const fresh = page.locator('.markdown-source__editor:visible');
      await expect(fresh).toBeVisible();
      await app!.evaluate(
        ({ clipboard }, value) => clipboard.writeText(value),
        source,
      );
      await fresh.focus();
      await page.keyboard.press(
        process.platform === 'darwin' ? 'Meta+V' : 'Control+V',
      );
      await page.waitForTimeout(1_500);
      console.log(
        `[probe] after paste into ${name}: ${JSON.stringify(
          await fresh.evaluate((root) => ({
            editors: document.querySelectorAll('.markdown-source__editor')
              .length,
            hasInput: Boolean(root.querySelector('.source-window__input')),
            scrollable: root.scrollHeight - root.clientHeight,
            text: (root.textContent ?? '').length,
          })),
        )}`,
      );
      await expect
        .poll(
          () => fresh.evaluate((root) => root.scrollHeight - root.clientHeight),
          { timeout: 60_000 },
        )
        .toBeGreaterThan(1_000);
    };

    // Two notes, so that opening one to the right leaves a live editor in each
    // pane. With the pane menu's placeholder page on the right there is only
    // ever one editor mounted, and the pair is the whole point of the repro.
    await createNote('Nota B');
    await createNote('Nota A');

    const editor = page.locator('.markdown-source__editor:visible');
    // A small note renders through the non-windowed editor, which carries no
    // line-count attribute, so readiness is judged by the document being
    // taller than the viewport in both cases.
    await expect
      .poll(
        () => editor.evaluate((root) => root.scrollHeight - root.clientHeight),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(1_000);
    console.log(
      `[probe] windowed=${await editor.getAttribute('data-windowed')} lines=${LINE_COUNT}`,
    );

    // Read into the middle and leave the caret behind, exactly as a reader does.
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.4);
    });
    await page.waitForTimeout(900);
    const caretTarget = await editor.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const candidates = root.querySelectorAll<HTMLElement>(
        '.md-line, .markdown-source__line, p, div',
      );
      const line = [...candidates].find(
        (element) =>
          element.getBoundingClientRect().top > rootRect.top + 120 &&
          element.getBoundingClientRect().height > 0,
      );
      const box = (line ?? root).getBoundingClientRect();
      return { x: box.left + 24, y: box.top + 4 };
    });
    await page.mouse.click(caretTarget.x, caretTarget.y);
    await page.waitForTimeout(400);
    await editor.evaluate((root) => {
      root.scrollTop += 600;
    });
    await page.waitForTimeout(900);

    await page.evaluate(installProbe);

    const chooseMode = async (mode: string): Promise<void> => {
      await page
        .getByRole('button', { name: labels.modeMenu })
        .first()
        .click();
      await page
        .locator(`.flyoff-menu__item[id$="-item-mode:${mode}"]`)
        .first()
        .click();
    };

    await runScenario(page, 'A idle (control, no action)', async () => {
      /* nothing happens; any reversal here is background noise */
    });

    // The pane menu's "split right" only parks an empty new-tab page beside the
    // note. Dragging the tab onto the pane's right edge is the operation that
    // actually moves the note into a pane of its own, which is what "open
    // something to the right" does.
    await runScenario(page, 'B drag the note tab to the right edge', async () => {
      const tab = page
        .locator('.workspace-pane .page-tab')
        .filter({ hasText: 'Nota B' })
        .first();
      const pane = page.locator('.workspace-pane').first();
      const box = (await pane.boundingBox())!;
      await tab.hover();
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
        steps: 8,
      });
      await page.mouse.move(box.x + box.width - 12, box.y + box.height * 0.5, {
        steps: 12,
      });
      await page.mouse.up();
      await expect(page.locator('.workspace-pane')).toHaveCount(2, {
        timeout: 10_000,
      });
      console.log(
        `[probe] editors mounted after split: ${await page
          .locator('.markdown-source__editor')
          .count()}`,
      );
    });

    await runScenario(page, 'C mode -> split (reading opens right)', () =>
      chooseMode('split'),
    );

    await runScenario(page, 'D back to edit mode', () => chooseMode('edit'));
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { force: true, recursive: true });
    await rm(projectParent, { force: true, recursive: true });
  }
});
