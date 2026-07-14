export const MENU_COMMAND_CHANNEL = 'flyoff:menu:execute' as const;
export const RENDERER_MENU_COMMAND_CHANNEL =
  'flyoff:menu:renderer-command' as const;

export const TITLEBAR_MENU_IDS = {
  file: 'file-menu',
  edit: 'edit-menu',
  view: 'view-menu',
  help: 'help-menu',
} as const;

export type TitlebarMenuId =
  (typeof TITLEBAR_MENU_IDS)[keyof typeof TITLEBAR_MENU_IDS];

export const APPLICATION_MENU_COMMANDS = {
  closeWindow: 'file.closeWindow',
  quit: 'file.quit',
  undo: 'edit.undo',
  redo: 'edit.redo',
  cut: 'edit.cut',
  copy: 'edit.copy',
  paste: 'edit.paste',
  selectAll: 'edit.selectAll',
  resetZoom: 'view.resetZoom',
  zoomIn: 'view.zoomIn',
  zoomOut: 'view.zoomOut',
  toggleFullScreen: 'view.toggleFullScreen',
  about: 'help.about',
} as const;

export const RENDERER_MENU_COMMANDS = {
  closeTab: 'file.closeTab',
} as const;

export type ApplicationMenuCommand =
  (typeof APPLICATION_MENU_COMMANDS)[keyof typeof APPLICATION_MENU_COMMANDS];

export type RendererMenuCommand =
  (typeof RENDERER_MENU_COMMANDS)[keyof typeof RENDERER_MENU_COMMANDS];

export type AnyMenuCommand =
  | ApplicationMenuCommand
  | RendererMenuCommand;

const titlebarMenuIds = new Set<string>(Object.values(TITLEBAR_MENU_IDS));
const applicationMenuCommands = new Set<string>(
  Object.values(APPLICATION_MENU_COMMANDS),
);
const rendererMenuCommands = new Set<string>(
  Object.values(RENDERER_MENU_COMMANDS),
);

export function isTitlebarMenuId(value: unknown): value is TitlebarMenuId {
  return typeof value === 'string' && titlebarMenuIds.has(value);
}

export function isApplicationMenuCommand(
  value: unknown,
): value is ApplicationMenuCommand {
  return typeof value === 'string' && applicationMenuCommands.has(value);
}

export function isRendererMenuCommand(
  value: unknown,
): value is RendererMenuCommand {
  return typeof value === 'string' && rendererMenuCommands.has(value);
}

export function isAnyMenuCommand(value: unknown): value is AnyMenuCommand {
  return isApplicationMenuCommand(value) || isRendererMenuCommand(value);
}
