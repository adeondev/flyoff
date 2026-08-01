import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type CDPSession,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');
const populations = [1, 5, 20] as const;
const profileEnabled =
  process.env.FLYOFF_HIDDEN_EDITOR_LIFECYCLE_PROFILE === '1';
const keepTemporaryData =
  process.env.FLYOFF_KEEP_HIDDEN_EDITOR_LIFECYCLE_TEMP === '1';
const temporaryDirectoryPrefix = 'flyoff-hidden-editor-profile-';
const layoutWorkKeys = [
  'coalescedResizeNotifications',
  'fullLayoutResets',
  'heightMapRebuilds',
  'hiddenResizeSkips',
  'insignificantResizePasses',
  'liveResizePasses',
  'resizeNotifications',
  'scheduledLayoutPasses',
  'settledResizeNoops',
  'settledResizeRebuilds',
  'skippedWidthRebuilds',
] as const;

type Population = (typeof populations)[number];
type LayoutWorkKey = (typeof layoutWorkKeys)[number];
type LayoutWork = Record<LayoutWorkKey, number>;
type LifecycleAblation = 'current' | 'visible-editor-only';

interface CadenceReport {
  beyond75: number;
  durationMs: number;
  frames: number;
  longestMs: number;
  longTaskMs: number;
  longTasks: number;
  medianMs: number;
  near16: number;
  near33: number;
  near50: number;
  near66: number;
  p95Ms: number;
  p99Ms: number;
}

interface CdpSnapshot {
  domCounters: {
    documents: number;
    jsEventListeners: number;
    nodes: number;
  };
  heapUsage: {
    backingStorageSize?: number;
    embedderHeapUsedSize?: number;
    totalSize: number;
    usedSize: number;
  };
  performanceMetrics: Record<string, number>;
}

interface EditorEntrySnapshot {
  descendantNodes: number;
  hidden: boolean;
  layoutWork: LayoutWork | null;
  mountedLines: number;
  nodeId: string;
  panelId: string;
  sourceLines: number;
  viewId: string;
}

interface EditorGroupSnapshot {
  descendantNodes: number;
  editors: number;
  layoutDiagnosticsAvailable: number;
  layoutWork: LayoutWork | null;
  mountedLines: number;
  sourceLines: number;
}

interface EditorLifecycleSnapshot {
  entries: EditorEntrySnapshot[];
  groups: {
    all: EditorGroupSnapshot;
    hidden: EditorGroupSnapshot;
    visible: EditorGroupSnapshot;
  };
}

interface ProfileSnapshot {
  cdp: CdpSnapshot;
  editors: EditorLifecycleSnapshot;
}

interface ScenarioDelta {
  domCounters: Record<keyof CdpSnapshot['domCounters'], number>;
  editorLayoutWork: {
    all: LayoutWork | null;
    hidden: LayoutWork | null;
    visible: LayoutWork | null;
  };
  heapUsage: Record<string, number>;
  performanceMetrics: Record<string, number>;
}

interface ScenarioReport {
  after: ProfileSnapshot;
  before: ProfileSnapshot;
  cadence: CadenceReport;
  delta: ScenarioDelta;
}

interface PopulationReport {
  completedAt: string;
  initial: ProfileSnapshot;
  notes: {
    hidden: number;
    names: string[];
    total: Population;
    visible: number;
  };
  runtime: unknown;
  scenarios: {
    idle: ScenarioReport;
    tabSwitching: ScenarioReport;
    windowResize: ScenarioReport;
  };
  startedAt: string;
  temporaryDataKept: boolean;
  temporaryDirectory: string;
}

interface HiddenEditorProfileReport {
  completed: boolean;
  completedAt?: string;
  configuration: {
    ablation: LifecycleAblation;
    graphicsBackend: 'automatic' | 'opengl';
    lineCount: number;
    packagedAsar: string;
    populations: readonly Population[];
  };
  error?: string;
  populations: Partial<Record<Population, PopulationReport>>;
  schemaVersion: 1;
  startedAt: string;
}

