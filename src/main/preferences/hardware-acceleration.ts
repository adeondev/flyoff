import type { App } from 'electron';

import type { FlyoffPreferences } from '../../shared/contracts';

export function applyHardwareAccelerationPreference(
  application: Pick<App, 'disableHardwareAcceleration'>,
  preferences: FlyoffPreferences,
): void {
  if (!preferences.general.hardwareAcceleration) {
    application.disableHardwareAcceleration();
  }
}
