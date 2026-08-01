import type { App, CommandLine } from 'electron';

import type {
  FlyoffPreferences,
  GraphicsBackend,
} from '../../shared/contracts';

type HardwareAccelerationApplication = Pick<
  App,
  'disableHardwareAcceleration'
> & {
  commandLine: Pick<CommandLine, 'appendSwitch'>;
};

export function resolveGraphicsBackend(
  preferences: FlyoffPreferences,
  platform: NodeJS.Platform,
): GraphicsBackend {
  return platform === 'win32'
    ? preferences.general.graphicsBackend
    : 'automatic';
}

export function applyHardwareAccelerationPreference(
  application: HardwareAccelerationApplication,
  preferences: FlyoffPreferences,
  platform: NodeJS.Platform = process.platform,
): GraphicsBackend {
  const graphicsBackend = resolveGraphicsBackend(preferences, platform);
  if (graphicsBackend === 'opengl') {
    application.commandLine.appendSwitch('use-angle', 'gl');
  }
  if (!preferences.general.hardwareAcceleration) {
    application.disableHardwareAcceleration();
  }
  return graphicsBackend;
}
