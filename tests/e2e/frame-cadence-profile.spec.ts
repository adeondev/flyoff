/**
 * What the application actually presents, frame by frame, in the real package.
 *
 * The editor benchmarks under `scripts/` all run with `offscreen: true` and
 * `--disable-gpu`, and they mount `WindowedSourceView` directly rather than the
 * application. They can report a healthy wheel-scroll frame time while the
 * assembled application drops three frames out of four, because the work they
 * cannot see — React reconciliation of the whole tree, container queries on the
 * pane, the resize path the panes drive — is the work that is missing the
 * deadline. This measures the shipped package instead: it launches the same
 * ASAR a user runs, drives real input, and records the interval between
 * animation frames.
 *
 * Two controls make the numbers readable rather than suggestive:
 *
 *  - transform, opacity, and `left` animations on a detached element, run in
 *    the same window in the same session. The first two show what this machine
 *    can do with compositor-friendly properties; the last shows what an
 *    animated layout property costs here. Every application scenario is read
 *    against those controls.
 *  - long tasks, recorded per scenario. A frame interval says a deadline was
 *    missed; a long task says how much main-thread work missed it, which is
 *    what separates a paint or compositor problem from a scripting one.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type CDPSession,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import { locatePackagedAsar } from './packaged-asar';
import { terminateProcessTree } from './terminate-process';

const repositoryRoot = path.resolve(__dirname, '../..');
const LINE_COUNT = 11_000;

interface CadenceReport {
  frames: number;
  longestMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  /** Frames within half a frame of each multiple of the 60 Hz interval. */
  near16: number;
  near33: number;
  near50: number;
  near66: number;
  beyond: number;
  /** Main-thread tasks over 50 ms, which are what push a frame past its deadline. */
  longTasks: number;
  longTaskMs: number;
}

interface AnchorDiagnostics {
  error?: string;
  generation?: string;
  line?: string;
  passes?: string;
}

interface RuntimeReport {
  app: {
    appPath: string;
    executablePath: string;
    isPackaged: boolean;
    name: string;
    version: string;
  };
  commandLine: string[];
  displays: unknown;
  gpu: {
    featureStatus: unknown;
    hardwareAccelerationEnabled: boolean;
    info: unknown;
    infoError?: string;
  };
  platform: {
    arch: string;
    locale: string;
    name: NodeJS.Platform;
  };
  processMetrics: unknown;
  versions: {
    chrome?: string;
    electron?: string;
    node: string;
    v8: string;
  };
  window: {
    alwaysOnTop: boolean;
    backgroundThrottling: boolean;
    bounds: { height: number; width: number; x: number; y: number };
    contentBounds: { height: number; width: number; x: number; y: number };
    focused: boolean;
    fullScreen: boolean;
    id: number;
    maximized: boolean;
    minimized: boolean;
    renderer: unknown;
    rendererProcessId: number;
    visible: boolean;
  };
}

function cadenceReportPath(): string {
  const configured = process.env.FLYOFF_CADENCE_REPORT?.trim();
  return configured
    ? path.resolve(repositoryRoot, configured)
    : path.join(repositoryRoot, 'test-results', 'frame-cadence-report.json');
}

function cadenceGraphicsBackend(): 'automatic' | 'opengl' {
  const value =
    process.env.FLYOFF_CADENCE_GRAPHICS_BACKEND?.trim() ?? 'automatic';
  if (value !== 'automatic' && value !== 'opengl') {
    throw new Error(
      'FLYOFF_CADENCE_GRAPHICS_BACKEND must be automatic or opengl.',
    );
  }
  return value;
}

