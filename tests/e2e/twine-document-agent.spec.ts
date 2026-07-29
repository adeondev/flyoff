import {
  mkdtemp,
  readFile,
  realpath,
  rm,
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

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');

interface Labels {
  addInstance: string;
  approvalFull: string;
  approvalMode: string;
  chooseLocation: string;
  create: string;
  diagram: string;
  diagramClass: string;
  documentAgent: string;
  keyDialog: string;
  keyInput: string;
  name: string;
  newProject: string;
  note: string;
  projectName: string;
  saveKey: string;
  currentPage: string;
  twine: string;
  tools: string;
}

function labelsFor(locale: string): Labels {
  return locale === 'en-US'
    ? {
        addInstance: 'Add instance',
        approvalFull: 'Full access',
        approvalMode: 'Approval mode',
        chooseLocation: 'Choose location',
        create: 'Create',
        currentPage: 'Current page only',
        diagram: 'UML diagram',
        diagramClass: 'Class',
        documentAgent: 'Notes and diagrams',
        keyDialog: 'Connect Gemini',
        keyInput: 'Gemini API key',
        name: 'Name',
        newProject: 'New den',
        note: 'Note',
        projectName: 'Den name',
        saveKey: 'Save key',
        tools: 'Add and configure',
        twine: 'Twine',
      }
    : {
        addInstance: 'Adicionar instância',
        approvalFull: 'Acesso completo',
        approvalMode: 'Modo de aprovação',
        chooseLocation: 'Escolher local',
        create: 'Criar',
        currentPage: 'Somente a página atual',
        diagram: 'Diagrama UML',
        diagramClass: 'Classes',
        documentAgent: 'Notas e diagramas',
        keyDialog: 'Conectar Gemini',
        keyInput: 'API key do Gemini',
        name: 'Nome',
        newProject: 'Nova toca',
        note: 'Nota',
        projectName: 'Nome da toca',
        saveKey: 'Salvar chave',
        tools: 'Adicionar e configurar',
        twine: 'Twine',
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

async function sourceOf(editor: Locator): Promise<string> {
  return editor.evaluate((root) =>
    [...root.querySelectorAll(':scope > .md-line')]
      .map(
        (line) =>
          line.querySelector(':scope > .md-line__content')?.textContent ?? '',
      )
      .join('\n'),
  );
}

async function addNote(
  page: Page,
  labels: Labels,
  name: string,
): Promise<Locator> {
  await page.getByRole('button', { name: labels.addInstance }).click();
  await page
    .getByRole('dialog', { name: labels.addInstance })
    .getByRole('option', { name: new RegExp(`^${labels.note}`) })
    .click();
  const input = page.getByRole('textbox', { name: labels.name });
  await input.fill(name);
  await input.press('Enter');
  const editor = page.locator('.markdown-source__editor:visible');
  await expect(editor).toBeVisible();
  return editor;
}

async function addClassDiagram(
  page: Page,
  labels: Labels,
  name: string,
): Promise<void> {
  await page.getByRole('button', { name: labels.addInstance }).click();
  await page
    .getByRole('dialog', { name: labels.addInstance })
    .getByRole('option', { name: new RegExp(`^${labels.diagram}`) })
    .click();
  await page
    .getByRole('dialog', { name: /UML/i })
    .getByRole('button', { name: new RegExp(labels.diagramClass) })
    .click();
  const input = page.locator('.project-tree__inline-editor').getByRole(
    'textbox',
    { name: labels.name },
  );
  await input.fill(name);
  await input.press('Enter');
  await expect(
    page.getByRole('tabpanel', { name }).locator('.diagram-page'),
  ).toBeVisible();
}

async function configureTwine(
  page: Page,
  labels: Labels,
): Promise<void> {
  await page.getByRole('button', { name: labels.twine, exact: true }).click();
  const keyDialog = page.getByRole('dialog', { name: labels.keyDialog });
  await expect(keyDialog).toBeVisible();
  await keyDialog
    .getByRole('textbox', { name: labels.keyInput })
    .fill('flyoff-e2e-placeholder-key');
  await keyDialog.getByRole('button', { name: labels.saveKey }).click();
  await expect(keyDialog).toBeHidden();
  await expect(page.locator('.workspace-pane')).toHaveCount(2);

  await page.getByRole('button', { name: labels.tools }).click();
  await page
    .getByRole('menuitem', { name: labels.documentAgent })
    .click();
  await page
    .getByRole('menuitemcheckbox', { name: labels.currentPage })
    .click();

  await page
    .getByRole('button', { name: new RegExp(labels.approvalMode) })
    .click();
  await page
    .getByRole('menuitemcheckbox', { name: labels.approvalFull })
    .click();
}

async function sendTwineMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: /Twine/ });
  await input.fill(text);
  await input.press('Enter');
}

