export const UI_STATE_VERSION = 1 as const;

export const GET_UI_STATE_CHANNEL = 'flyoff:ui-state:get' as const;
export const SAVE_UI_STATE_CHANNEL = 'flyoff:ui-state:save' as const;

export const SIDEBAR_WIDTH_MIN = 196;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 248;

export const RAIL_WIDTH_MIN = 40;
export const RAIL_WIDTH_MAX = 240;
export const RAIL_WIDTH_DEFAULT = 44;

export const NOTE_FONT_SCALE_MIN = 0.6;
export const NOTE_FONT_SCALE_MAX = 2.6;
export const NOTE_FONT_SCALE_DEFAULT = 1;

export const DEFAULT_RAIL_VIEW_ID = 'projeto';

export interface WorkspaceLayoutState {
  version: typeof UI_STATE_VERSION;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  railWidth: number;
  railViewId: string;
  noteFontScale: number;
}

export function clampSidebarWidth(value: number): number {
  return Math.min(
    Math.max(Math.round(value), SIDEBAR_WIDTH_MIN),
    SIDEBAR_WIDTH_MAX,
  );
}

export function clampRailWidth(value: number): number {
  return Math.min(Math.max(Math.round(value), RAIL_WIDTH_MIN), RAIL_WIDTH_MAX);
}

export function clampNoteFontScale(value: number): number {
  return Math.min(
    Math.max(Math.round(value * 100) / 100, NOTE_FONT_SCALE_MIN),
    NOTE_FONT_SCALE_MAX,
  );
}

export function createDefaultWorkspaceLayoutState(): WorkspaceLayoutState {
  return {
    version: UI_STATE_VERSION,
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    railWidth: RAIL_WIDTH_DEFAULT,
    railViewId: DEFAULT_RAIL_VIEW_ID,
    noteFontScale: NOTE_FONT_SCALE_DEFAULT,
  };
}

export function isWorkspaceLayoutState(
  value: unknown,
): value is WorkspaceLayoutState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Record<string, unknown>;

  return (
    state.version === UI_STATE_VERSION &&
    typeof state.sidebarCollapsed === 'boolean' &&
    typeof state.sidebarWidth === 'number' &&
    Number.isFinite(state.sidebarWidth) &&
    typeof state.railWidth === 'number' &&
    Number.isFinite(state.railWidth) &&
    typeof state.railViewId === 'string' &&
    state.railViewId.length > 0 &&
    typeof state.noteFontScale === 'number' &&
    Number.isFinite(state.noteFontScale)
  );
}

export function normalizeWorkspaceLayoutState(
  value: unknown,
): WorkspaceLayoutState {
  const defaults = createDefaultWorkspaceLayoutState();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const state = value as Record<string, unknown>;

  return {
    version: UI_STATE_VERSION,
    sidebarCollapsed:
      typeof state.sidebarCollapsed === 'boolean'
        ? state.sidebarCollapsed
        : defaults.sidebarCollapsed,
    sidebarWidth:
      typeof state.sidebarWidth === 'number' &&
      Number.isFinite(state.sidebarWidth)
        ? clampSidebarWidth(state.sidebarWidth)
        : defaults.sidebarWidth,
    railWidth:
      typeof state.railWidth === 'number' && Number.isFinite(state.railWidth)
        ? clampRailWidth(state.railWidth)
        : defaults.railWidth,
    railViewId:
      typeof state.railViewId === 'string' && state.railViewId.length > 0
        ? state.railViewId
        : defaults.railViewId,
    noteFontScale:
      typeof state.noteFontScale === 'number' &&
      Number.isFinite(state.noteFontScale)
        ? clampNoteFontScale(state.noteFontScale)
        : defaults.noteFontScale,
  };
}
