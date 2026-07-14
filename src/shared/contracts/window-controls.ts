export const WINDOW_CONTROL_CHANNEL = 'flyoff:window:control' as const;
export const WINDOW_STATE_CHANNEL = 'flyoff:window:state' as const;
export const WINDOW_STATE_CHANGED_CHANNEL =
  'flyoff:window:state-changed' as const;

export const WINDOW_CONTROL_ACTIONS = [
  'minimize',
  'toggle-maximize',
  'close',
] as const;

export type WindowControlAction =
  (typeof WINDOW_CONTROL_ACTIONS)[number];

export interface WindowState {
  maximized: boolean;
}

const windowControlActions = new Set<unknown>(WINDOW_CONTROL_ACTIONS);

export function isWindowControlAction(
  value: unknown,
): value is WindowControlAction {
  return windowControlActions.has(value);
}

export function isWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof (value as Record<string, unknown>).maximized === 'boolean';
}
