import { describe, expect, it, vi } from 'vitest';

import { applyHardwareAccelerationPreference } from '../../src/main/preferences';
import { createDefaultFlyoffPreferences } from '../../src/shared/contracts';

describe('hardware acceleration preference', () => {
  it('keeps GPU acceleration enabled by default', () => {
    const application = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    };

    const backend = applyHardwareAccelerationPreference(
      application,
      createDefaultFlyoffPreferences(),
      'win32',
    );

    expect(backend).toBe('automatic');
    expect(application.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(application.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it('disables GPU acceleration before startup when requested', () => {
    const application = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    };
    const preferences = createDefaultFlyoffPreferences();
    preferences.general.hardwareAcceleration = false;

    applyHardwareAccelerationPreference(application, preferences, 'win32');

    expect(application.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  it('selects the OpenGL ANGLE backend on Windows without disabling compositing', () => {
    const application = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    };
    const preferences = createDefaultFlyoffPreferences();
    preferences.general.graphicsBackend = 'opengl';

    const backend = applyHardwareAccelerationPreference(
      application,
      preferences,
      'win32',
    );

    expect(backend).toBe('opengl');
    expect(application.commandLine.appendSwitch).toHaveBeenCalledWith(
      'use-angle',
      'gl',
    );
    expect(application.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it('keeps the automatic backend on non-Windows platforms', () => {
    const application = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    };
    const preferences = createDefaultFlyoffPreferences();
    preferences.general.graphicsBackend = 'opengl';

    const backend = applyHardwareAccelerationPreference(
      application,
      preferences,
      'linux',
    );

    expect(backend).toBe('automatic');
    expect(application.commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