test('Twine edits notes and UML diagrams live through the secure document bridge', async () => {
  test.setTimeout(120_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-twine-e2e-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-twine-project-'),
  );
  const canonicalParent = await realpath(projectParent);
  const projectName = 'Twine Agent E2E';
  const projectRoot = path.join(canonicalParent, projectName);
  const noteName = 'Plano';
  const diagramName = 'Modelo de pedidos';
  const originalNote = '# Plano\n\nStatus: rascunho';
  const finalNote =
    '# Plano\n\nStatus: revisado pelo Twine\n\n## Próximo passo\n\nValidar a entrega automatizada.';
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
        FLYOFF_E2E_TWINE_MODEL_SCENARIO: 'document-live-edit',
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

    let editor = await addNote(page, labels, noteName);
    await editor.click();
    await page.keyboard.insertText(originalNote);
    await expect
      .poll(() =>
        readFile(path.join(projectRoot, `${noteName}.md`), 'utf8').catch(
          () => '',
        ),
      )
      .toBe(originalNote);

    await addClassDiagram(page, labels, diagramName);
    await page.getByRole('tab', { name: noteName }).click();
    editor = page.locator('.markdown-source__editor:visible');
    await configureTwine(page, labels);

    await editor.evaluate((root) => {
      const state = globalThis as typeof globalThis & {
        __twineNoteSnapshots?: string[];
      };
      const capture = () =>
        [...root.querySelectorAll(':scope > .md-line')]
          .map(
            (line) =>
              line.querySelector(':scope > .md-line__content')?.textContent ??
              '',
          )
          .join('\n');
      state.__twineNoteSnapshots = [capture()];
      new MutationObserver(() => {
        const next = capture();
        if (state.__twineNoteSnapshots?.at(-1) !== next) {
          state.__twineNoteSnapshots?.push(next);
        }
      }).observe(root, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    });

    await sendTwineMessage(page, 'Atualize esta nota.');
    await expect(page.getByText('Nota atualizada e salva.')).toBeVisible();
    await expect.poll(() => sourceOf(editor)).toBe(finalNote);
    const noteSnapshots = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __twineNoteSnapshots?: string[];
          }
        ).__twineNoteSnapshots ?? [],
    );
    expect(noteSnapshots).toContain(
      '# Plano\n\nStatus: revisado pelo Twine',
    );
    expect(noteSnapshots.at(-1)).toBe(finalNote);
    await expect
      .poll(() => readFile(path.join(projectRoot, `${noteName}.md`), 'utf8'))
      .toBe(finalNote);

    await editor.click();
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect.poll(() => sourceOf(editor)).toBe(originalNote);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect.poll(() => sourceOf(editor)).toBe(finalNote);

    await page.getByRole('tab', { name: diagramName }).click();
    const diagramPanel = page.getByRole('tabpanel', { name: diagramName });
    const canvas = diagramPanel.locator('.diagram-canvas');
    await canvas.evaluate((root) => {
      const state = globalThis as typeof globalThis & {
        __twineDiagramSnapshots?: Array<{
          elements: number;
          relationships: number;
        }>;
      };
      const capture = () => ({
        elements: new Set(
          [...root.querySelectorAll('[data-element-id]')].map((element) =>
            element.getAttribute('data-element-id'),
          ),
        ).size,
        relationships: new Set(
          [...root.querySelectorAll('[data-relationship-id]')].map(
            (relationship) =>
              relationship.getAttribute('data-relationship-id'),
          ),
        ).size,
      });
      state.__twineDiagramSnapshots = [capture()];
      new MutationObserver(() => {
        const next = capture();
        const previous = state.__twineDiagramSnapshots?.at(-1);
        if (
          previous?.elements !== next.elements ||
          previous.relationships !== next.relationships
        ) {
          state.__twineDiagramSnapshots?.push(next);
        }
      }).observe(root, { childList: true, subtree: true });
    });

    await sendTwineMessage(page, 'Crie as classes Cliente e Pedido.');
    await expect(page.getByText('Diagrama atualizado e salvo.')).toBeVisible();
    await expect(diagramPanel.locator('[data-element-id]')).toHaveCount(2);
    await expect(diagramPanel.locator('.diagram-node__name')).toHaveText([
      'Cliente',
      'Pedido',
    ]);
    await expect
      .poll(() =>
        diagramPanel
          .locator('[data-relationship-id]')
          .evaluateAll(
            (nodes) =>
              new Set(
                nodes.map((node) =>
                  node.getAttribute('data-relationship-id'),
                ),
              ).size,
          ),
      )
      .toBe(1);
    const diagramSnapshots = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __twineDiagramSnapshots?: Array<{
              elements: number;
              relationships: number;
            }>;
          }
        ).__twineDiagramSnapshots ?? [],
    );
    expect(diagramSnapshots).toContainEqual({
      elements: 1,
      relationships: 0,
    });
    expect(diagramSnapshots.at(-1)).toEqual({
      elements: 2,
      relationships: 1,
    });

    const diagramPath = path.join(projectRoot, `${diagramName}.flyd`);
    await expect
      .poll(async () => {
        const document = JSON.parse(await readFile(diagramPath, 'utf8')) as {
          elements: Array<{ id: string; name: string }>;
          relationships: Array<{
            sourceId: string;
            targetId: string;
          }>;
        };
        const elementIds = new Set(document.elements.map(({ id }) => id));
        return {
          names: document.elements.map(({ name }) => name),
          relationshipCount: document.relationships.length,
          validEndpoints: document.relationships.every(
            ({ sourceId, targetId }) =>
              elementIds.has(sourceId) && elementIds.has(targetId),
          ),
        };
      })
      .toEqual({
        names: ['Cliente', 'Pedido'],
        relationshipCount: 1,
        validEndpoints: true,
      });

    await canvas.click({ position: { x: 40, y: 40 } });
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
    );
    await expect(diagramPanel.locator('[data-element-id]')).toHaveCount(0);
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
    );
    await expect(diagramPanel.locator('[data-element-id]')).toHaveCount(2);

    const security = await page.evaluate(() => {
      const globalObject = globalThis as typeof globalThis & {
        electron?: unknown;
        process?: unknown;
        require?: unknown;
      };
      return {
        electron: typeof globalObject.electron,
        process: typeof globalObject.process,
        readFile: 'readFile' in window.flyoff,
        require: typeof globalObject.require,
        testModelControl: 'twineE2eModel' in window.flyoff,
      };
    });
    expect(security).toEqual({
      electron: 'undefined',
      process: 'undefined',
      readFile: false,
      require: 'undefined',
      testModelControl: false,
    });
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