async function collectRuntimeReport(
  application: ElectronApplication,
): Promise<RuntimeReport> {
  return application.evaluate(async ({ app, BrowserWindow, screen }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      throw new Error('The cadence profiler could not find the main window.');
    }

    const serializeDisplay = (
      display: ReturnType<typeof screen.getPrimaryDisplay>,
    ) => ({
      accelerometerSupport: display.accelerometerSupport,
      bounds: display.bounds,
      colorDepth: display.colorDepth,
      colorSpace: display.colorSpace,
      depthPerComponent: display.depthPerComponent,
      detected: display.detected,
      displayFrequency: display.displayFrequency,
      id: display.id,
      internal: display.internal,
      label: display.label,
      maximumCursorSize: display.maximumCursorSize,
      monochrome: display.monochrome,
      nativeOrigin: display.nativeOrigin,
      rotation: display.rotation,
      scaleFactor: display.scaleFactor,
      size: display.size,
      touchSupport: display.touchSupport,
      workArea: display.workArea,
      workAreaSize: display.workAreaSize,
    });
    const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
    let gpuInfo: unknown = null;
    let gpuInfoError: string | undefined;
    try {
      gpuInfo = await app.getGPUInfo('complete');
    } catch (error) {
      gpuInfoError = error instanceof Error ? error.message : String(error);
    }
    const renderer = (await mainWindow.webContents.executeJavaScript(
      `({
        devicePixelRatio: window.devicePixelRatio,
        documentHidden: document.hidden,
        screen: {
          availHeight: window.screen.availHeight,
          availWidth: window.screen.availWidth,
          colorDepth: window.screen.colorDepth,
          height: window.screen.height,
          pixelDepth: window.screen.pixelDepth,
          width: window.screen.width
        },
        userAgent: navigator.userAgent,
        visibilityState: document.visibilityState
      })`,
      true,
    )) as unknown;

    return {
      app: {
        appPath: app.getAppPath(),
        executablePath: app.getPath('exe'),
        isPackaged: app.isPackaged,
        name: app.getName(),
        version: app.getVersion(),
      },
      commandLine: [...process.argv],
      displays: {
        all: screen.getAllDisplays().map(serializeDisplay),
        current: serializeDisplay(currentDisplay),
        primaryId: screen.getPrimaryDisplay().id,
      },
      gpu: {
        featureStatus: app.getGPUFeatureStatus(),
        hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
        info: gpuInfo,
        ...(gpuInfoError ? { infoError: gpuInfoError } : {}),
      },
      platform: {
        arch: process.arch,
        locale: app.getLocale(),
        name: process.platform,
      },
      processMetrics: app.getAppMetrics(),
      versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      window: {
        alwaysOnTop: mainWindow.isAlwaysOnTop(),
        backgroundThrottling:
          mainWindow.webContents.getBackgroundThrottling(),
        bounds: mainWindow.getBounds(),
        contentBounds: mainWindow.getContentBounds(),
        focused: mainWindow.isFocused(),
        fullScreen: mainWindow.isFullScreen(),
        id: mainWindow.id,
        maximized: mainWindow.isMaximized(),
        minimized: mainWindow.isMinimized(),
        renderer,
        rendererProcessId: mainWindow.webContents.getOSProcessId(),
        visible: mainWindow.isVisible(),
      },
    };
  });
}

