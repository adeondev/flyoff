import { describe, expect, it, vi } from 'vitest';

import { applyHardwareAccelerationPreference } from '../../src/main/preferences';
import { createDefaultFlyoffPreferences } from '../../src/shared/contracts';

describe('hardware acceleration preference', () => {
  it('keeps GPU acceleration enabled by default', () => {
    const application = { disableHardwareAcceleration: vi.fn() };

    applyHardwareAccelerationPreference(
      application,
      createDefaultFlyoffPreferences(),
    );

    expect(application.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it('disables GPU acceleration before startup when requested', () => {
    const application = { disableHardwareAcceleration: vi.fn() };
    const preferences = createDefaultFlyoffPreferences();
    preferences.general.hardwareAcceleration = false;

    applyHardwareAccelerationPreference(application, preferences);

    expect(application.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });
});
