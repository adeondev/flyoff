import type { Display, GPUFeatureStatus, Rectangle } from 'electron';

export const RUNTIME_DIAGNOSTIC_SWITCHES = [
  'disable-background-timer-throttling',
  'disable-backgrounding-occluded-windows',
  'disable-frame-rate-limit',
  'disable-gpu',
  'disable-gpu-compositing',
  'disable-gpu-vsync',
  'disable-renderer-backgrounding',
  'disable-software-rasterizer',
  'enable-features',
  'enable-gpu-benchmarking',
  'enable-gpu-rasterization',
  'enable-logging',
  'force-device-scale-factor',
  'gpu-startup-dialog',
  'ignore-gpu-blocklist',
  'in-process-gpu',
  'log-file',
  'log-gpu-control-list-decisions',
  'remote-allow-origins',
  'remote-debugging-address',
  'remote-debugging-pipe',
  'remote-debugging-port',
  'trace-startup',
  'trace-startup-duration',
  'trace-startup-file',
  'trace-startup-format',
  'trace-startup-record-mode',
  'use-angle',
  'use-gl',
] as const;

export type RuntimeDiagnosticSwitchName =
  (typeof RUNTIME_DIAGNOSTIC_SWITCHES)[number];

export interface RuntimeVersionSource {
  chrome?: string;
  electron?: string;
  node?: string;
  v8?: string;
}

export interface RuntimeVersionDiagnostics {
  chromium: string | null;
  electron: string | null;
  node: string | null;
  v8: string | null;
}

export interface RuntimeArgvSwitch {
  name: string;
  value: string | null;
}

export interface RuntimeChromiumSwitch {
  name: RuntimeDiagnosticSwitchName;
  value: string | null;
}

export interface RuntimeCommandLineDiagnostics {
  argv: string[];
  argvSwitches: RuntimeArgvSwitch[];
  chromiumSwitchEnumerationSupported: false;
  observedChromiumSwitches: RuntimeChromiumSwitch[];
}

export interface RuntimeDiagnosticError {
  message: string;
  name: string;
}

export interface RuntimeGpuDiagnostics {
  completeInfo: Readonly<Record<string, unknown>> | null;
  completeInfoError: RuntimeDiagnosticError | null;
  featureStatus: GPUFeatureStatus;
  hardwareAccelerationEnabled: boolean;
}

export interface RuntimeDisplayDiagnostics {
  bounds: Rectangle;
  colorDepth: number;
  colorSpace: string;
  depthPerComponent: number;
  detected: boolean;
  displayFrequency: number;
  id: number;
  internal: boolean;
  label: string;
  rotation: number;
  scaleFactor: number;
  size: Display['size'];
  touchSupport: Display['touchSupport'];
  workArea: Rectangle;
}

export interface RuntimeWindowDiagnostics {
  bounds: Rectangle;
  focused: boolean;
  minimized: boolean;
  visible: boolean;
}

export interface RuntimeDiagnosticsReport {
  commandLine: RuntimeCommandLineDiagnostics;
  display: RuntimeDisplayDiagnostics;
  gpu: RuntimeGpuDiagnostics;
  isPackaged: boolean;
  versions: RuntimeVersionDiagnostics;
  window: RuntimeWindowDiagnostics | null;
}

export interface RuntimeDiagnosticsCommandLine {
  getSwitchValue(name: string): string;
  hasSwitch(name: string): boolean;
}

export interface RuntimeDiagnosticsApplication {
  readonly commandLine: RuntimeDiagnosticsCommandLine;
  readonly isPackaged: boolean;
  getGPUFeatureStatus(): GPUFeatureStatus;
  getGPUInfo(infoType: 'complete'): Promise<unknown>;
  isHardwareAccelerationEnabled(): boolean;
}

type RuntimeDisplaySource = Pick<
  Display,
  | 'bounds'
  | 'colorDepth'
  | 'colorSpace'
  | 'depthPerComponent'
  | 'detected'
  | 'displayFrequency'
  | 'id'
  | 'internal'
  | 'label'
  | 'rotation'
  | 'scaleFactor'
  | 'size'
  | 'touchSupport'
  | 'workArea'
>;

export interface RuntimeDiagnosticsScreen {
  getDisplayMatching(rectangle: Rectangle): RuntimeDisplaySource;
  getPrimaryDisplay(): RuntimeDisplaySource;
}

