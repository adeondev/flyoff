import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  App,
  BrowserWindow,
  ContentTracing,
  MouseInputEvent,
  MouseWheelInputEvent,
  Screen,
} from 'electron';

import {
  rendererPerformanceDiagnosticSource,
  type DiagnosticCadenceReport,
  type DiagnosticRect,
  type DiagnosticScrollbarGeometry,
  type DiagnosticSourceLayoutWork,
  type PerformanceDiagnosticAblation,
  type RendererDiagnosticEnvironment,
} from './renderer-performance-diagnostic';
import {
  collectRuntimeDiagnostics,
  type RuntimeDiagnosticsReport,
} from './runtime-diagnostics';
import {
  analyzeChromiumTrace,
  type ChromiumTraceAnalysis,
} from './chromium-trace-analysis';

export const PERFORMANCE_DIAGNOSTIC_SWITCH =
  'flyoff-performance-diagnostic';
export const PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH =
  'flyoff-performance-diagnostic-suite';
export const PERFORMANCE_DIAGNOSTIC_TRACE_SWITCH =
  'flyoff-performance-diagnostic-trace';
export const PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH =
  'flyoff-performance-diagnostic-ablation';

export type PackagedPerformanceDiagnosticSuite =
  | 'controls'
  | 'full'
  | 'resize';
export type PackagedPerformanceDiagnosticTraceMode = 'full' | 'off';

const TRACE_CATEGORIES = [
  'benchmark',
  'blink',
  'blink.user_timing',
  'cc',
  'electron',
  'gpu',
  'input',
  'input.scrolling',
  'latency',
  'renderer.scheduler',
  'toplevel',
  'viz',
  'disabled-by-default-display.framedisplayed',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
] as const;

const CPU_PROFILE_SCENARIOS = new Set([
  '1x scroll: wheel',
  '1x divider drag',
  '6x typing',
  '6x scroll: wheel',
  '6x divider drag',
]);

export interface PackagedPerformanceDiagnosticOptions {
  ablation: PerformanceDiagnosticAblation;
  lineCount: number;
  reportPath: string;
  suite: PackagedPerformanceDiagnosticSuite;
  traceMode: PackagedPerformanceDiagnosticTraceMode;
  tracePath: string;
}

export interface CpuProfileAttribution {
  samples: number;
  topSelfTime: readonly {
    location: string;
    milliseconds: number;
  }[];
}

export interface PackagedPerformanceScenarioReport {
  cadence: DiagnosticCadenceReport;
  cpuProfile?: CpuProfileAttribution;
  sourceLayoutWork: {
    after: DiagnosticSourceLayoutWork;
    before: DiagnosticSourceLayoutWork;
    delta: DiagnosticSourceLayoutWork;
  } | null;
}

export interface PackagedPerformanceDiagnosticReport {
  ablation: PerformanceDiagnosticAblation;
  appMetrics: unknown;
  createdAt: string;
  renderer: RendererDiagnosticEnvironment;
  runtime: RuntimeDiagnosticsReport;
  scenarios: Record<string, PackagedPerformanceScenarioReport>;
  schemaVersion: 2;
  trace: {
    analysis: ChromiumTraceAnalysis | null;
    categories: readonly string[];
    path: string | null;
  };
}

interface CpuProfileNode {
  callFrame: {
    functionName: string;
    lineNumber: number;
    url: string;
  };
  id: number;
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

interface PerformanceDiagnosticDependencies {
  application: App;
  contentTracing: ContentTracing;
  screen: Screen;
  window: BrowserWindow;
}

function diagnosticSwitchValue(argv: readonly string[]): string | undefined {
  const prefix = `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=`;
  const matches = argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length > 1) {
    throw new Error('Only one performance diagnostic output may be specified.');
  }
  return matches[0]?.slice(prefix.length);
}