function profileLineCount(): number {
  const value = Number(
    process.env.FLYOFF_HIDDEN_EDITOR_LIFECYCLE_LINES ?? 11_000,
  );
  if (!Number.isInteger(value) || value < 2_000 || value > 50_000) {
    throw new Error(
      'FLYOFF_HIDDEN_EDITOR_LIFECYCLE_LINES must be an integer from 2000 to 50000.',
    );
  }
  return value;
}

function profileAblation(): LifecycleAblation {
  const value =
    process.env.FLYOFF_HIDDEN_EDITOR_LIFECYCLE_ABLATION?.trim() ?? 'current';
  if (value !== 'current' && value !== 'visible-editor-only') {
    throw new Error(
      'FLYOFF_HIDDEN_EDITOR_LIFECYCLE_ABLATION must be current or visible-editor-only.',
    );
  }
  return value;
}

function profileReportPath(ablation: LifecycleAblation): string {
  const configured =
    process.env.FLYOFF_HIDDEN_EDITOR_LIFECYCLE_REPORT?.trim();
  return configured
    ? path.resolve(repositoryRoot, configured)
    : path.join(
        repositoryRoot,
        'test-results',
        `hidden-editor-lifecycle-profile-${ablation}.json`,
      );
}

function longNoteFixture(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => {
    if (index % 47 === 0) {
      return `## Section ${index}`;
    }
    if (index % 4 === 0) {
      return `- Item ${index}: **Markdown** with enough text on the line that a narrower pane forces it to wrap onto a second row.`;
    }
    return `Line ${index}: political, religious and everyday record with enough text to react to the pane width.`;
  }).join('\n');
}