export interface RuntimeDiagnosticsWindow {
  getBounds(): Rectangle;
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
}

export interface RuntimeDiagnosticsOptions {
  application: RuntimeDiagnosticsApplication;
  argv?: readonly string[];
  screen: RuntimeDiagnosticsScreen;
  versions?: RuntimeVersionSource;
  window?: RuntimeDiagnosticsWindow | null;
}

function copyRectangle(rectangle: Rectangle): Rectangle {
  return {
    height: rectangle.height,
    width: rectangle.width,
    x: rectangle.x,
    y: rectangle.y,
  };
}

function parseArgvSwitches(argv: readonly string[]): RuntimeArgvSwitch[] {
  const switches: RuntimeArgvSwitch[] = [];

  for (const argument of argv) {
    if (argument === '--') {
      break;
    }
    if (!argument.startsWith('--') || argument.length === 2) {
      continue;
    }

    const separator = argument.indexOf('=');
    switches.push({
      name: argument.slice(2, separator < 0 ? undefined : separator),
      value: separator < 0 ? null : argument.slice(separator + 1),
    });
  }

  return switches;
}

function collectObservedChromiumSwitches(
  commandLine: RuntimeDiagnosticsCommandLine,
): RuntimeChromiumSwitch[] {
  return RUNTIME_DIAGNOSTIC_SWITCHES.flatMap((name) =>
    commandLine.hasSwitch(name)
      ? [
          {
            name,
            value: commandLine.getSwitchValue(name) || null,
          },
        ]
      : [],
  );
}

function snapshotWindow(
  window: RuntimeDiagnosticsWindow | null | undefined,
): RuntimeWindowDiagnostics | null {
  if (!window || window.isDestroyed()) {
    return null;
  }

  return {
    bounds: copyRectangle(window.getBounds()),
    focused: window.isFocused(),
    minimized: window.isMinimized(),
    visible: window.isVisible(),
  };
}

function snapshotDisplay(display: RuntimeDisplaySource): RuntimeDisplayDiagnostics {
  return {
    bounds: copyRectangle(display.bounds),
    colorDepth: display.colorDepth,
    colorSpace: display.colorSpace,
    depthPerComponent: display.depthPerComponent,
    detected: display.detected,
    displayFrequency: display.displayFrequency,
    id: display.id,
    internal: display.internal,
    label: display.label,
    rotation: display.rotation,
    scaleFactor: display.scaleFactor,
    size: { height: display.size.height, width: display.size.width },
    touchSupport: display.touchSupport,
    workArea: copyRectangle(display.workArea),
  };
}

function normalizeGpuInfo(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return { value };
}

function describeError(error: unknown): RuntimeDiagnosticError {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error), name: 'Error' };
}

function version(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export async function collectRuntimeDiagnostics({
  application,
  argv = process.argv,
  screen,
  versions = process.versions,
  window,
}: RuntimeDiagnosticsOptions): Promise<RuntimeDiagnosticsReport> {
  let completeInfo: Readonly<Record<string, unknown>> | null = null;
  let completeInfoError: RuntimeDiagnosticError | null = null;

  try {
    completeInfo = normalizeGpuInfo(await application.getGPUInfo('complete'));
  } catch (error) {
    completeInfoError = describeError(error);
  }

  const windowSnapshot = snapshotWindow(window);
  const display = windowSnapshot
    ? screen.getDisplayMatching(windowSnapshot.bounds)
    : screen.getPrimaryDisplay();

  return {
    commandLine: {
      argv: [...argv],
      argvSwitches: parseArgvSwitches(argv),
      chromiumSwitchEnumerationSupported: false,
      observedChromiumSwitches: collectObservedChromiumSwitches(
        application.commandLine,
      ),
    },
    display: snapshotDisplay(display),
    gpu: {
      completeInfo,
      completeInfoError,
      featureStatus: { ...application.getGPUFeatureStatus() },
      hardwareAccelerationEnabled:
        application.isHardwareAccelerationEnabled(),
    },
    isPackaged: application.isPackaged,
    versions: {
      chromium: version(versions.chrome),
      electron: version(versions.electron),
      node: version(versions.node),
      v8: version(versions.v8),
    },
    window: windowSnapshot,
  };
}
