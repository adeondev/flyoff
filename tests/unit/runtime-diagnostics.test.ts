import type { GPUFeatureStatus } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  collectRuntimeDiagnostics,
  type RuntimeDiagnosticsApplication,
  type RuntimeDiagnosticsScreen,
  type RuntimeDiagnosticsWindow,
} from '../../src/main/performance/runtime-diagnostics';

const featureStatus: GPUFeatureStatus = {
  '2d_canvas': 'enabled',
  flash_3d: 'unavailable_software',
  flash_stage3d: 'unavailable_software',
  flash_stage3d_baseline: 'unavailable_software',
  gpu_compositing: 'enabled',
  multiple_raster_threads: 'enabled_on',
  native_gpu_memory_buffers: 'enabled',
  rasterization: 'enabled',
  video_decode: 'enabled',
  video_encode: 'enabled',
  vpx_decode: 'enabled',
  webgl: 'enabled',
  webgl2: 'enabled',
};

const display = {
  bounds: { x: 1_920, y: 0, width: 2_560, height: 1_440 },
  colorDepth: 32,
  colorSpace: 'srgb',
  depthPerComponent: 8,
  detected: true,
  displayFrequency: 144,
  id: 2,
  internal: false,
  label: 'External display',
  rotation: 0,
  scaleFactor: 1.25,
  size: { width: 2_048, height: 1_152 },
  touchSupport: 'unavailable' as const,
  workArea: { x: 1_920, y: 0, width: 2_560, height: 1_400 },
};

function createApplication(
  gpuInfo: Promise<unknown> = Promise.resolve({
    auxAttributes: { glRenderer: 'ANGLE (D3D11)' },
    gpuDevice: [{ active: true, deviceId: 2, vendorId: 1 }],
  }),
): RuntimeDiagnosticsApplication {
  const switches = new Map([
    ['disable-gpu-vsync', ''],
    ['use-angle', 'd3d11'],
  ]);

  return {
    commandLine: {
      getSwitchValue: vi.fn((name) => switches.get(name) ?? ''),
      hasSwitch: vi.fn((name) => switches.has(name)),
    },
    getGPUFeatureStatus: vi.fn(() => featureStatus),
    getGPUInfo: vi.fn(() => gpuInfo),
    isHardwareAccelerationEnabled: vi.fn(() => true),
    isPackaged: true,
  };
}

describe('runtime diagnostics', () => {
  it('collects runtime, GPU, command-line, window and matching display data', async () => {
    const application = createApplication();
    const bounds = { x: 2_100, y: 90, width: 1_400, height: 900 };
    const window: RuntimeDiagnosticsWindow = {
      getBounds: vi.fn(() => bounds),
      isDestroyed: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      isVisible: vi.fn(() => true),
    };
    const screen: RuntimeDiagnosticsScreen = {
      getDisplayMatching: vi.fn(() => display),
      getPrimaryDisplay: vi.fn(() => display),
    };

    const report = await collectRuntimeDiagnostics({
      application,
      argv: [
        'Flyoff.exe',
        '--use-angle=d3d11',
        '--trace-startup',
        'note.flyd',
      ],
      screen,
      versions: {
        chrome: '150.0.7871.47',
        electron: '43.1.0',
        node: '24.18.0',
        v8: '15.0.245.13-electron.0',
      },
      window,
    });

    expect(application.getGPUInfo).toHaveBeenCalledWith('complete');
    expect(screen.getDisplayMatching).toHaveBeenCalledWith(bounds);
    expect(screen.getPrimaryDisplay).not.toHaveBeenCalled();
    expect(report.versions).toEqual({
      chromium: '150.0.7871.47',
      electron: '43.1.0',
      node: '24.18.0',
      v8: '15.0.245.13-electron.0',
    });
    expect(report.isPackaged).toBe(true);
    expect(report.gpu).toMatchObject({
      completeInfoError: null,
      featureStatus,
      hardwareAccelerationEnabled: true,
    });
    expect(report.gpu.completeInfo).toEqual({
      auxAttributes: { glRenderer: 'ANGLE (D3D11)' },
      gpuDevice: [{ active: true, deviceId: 2, vendorId: 1 }],
    });
    expect(report.commandLine).toEqual({
      argv: [
        'Flyoff.exe',
        '--use-angle=d3d11',
        '--trace-startup',
        'note.flyd',
      ],
      argvSwitches: [
        { name: 'use-angle', value: 'd3d11' },
        { name: 'trace-startup', value: null },
      ],
      chromiumSwitchEnumerationSupported: false,
      observedChromiumSwitches: [
        { name: 'disable-gpu-vsync', value: null },
        { name: 'use-angle', value: 'd3d11' },
      ],
    });
    expect(report.window).toEqual({
      bounds,
      focused: true,
      minimized: false,
      visible: true,
    });
    expect(report.window).not.toHaveProperty('occluded');
    expect(report.display).toEqual(display);
  });

  it('uses the primary display and retains a GPU error without a live window', async () => {
    const application = createApplication(
      Promise.reject(new Error('GPU process unavailable')),
    );
    const getBounds = vi.fn();
    const window: RuntimeDiagnosticsWindow = {
      getBounds,
      isDestroyed: vi.fn(() => true),
      isFocused: vi.fn(),
      isMinimized: vi.fn(),
      isVisible: vi.fn(),
    };
    const getDisplayMatching = vi.fn(() => display);
    const getPrimaryDisplay = vi.fn(() => display);

    const report = await collectRuntimeDiagnostics({
      application,
      argv: ['Flyoff.exe', '--', '--disable-gpu'],
      screen: { getDisplayMatching, getPrimaryDisplay },
      versions: { node: '24.18.0', v8: '15.0' },
      window,
    });

    expect(getBounds).not.toHaveBeenCalled();
    expect(getDisplayMatching).not.toHaveBeenCalled();
    expect(getPrimaryDisplay).toHaveBeenCalledOnce();
    expect(report.window).toBeNull();
    expect(report.commandLine.argvSwitches).toEqual([]);
    expect(report.gpu.completeInfo).toBeNull();
    expect(report.gpu.completeInfoError).toEqual({
      message: 'GPU process unavailable',
      name: 'Error',
    });
    expect(report.versions).toEqual({
      chromium: null,
      electron: null,
      node: '24.18.0',
      v8: '15.0',
    });
  });
});