async function writeReport(
  outputPath: string,
  report: HiddenEditorProfileReport,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function stopApplication(
  application: ElectronApplication | undefined,
): Promise<void> {
  if (!application) {
    return;
  }
  let child: ReturnType<ElectronApplication['process']> | undefined;
  try {
    child = application.process();
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
  await application.close().catch(() => undefined);
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith(temporaryDirectoryPrefix)
  ) {
    throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  }
  await rm(resolved, { force: true, recursive: true });
}

const installCadenceProbe = () => {
  const store = {
    intervals: [] as number[],
    last: 0,
    longTasks: [] as number[],
    recording: false,
    started: 0,
  };
  (
    window as unknown as {
      __hiddenEditorCadence: typeof store;
    }
  ).__hiddenEditorCadence = store;
  const tick = (now: number): void => {
    if (store.recording && store.last > 0) {
      store.intervals.push(now - store.last);
    }
    store.last = store.recording ? now : 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((entries) => {
      if (!store.recording) {
        return;
      }
      for (const entry of entries.getEntries()) {
        store.longTasks.push(entry.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // Frame cadence remains available when Long Tasks are unsupported.
  }
};

const startCadence = () => {
  const store = (
    window as unknown as {
      __hiddenEditorCadence: {
        intervals: number[];
        last: number;
        longTasks: number[];
        recording: boolean;
        started: number;
      };
    }
  ).__hiddenEditorCadence;
  store.intervals.length = 0;
  store.last = 0;
  store.longTasks.length = 0;
  store.recording = true;
  store.started = performance.now();
};

const finishCadence = (): CadenceReport => {
  const store = (
    window as unknown as {
      __hiddenEditorCadence: {
        intervals: number[];
        longTasks: number[];
        recording: boolean;
        started: number;
      };
    }
  ).__hiddenEditorCadence;
  store.recording = false;
  const sorted = [...store.intervals].sort((left, right) => left - right);
  const percentile = (share: number): number =>
    sorted.length === 0
      ? 0
      : (sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * share))
        ] ?? 0);
  const bucket = (centre: number): number =>
    sorted.filter((value) => Math.abs(value - centre) <= 8.33).length;
  const round = (value: number): number => Number(value.toFixed(2));
  return {
    beyond75: sorted.filter((value) => value > 75).length,
    durationMs: round(performance.now() - store.started),
    frames: sorted.length,
    longestMs: round(sorted.at(-1) ?? 0),
    longTaskMs: round(
      store.longTasks.reduce((total, value) => total + value, 0),
    ),
    longTasks: store.longTasks.length,
    medianMs: round(percentile(0.5)),
    near16: bucket(16.67),
    near33: bucket(33.33),
    near50: bucket(50),
    near66: bucket(66.67),
    p95Ms: round(percentile(0.95)),
    p99Ms: round(percentile(0.99)),
  };
};

const readEditorLifecycle = (): EditorLifecycleSnapshot => {
  const keys = [
    'coalescedResizeNotifications',
    'fullLayoutResets',
    'heightMapRebuilds',
    'hiddenResizeSkips',
    'insignificantResizePasses',
    'liveResizePasses',
    'resizeNotifications',
    'scheduledLayoutPasses',
    'settledResizeNoops',
    'settledResizeRebuilds',
    'skippedWidthRebuilds',
  ] as const;
  type Key = (typeof keys)[number];
  type Work = Record<Key, number>;
  type InstrumentedEditor = HTMLElement & {
    __flyoffSourceLayoutWork?: Work;
  };
  const entries = Array.from(
    document.querySelectorAll<InstrumentedEditor>(
      '.markdown-source__editor[data-windowed=true]',
    ),
    (editor) => {
      const panel = editor.closest<HTMLElement>('.page-panel');
      const diagnostics = editor.__flyoffSourceLayoutWork;
      return {
        descendantNodes: editor.querySelectorAll('*').length,
        hidden: panel?.hasAttribute('hidden') ?? true,
        layoutWork: diagnostics
          ? Object.fromEntries(
              keys.map((key) => [key, Number(diagnostics[key] ?? 0)]),
            ) as Work
          : null,
        mountedLines: editor.querySelectorAll('.md-line').length,
        nodeId: editor.dataset.markdownNodeId ?? '',
        panelId: panel?.id ?? '',
        sourceLines: Number(editor.dataset.sourceLineCount ?? 0),
        viewId: editor.dataset.markdownViewId ?? '',
      };
    },
  );
  const aggregate = (
    selected: typeof entries,
  ): EditorGroupSnapshot => {
    const available = selected.filter(({ layoutWork }) => layoutWork);
    const work = available.length > 0
      ? Object.fromEntries(
          keys.map((key) => [
            key,
            available.reduce(
              (total, entry) => total + (entry.layoutWork?.[key] ?? 0),
              0,
            ),
          ]),
        ) as Work
      : null;
    return {
      descendantNodes: selected.reduce(
        (total, entry) => total + entry.descendantNodes,
        0,
      ),
      editors: selected.length,
      layoutDiagnosticsAvailable: available.length,
      layoutWork: work,
      mountedLines: selected.reduce(
        (total, entry) => total + entry.mountedLines,
        0,
      ),
      sourceLines: selected.reduce(
        (total, entry) => total + entry.sourceLines,
        0,
      ),
    };
  };
  return {
    entries,
    groups: {
      all: aggregate(entries),
      hidden: aggregate(entries.filter(({ hidden }) => hidden)),
      visible: aggregate(entries.filter(({ hidden }) => !hidden)),
    },
  };
};

async function collectCdpSnapshot(session: CDPSession): Promise<CdpSnapshot> {
  const [domCounters, heapUsage, performanceResult] = await Promise.all([
    session.send('Memory.getDOMCounters') as Promise<
      CdpSnapshot['domCounters']
    >,
    session.send('Runtime.getHeapUsage') as Promise<CdpSnapshot['heapUsage']>,
    session.send('Performance.getMetrics') as Promise<{
      metrics: { name: string; value: number }[];
    }>,
  ]);
  return {
    domCounters,
    heapUsage,
    performanceMetrics: Object.fromEntries(
      performanceResult.metrics.map(({ name, value }) => [name, value]),
    ),
  };
}

async function collectSnapshot(
  page: Page,
  session: CDPSession,
): Promise<ProfileSnapshot> {
  const [cdp, editors] = await Promise.all([
    collectCdpSnapshot(session),
    page.evaluate(readEditorLifecycle),
  ]);
  return { cdp, editors };
}

function numericRecordDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => [
      key,
      (after[key] ?? 0) - (before[key] ?? 0),
    ]),
  );
}