function optionalSwitchValue(
  argv: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const matches = argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length > 1) {
    throw new Error(`Only one --${name} value may be specified.`);
  }
  return matches[0]?.slice(prefix.length);
}

export function parsePackagedPerformanceDiagnosticOptions(
  argv: readonly string[],
): PackagedPerformanceDiagnosticOptions | null {
  const value = diagnosticSwitchValue(argv);
  if (value === undefined) {
    return null;
  }
  if (!value || !path.isAbsolute(value) || path.extname(value) !== '.json') {
    throw new Error(
      `--${PERFORMANCE_DIAGNOSTIC_SWITCH} must name an absolute .json file.`,
    );
  }
  const reportPath = path.normalize(value);
  const extension = path.extname(reportPath);
  const ablation = optionalSwitchValue(
    argv,
    PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH,
  ) ?? 'current';
  const suite = optionalSwitchValue(
    argv,
    PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH,
  ) ?? (ablation === 'editor-static' ? 'resize' : 'full');
  const traceMode = optionalSwitchValue(
    argv,
    PERFORMANCE_DIAGNOSTIC_TRACE_SWITCH,
  ) ?? 'full';
  if (suite !== 'controls' && suite !== 'full' && suite !== 'resize') {
    throw new Error(
      `--${PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH} must be controls, resize, or full.`,
    );
  }
  if (traceMode !== 'full' && traceMode !== 'off') {
    throw new Error(
      `--${PERFORMANCE_DIAGNOSTIC_TRACE_SWITCH} must be full or off.`,
    );
  }
  if (
    ablation !== 'container-queries-off' &&
    ablation !== 'current' &&
    ablation !== 'editor-static' &&
    ablation !== 'transitions-off'
  ) {
    throw new Error(
      `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH} must be current, editor-static, transitions-off, or container-queries-off.`,
    );
  }
  if (ablation === 'editor-static' && suite === 'full') {
    throw new Error(
      `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=editor-static cannot run the full editor suite. Use --${PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH}=resize or controls.`,
    );
  }
  return {
    ablation,
    lineCount: 11_000,
    reportPath,
    suite,
    traceMode,
    tracePath: `${reportPath.slice(0, -extension.length)}.trace.json`,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function point(rectangle: DiagnosticRect): { x: number; y: number } {
  return {
    x: Math.round(rectangle.x + rectangle.width / 2),
    y: Math.round(rectangle.y + rectangle.height / 2),
  };
}

function mouseEvent(
  type: MouseInputEvent['type'],
  coordinates: { x: number; y: number },
  button?: MouseInputEvent['button'],
): MouseInputEvent {
  return {
    ...(button ? { button } : {}),
    clickCount: button ? 1 : undefined,
    type,
    x: Math.round(coordinates.x),
    y: Math.round(coordinates.y),
  };
}

function wheelEvent(
  coordinates: { x: number; y: number },
  deltaY: number,
): MouseWheelInputEvent {
  return {
    canScroll: true,
    deltaX: 0,
    deltaY,
    hasPreciseScrollingDeltas: true,
    type: 'mouseWheel',
    wheelTicksX: 0,
    wheelTicksY: deltaY / 120,
    x: Math.round(coordinates.x),
    y: Math.round(coordinates.y),
  };
}

function summariseCpuProfile(profile: CpuProfile): CpuProfileAttribution {
  const elapsedByNode = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const node = samples[index];
    if (node !== undefined) {
      elapsedByNode.set(
        node,
        (elapsedByNode.get(node) ?? 0) + (deltas[index] ?? 0),
      );
    }
  }
  const byLocation = new Map<string, number>();
  for (const node of profile.nodes) {
    const elapsed = elapsedByNode.get(node.id);
    if (!elapsed) {
      continue;
    }
    const filename = node.callFrame.url.split('/').at(-1) ?? '';
    const location = `${node.callFrame.functionName || '(anonymous)'} @${filename}:${
      node.callFrame.lineNumber + 1
    }`;
    byLocation.set(location, (byLocation.get(location) ?? 0) + elapsed);
  }
  return {
    samples: samples.length,
    topSelfTime: [...byLocation]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 30)
      .map(([location, microseconds]) => ({
        location,
        milliseconds: Number((microseconds / 1_000).toFixed(2)),
      })),
  };
}

