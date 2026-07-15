export const UI_STATE_VERSION = 1 as const;

export const GET_UI_STATE_CHANNEL = 'flyoff:ui-state:get' as const;
export const SAVE_UI_STATE_CHANNEL = 'flyoff:ui-state:save' as const;

export const SIDEBAR_WIDTH_MIN = 196;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 248;

export const DEFAULT_RAIL_VIEW_ID = 'projeto';

export interface WorkspaceLayoutState {
  version: typeof UI_STATE_VERSION;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  railViewId: string;
}

export function clampSidebarWidth(value: number): number {
  return Math.min(
    Math.max(Math.round(value), SIDEBAR_WIDTH_MIN),
    SIDEBAR_WIDTH_MAX,
  );
}

export function createDefaultWorkspaceLayoutState(): WorkspaceLayoutState {
  return {
    version: UI_STATE_VERSION,
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    railViewId: DEFAULT_RAIL_VIEW_ID,
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
    typeof state.railViewId === 'string' &&
    state.railViewId.length > 0
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
    railViewId:
      typeof state.railViewId === 'string' && state.railViewId.length > 0
        ? state.railViewId
        : defaults.railViewId,
  };
}