async function saveCadenceReport(options: {
  anchorDiagnostics: Readonly<Record<string, AnchorDiagnostics>>;
  completed: boolean;
  completedAt: string;
  outputPath: string;
  reports: ReadonlyMap<string, CadenceReport>;
  runtime?: RuntimeReport;
  startedAt: string;
}): Promise<void> {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    `${JSON.stringify(
      {
        anchorDiagnostics: options.anchorDiagnostics,
        capturedAt: options.completedAt,
        completed: options.completed,
        fixture: { lines: LINE_COUNT },
        profileScenario: profileScenario ?? null,
        runtime: options.runtime ?? null,
        scenarios: Object.fromEntries(options.reports),
        schemaVersion: 1,
        startedAt: options.startedAt,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`[cadence] report ${options.outputPath}`);
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

const installCadenceProbe = () => {
  const store = {
    intervals: [] as number[],
    last: 0,
    longTasks: [] as number[],
    recording: false,
  };
  (window as unknown as { __cadence: typeof store }).__cadence = store;
  const tick = (now: number) => {
    if (store.recording && store.last > 0) {
      store.intervals.push(now - store.last);
    }
    store.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // A frame interval says a deadline was missed; a long task says what missed
  // it and for how long, on which thread.
  try {
    new PerformanceObserver((list) => {
      if (!store.recording) {
        return;
      }
      for (const entry of list.getEntries()) {
        store.longTasks.push(entry.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // A runtime without the entry type still reports frame intervals.
  }
};

const startCadence = () => {
  const scope = window as unknown as {
    __cadence: {
      intervals: number[];
      last: number;
      longTasks: number[];
      recording: boolean;
    };
  };
  scope.__cadence.intervals.length = 0;
  scope.__cadence.longTasks.length = 0;
  scope.__cadence.last = 0;
  scope.__cadence.recording = true;
};

const collectCadence = (): CadenceReport => {
  const scope = window as unknown as {
    __cadence: { intervals: number[]; longTasks: number[]; recording: boolean };
  };
  scope.__cadence.recording = false;
  const sorted = [...scope.__cadence.intervals].sort((a, b) => a - b);
  const at = (share: number): number =>
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0);
  // Half a frame either side, so a frame presented one vsync late lands in the
  // 33 ms bucket rather than being smeared across two.
  const bucket = (centre: number): number =>
    sorted.filter((value) => Math.abs(value - centre) <= 8.33).length;
  const round = (value: number): number => Number(value.toFixed(2));

  return {
    beyond: sorted.filter((value) => value > 75).length,
    frames: sorted.length,
    longTaskMs: round(
      scope.__cadence.longTasks.reduce((total, value) => total + value, 0),
    ),
    longTasks: scope.__cadence.longTasks.length,
    longestMs: round(sorted.at(-1) ?? 0),
    medianMs: round(at(0.5)),
    near16: bucket(16.67),
    near33: bucket(33.33),
    near50: bucket(50),
    near66: bucket(66.67),
    p95Ms: round(at(0.95)),
    p99Ms: round(at(0.99)),
  };
};

function describe(label: string, report: CadenceReport): string {
  return (
    `[cadence] ${label.padEnd(26)} ` +
    `frames=${String(report.frames).padStart(4)} ` +
    `median=${String(report.medianMs).padStart(6)}ms ` +
    `p95=${String(report.p95Ms).padStart(7)}ms ` +
    `p99=${String(report.p99Ms).padStart(7)}ms ` +
    `max=${String(report.longestMs).padStart(7)}ms ` +
    `16/33/50/66/+=${report.near16}/${report.near33}/${report.near50}/${report.near66}/${report.beyond} ` +
    `longTasks=${String(report.longTasks).padStart(3)}/${report.longTaskMs}ms`
  );
}

const reports = new Map<string, CadenceReport>();

/**
 * Optional: name a scenario in `FLYOFF_CADENCE_PROFILE` and its main-thread
 * work is sampled and attributed to functions. A frame interval says a deadline
 * was missed, a long task says by how much, and this says by what.
 */
const profileScenario = process.env.FLYOFF_CADENCE_PROFILE;
let profiler: CDPSession | undefined;

interface ProfileNode {
  id: number;
  hitCount?: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

function summariseProfile(profile: {
  nodes: ProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}): string {
  const byNode = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const node = samples[index];
    if (node !== undefined) {
      byNode.set(node, (byNode.get(node) ?? 0) + (deltas[index] ?? 0));
    }
  }
  const named = new Map<string, number>();
  for (const node of profile.nodes) {
    const micros = byNode.get(node.id);
    if (!micros) {
      continue;
    }
    const name =
      `${node.callFrame.functionName || '(anonymous)'} ` +
      `@${node.callFrame.url.split('/').pop() ?? ''}:${node.callFrame.lineNumber}`;
    named.set(name, (named.get(name) ?? 0) + micros);
  }
  return [...named.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([name, micros]) => `      ${(micros / 1000).toFixed(1)}ms  ${name}`)
    .join('\n');
}

async function record(
  page: Page,
  label: string,
  action: () => Promise<void>,
): Promise<CadenceReport> {
  const sampling = profiler !== undefined && label === profileScenario;
  if (sampling && profiler) {
    await profiler.send('Profiler.start');
  }
  await page.evaluate(startCadence);
  let actionFailure: { error: unknown } | undefined;
  try {
    await action();
  } catch (error) {
    actionFailure = { error };
  }
  const report = await page.evaluate(collectCadence);
  reports.set(label, report);
  console.log(describe(label, report));
  if (sampling && profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    console.log(
      `[cadence] self time during "${label}"\n${summariseProfile(
        profile as unknown as Parameters<typeof summariseProfile>[0],
      )}`,
    );
  }
  if (actionFailure) {
    throw actionFailure.error;
  }
  return report;
}

/** Compositor-friendly and layout-property animations in the same window. */
const runControlAnimation = (kind: 'transform' | 'opacity' | 'left') => {
  return new Promise<void>((resolve) => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:4px;left:4px;width:40px;height:40px;' +
      'background:#4488ff;contain:strict;z-index:2147483647;' +
      'pointer-events:none;';
    if (kind === 'opacity') {
      probe.style.willChange = 'opacity';
    } else if (kind === 'transform') {
      probe.style.willChange = 'transform';
    }
    document.body.appendChild(probe);
    const started = performance.now();
    const step = () => {
      const elapsed = performance.now() - started;
      const wave = Math.sin(elapsed / 120);
      const offset = Math.round(wave * 120 + 130);
      if (kind === 'transform') {
        probe.style.transform = `translate3d(${offset}px,0,0)`;
      } else if (kind === 'opacity') {
        probe.style.opacity = String(0.625 + wave * 0.375);
      } else {
        probe.style.left = `${offset}px`;
      }
      if (elapsed < 2_000) {
        requestAnimationFrame(step);
      } else {
        probe.remove();
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
};

async function prepareScrollbarThumb(
  page: Page,
  editor: Locator,
): Promise<void> {
  await editor.evaluate((root) => {
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTop = Math.round(maximum * 0.12);
    root.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const box = await editor.boundingBox();
  if (!box) {
    throw new Error('The source editor has no box for scrollbar preparation.');
  }
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1);
  await page.waitForTimeout(50);
}

async function dragScrollbarThumb(page: Page, editor: Locator): Promise<void> {
  const geometry = await editor.evaluate((root) => {
    const scrollRoot = root as HTMLElement;
    const bounds = scrollRoot.getBoundingClientRect();
    const styles = getComputedStyle(scrollRoot);
    const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
    const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
    const scrollbarWidth = Math.max(
      0,
      scrollRoot.offsetWidth -
        scrollRoot.clientWidth -
        borderLeft -
        borderRight,
    );
    const maximum = Math.max(
      0,
      scrollRoot.scrollHeight - scrollRoot.clientHeight,
    );
    const trackHeight = scrollRoot.clientHeight;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(
        32,
        trackHeight * (scrollRoot.clientHeight / scrollRoot.scrollHeight),
      ),
    );
    const travel = Math.max(0, trackHeight - thumbHeight);
    const ratio = maximum > 0 ? scrollRoot.scrollTop / maximum : 0;
    return {
      before: scrollRoot.scrollTop,
      endY: bounds.top + borderTop + thumbHeight / 2 + travel * 0.82,
      maximum,
      startY:
        bounds.top + borderTop + thumbHeight / 2 + travel * ratio,
      viewportHeight: scrollRoot.clientHeight,
      x:
        bounds.right -
        borderRight -
        (scrollbarWidth > 0 ? scrollbarWidth / 2 : 2),
    };
  });
  if (geometry.maximum <= 0 || geometry.viewportHeight <= 0) {
    throw new Error('The source editor does not have a draggable scrollbar.');
  }

  await page.mouse.move(geometry.x, geometry.startY);
  await page.mouse.down();
  try {
    for (let step = 1; step <= 48; step += 1) {
      const progress = step / 48;
      await page.mouse.move(
        geometry.x,
        geometry.startY + (geometry.endY - geometry.startY) * progress,
      );
      await page.waitForTimeout(8);
    }
  } finally {
    await page.mouse.up();
  }

  const after = await editor.evaluate((root) => root.scrollTop);
  if (after - geometry.before < geometry.maximum * 0.25) {
    throw new Error(
      `The scrollbar thumb did not move the document: ${JSON.stringify({
        after,
        before: geometry.before,
        maximum: geometry.maximum,
        x: geometry.x,
      })}`,
    );
  }
  await page.waitForTimeout(500);
}

test('the packaged application presents frames at the display cadence', async () => {
  test.setTimeout(420_000);
  reports.clear();
  profiler = undefined;
  const appPath = locatePackagedAsar(repositoryRoot);
  const outputPath = cadenceReportPath();
  const graphicsBackend = cadenceGraphicsBackend();
  const startedAt = new Date().toISOString();
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'flyoff-cadence-'));
  const projectParent = await mkdtemp(
    path.join(os.tmpdir(), 'flyoff-cadence-project-'),
  );
  const projectName = 'Cadence';
  const longNoteName = 'Long note';
  const switchNoteName = 'Switch note';
  const source = longNoteFixture();
  const anchorDiagnostics: Record<string, AnchorDiagnostics> = {};
  let app: ElectronApplication | undefined;
  let completed = false;
  let runtime: RuntimeReport | undefined;

  try {
    await writeFile(
      path.join(userDataPath, 'preferences.json'),
      JSON.stringify({
        general: { focusEditorOnOpen: true, graphicsBackend },
      }),
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
          toggleSidebar: 'Toggle sidebar',
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
          toggleSidebar: 'Alternar barra lateral',
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
    await nameInput.fill(longNoteName);
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
    await page.waitForTimeout(1_500);

    await page.getByRole('button', { name: labels.add }).click();
    await page
      .getByRole('dialog', { name: labels.add })
      .getByRole('option', { name: new RegExp(`^${labels.note}`) })
      .click();
    await nameInput.fill(switchNoteName);
    await nameInput.press('Enter');
    const longTab = page.getByRole('tab', {
      exact: true,
      name: longNoteName,
    });
    const switchTab = page.getByRole('tab', {
      exact: true,
      name: switchNoteName,
    });
    await expect(longTab).toBeVisible();
    await expect(switchTab).toHaveAttribute('aria-selected', 'true');
    await longTab.click();
    await expect(longTab).toHaveAttribute('aria-selected', 'true');
    await expect(editor).toHaveAttribute('data-windowed', 'true');
    await editor.evaluate((root) => {
      root.scrollTop = Math.round(root.scrollHeight * 0.35);
    });
    await page.waitForTimeout(900);

    runtime = await collectRuntimeReport(app);
    await page.evaluate(installCadenceProbe);

    const cdp = await page.context().newCDPSession(page);
    if (profileScenario) {
      profiler = cdp;
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    }

    async function runScenarios(tag: string): Promise<void> {
      await longTab.click();
      await expect(longTab).toHaveAttribute('aria-selected', 'true');
      await expect(editor).toHaveAttribute('data-windowed', 'true');
      await page.waitForTimeout(300);

      await record(page, `${tag} idle`, () => page.waitForTimeout(2_500));
      await record(page, `${tag} control: transform`, () =>
        page.evaluate(runControlAnimation, 'transform' as const),
      );
      await record(page, `${tag} control: opacity`, () =>
        page.evaluate(runControlAnimation, 'opacity' as const),
      );
      await record(page, `${tag} control: left (layout)`, () =>
        page.evaluate(runControlAnimation, 'left' as const),
      );

      await record(page, `${tag} hover: tabs`, async () => {
        const tab = page.locator('.page-tab').first();
        const close = page
          .locator('.workspace-pane--active .page-tab__close')
          .first();
        for (let index = 0; index < 12; index += 1) {
          await tab.hover();
          await page.waitForTimeout(60);
          await close.hover({ force: true });
          await page.waitForTimeout(60);
        }
      });

      await record(page, `${tag} tab switching`, async () => {
        for (let index = 0; index < 8; index += 1) {
          await switchTab.click();
          await page.waitForTimeout(80);
          await longTab.click();
          await page.waitForTimeout(80);
        }
        await page.waitForTimeout(200);
      });
      await expect(longTab).toHaveAttribute('aria-selected', 'true');

      await record(page, `${tag} sidebar toggle`, async () => {
        const toggle = page
          .locator('.icon-rail__button--sidebar, .titlebar__sidebar-toggle')
          .first();
        for (let index = 0; index < 6; index += 1) {
          await toggle.click();
          await page.waitForTimeout(320);
        }
      });

      await record(page, `${tag} typing`, async () => {
        await editor.click();
        await page.keyboard.type('performance probe line', { delay: 45 });
        await page.waitForTimeout(300);
      });

      await record(page, `${tag} scroll: wheel`, async () => {
        const box = await editor.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        }
        for (let index = 0; index < 60; index += 1) {
          await page.mouse.wheel(0, 240);
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(400);
      });

      await editor.evaluate((root) => {
        const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop = Math.round(maximum * 0.18);
        root.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await page.waitForTimeout(300);
      await record(page, `${tag} scroll: wheel burst`, async () => {
        const box = await editor.boundingBox();
        if (!box) {
          throw new Error('The source editor has no box for fast wheel input.');
        }
        await page.mouse.move(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        for (let burst = 0; burst < 6; burst += 1) {
          for (let sample = 0; sample < 10; sample += 1) {
            await page.mouse.wheel(0, 720);
          }
          await page.waitForTimeout(30);
        }
        await page.waitForTimeout(500);
      });

      await prepareScrollbarThumb(page, editor);
      await record(page, `${tag} scroll: scrollbar thumb`, () =>
        dragScrollbarThumb(page, editor),
      );
      await editor.evaluate((root) => {
        root.scrollTop = Math.round(root.scrollHeight * 0.35);
        root.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await page.waitForTimeout(400);

      await record(page, `${tag} pane open`, async () => {
        await page
          .locator('.workspace-pane--active')
          .getByRole('button', { name: labels.paneMenu })
          .click();
        await page
          .locator('.flyoff-menu__item[id$="-item-split-right"]')
          .click();
        await expect(page.locator('.workspace-pane')).toHaveCount(2);
        await page.waitForTimeout(1_200);
      });

      // The divider only exists once a split does, so this follows the open.
      const divider = page.locator('.workspace-split__divider').first();
      await expect(divider).toBeVisible();
      await record(page, `${tag} divider drag`, async () => {
        const box = await divider.boundingBox();
        if (!box) {
          throw new Error('The split divider has no box to drag.');
        }
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        for (let step = 0; step < 40; step += 1) {
          const offset = Math.sin(step / 5) * 140;
          await page.mouse.move(box.x + box.width / 2 + offset, y);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        await page.waitForTimeout(400);
      });

      await record(page, `${tag} pane close`, async () => {
        await page
          .locator('.workspace-pane--active .page-tab__close')
          .first()
          .click();
        await expect(page.locator('.workspace-pane')).toHaveCount(1);
        await page.waitForTimeout(1_200);
      });

      const diagnostics = await editor.evaluate((root) => ({
        error: root.dataset.anchorError,
        generation: root.dataset.anchorGeneration,
        line: root.dataset.anchorLine,
        passes: root.dataset.anchorPasses,
      }));
      anchorDiagnostics[tag] = diagnostics;
      console.log(
        `[cadence] ${tag} anchor diagnostics ${JSON.stringify(diagnostics)}`,
      );
    }

    await runScenarios('1x');

    // This container renders in software but still delivers frames at 16.7 ms,
    // so at full speed it has budget to spare and hides whatever the assembled
    // application spends per frame. Throttling the main thread is what makes
    // that spend visible: a scenario that stays at the display cadence here is
    // not main-thread bound, and one that collapses is.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    try {
      await runScenarios('6x');
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    completed = true;

    const idle = reports.get('1x idle');
    const transform = reports.get('1x control: transform');

    // The machine has to be able to hit the display cadence at rest, or none of
    // the numbers above mean anything.
    expect(
      idle?.medianMs,
      `idle cadence was ${idle?.medianMs}ms, so this run cannot judge anything else`,
    ).toBeLessThan(20);
    expect(
      transform?.medianMs,
      `a compositor-only animation ran at ${transform?.medianMs}ms`,
    ).toBeLessThan(20);
  } finally {
    try {
      await saveCadenceReport({
        anchorDiagnostics,
        completed,
        completedAt: new Date().toISOString(),
        outputPath,
        reports,
        runtime,
        startedAt,
      });
    } finally {
      await stopApplication(app);
      await rm(userDataPath, { force: true, recursive: true });
      await rm(projectParent, { force: true, recursive: true });
    }
  }
});
