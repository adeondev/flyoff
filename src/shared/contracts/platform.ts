export const FLYOFF_PLATFORMS = ['win32', 'linux', 'darwin'] as const;

export type FlyoffPlatform = (typeof FLYOFF_PLATFORMS)[number];

export function isFlyoffPlatform(value: unknown): value is FlyoffPlatform {
  return (
    typeof value === 'string' &&
    (FLYOFF_PLATFORMS as readonly string[]).includes(value)
  );
}