function layoutWorkDelta(
  before: LayoutWork | null,
  after: LayoutWork | null,
): LayoutWork | null {
  if (!before || !after) {
    return null;
  }
  return Object.fromEntries(
    layoutWorkKeys.map((key) => [key, after[key] - before[key]]),
  ) as LayoutWork;
}

function scenarioDelta(
  before: ProfileSnapshot,
  after: ProfileSnapshot,
): ScenarioDelta {
  return {
    domCounters: {
      documents:
        after.cdp.domCounters.documents - before.cdp.domCounters.documents,
      jsEventListeners:
        after.cdp.domCounters.jsEventListeners -
        before.cdp.domCounters.jsEventListeners,
      nodes: after.cdp.domCounters.nodes - before.cdp.domCounters.nodes,
    },
    editorLayoutWork: {
      all: layoutWorkDelta(
        before.editors.groups.all.layoutWork,
        after.editors.groups.all.layoutWork,
      ),
      hidden: layoutWorkDelta(
        before.editors.groups.hidden.layoutWork,
        after.editors.groups.hidden.layoutWork,
      ),
      visible: layoutWorkDelta(
        before.editors.groups.visible.layoutWork,
        after.editors.groups.visible.layoutWork,
      ),
    },
    heapUsage: numericRecordDelta(
      before.cdp.heapUsage as Record<string, number>,
      after.cdp.heapUsage as Record<string, number>,
    ),
    performanceMetrics: numericRecordDelta(
      before.cdp.performanceMetrics,
      after.cdp.performanceMetrics,
    ),
  };
}

async function recordScenario(
  page: Page,
  session: CDPSession,
  action: () => Promise<void>,
): Promise<ScenarioReport> {
  const before = await collectSnapshot(page, session);
  await page.evaluate(startCadence);
  let cadence!: CadenceReport;
  try {
    await action();
  } finally {
    cadence = await page.evaluate(finishCadence);
  }
  const after = await collectSnapshot(page, session);
  return {
    after,
    before,
    cadence,
    delta: scenarioDelta(before, after),
  };
}

async function createProject(page: Page, projectName: string): Promise<void> {
  await page.locator('.home__action-list button').first().click();
  const form = page.locator('.flyoff-dialog__form');
  await expect(form).toBeVisible();
  await form.locator('input').first().fill(projectName);
  await form.locator('.create-project-dialog__location button').click();
  const create = page.locator('.flyoff-dialog__button--primary[form]');
  await expect(create).toBeEnabled();
  await create.click();
  await expect(
    page.locator(
      '.project-sidebar__tools button[aria-haspopup="dialog"]',
    ),
  ).toBeVisible({ timeout: 60_000 });
}