function sourceLayoutWorkDelta(
  after: DiagnosticSourceLayoutWork,
  before: DiagnosticSourceLayoutWork,
): DiagnosticSourceLayoutWork {
  return {
    coalescedResizeNotifications:
      after.coalescedResizeNotifications - before.coalescedResizeNotifications,
    fullLayoutResets: after.fullLayoutResets - before.fullLayoutResets,
    heightMapRebuilds: after.heightMapRebuilds - before.heightMapRebuilds,
    insignificantResizePasses:
      after.insignificantResizePasses - before.insignificantResizePasses,
    liveResizePasses: after.liveResizePasses - before.liveResizePasses,
    resizeNotifications:
      after.resizeNotifications - before.resizeNotifications,
    scheduledLayoutPasses:
      after.scheduledLayoutPasses - before.scheduledLayoutPasses,
    settledResizeRebuilds:
      after.settledResizeRebuilds - before.settledResizeRebuilds,
    skippedWidthRebuilds:
      after.skippedWidthRebuilds - before.skippedWidthRebuilds,
  };
}

async function controllerCall<T>(
  window: BrowserWindow,
  expression: string,
): Promise<T> {
  return window.webContents.executeJavaScript(
    `window.__flyoffPerformanceDiagnostic?.${expression}`,
    true,
  ) as Promise<T>;
}

