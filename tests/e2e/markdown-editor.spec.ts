import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
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
  addInstance: string;
  chooseLocation: string;
  create: string;
  edit: string;
  editor: string;
  name: string;
  newNote: string;
  note: string;
  newProject: string;
  projectName: string;
  reading: string;
  redo: string;
  split: string;
  undo: string;
}

function labelsFor(locale: string): Labels {
  return locale === 'en-US'
      ? {
        addInstance: 'Add instance',
        chooseLocation: 'Choose location',
        create: 'Create',
        edit: 'Edit',
        editor: 'Markdown editor',
        name: 'Name',
        newNote: 'New note',
        note: 'Note',
        newProject: 'New Project',
        projectName: 'Project name',
        reading: 'Reading',
        redo: 'Redo',
        split: 'Split',
        undo: 'Undo',
      }
      : {
        addInstance: 'Adicionar instância',
        chooseLocation: 'Escolher local',
        create: 'Criar',
        edit: 'Editar',
        editor: 'Editor Markdown',
        name: 'Nome',
        newNote: 'Nova nota',
        note: 'Nota',
        newProject: 'Novo Projeto',
        projectName: 'Nome do projeto',
        reading: 'Leitura',
        redo: 'Refazer',
        split: 'Dividido',
        undo: 'Desfazer',
      };
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

async function sourceOf(editor: ReturnType<Page['locator']>): Promise<string> {
  return editor.evaluate((root) =>
    [...root.querySelectorAll(':scope > .md-line')]
      .map(
        (line) =>
          line.querySelector(':scope > .md-line__content')?.textContent ?? '',
      )
      .join('\n'),
  );
}

async function doubleClickSourceText(
  page: Page,
  editor: ReturnType<Page['locator']>,
  target: string,
): Promise<void> {
  const point = await editor.evaluate((root, expected) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const index = node.textContent?.indexOf(expected) ?? -1;
      if (index >= 0 && !parent?.closest('[data-md-gutter]')) {
        parent?.closest('.md-line')?.scrollIntoView({ block: 'center' });
        const middle = index + Math.floor(expected.length / 2);
        const range = document.createRange();
        range.setStart(node, middle);
        range.setEnd(node, Math.min(middle + 1, node.textContent?.length ?? 0));
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    throw new Error(`Source text was not found: ${expected}`);
  }, target);

  await page.mouse.dblclick(point.x, point.y);
}

test('stabilizes Markdown editing, history, gutters and note zoom', async () => {
  test.setTimeout(90_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-md-e2e-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-md-project-'),
  );
  const canonicalParent = await realpath(projectParent);
  const projectName = 'Markdown E2E';
  const noteName = 'Engine';
  const projectRoot = path.join(canonicalParent, projectName);
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [
        appPath,
        ...(process.platform === 'linux' && process.env.CI
          ? ['--no-sandbox']
          : []),
      ],
      env: {
        ...process.env,
        FLYOFF_E2E: '1',
        FLYOFF_E2E_PROJECT_CREATE_PARENT: canonicalParent,
        FLYOFF_E2E_PROJECT_OPEN_ROOT: projectRoot,
        FLYOFF_E2E_USER_DATA: userDataPath,
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() =>
      ['pt-BR', 'en-US'].includes(document.documentElement.lang),
    );
    const labels = labelsFor(
      await page.evaluate(() => document.documentElement.lang),
    );

    await page.getByRole('button', { name: labels.newProject }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await dialog
      .getByRole('button', { name: labels.chooseLocation })
      .click();
    await expect(dialog.getByText(canonicalParent)).toBeVisible();
    await dialog.getByRole('button', { name: labels.create }).click();
    await page.getByRole('button', { name: labels.addInstance }).click();
    const instancePicker = page.getByRole('dialog', {
      name: labels.addInstance,
    });
    await expect(instancePicker).toBeVisible();
    await instancePicker
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    const nameInput = page.getByRole('textbox', { name: labels.name });
    await nameInput.fill(noteName);
    await nameInput.press('Enter');

    let editor = page.getByRole('textbox', { name: labels.editor });
    await editor.click();
    await page.keyboard.type('a');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect.poll(() => sourceOf(editor)).toBe('a\n\n');
    await page.keyboard.press('Backspace');
    await expect.poll(() => sourceOf(editor)).toBe('a\n');
    await page.keyboard.press('Backspace');
    await expect.poll(() => sourceOf(editor)).toBe('a');
    await editor.selectText();
    await page.keyboard.insertText('==uau==');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('[text](https://x.dev)');
    const sample = '==uau==\n[text](https://x.dev)';
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    await doubleClickSourceText(page, editor, 'text');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(
      'text',
    );
    await page.getByRole('button', { name: labels.split }).click();
    const reading = page.getByRole('document', { name: labels.reading });
    await expect(reading.locator('mark')).toHaveText('uau');
    await expect(reading.locator('br')).toHaveCount(1);
    await expect(reading.locator('a')).toHaveText('text');

    const notePath = path.join(projectRoot, `${noteName}.md`);
    await expect
      .poll(() => readFile(notePath, 'utf8').catch(() => ''))
      .toBe(sample);
    await page.getByRole('tab', { name: projectName }).click();
    await page.getByRole('tab', { name: noteName }).click();
    editor = page.getByRole('textbox', { name: labels.editor });
    await editor.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe('==uau==\n');
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    if (process.platform === 'darwin') {
      await app.evaluate(({ BrowserWindow, Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('editor.undo');
        const window = BrowserWindow.getAllWindows()[0];
        if (item && window) {
          item.click?.(item, window, {} as never);
        }
      });
    } else {
      await page.getByRole('menuitem', { name: labels.edit, exact: true }).click();
      await page
        .locator('.flyoff-menu')
        .getByRole('menuitem', { name: new RegExp(`^${labels.undo}`) })
        .click();
    }
    await expect.poll(() => sourceOf(editor)).toBe('==uau==\n');
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    const longLine = `long ${'wrapped '.repeat(100)}`;
    const layoutContent = [
      '# Heading',
      longLine,
      '',
      ...Array.from({ length: 998 }, (_, index) => `line ${index + 4}`),
    ].join('\n');
    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      layoutContent,
    );
    await editor.selectText();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+V' : 'Control+V',
    );
    await expect.poll(() => sourceOf(editor)).toBe(layoutContent);

    let currentScale = 1;
    for (const targetScale of [0.6, 1, 2, 2.6]) {
      const direction = targetScale > currentScale ? -100 : 100;
      const steps = Math.round(Math.abs(targetScale - currentScale) * 10);
      await editor.hover();
      await page.keyboard.down('Control');
      for (let index = 0; index < steps; index += 1) {
        await page.mouse.wheel(0, direction);
      }
      await page.keyboard.up('Control');
      currentScale = targetScale;
      await expect
        .poll(() =>
          page
            .locator('.workspace')
            .evaluate((element) =>
              Number(
                element.style.getPropertyValue('--md-scale'),
              ),
            ),
        )
        .toBe(targetScale);

      const metrics = await editor.evaluate((root) => {
        const line = root.querySelector<HTMLElement>('.md-line');
        const long = root.querySelector<HTMLElement>(
          '.md-line[data-line="2"]',
        );
        const content = line?.querySelector<HTMLElement>('.md-line__content');
        const gutter = line?.querySelector<HTMLElement>('.md-line__gutter');
        const view = document.querySelector<HTMLElement>('.markdown-view');
        const sourceStyle = getComputedStyle(root);
        const lineStyle = line ? getComputedStyle(line) : undefined;
        return {
          border: getComputedStyle(root.parentElement!).borderRightWidth,
          contentOffset:
            line && content
              ? content.getBoundingClientRect().left -
                line.getBoundingClientRect().left
              : 0,
          fontSize: Number.parseFloat(sourceStyle.fontSize),
          gutterFontSize: line
            ? Number.parseFloat(getComputedStyle(gutter!).fontSize)
            : 0,
          gutterLeft:
            line && gutter
              ? gutter.getBoundingClientRect().left -
                root.getBoundingClientRect().left
              : -1,
          gutterOverlap:
            gutter && content
              ? gutter.getBoundingClientRect().right >
                content.getBoundingClientRect().left
              : true,
          lastNumber:
            root.querySelector('.md-line:last-child')?.getAttribute('data-line'),
          lineCount: root.querySelectorAll(':scope > .md-line').length,
          lineHeight: lineStyle
            ? Number.parseFloat(lineStyle.lineHeight)
            : 0,
          longHeight: long?.getBoundingClientRect().height ?? 0,
          readingPadding: view
            ? Number.parseFloat(getComputedStyle(view).paddingLeft)
            : 0,
          readingFontFamily: view ? getComputedStyle(view).fontFamily : '',
          readingFontSize: view
            ? Number.parseFloat(getComputedStyle(view).fontSize)
            : 0,
          sourceFontFamily: sourceStyle.fontFamily,
          sourcePadding: Number.parseFloat(sourceStyle.paddingLeft),
        };
      });

      expect(metrics.fontSize).toBeCloseTo(15 * targetScale, 1);
      expect(metrics.gutterFontSize).toBeCloseTo(metrics.fontSize, 1);
      expect(metrics.readingFontSize).toBeCloseTo(metrics.fontSize, 1);
      expect(metrics.sourceFontFamily).toContain('Arial');
      expect(metrics.readingFontFamily).toBe(metrics.sourceFontFamily);
      expect(metrics.gutterLeft).toBeCloseTo(28, 1);
      expect(metrics.gutterOverlap).toBe(false);
      expect(metrics.contentOffset).toBeGreaterThan(28 + metrics.fontSize * 2);
      expect(metrics.sourcePadding).toBe(0);
      expect(metrics.readingPadding).toBeCloseTo(28 * targetScale, 1);
      expect(metrics.lineCount).toBe(1_001);
      expect(metrics.lastNumber).toBe('1001');
      expect(metrics.longHeight).toBeGreaterThan(metrics.lineHeight * 1.5);
      expect(metrics.border).toBe('1px');
    }

    await expect
      .poll(() => readFile(notePath, 'utf8').catch(() => ''))
      .toBe(layoutContent);
    await page.getByRole('tab', { name: projectName }).click();
    await page.getByRole('tab', { name: noteName }).click();
    editor = page.getByRole('textbox', { name: labels.editor });
    await editor.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(layoutContent);
    await doubleClickSourceText(page, editor, '1000');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(
      '1000',
    );
  } finally {
    await stopApplication(app);
    await rm(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await rm(projectParent, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