async function createVisitedNote(
  page: Page,
  name: string,
  lineCount: number,
): Promise<void> {
  await page
    .locator('.project-sidebar__tools button[aria-haspopup="dialog"]')
    .click();
  await page.locator('[data-instance-type="markdown"]').click();
  const inlineEditor = page.locator('.project-tree__inline-editor');
  await expect(inlineEditor).toBeVisible();
  await inlineEditor.locator('input').fill(name);
  await inlineEditor.locator('input').press('Enter');
  await expect(page.getByRole('tab', { exact: true, name })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const editor = page.locator('.markdown-source__editor:visible');
  await expect(editor).toBeVisible();
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
    .toBe(String(lineCount));
}

async function waitForAutosave(
  projectRoot: string,
  noteNames: readonly string[],
  source: string,
): Promise<void> {
  const expectedBytes = Buffer.byteLength(source);
  const paths = noteNames.map((name) => path.join(projectRoot, `${name}.md`));
  await expect
    .poll(
      async () => {
        const sizes = await Promise.all(
          paths.map((filePath) =>
            stat(filePath)
              .then(({ size }) => size)
              .catch(() => -1),
          ),
        );
        return sizes.filter((size) => size === expectedBytes).length;
      },
      { timeout: 120_000 },
    )
    .toBe(paths.length);
  const saved = await Promise.all(
    paths.map((filePath) => readFile(filePath, 'utf8')),
  );
  expect(saved.every((content) => content === source)).toBe(true);
}

async function collectRuntime(
  application: ElectronApplication,
): Promise<unknown> {
  return application.evaluate(({ app, BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      throw new Error('The hidden-editor profiler could not find the window.');
    }
    const display = screen.getDisplayMatching(window.getBounds());
    return {
      appPath: app.getAppPath(),
      displayFrequency: display.displayFrequency,
      hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
      isPackaged: app.isPackaged,
      versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      window: {
        bounds: window.getBounds(),
        focused: window.isFocused(),
        minimized: window.isMinimized(),
        visible: window.isVisible(),
      },
    };
  });
}

async function assertPopulation(
  page: Page,
  total: Population,
): Promise<void> {
  await expect(
    page.locator(
      '.page-panel[hidden] .markdown-source__editor[data-windowed=true]',
    ),
  ).toHaveCount(total - 1);
  await expect(
    page.locator(
      '.page-panel:not([hidden]) .markdown-source__editor[data-windowed=true]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator('.page-panel .markdown-source__editor[data-windowed=true]'),
  ).toHaveCount(total);
}

async function resizeMainWindow(
  application: ElectronApplication,
  width: number,
): Promise<void> {
  await application.evaluate(
    ({ BrowserWindow }, nextWidth) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        throw new Error('The hidden-editor profiler window disappeared.');
      }
      window.setSize(nextWidth, 900);
    },
    width,
  );
}

