import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
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

import { serializeImageDirective } from '../../src/shared/markdown';
import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');

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

function largeMarkdownFixture(): string {
  const image = serializeImageDirective({
    align: 'left',
    alt: 'Performance image',
    assetId: '123e4567-e89b-42d3-a456-426614174000',
    caption: '',
    height: 180,
    instanceId: '223e4567-e89b-42d3-a456-426614174001',
    margin: 12,
    maxWidth: 1_200,
    minWidth: 96,
    mode: 'wrap',
    path: 'Media/performance.png',
    positionLock: false,
    ratioLock: true,
    version: 2,
    width: 320,
  });
  return Array.from({ length: 15_000 }, (_, index) => {
    if (index === 3) {
      return image;
    }
    if (index % 47 === 0) {
      return `## Section ${index}`;
    }
    return `Line ${index}: **Markdown**, ==highlight=={color=#8F4FC4}, [[Note|link]] and text.`;
  }).join('\n');
}

function checksum(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

interface ClipboardSummary {
  checksum: number;
  end: string;
  length: number;
  start: string;
}

function clipboardSummary(value: string): ClipboardSummary {
  return {
    checksum: checksum(value),
    end: value.slice(-32),
    length: value.length,
    start: value.slice(0, 32),
  };
}

async function readClipboardSummary(
  app: ElectronApplication,
): Promise<ClipboardSummary> {
  return app.evaluate(({ clipboard }) => {
    const value = clipboard.readText();
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return {
      checksum: hash >>> 0,
      end: value.slice(-32),
      length: value.length,
      start: value.slice(0, 32),
    };
  });
}

async function expectCompleteCopy(
  app: ElectronApplication,
  page: Page,
  input: Locator,
  expected: string,
): Promise<void> {
  await app.evaluate(
    ({ clipboard }, sentinel) => clipboard.writeText(sentinel),
    `__flyoff-copy-sentinel-${expected.length}__`,
  );
  await input.focus();
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
  );
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+C' : 'Control+C',
  );
  await expect
    .poll(() => readClipboardSummary(app), { timeout: 15_000 })
    .toEqual(clipboardSummary(expected));
}

