import {
  access,
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

import { createDiagramDocument } from '../../src/shared/diagram';
import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');

interface DiagramLabels {
  addInstance: string;
  chooseLocation: string;
  create: string;
  diagram: string;
  diagramTypes: Record<'class' | 'use-case' | 'sequence' | 'activity', string>;
  addPartitionRight: string;
  elementClass: string;
  elementPartition: string;
  exportDiagram: string;
  fileActions: string;
  fitView: string;
  importDiagram: string;
  importSelected: string;
  name: string;
  newProject: string;
  projectName: string;
  reload: string;
}

function labelsFor(locale: string): DiagramLabels {
  return locale === 'en-US'
    ? {
        addInstance: 'Add instance',
        chooseLocation: 'Choose location',
        create: 'Create',
        diagram: 'UML diagram',
        diagramTypes: {
          class: 'Class',
          'use-case': 'Use case',
          sequence: 'Sequence',
          activity: 'Activity',
        },
        addPartitionRight: 'Add partition to the right',
        elementClass: 'Class',
        elementPartition: 'Partition',
        exportDiagram: 'Export diagram',
        fileActions: 'Import and export',
        fitView: 'Fit to view',
        importDiagram: 'Import diagram',
        importSelected: 'Import selected',
        name: 'Name',
        newProject: 'New den',
        projectName: 'Den name',
        reload: 'Reload from disk',
      }
    : {
        addInstance: 'Adicionar instância',
        chooseLocation: 'Escolher local',
        create: 'Criar',
        diagram: 'Diagrama UML',
        diagramTypes: {
          class: 'Classes',
          'use-case': 'Casos de uso',
          sequence: 'Sequência',
          activity: 'Atividades',
        },
        addPartitionRight: 'Adicionar raia à direita',
        elementClass: 'Classe',
        elementPartition: 'Raia',
        exportDiagram: 'Exportar diagrama',
        fileActions: 'Importar e exportar',
        fitView: 'Ajustar à tela',
        importDiagram: 'Importar diagrama',
        importSelected: 'Importar selecionados',
        name: 'Nome',
        newProject: 'Nova toca',
        projectName: 'Nome da toca',
        reload: 'Recarregar do disco',
      };
}

async function stopApplication(app: ElectronApplication | undefined) {
  if (!app) {
    return;
  }
  const child = app.process();
  if (child.exitCode === null) {
    terminateProcessTree(child);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  await app.close().catch(() => undefined);
}

async function createDiagramPage(
  page: Page,
  labels: DiagramLabels,
  type: keyof DiagramLabels['diagramTypes'],
  name: string,
) {
  await page.getByRole('button', { name: labels.addInstance }).click();
  await page
    .getByRole('dialog', { name: labels.addInstance })
    .getByRole('option', { name: new RegExp(`^${labels.diagram}`) })
    .click();
  const typeDialog = page.getByRole('dialog', { name: /UML/i });
  await typeDialog
    .getByRole('button', { name: new RegExp(labels.diagramTypes[type]) })
    .click();
  const input = page.locator('.project-tree__inline-editor').getByRole('textbox', {
    name: labels.name,
  });
  await input.fill(name);
  await input.press('Enter');
  await expect(
    page.getByRole('tabpanel', { name }).locator('.diagram-page'),
  ).toBeVisible();
}

test('creates, edits, saves, imports and exports native UML diagrams securely', async () => {
  test.setTimeout(120_000);
  const appPath = locatePackagedAsar(repositoryRoot);
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-diagram-e2e-'));
  const projectParent = await mkdtemp(path.join(os.tmpdir(), 'flyoff-diagram-project-'));
  const canonicalParent = await realpath(projectParent);
  const projectName = 'Diagram E2E';
  const projectRoot = path.join(canonicalParent, projectName);
  const importPath = path.join(canonicalParent, 'Imported.flyd');
  const exportPath = path.join(canonicalParent, 'Exported.flyd');
  const imported = createDiagramDocument(
    'class',
    () => '99999999-9999-4999-8999-999999999999',
  );
  await writeFile(importPath, `${JSON.stringify(imported, null, 2)}\n`, 'utf8');
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [
        appPath,
        ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
      ],
      env: {
        ...process.env,
        FLYOFF_E2E: '1',
        FLYOFF_E2E_DIAGRAM_EXPORT: exportPath,
        FLYOFF_E2E_DIAGRAM_IMPORT: importPath,
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
    const labels = labelsFor(await page.evaluate(() => document.documentElement.lang));

    await page.getByRole('button', { name: labels.newProject }).click();
    const projectDialog = page.getByRole('dialog');
    await projectDialog
      .getByRole('textbox', { name: labels.projectName })
      .fill(projectName);
    await projectDialog
      .getByRole('button', { name: labels.chooseLocation })
      .click();
    await projectDialog.getByRole('button', { name: labels.create }).click();

    await createDiagramPage(page, labels, 'class', 'Class model');
    await page
      .getByRole('button', { name: labels.elementClass, exact: true })
      .click();
    const classPanel = page.getByRole('tabpanel', { name: 'Class model' });
    const canvas = classPanel.locator('.diagram-canvas');
    await canvas.click({ position: { x: 260, y: 180 } });
    const inspectorName = classPanel
      .getByRole('complementary')
      .getByRole('textbox', { name: labels.name });
    await inspectorName.fill('Customer');
    await expect(classPanel.locator('.diagram-node__name')).toContainText('Customer');
    await expect(classPanel.locator('.diagram-page__save-status')).toHaveAttribute(
      'data-status',
      'saved',
    );

    await createDiagramPage(page, labels, 'use-case', 'Use cases');
    await createDiagramPage(page, labels, 'sequence', 'Sequence flow');
    await createDiagramPage(page, labels, 'activity', 'Activity flow');

    const activityPanel = page.getByRole('tabpanel', { name: 'Activity flow' });
    await activityPanel
      .getByRole('button', { name: labels.elementPartition, exact: true })
      .click();
    await activityPanel.locator('.diagram-canvas').click({
      position: { x: 280, y: 150 },
    });
    await expect(activityPanel.locator('[data-element-id]')).toHaveCount(1);
    await activityPanel
      .getByRole('button', { name: labels.elementPartition, exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: labels.addPartitionRight })
      .click();
    await expect(activityPanel.locator('[data-element-id]')).toHaveCount(2);
    await activityPanel.getByRole('button', { name: labels.fitView }).click();
    const resizeHandle = activityPanel.locator('[data-resize-handle="se"]');
    const handleBounds = await resizeHandle.boundingBox();
    expect(handleBounds).not.toBeNull();
    await page.mouse.move(
      handleBounds!.x + handleBounds!.width / 2,
      handleBounds!.y + handleBounds!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBounds!.x + 48, handleBounds!.y + 48);
    await page.mouse.up();
    const resizedHeight = await activityPanel
      .locator('.diagram-node--selected .diagram-node__shape')
      .getAttribute('height');
    expect(Number(resizedHeight)).toBeGreaterThan(440);

    for (const name of ['Class model', 'Use cases', 'Sequence flow', 'Activity flow']) {
      await page.getByRole('treeitem', { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();
      await expect(
        page.getByRole('tabpanel', { name }).locator('.diagram-page'),
      ).toBeVisible();
    }

    await page.getByRole('button', { name: labels.fileActions }).click();
    await page
      .getByRole('menuitem', {
        name: `${labels.exportDiagram} (.flyd)`,
      })
      .click();
    await expect.poll(async () => access(exportPath).then(() => true, () => false)).toBe(true);

    await page.getByRole('button', { name: labels.fileActions }).click();
    await page.getByRole('menuitem', { name: labels.importDiagram }).click();
    const importDialog = page.getByRole('dialog');
    await importDialog.getByRole('button', { name: labels.importSelected }).click();
    await expect(page.getByRole('tab', { name: 'Imported' })).toBeVisible();
    const importedPanel = page.getByRole('tabpanel', { name: 'Imported' });
    await expect(importedPanel.locator('.diagram-page__save-status')).toHaveAttribute(
      'data-status',
      'saved',
    );

    const security = await page.evaluate(() => {
      const globalObject = globalThis as typeof globalThis & {
        require?: unknown;
        process?: unknown;
        electron?: unknown;
      };
      return {
        electron: typeof globalObject.electron,
        process: typeof globalObject.process,
        readFile: 'readFile' in window.flyoff,
        require: typeof globalObject.require,
      };
    });
    expect(security).toEqual({
      electron: 'undefined',
      process: 'undefined',
      readFile: false,
      require: 'undefined',
    });

    const importedProjectPath = path.join(projectRoot, 'Imported.flyd');
    const external = JSON.parse(await readFile(importedProjectPath, 'utf8')) as {
      settings: { gridSize: number };
    };
    external.settings.gridSize = 24;
    await writeFile(importedProjectPath, `${JSON.stringify(external, null, 2)}\n`, 'utf8');
    await importedPanel
      .getByRole('button', { name: labels.elementClass, exact: true })
      .click();
    await importedPanel.locator('.diagram-canvas').click({ position: { x: 300, y: 200 } });
    await expect(importedPanel.locator('.diagram-page__save-status')).toHaveAttribute(
      'data-status',
      'conflict',
    );
    await page.getByRole('button', { name: labels.reload }).click();
    await expect(importedPanel.locator('.diagram-page__save-status')).toHaveAttribute(
      'data-status',
      'saved',
    );

    const persisted = await Promise.all(
      ['Class model', 'Use cases', 'Sequence flow', 'Activity flow', 'Imported'].map(
        async (name) => JSON.parse(await readFile(path.join(projectRoot, `${name}.flyd`), 'utf8')),
      ),
    );
    expect(persisted.map(({ diagramType }) => diagramType)).toEqual([
      'class',
      'use-case',
      'sequence',
      'activity',
      'class',
    ]);
  } finally {
    await stopApplication(app);
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 5 });
    await rm(projectParent, { recursive: true, force: true, maxRetries: 5 });
  }
});