async function profilePopulation(
  packagedAsar: string,
  total: Population,
  lineCount: number,
  ablation: LifecycleAblation,
): Promise<PopulationReport> {
  const startedAt = new Date().toISOString();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), temporaryDirectoryPrefix),
  );
  const userDataPath = path.join(temporaryDirectory, 'user-data');
  const projectParent = path.join(temporaryDirectory, 'projects');
  const projectName = `Hidden editors ${total}`;
  const projectRoot = path.join(projectParent, projectName);
  const noteNames = Array.from(
    { length: total },
    (_, index) => `Visited ${String(index + 1).padStart(2, '0')}`,
  );
  const source = longNoteFixture(lineCount);
  let application: ElectronApplication | undefined;
  let session: CDPSession | undefined;

  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(projectParent, { recursive: true }),
  ]);

  try {
    await writeFile(
      path.join(userDataPath, 'preferences.json'),
      JSON.stringify({
        general: {
          focusEditorOnOpen: true,
          ...(process.platform === 'win32'
            ? { graphicsBackend: 'opengl' }
            : {}),
        },
      }),
      'utf8',
    );
    application = await electron.launch({
      args: [
        packagedAsar,
        `--user-data-dir=${userDataPath}`,
        ...(process.platform === 'linux' && process.env.CI
          ? ['--no-sandbox']
          : []),
      ],
      env: {
        ...process.env,
        FLYOFF_E2E: '1',
        FLYOFF_E2E_PROJECT_CREATE_PARENT: projectParent,
        FLYOFF_E2E_PROJECT_OPEN_ROOT: projectRoot,
        FLYOFF_E2E_USER_DATA: userDataPath,
      },
    });
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await resizeMainWindow(application, 1_400);
    await page.waitForFunction(() =>
      ['en-US', 'pt-BR'].includes(document.documentElement.lang),
    );
    await page.evaluate((value) => {
      document.documentElement.dataset.performanceDiagnosticAblation = value;
    }, ablation);
    await createProject(page, projectName);
    await application.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      source,
    );

    for (const name of noteNames) {
      await createVisitedNote(page, name, lineCount);
    }

    await waitForAutosave(projectRoot, noteNames, source);
    await page.waitForTimeout(1_000);
    await assertPopulation(page, total);
    await page.evaluate(installCadenceProbe);

    session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const runtime = await collectRuntime(application);
    const initial = await collectSnapshot(page, session);
    const idle = await recordScenario(page, session, () =>
      page.waitForTimeout(5_000),
    );

    const activeTab = page.getByRole('tab', {
      exact: true,
      name: noteNames.at(-1)!,
    });
    const alternateTab = total === 1
      ? page.locator('.page-tab__trigger[aria-selected="false"]').first()
      : page.getByRole('tab', { exact: true, name: noteNames[0]! });
    expect(await alternateTab.getAttribute('id')).not.toBe(
      await activeTab.getAttribute('id'),
    );
    const tabSwitching = await recordScenario(page, session, async () => {
      for (let index = 0; index < 40; index += 1) {
        await (index % 2 === 0 ? alternateTab : activeTab).click();
        await page.waitForTimeout(80);
      }
      await activeTab.click();
      await page.waitForTimeout(500);
    });
    await assertPopulation(page, total);

    const windowResize = await recordScenario(page, session, async () => {
      for (let index = 0; index < 12; index += 1) {
        await resizeMainWindow(application!, index % 2 === 0 ? 1_160 : 1_400);
        await page.waitForTimeout(160);
      }
      await resizeMainWindow(application!, 1_400);
      await page.waitForTimeout(800);
    });
    await assertPopulation(page, total);

    return {
      completedAt: new Date().toISOString(),
      initial,
      notes: {
        hidden: total - 1,
        names: noteNames,
        total,
        visible: 1,
      },
      runtime,
      scenarios: { idle, tabSwitching, windowResize },
      startedAt,
      temporaryDataKept: keepTemporaryData,
      temporaryDirectory,
    };
  } finally {
    await session?.detach().catch(() => undefined);
    await stopApplication(application);
    if (keepTemporaryData) {
      console.log(`[hidden-editors] temporary data: ${temporaryDirectory}`);
    } else {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  }
}

test('profile: 1, 5 and 20 visited Markdown editors', async () => {
  test.skip(
    !profileEnabled,
    'Set FLYOFF_HIDDEN_EDITOR_LIFECYCLE_PROFILE=1 to run this profiler.',
  );
  test.setTimeout(1_800_000);

  const packagedAsar = locatePackagedAsar(repositoryRoot);
  const lineCount = profileLineCount();
  const ablation = profileAblation();
  const outputPath = profileReportPath(ablation);
  const report: HiddenEditorProfileReport = {
    completed: false,
    configuration: {
      ablation,
      graphicsBackend: process.platform === 'win32' ? 'opengl' : 'automatic',
      lineCount,
      packagedAsar,
      populations,
    },
    populations: {},
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
  };

  try {
    for (const population of populations) {
      console.log(
        `[hidden-editors] ${ablation}: profiling ${population} visited editor${population === 1 ? '' : 's'}`,
      );
      report.populations[population] = await profilePopulation(
        packagedAsar,
        population,
        lineCount,
        ablation,
      );
      await writeReport(outputPath, report);
    }
    report.completed = true;
  } catch (error) {
    report.error = error instanceof Error
      ? error.stack ?? error.message
      : String(error);
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    await writeReport(outputPath, report);
    console.log(`[hidden-editors] report: ${outputPath}`);
  }

  await test.info().attach('hidden-editor-lifecycle-profile', {
    contentType: 'application/json',
    path: outputPath,
  });
});