test('keeps a 15k-line rich Markdown note responsive and fully editable', async () => {
  test.setTimeout(180_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-large-md-e2e-'),
  );
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-large-md-project-'),
  );
  const canonicalParent = await realpath(projectParent);
  const projectName = 'Large Markdown';
  const source = largeMarkdownFixture();
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
        FLYOFF_E2E_PROJECT_CREATE_PARENT: canonicalParent,
        FLYOFF_E2E_PROJECT_OPEN_ROOT: path.join(
          canonicalParent,
          projectName,
        ),
        FLYOFF_E2E_USER_DATA: userDataPath,
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() =>
      ['pt-BR', 'en-US'].includes(document.documentElement.lang),
    );
    const english =
      (await page.evaluate(() => document.documentElement.lang)) === 'en-US';
    const labels = english
      ? {
          add: 'Add instance',
          choose: 'Choose location',
          closePrefix: 'Close tab',
          create: 'Create',
          name: 'Name',
          newProject: 'New den',
          newTab: 'New tab',
          note: 'Note',
          projectName: 'Den name',
        }
      : {
          add: 'Adicionar instância',
          choose: 'Escolher local',
          closePrefix: 'Fechar aba',
          create: 'Criar',
          name: 'Nome',
          newProject: 'Nova toca',
          newTab: 'Nova aba',
          note: 'Nota',
          projectName: 'Nome da toca',
        };

    await page.getByRole('button', { name: labels.newProject }).click();
    const projectDialog = page.getByRole('dialog');
    await projectDialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await projectDialog
      .getByRole('button', { name: labels.choose })
      .click();
    await projectDialog
      .getByRole('button', { name: labels.create })
      .click();
    await page.getByRole('button', { name: labels.add }).click();
    await page
      .getByRole('dialog', { name: labels.add })
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    const noteName = 'Fifteen thousand lines';
    const nameInput = page.getByRole('textbox', { name: labels.name });
    await nameInput.fill(noteName);
    await nameInput.press('Enter');

    const editor = page.locator('.markdown-source__editor:visible');
    await expect(editor).toBeVisible();
    await app.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      source,
    );
    await editor.focus();
    const pasteStarted = await page.evaluate(() => performance.now());
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+V' : 'Control+V',
    );
    const pasteDispatched = await page.evaluate(() => performance.now());
    await expect(editor).toHaveAttribute('data-windowed', 'true', {
      timeout: 30_000,
    });
    const windowedReady = await page.evaluate(() => performance.now());
    const input = editor.locator('.source-window__input');
    await expect
      .poll(() => editor.getAttribute('data-source-length'), {
        timeout: 30_000,
      })
      .toBe(String(source.length));
    await expect
      .poll(() => editor.getAttribute('data-source-line-count'), {
        timeout: 30_000,
      })
      .toBe('15000');
    const pasteFinished = await page.evaluate(() => performance.now());
    const pasteTiming = {
      dispatch: pasteDispatched - pasteStarted,
      model: pasteFinished - windowedReady,
      promotion: windowedReady - pasteDispatched,
      total: pasteFinished - pasteStarted,
    };
    expect(pasteTiming.total, JSON.stringify(pasteTiming)).toBeLessThan(
      2_000,
    );

    await input.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+S' : 'Control+S',
    );
    await expect(page.locator('.markdown-editor__status')).toHaveCount(0);
    const notePath = path.join(
      canonicalParent,
      projectName,
      `${noteName}.md`,
    );
    await expect
      .poll(() => readFile(notePath, 'utf8').catch(() => ''))
      .toBe(source);
    await page
      .getByRole('button', {
        name: `${labels.closePrefix}: ${noteName}`,
      })
      .click();
    await expect(editor).toHaveCount(0);
    const reopenStarted = await page.evaluate(() => performance.now());
    await page
      .getByRole('tree', { name: /toca|den/iu })
      .getByRole('button', { exact: true, name: noteName })
      .click();
    await expect(editor).toHaveAttribute('data-windowed', 'true');
    await expect(editor).toHaveAttribute(
      'data-source-length',
      String(source.length),
    );
    const reopenDuration = await page.evaluate(
      (started) => performance.now() - started,
      reopenStarted,
    );
    expect(reopenDuration).toBeLessThan(2_000);

    const initial = await editor.evaluate((root) => ({
      elements: root.querySelectorAll('*').length,
      lines: root.querySelectorAll('.md-line').length,
      inputLength:
        root.querySelector<HTMLTextAreaElement>('.source-window__input')
          ?.value.length ?? 0,
      modelLength: Number(root.dataset.sourceLength),
    }));
    expect(initial.modelLength).toBe(source.length);
    expect(initial.inputLength).toBeLessThanOrEqual(8_192);
    expect(initial.lines).toBeGreaterThan(0);
    expect(initial.lines).toBeLessThanOrEqual(300);
    expect(initial.elements).toBeLessThan(3_000);

    await editor.evaluate((root) => {
      root.scrollTop = 0;
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const heading = editor.locator('.md-line[data-line="1"]');
    await expect(heading).toHaveClass(/md-line--heading/u);
    await expect(heading.locator('.md-tok-heading')).toHaveText('Section 0');
    const richLine = editor.locator('.md-line[data-line="2"]');
    const strong = richLine.locator('.md-tok-strong');
    await expect(strong).toContainText('Markdown');
    await expect
      .poll(() =>
        strong.evaluate((element) => getComputedStyle(element).fontWeight),
      )
      .toBe('700');
    const colored = richLine.locator('.md-source-colored-highlight');
    await expect
      .poll(() =>
        colored.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .toBe('rgb(143, 79, 196)');
    const colorTrigger = richLine.locator(
      '.md-inline-color-trigger[data-md-color-value="#8F4FC4"]',
    );
    await expect(colorTrigger).toHaveAttribute(
      'data-md-color-value',
      '#8F4FC4',
    );
    const sourceImage = editor.locator(
      '.md-line[data-line="4"] .md-source-image',
    );
    await expect(sourceImage).toHaveCount(1);
    await expect(sourceImage).toHaveAttribute('data-image-mode', 'wrap');
    const imageHost = sourceImage.locator('.md-source-image__host');
    await expect(imageHost).toBeVisible();
    await expect(imageHost).toHaveAttribute(
      'aria-label',
      'Performance image',
    );
    const imageBounds = await imageHost.boundingBox();
    expect(imageBounds?.width ?? 0).toBeGreaterThan(100);
    expect(imageBounds?.height ?? 0).toBeGreaterThan(100);

    const profiler = process.env.FLYOFF_PROFILE_SCROLL
      ? await page.context().newCDPSession(page)
      : undefined;
    if (profiler) {
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.start');
    }
    const scroll = await editor.evaluate(async (root) => {
      const durations: number[] = [];
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((entries) => {
        longTasks.push(...entries.getEntries().map(({ duration }) => duration));
      });
      observer.observe({ entryTypes: ['longtask'] });
      const heightBefore = root.scrollHeight;
      const distance = Math.max(1, root.scrollHeight - root.clientHeight);
      let maximumLines = 0;
      let previous = performance.now();
      for (let index = 1; index <= 180; index += 1) {
        root.scrollTop = (distance * index) / 180;
        root.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const current = performance.now();
        durations.push(current - previous);
        previous = current;
        maximumLines = Math.max(
          maximumLines,
          root.querySelectorAll('.md-line').length,
        );
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      longTasks.push(
        ...observer.takeRecords().map(({ duration }) => duration),
      );
      observer.disconnect();
      const sorted = [...durations].sort((left, right) => left - right);
      return {
        heightAfter: root.scrollHeight,
        heightBefore,
        lines: root.querySelectorAll('.md-line').length,
        longTasks,
        maximum: Math.max(...durations),
        maximumLines,
        p95:
          sorted[
            Math.min(
              sorted.length - 1,
              Math.ceil(sorted.length * 0.95) - 1,
            )
          ] ?? 0,
      };
    });
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await writeFile(
        path.join(repositoryRoot, 'test-results', 'scroll-profile.json'),
        JSON.stringify(profile),
        'utf8',
      );
      const samples = profile.samples ?? [];
      const deltas = profile.timeDeltas ?? [];
      const times = new Map<number, number>();
      for (let index = 0; index < samples.length; index += 1) {
        const nodeId = samples[index]!;
        times.set(nodeId, (times.get(nodeId) ?? 0) + (deltas[index] ?? 0));
      }
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      console.log(
        'scroll profile',
        [...times]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 20)
          .map(([nodeId, microseconds]) => {
            const frame = nodes.get(nodeId)?.callFrame;
            return {
              function: frame?.functionName,
              line: (frame?.lineNumber ?? -1) + 1,
              milliseconds: microseconds / 1_000,
              url: frame?.url,
            };
          }),
      );
      await profiler.detach();
    }
    expect(scroll.lines).toBeLessThanOrEqual(300);
    expect(scroll.maximumLines).toBeLessThanOrEqual(300);
    expect(
      Math.abs(scroll.heightAfter - scroll.heightBefore) /
        Math.max(1, scroll.heightBefore),
    ).toBeLessThan(0.005);
    expect(scroll.p95, JSON.stringify(scroll)).toBeLessThan(25);
    expect(scroll.maximum, JSON.stringify(scroll)).toBeLessThan(50);
    expect(scroll.longTasks, JSON.stringify(scroll)).toEqual([]);

    const settledViewport = await editor.evaluate(async (root) => {
      const frames = async (count: number) => {
        for (let index = 0; index < count; index += 1) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
      };
      root.scrollTop =
        (root.scrollHeight - root.clientHeight) * 0.63;
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
      await frames(2);
      const bounds = root.getBoundingClientRect();
      const visible = [...root.querySelectorAll<HTMLElement>('.md-line')].find(
        (line) => {
          const lineBounds = line.getBoundingClientRect();
          return (
            lineBounds.bottom > bounds.top &&
            lineBounds.top < bounds.bottom
          );
        },
      );
      const line = visible?.dataset.line ?? '';
      const beforeTop = visible
        ? visible.getBoundingClientRect().top - bounds.top
        : Number.NaN;
      const beforeScrollTop = root.scrollTop;
      await new Promise((resolve) => setTimeout(resolve, 140));
      await frames(2);
      const after = root.querySelector<HTMLElement>(
        `.md-line[data-line="${line}"]`,
      );
      return {
        afterScrollTop: root.scrollTop,
        afterTop: after
          ? after.getBoundingClientRect().top -
            root.getBoundingClientRect().top
          : Number.NaN,
        beforeScrollTop,
        beforeTop,
        line,
      };
    });
    expect(settledViewport.line).not.toBe('');
    expect(
      Math.abs(
        settledViewport.afterScrollTop -
          settledViewport.beforeScrollTop,
      ),
      JSON.stringify(settledViewport),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(settledViewport.afterTop - settledViewport.beforeTop),
      JSON.stringify(settledViewport),
    ).toBeLessThanOrEqual(1);

    const tabScrollTop = settledViewport.afterScrollTop;
    await editor.evaluate((root) => {
      root.dispatchEvent(new Event('scrollend', { bubbles: true }));
    });
    for (let index = 0; index < 3; index += 1) {
      await page
        .getByRole('button', { exact: true, name: labels.newTab })
        .click();
      await page
        .getByRole('tab', { exact: true, name: noteName })
        .dispatchEvent('click');
      await expect(editor).toBeVisible();
      await expect
        .poll(async () =>
          Math.abs(
            (await editor.evaluate((root) => root.scrollTop)) -
              tabScrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
    }

    await editor.evaluate(async (root) => {
      root.scrollTop = root.scrollHeight;
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve()),
        ),
      );
    });
    await expect(
      editor.locator('.md-line[data-line="15000"]'),
    ).toBeAttached();

    await input.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End',
    );
    await editor.evaluate(
      (root, expectedLength) => {
        const metrics = window as typeof window & {
          __flyoffLargeNoteEditLatency?: number;
        };
        metrics.__flyoffLargeNoteEditLatency = undefined;
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (
            root.getAttribute('data-source-length') === expectedLength &&
            root.getAttribute('data-source-line-count') === '15001'
          ) {
            metrics.__flyoffLargeNoteEditLatency =
              performance.now() - started;
            observer.disconnect();
          }
        });
        observer.observe(root, {
          attributeFilter: [
            'data-source-length',
            'data-source-line-count',
          ],
        });
      },
      String(source.length + 11),
    );
    await page.keyboard.insertText('\nfinal edit');
    await expect
      .poll(() => editor.getAttribute('data-source-length'))
      .toBe(String(source.length + 11));
    await expect
      .poll(() => editor.getAttribute('data-source-line-count'))
      .toBe('15001');
    const editLatency = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __flyoffLargeNoteEditLatency?: number;
          }
        ).__flyoffLargeNoteEditLatency,
    );
    expect(editLatency).toBeDefined();
    expect(editLatency ?? Number.POSITIVE_INFINITY).toBeLessThan(100);
    const finalLine = editor.locator('.md-line[data-line="15001"]');
    await expect(finalLine.locator('.md-line__content')).toHaveText(
      'final edit',
    );
    const expected = `${source}\nfinal edit`;
    await expectCompleteCopy(app, page, input, expected);

    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect
      .poll(() => editor.getAttribute('data-source-length'))
      .toBe(String(source.length));
    await expect
      .poll(() => editor.getAttribute('data-source-line-count'))
      .toBe('15000');
    await expect(finalLine).toHaveCount(0);
    await expectCompleteCopy(app, page, input, source);

    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect
      .poll(() => editor.getAttribute('data-source-length'))
      .toBe(String(source.length + 11));
    await expect
      .poll(() => editor.getAttribute('data-source-line-count'))
      .toBe('15001');
    await expect(finalLine.locator('.md-line__content')).toHaveText(
      'final edit',
    );
    await expectCompleteCopy(app, page, input, expected);
    console.info(
      'large-markdown-performance',
      JSON.stringify({
        editLatency,
        pasteTiming,
        reopenDuration,
        scroll,
      }),
    );
  } finally {
    await stopApplication(app);
    await rm(userDataPath, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
    await rm(projectParent, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});
