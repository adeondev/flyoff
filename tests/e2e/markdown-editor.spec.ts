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
  type Page,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');

interface Labels {
  addInstance: string;
  chooseLocation: string;
  collapseToolbar: string;
  copyAddress: string;
  create: string;
  duplicateLine: string;
  edit: string;
  editor: string;
  editorModeMenu: string;
  expandToolbar: string;
  findReferences: string;
  goToDefinition: string;
  line: string;
  linkPreview: string;
  name: string;
  newNote: string;
  note: string;
  newProject: string;
  projectName: string;
  reading: string;
  redo: string;
  rename: string;
  renameSymbol: string;
  replaceOccurrences: string;
  split: string;
  peekDefinition: string;
  unmarkTask: string;
  undo: string;
}

function labelsFor(locale: string): Labels {
  return locale === 'en-US'
      ? {
        addInstance: 'Add instance',
        chooseLocation: 'Choose location',
        collapseToolbar: 'Collapse formatting toolbar',
        copyAddress: 'Copy address',
        create: 'Create',
        duplicateLine: 'Duplicate line',
        edit: 'Edit',
        editor: 'Markdown editor',
        editorModeMenu: 'Note options',
        expandToolbar: 'Show formatting toolbar',
        findReferences: 'Find references',
        goToDefinition: 'Go to definition',
        line: 'Line',
        linkPreview: 'Preview',
        name: 'Name',
        newNote: 'New note',
        note: 'Note',
        newProject: 'New den',
        projectName: 'Den name',
        reading: 'Reading',
        redo: 'Redo',
        rename: 'Rename',
        renameSymbol: 'Rename symbol',
        replaceOccurrences: 'Change links in this note',
        split: 'Split',
        peekDefinition: 'Peek',
        unmarkTask: 'Unmark task',
        undo: 'Undo',
      }
      : {
        addInstance: 'Adicionar instância',
        chooseLocation: 'Escolher local',
        copyAddress: 'Copiar endereço',
        collapseToolbar: 'Recolher barra de formata\u00e7\u00e3o',
        create: 'Criar',
        duplicateLine: 'Duplicar linha',
        edit: 'Editar',
        expandToolbar: 'Mostrar barra de formata\u00e7\u00e3o',
        editor: 'Editor Markdown',
        editorModeMenu: 'Op\u00e7\u00f5es da nota',
        findReferences: 'Localizar refer\u00eancias',
        goToDefinition: 'Ir para defini\u00e7\u00e3o',
        line: 'Linha',
        linkPreview: 'Pr\u00e9-visualiza\u00e7\u00e3o',
        name: 'Nome',
        newNote: 'Nova nota',
        note: 'Nota',
        newProject: 'Nova toca',
        projectName: 'Nome da toca',
        reading: 'Leitura',
        redo: 'Refazer',
        rename: 'Renomear',
        renameSymbol: 'Renomear s\u00edmbolo',
        replaceOccurrences: 'Alterar links nesta nota',
        split: 'Dividido',
        peekDefinition: 'Espiar',
        unmarkTask: 'Desmarcar tarefa',
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

async function sourceTextPoint(
  editor: ReturnType<Page['locator']>,
  target: string,
): Promise<{ x: number; y: number }> {
  return editor.evaluate((root, expected) => {
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
}

async function clickSourceText(
  page: Page,
  editor: ReturnType<Page['locator']>,
  target: string,
  clickCount: 2 | 3,
): Promise<void> {
  const point = await sourceTextPoint(editor, target);
  await page.mouse.click(point.x, point.y, { clickCount });
}

async function addMarkdownNote(
  page: Page,
  labels: Labels,
  name: string,
): Promise<ReturnType<Page['locator']>> {
  await page.getByRole('button', { name: labels.addInstance }).click();
  await page
    .getByRole('dialog', { name: labels.addInstance })
    .getByRole('option', { name: new RegExp(`^${labels.note}`) })
    .click();
  const nameInput = page.getByRole('textbox', { name: labels.name });
  await nameInput.fill(name);
  await nameInput.press('Enter');
  await expect(page.getByRole('tab', { name })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const editor = page.locator('.markdown-source__editor:visible');
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  return editor;
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
    await writeFile(
      path.join(userDataPath, 'preferences.json'),
      JSON.stringify({
        general: {
          focusEditorOnOpen: false,
        },
      }),
      'utf8',
    );
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

    let editor = page.locator('.markdown-source__editor:visible');
    await expect(editor).not.toBeFocused();
    await expect(editor.locator(':scope > .md-line')).toHaveCount(1);
    await expect(editor.locator('[data-md-gutter]')).toHaveText('1');
    await expect(editor.locator('[data-md-placeholder]')).toHaveCount(1);

    const toolbarRegion = () =>
      page
        .getByRole('tabpanel')
        .locator('.markdown-editor__toolbar-region');
    await page
      .getByRole('button', { name: labels.collapseToolbar })
      .click();
    await expect(toolbarRegion()).toHaveAttribute('data-collapsed', 'true');

    await page.getByRole('button', { name: labels.addInstance }).click();
    await page
      .getByRole('dialog', { name: labels.addInstance })
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    const syncedNoteName = 'Toolbar sync';
    const syncedNameInput = page.getByRole('textbox', {
      name: labels.name,
    });
    await syncedNameInput.fill(syncedNoteName);
    await syncedNameInput.press('Enter');
    await expect(toolbarRegion()).toHaveAttribute('data-collapsed', 'true');

    await page.getByRole('tab', { name: noteName }).click();
    await expect(toolbarRegion()).toHaveAttribute('data-collapsed', 'true');
    await page
      .getByRole('button', { name: labels.expandToolbar })
      .click();
    await expect(toolbarRegion()).not.toHaveAttribute('data-collapsed');
    await page.getByRole('tab', { name: syncedNoteName }).click();
    await expect(toolbarRegion()).not.toHaveAttribute('data-collapsed');
    await page.getByRole('tab', { name: noteName }).click();

    const shelfGeometry = await page
      .getByRole('tabpanel')
      .locator('.markdown-editor__shelf-frame')
      .evaluate((frame) => {
        const outlines = frame.querySelectorAll<SVGGeometryElement>(
          '.markdown-editor__shelf-outline',
        );
        const curve = outlines[0];
        const curveLength = curve?.getTotalLength() ?? 0;
        const start = curve?.getPointAtLength(0);
        const end = curve?.getPointAtLength(curveLength);
        return {
          curveEnd: end ? { x: end.x, y: end.y } : undefined,
          curveStart: start ? { x: start.x, y: start.y } : undefined,
          lowerStart: {
            x: outlines[2]?.getAttribute('x1'),
            y: outlines[2]?.getAttribute('y1'),
          },
          upperStart: {
            x: outlines[1]?.getAttribute('x1'),
            y: outlines[1]?.getAttribute('y1'),
          },
        };
      });
    expect(shelfGeometry).toMatchObject({
      curveEnd: { x: 0.5, y: 25.5 },
      curveStart: { x: 24, y: 0.5 },
      lowerStart: { x: '.5', y: '25.5' },
      upperStart: { x: '24', y: '.5' },
    });

    await editor.click();
    await page.keyboard.type('a');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect.poll(() => sourceOf(editor)).toBe('a\n\n');
    await editor.press('Backspace');
    await expect.poll(() => sourceOf(editor)).toBe('a\n');
    await editor.press('Backspace');
    await expect.poll(() => sourceOf(editor)).toBe('a');
    await editor.selectText();
    await page.keyboard.insertText('==uau==');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('[text](https://x.dev)');
    const sample = '==uau==\n[text](https://x.dev)';
    await expect.poll(() => sourceOf(editor)).toBe(sample);
    await editor.locator('.md-source-link').click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: labels.copyAddress })
      .click();
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe('https://x.dev');

    await clickSourceText(page, editor, 'text', 2);
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(
      'text',
    );
    await editor.evaluate((root) => {
      const editorElement = root as HTMLElement;
      const recordTripleMouseDown = (event: MouseEvent): void => {
        if (event.detail !== 3) {
          return;
        }
        editorElement.dataset.tripleMouseDownDefaultPrevented = String(
          event.defaultPrevented,
        );
        editorElement.removeEventListener(
          'mousedown',
          recordTripleMouseDown,
        );
      };
      editorElement.addEventListener('mousedown', recordTripleMouseDown);
    });
    await clickSourceText(page, editor, 'text', 3);
    await expect
      .poll(() =>
        editor.getAttribute('data-triple-mouse-down-default-prevented'),
      )
      .toBe('true');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(
      '[text](https://x.dev)',
    );
    await page
      .getByRole('button', { name: labels.editorModeMenu })
      .click();
    await page
      .getByRole('menuitemcheckbox', { name: labels.split })
      .click();
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
    await expect(editor).not.toBeFocused();
    await editor.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe('==uau==\n');
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    await expect(
      page.getByRole('menuitem', { name: labels.edit, exact: true }),
    ).toHaveCount(0);
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('editor.undo');
      const window = BrowserWindow.getAllWindows()[0];
      if (item && window) {
        item.click?.(item, window, {} as never);
      }
    });
    await expect.poll(() => sourceOf(editor)).toBe('==uau==\n');
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
    const documentStart =
      process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
    const documentEnd =
      process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    const lineEnd =
      process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
    const selectDocumentStart =
      process.platform === 'darwin'
        ? 'Meta+Shift+ArrowUp'
        : 'Control+Shift+Home';
    const selectDocumentEnd =
      process.platform === 'darwin'
        ? 'Meta+Shift+ArrowDown'
        : 'Control+Shift+End';
    const selectLineStart =
      process.platform === 'darwin'
        ? 'Meta+Shift+ArrowLeft'
        : 'Shift+Home';
    const selectLineEnd =
      process.platform === 'darwin'
        ? 'Meta+Shift+ArrowRight'
        : 'Shift+End';
    const selectWordForward =
      process.platform === 'darwin'
        ? 'Alt+Shift+ArrowRight'
        : 'Control+Shift+ArrowRight';
    const selectWordBackward =
      process.platform === 'darwin'
        ? 'Alt+Shift+ArrowLeft'
        : 'Control+Shift+ArrowLeft';
    const deleteWordBackward =
      process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace';
    const undo = `${primary}+Z`;
    const commandContent = 'alpha beta\ngamma delta\nomega';

    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      commandContent,
    );
    await editor.selectText();
    await page.keyboard.press(`${primary}+V`);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    await page.keyboard.press(`${primary}+A`);
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe(commandContent);

    await page.keyboard.press(documentStart);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe('a');

    await page.keyboard.press(documentStart);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press(`${primary}+C`);
    await expect
      .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('alpha');

    await page.keyboard.press(documentEnd);
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press(`${primary}+C`);
    await expect
      .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('omega');

    await page.keyboard.press(documentStart);
    await page.keyboard.press(selectLineEnd);
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe('alpha beta');

    await page.keyboard.press(documentStart);
    await page.keyboard.press(lineEnd);
    await page.keyboard.press(selectLineStart);
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe('alpha beta');

    await page.keyboard.press(documentStart);
    await page.keyboard.press(selectWordForward);
    await page.keyboard.press(`${primary}+C`);
    await expect
      .poll(async () =>
        (await app!.evaluate(({ clipboard }) => clipboard.readText())).trim(),
      )
      .toBe('alpha');

    await page.keyboard.press(documentStart);
    await page.keyboard.press(lineEnd);
    await page.keyboard.press(selectWordBackward);
    await page.keyboard.press(`${primary}+C`);
    await expect
      .poll(async () =>
        (await app!.evaluate(({ clipboard }) => clipboard.readText())).trim(),
      )
      .toBe('beta');

    await page.keyboard.press(documentStart);
    await page.keyboard.press(selectDocumentEnd);
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe(commandContent);

    await page.keyboard.press(documentEnd);
    await page.keyboard.press(selectDocumentStart);
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() =>
      app!.evaluate(({ clipboard }) => clipboard.readText()),
    ).toBe(commandContent);

    await page.keyboard.press(documentStart);
    await page.keyboard.press('Delete');
    await expect.poll(() => sourceOf(editor)).toBe(commandContent.slice(1));
    await page.keyboard.press(undo);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    await page.keyboard.press(documentEnd);
    await page.keyboard.press('Backspace');
    await expect.poll(() => sourceOf(editor)).toBe(commandContent.slice(0, -1));
    await page.keyboard.press(undo);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    await page.keyboard.press(documentEnd);
    await page.keyboard.press(deleteWordBackward);
    await expect.poll(() => sourceOf(editor)).toBe(
      commandContent.slice(0, -'omega'.length),
    );
    await page.keyboard.press(undo);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    if (process.platform !== 'darwin') {
      await page.keyboard.press(documentStart);
      await page.keyboard.press('Control+Delete');
      await expect.poll(() => sourceOf(editor)).toBe(
        commandContent.slice('alpha'.length),
      );
      await page.keyboard.press(undo);
      await expect.poll(() => sourceOf(editor)).toBe(commandContent);
    }

    await page.keyboard.press(documentStart);
    await page.keyboard.press('Enter');
    await expect.poll(() => sourceOf(editor)).toBe(`\n${commandContent}`);
    await page.keyboard.press(undo);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    await page.keyboard.press(documentStart);
    await page.keyboard.press(selectWordForward);
    await page.keyboard.press(`${primary}+X`);
    await expect
      .poll(async () =>
        (await app!.evaluate(({ clipboard }) => clipboard.readText())).trim(),
      )
      .toBe('alpha');
    expect(await sourceOf(editor)).not.toBe(commandContent);
    await page.keyboard.press(`${primary}+V`);
    await expect.poll(() => sourceOf(editor)).toBe(commandContent);

    await editor.focus();
    await page.keyboard.press('Tab');
    await expect(editor).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(editor).toBeFocused();

    const dragStart = await sourceTextPoint(editor, 'alpha');
    const dragEnd = await sourceTextPoint(editor, 'delta');
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString() ?? ''))
      .toContain('gamma');

    await page.mouse.click(dragStart.x, dragStart.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(dragEnd.x, dragEnd.y);
    await page.keyboard.up('Shift');
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString() ?? ''))
      .toContain('gamma');

    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      sample,
    );
    await editor.selectText();
    await page.keyboard.press(`${primary}+V`);
    await expect.poll(() => sourceOf(editor)).toBe(sample);

    await app.evaluate(
      ({ clipboard }) => clipboard.writeText('- [x] done'),
    );
    await expect
      .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('- [x] done');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        ),
    );
    await editor.selectText();
    await page.keyboard.press(`${primary}+V`);
    await expect.poll(() => sourceOf(editor)).toBe('- [x] done');
    let task = editor.locator('.md-tok-task--checked');
    await expect(task).toHaveCount(1);
    await expect(task.locator('.md-tok-task__box')).toHaveCSS(
      'border-style',
      'solid',
    );

    await task.click({ button: 'right' });
    await page.getByRole('menuitem', { name: labels.line }).click();
    await page
      .getByRole('menuitem', { name: labels.duplicateLine })
      .click();
    await expect.poll(() => sourceOf(editor)).toBe(
      '- [x] done\n- [x] done',
    );

    task = editor.locator('.md-tok-task--checked').first();
    await task.click({ button: 'right' });
    const toggleTask = page.getByRole('menuitemcheckbox', {
      name: labels.unmarkTask,
    });
    await expect(toggleTask).toHaveAttribute('aria-checked', 'true');
    await toggleTask.click();
    await expect.poll(() => sourceOf(editor)).toBe(
      '- [ ] done\n- [x] done',
    );

    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      sample,
    );
    await editor.selectText();
    await page.keyboard.press(`${primary}+V`);
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

    await editor.focus();
    await page.keyboard.press(documentStart);
    await expect.poll(() => editor.evaluate((root) => root.scrollTop)).toBe(0);
    await editor.hover();
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => editor.evaluate((root) => root.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press(documentStart);
    await expect.poll(() => editor.evaluate((root) => root.scrollTop)).toBe(0);
    await page.keyboard.press('PageDown');
    await expect
      .poll(() => editor.evaluate((root) => root.scrollTop))
      .toBeGreaterThan(0);
    const pageDownScroll = await editor.evaluate((root) => root.scrollTop);
    await page.keyboard.press('PageUp');
    await expect
      .poll(() => editor.evaluate((root) => root.scrollTop))
      .toBeLessThan(pageDownScroll);

    await editor.evaluate((root) => {
      root.scrollTop = (root.scrollHeight - root.clientHeight) * 0.45;
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect
      .poll(async () => {
        const [sourceRatio, readingRatio] = await Promise.all([
          editor.evaluate(
            (root) =>
              root.scrollTop /
              Math.max(1, root.scrollHeight - root.clientHeight),
          ),
          reading.evaluate(
            (root) =>
              root.scrollTop /
              Math.max(1, root.scrollHeight - root.clientHeight),
          ),
        ]);
        return Math.abs(sourceRatio - readingRatio);
      })
      .toBeLessThan(0.03);

    await reading.evaluate((root) => {
      root.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      root.scrollTop = 12;
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await reading.evaluate((root) => root.scrollTop)).toBe(12);
    await editor.evaluate((root) => {
      root.scrollTop = (root.scrollHeight - root.clientHeight) * 0.8;
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect
      .poll(async () => {
        const [sourceRatio, readingRatio] = await Promise.all([
          editor.evaluate(
            (root) =>
              root.scrollTop /
              Math.max(1, root.scrollHeight - root.clientHeight),
          ),
          reading.evaluate(
            (root) =>
              root.scrollTop /
              Math.max(1, root.scrollHeight - root.clientHeight),
          ),
        ]);
        return Math.abs(sourceRatio - readingRatio);
      })
      .toBeLessThan(0.03);

    const scrollbar = await editor.evaluate((root) => ({
      button: getComputedStyle(root, '::-webkit-scrollbar-button').display,
      thumb: getComputedStyle(root, '::-webkit-scrollbar-thumb')
        .backgroundColor,
      track: getComputedStyle(root, '::-webkit-scrollbar-track')
        .backgroundColor,
    }));
    expect(scrollbar.button).toBe('none');
    expect(scrollbar.thumb).not.toBe('rgba(0, 0, 0, 0)');
    expect(scrollbar.track).toBe('rgba(0, 0, 0, 0)');

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
      expect(metrics.gutterLeft).toBeCloseTo(28 * targetScale, 1);
      expect(metrics.gutterOverlap).toBe(false);
      expect(metrics.contentOffset).toBeGreaterThan(
        28 * targetScale + metrics.fontSize * 2,
      );
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
    await expect(editor).not.toBeFocused();
    await editor.focus();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe(sample);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(layoutContent);
    await clickSourceText(page, editor, '1000', 2);
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

test('navigates, previews and rewrites internal note links', async () => {
  test.setTimeout(90_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-links-e2e-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-links-project-'),
  );
  const canonicalParent = await realpath(projectParent);
  const projectName = 'Links E2E';
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
    const projectDialog = page.getByRole('dialog');
    await projectDialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await projectDialog
      .getByRole('button', { name: labels.chooseLocation })
      .click();
    await projectDialog.getByRole('button', { name: labels.create }).click();

    let editor = await addMarkdownNote(page, labels, 'Target');
    const targetContent = '# Parent\n\n## Child\n\nTarget body';
    await editor.click();
    await page.keyboard.insertText(targetContent);
    await expect
      .poll(() =>
        readFile(path.join(projectRoot, 'Target.md'), 'utf8').catch(() => ''),
      )
      .toBe(targetContent);

    editor = await addMarkdownNote(page, labels, 'Other');
    await editor.click();
    await page.keyboard.insertText('# Other');
    await expect
      .poll(() =>
        readFile(path.join(projectRoot, 'Other.md'), 'utf8').catch(() => ''),
      )
      .toBe('# Other');

    editor = await addMarkdownNote(page, labels, 'Source');
    const sourceContent =
      '[go](Target.md#Parent#Child)\n[[Target#Parent#Child|wiki]]';
    await editor.click();
    await page.keyboard.insertText(sourceContent);
    await expect
      .poll(() =>
        readFile(path.join(projectRoot, 'Source.md'), 'utf8').catch(() => ''),
      )
      .toBe(sourceContent);

    await editor.locator('.md-source-link').first().click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: labels.peekDefinition })
      .click();
    const preview = page.getByRole('dialog', { name: labels.linkPreview });
    await expect(preview).toContainText('Target body');
    await expect(
      page.getByRole('tab', { name: 'Source' }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');

    await editor.locator('.md-source-link').first().click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: labels.goToDefinition })
      .click();
    await expect(
      page.getByRole('tab', { name: 'Target' }),
    ).toHaveAttribute('aria-selected', 'true');
    editor = page.locator('.markdown-source__editor:visible');
    await expect.poll(() => sourceOf(editor)).toBe(targetContent);

    await page.getByRole('tab', { name: 'Source' }).click();
    editor = page.locator('.markdown-source__editor:visible');
    await editor.locator('.md-source-link').first().click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: labels.findReferences })
      .click();
    const backlinks = page.getByRole('dialog', {
      name: new RegExp('Target'),
    });
    await expect(backlinks).toContainText('/Source:1:1');
    await expect(backlinks).toContainText('/Source:2:1');
    await page.keyboard.press('Escape');

    await editor.locator('.md-source-link').first().click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: labels.renameSymbol })
      .click();
    const renameDialog = page.getByRole('dialog');
    const renameInput = renameDialog.getByRole('textbox', {
      name: labels.name,
    });
    await renameInput.fill('Renamed');
    await renameDialog
      .getByRole('button', { name: labels.rename })
      .click();
    const renamedContent =
      '[go](Renamed.md#Parent#Child)\n[[Renamed#Parent#Child|wiki]]';
    await expect.poll(() => sourceOf(editor)).toBe(renamedContent);
    await expect
      .poll(() =>
        readFile(path.join(projectRoot, 'Renamed.md'), 'utf8').catch(() => ''),
      )
      .toBe(targetContent);

    const firstLink = await sourceTextPoint(editor, 'Renamed.md');
    await page.mouse.click(firstLink.x, firstLink.y);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+F2' : 'Control+F2',
    );
    const replaceDialog = page.getByRole('dialog', {
      name: labels.replaceOccurrences,
    });
    await replaceDialog.getByRole('button', { name: /Other/ }).click();
    const replacedContent =
      '[go](Other.md#Parent#Child)\n[[Other#Parent#Child|wiki]]';
    await expect.poll(() => sourceOf(editor)).toBe(replacedContent);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe(renamedContent);
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