async function waitForSelector(
  window: BrowserWindow,
  selector: string,
  timeoutMs = 10_000,
  minimumCount = 1,
): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const found = await window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll(${JSON.stringify(
        selector,
      )})).filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).length >= ${minimumCount}`,
      true,
    );
    if (found) {
      return;
    }
    await wait(16);
  }
  throw new Error(`Timed out waiting for diagnostic selector: ${selector}`);
}

async function click(
  window: BrowserWindow,
  selector: string,
  index = 0,
): Promise<void> {
  await controllerCall<void>(
    window,
    `click(${JSON.stringify(selector)}, ${index})`,
  );
}

async function movePointer(
  window: BrowserWindow,
  coordinates: { x: number; y: number },
): Promise<void> {
  window.webContents.sendInputEvent(mouseEvent('mouseMove', coordinates));
}

async function dragPointer(
  window: BrowserWindow,
  start: { x: number; y: number },
  end: { x: number; y: number },
  steps: number,
): Promise<void> {
  await movePointer(window, start);
  window.webContents.sendInputEvent(mouseEvent('mouseDown', start, 'left'));
  for (let step = 1; step <= steps; step += 1) {
    const share = step / steps;
    const next = {
      x: start.x + (end.x - start.x) * share,
      y: start.y + (end.y - start.y) * share,
    };
    window.webContents.sendInputEvent(mouseEvent('mouseMove', next, 'left'));
    await wait(16);
  }
  window.webContents.sendInputEvent(mouseEvent('mouseUp', end, 'left'));
}

async function beginCpuProfile(window: BrowserWindow): Promise<void> {
  await window.webContents.debugger.sendCommand('Profiler.start');
}

async function endCpuProfile(
  window: BrowserWindow,
): Promise<CpuProfileAttribution> {
  const result = (await window.webContents.debugger.sendCommand(
    'Profiler.stop',
  )) as { profile: CpuProfile };
  return summariseCpuProfile(result.profile);
}

async function writeReport(
  reportPath: string,
  report: PackagedPerformanceDiagnosticReport,
): Promise<void> {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

export async function runPackagedPerformanceDiagnostic(
  dependencies: PerformanceDiagnosticDependencies,
  options: PackagedPerformanceDiagnosticOptions,
): Promise<PackagedPerformanceDiagnosticReport> {
  const { application, contentTracing, screen, window } = dependencies;
  await access(path.dirname(options.reportPath));
  await Promise.all([
    access(options.reportPath).then(
      () => Promise.reject(new Error(`Report already exists: ${options.reportPath}`)),
      () => undefined,
    ),
    ...(options.traceMode === 'full'
      ? [
          access(options.tracePath).then(
            () =>
              Promise.reject(
                new Error(`Trace already exists: ${options.tracePath}`),
              ),
            () => undefined,
          ),
        ]
      : []),
  ]);

  window.focus();
  const display = screen.getDisplayMatching(window.getBounds());
  const refreshRate = display.displayFrequency > 0
    ? display.displayFrequency
    : 60;
  const renderer = (await window.webContents.executeJavaScript(
    rendererPerformanceDiagnosticSource({
      ablation: options.ablation,
      lineCount: options.lineCount,
      refreshRate,
    }),
    true,
  )) as RendererDiagnosticEnvironment;
  if (
    options.ablation === 'editor-static' &&
    (!renderer.editor.static ||
      renderer.editor.descendantNodes !== 0 ||
      renderer.editor.mountedLines !== 0)
  ) {
    throw new Error(
      'The editor-static ablation did not produce an empty static editor rectangle.',
    );
  }

  const debuggerSession = window.webContents.debugger;
  debuggerSession.attach('1.3');
  await debuggerSession.sendCommand('Profiler.enable');
  await debuggerSession.sendCommand('Profiler.setSamplingInterval', {
    interval: 200,
  });

  const scenarios: Record<string, PackagedPerformanceScenarioReport> = {};
  let tracing = false;
  let traceRecorded = false;
  try {
    if (options.traceMode === 'full') {
      await contentTracing.startRecording({
        enable_argument_filter: false,
        included_categories: [...TRACE_CATEGORIES],
        recording_mode: 'record-continuously',
        trace_buffer_size_in_kb: 256 * 1_024,
      });
      tracing = true;
    }

    const record = async (
      label: string,
      action: () => Promise<void>,
    ): Promise<void> => {
      const profile = CPU_PROFILE_SCENARIOS.has(label);
      const sourceLayoutBefore = await controllerCall<
        DiagnosticSourceLayoutWork | null
      >(window, 'sourceLayoutWork()');
      if (profile) {
        await beginCpuProfile(window);
      }
      await controllerCall<void>(window, `start(${JSON.stringify(label)})`);
      let cadence: DiagnosticCadenceReport;
      try {
        await action();
      } finally {
        cadence = await controllerCall<DiagnosticCadenceReport>(
          window,
          `finish(${JSON.stringify(label)})`,
        );
      }
      const sourceLayoutAfter = await controllerCall<
        DiagnosticSourceLayoutWork | null
      >(window, 'sourceLayoutWork()');
      scenarios[label] = {
        cadence,
        ...(profile ? { cpuProfile: await endCpuProfile(window) } : {}),
        sourceLayoutWork: sourceLayoutBefore && sourceLayoutAfter
          ? {
              after: sourceLayoutAfter,
              before: sourceLayoutBefore,
              delta: sourceLayoutWorkDelta(
                sourceLayoutAfter,
                sourceLayoutBefore,
              ),
            }
          : null,
      };
      process.stdout.write(
        `[performance] ${label}: median=${cadence.medianMs}ms p95=${cadence.p95Ms}ms p99=${cadence.p99Ms}ms max=${cadence.longestMs}ms longTasks=${cadence.longTasks}\n`,
      );
    };

    await record('1x idle', () => wait(5_000));
    for (const kind of ['transform', 'opacity', 'left', 'transform-js'] as const) {
      await record(`1x control: ${kind}`, () =>
        controllerCall<void>(window, `runControl(${JSON.stringify(kind)}, 4000)`),
      );
    }
    if (options.suite === 'full') {
    await record('1x hover: tabs', async () => {
      const tabs = await controllerCall<DiagnosticRect[]>(window, 'tabRects()');
      if (tabs.length === 0) {
        throw new Error('No visible tab is available for the hover scenario.');
      }
      const tab = point(tabs[0]!);
      const closeRect = await controllerCall<DiagnosticRect>(
        window,
        `rect('.page-tab__close', 0)`,
      );
      const close = point(closeRect);
      for (let index = 0; index < 32; index += 1) {
        await movePointer(window, tab);
        await wait(80);
        await movePointer(window, close);
        await wait(80);
      }
    });
    await record('1x sidebar toggle', async () => {
      for (let index = 0; index < 16; index += 1) {
        await click(
          window,
          '.icon-rail__button--sidebar, .titlebar__sidebar-toggle',
        );
        await wait(320);
      }
    });
    await record('1x tab switching', async () => {
      const tabs = await controllerCall<DiagnosticRect[]>(window, 'tabRects()');
      if (tabs.length < 2) {
        throw new Error('Two visible tabs are required for tab switching.');
      }
      for (let index = 0; index < 40; index += 1) {
        await click(window, '.page-tab__trigger', index % 2);
        await wait(100);
      }
      await click(window, '.page-tab__trigger', 1);
      await wait(300);
    });
    await record('1x typing', async () => {
      await controllerCall<void>(window, 'focusEditor()');
      const text = 'performance probe line '.repeat(4);
      for (const character of text) {
        window.webContents.insertText(character);
        await wait(45);
      }
      await wait(300);
    });
    await record('1x scroll: wheel', async () => {
      const editor = await controllerCall<DiagnosticRect>(
        window,
        `rect('.markdown-source__editor', 0)`,
      );
      const centre = point(editor);
      await movePointer(window, centre);
      for (let index = 0; index < 240; index += 1) {
        window.webContents.sendInputEvent(wheelEvent(centre, 240));
        await wait(16);
      }
      await wait(400);
    });
    await record('1x scroll: fast bursts', async () => {
      const editor = await controllerCall<DiagnosticRect>(
        window,
        `rect('.markdown-source__editor', 0)`,
      );
      const centre = point(editor);
      await movePointer(window, centre);
      for (let burst = 0; burst < 40; burst += 1) {
        for (let sample = 0; sample < 5; sample += 1) {
          window.webContents.sendInputEvent(wheelEvent(centre, 560));
        }
        await wait(80);
      }
      await wait(400);
    });
    await record('1x scroll: thumb drag', async () => {
      const geometry = await controllerCall<DiagnosticScrollbarGeometry>(
        window,
        'scrollbarGeometry()',
      );
      if (geometry.maximumScrollTop <= 0) {
        throw new Error('The editor does not expose a scrollable range.');
      }
      await dragPointer(window, geometry.start, geometry.end, 120);
      await wait(400);
    });
    }
    if (options.suite !== 'controls') {
    await record('1x pane open', async () => {
      await click(window, '.workspace-pane--active .workspace-pane__action');
      await waitForSelector(window, '.flyoff-menu__item[id$="-item-split-right"]');
      await click(window, '.flyoff-menu__item[id$="-item-split-right"]');
      await waitForSelector(window, '.workspace-pane', 10_000, 2);
      if (options.ablation === 'editor-static') {
        await waitForSelector(
          window,
          '.markdown-source__editor[data-performance-static-editor="true"]',
          10_000,
          2,
        );
      }
      await wait(1_200);
    });
    await record('1x divider drag', async () => {
      const divider = await controllerCall<DiagnosticRect>(
        window,
        `rect('.workspace-split__divider', 0)`,
      );
      const start = point(divider);
      await movePointer(window, start);
      window.webContents.sendInputEvent(mouseEvent('mouseDown', start, 'left'));
      for (let step = 0; step < 120; step += 1) {
        const next = {
          x: start.x + Math.sin(step / 8) * 140,
          y: start.y,
        };
        window.webContents.sendInputEvent(mouseEvent('mouseMove', next, 'left'));
        await wait(16);
      }
      window.webContents.sendInputEvent(mouseEvent('mouseUp', start, 'left'));
      await wait(400);
    });
    await record('1x pane close', async () => {
      await click(window, '.workspace-pane--active .page-tab__close');
      await waitForSelector(window, '.workspace-pane');
      await wait(1_200);
    });

    await debuggerSession.sendCommand('Emulation.setCPUThrottlingRate', {
      rate: 6,
    });
    await record('6x idle', () => wait(5_000));
    if (options.suite === 'full') {
    await record('6x typing', async () => {
      await controllerCall<void>(window, 'focusEditor()');
      for (const character of 'throttled typing probe') {
        window.webContents.insertText(character);
        await wait(45);
      }
      await wait(300);
    });
    await record('6x scroll: wheel', async () => {
      const editor = await controllerCall<DiagnosticRect>(
        window,
        `rect('.markdown-source__editor', 0)`,
      );
      const centre = point(editor);
      await movePointer(window, centre);
      for (let index = 0; index < 120; index += 1) {
        window.webContents.sendInputEvent(wheelEvent(centre, -240));
        await wait(16);
      }
      await wait(400);
    });
    }
    await record('6x pane open', async () => {
      await click(window, '.workspace-pane--active .workspace-pane__action');
      await waitForSelector(window, '.flyoff-menu__item[id$="-item-split-right"]');
      await click(window, '.flyoff-menu__item[id$="-item-split-right"]');
      await waitForSelector(window, '.workspace-pane', 10_000, 2);
      if (options.ablation === 'editor-static') {
        await waitForSelector(
          window,
          '.markdown-source__editor[data-performance-static-editor="true"]',
          10_000,
          2,
        );
      }
      await wait(1_200);
    });
    await record('6x divider drag', async () => {
      const divider = await controllerCall<DiagnosticRect>(
        window,
        `rect('.workspace-split__divider', 0)`,
      );
      const start = point(divider);
      await movePointer(window, start);
      window.webContents.sendInputEvent(mouseEvent('mouseDown', start, 'left'));
      for (let step = 0; step < 60; step += 1) {
        const next = {
          x: start.x + Math.sin(step / 6) * 140,
          y: start.y,
        };
        window.webContents.sendInputEvent(mouseEvent('mouseMove', next, 'left'));
        await wait(16);
      }
      window.webContents.sendInputEvent(mouseEvent('mouseUp', start, 'left'));
      await wait(400);
    });
    await record('6x pane close', async () => {
      await click(window, '.workspace-pane--active .page-tab__close');
      await wait(1_200);
    });
    }
  } finally {
    await debuggerSession
      .sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 })
      .catch(() => undefined);
    if (debuggerSession.isAttached()) {
      debuggerSession.detach();
    }
    if (tracing) {
      await contentTracing.stopRecording(options.tracePath);
      traceRecorded = true;
    }
  }

  const runtime = await collectRuntimeDiagnostics({
    application,
    screen,
    window,
  });
  const traceAnalysis = traceRecorded
    ? analyzeChromiumTrace(await readFile(options.tracePath, 'utf8'), {
        refreshIntervalMs: 1_000 / refreshRate,
      })
    : null;
  const report: PackagedPerformanceDiagnosticReport = {
    ablation: options.ablation,
    appMetrics: application.getAppMetrics(),
    createdAt: new Date().toISOString(),
    renderer,
    runtime,
    scenarios,
    schemaVersion: 2,
    trace: {
      analysis: traceAnalysis,
      categories: traceRecorded ? TRACE_CATEGORIES : [],
      path: traceRecorded ? options.tracePath : null,
    },
  };
  await writeReport(options.reportPath, report);
  return report;
}
