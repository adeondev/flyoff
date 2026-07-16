import {
  APPLICATION_MENU_COMMANDS,
  RENDERER_MENU_COMMANDS,
  TITLEBAR_MENU_IDS,
  type AnyMenuCommand,
  type TitlebarMenuId,
} from './contracts';
import type { TranslationKey } from './i18n';

export type NativeApplicationMenuRole =
  | 'about'
  | 'close'
  | 'copy'
  | 'cut'
  | 'hide'
  | 'hideOthers'
  | 'paste'
  | 'quit'
  | 'redo'
  | 'resetZoom'
  | 'selectAll'
  | 'services'
  | 'togglefullscreen'
  | 'undo'
  | 'unhide'
  | 'zoomIn'
  | 'zoomOut';

export interface ApplicationMenuActionDefinition {
  kind: 'action';
  command: AnyMenuCommand;
  target: 'main' | 'renderer';
  labelKey: TranslationKey;
  role?: NativeApplicationMenuRole;
  shortcut?: {
    accelerator: string;
    display: string;
  };
}

export interface ApplicationMenuSeparatorDefinition {
  id: string;
  kind: 'separator';
}

export interface ApplicationMenuSubmenuDefinition {
  id: string;
  kind: 'submenu';
  labelKey: TranslationKey;
  children: readonly ApplicationMenuEntryDefinition[];
  disabled?: boolean;
}

export type ApplicationMenuEntryDefinition =
  | ApplicationMenuActionDefinition
  | ApplicationMenuSeparatorDefinition
  | ApplicationMenuSubmenuDefinition;

export interface ApplicationMenuDefinition {
  id: TitlebarMenuId;
  labelKey: TranslationKey;
  children: readonly ApplicationMenuEntryDefinition[];
}

const command = APPLICATION_MENU_COMMANDS;
const rendererCommand = RENDERER_MENU_COMMANDS;

export const APPLICATION_MENU_DEFINITIONS = [
  {
    id: TITLEBAR_MENU_IDS.file,
    labelKey: 'menu.file',
    children: [
      {
        kind: 'action',
        command: rendererCommand.closeTab,
        target: 'renderer',
        labelKey: 'menu.closeTab',
        shortcut: {
          accelerator: 'CommandOrControl+W',
          display: 'Ctrl+W',
        },
      },
      {
        kind: 'action',
        command: command.closeWindow,
        target: 'main',
        labelKey: 'menu.closeWindow',
        role: 'close',
        shortcut: {
          accelerator: 'CommandOrControl+Shift+W',
          display: 'Ctrl+Shift+W',
        },
      },
      { id: 'file-separator', kind: 'separator' },
      {
        kind: 'action',
        command: command.quit,
        target: 'main',
        labelKey: 'menu.quit',
        role: 'quit',
      },
    ],
  },
  {
    id: TITLEBAR_MENU_IDS.edit,
    labelKey: 'menu.edit',
    children: [
      {
        kind: 'action',
        command: command.undo,
        target: 'main',
        labelKey: 'menu.undo',
        role: 'undo',
        shortcut: { accelerator: 'CommandOrControl+Z', display: 'Ctrl+Z' },
      },
      {
        kind: 'action',
        command: command.redo,
        target: 'main',
        labelKey: 'menu.redo',
        role: 'redo',
        shortcut: {
          accelerator: 'CommandOrControl+Shift+Z',
          display: 'Ctrl+Shift+Z',
        },
      },
      { id: 'edit-history-separator', kind: 'separator' },
      {
        kind: 'action',
        command: command.cut,
        target: 'main',
        labelKey: 'menu.cut',
        role: 'cut',
        shortcut: { accelerator: 'CommandOrControl+X', display: 'Ctrl+X' },
      },
      {
        kind: 'action',
        command: command.copy,
        target: 'main',
        labelKey: 'menu.copy',
        role: 'copy',
        shortcut: { accelerator: 'CommandOrControl+C', display: 'Ctrl+C' },
      },
      {
        kind: 'action',
        command: command.paste,
        target: 'main',
        labelKey: 'menu.paste',
        role: 'paste',
        shortcut: { accelerator: 'CommandOrControl+V', display: 'Ctrl+V' },
      },
      { id: 'edit-selection-separator', kind: 'separator' },
      {
        kind: 'action',
        command: command.selectAll,
        target: 'main',
        labelKey: 'menu.selectAll',
        role: 'selectAll',
        shortcut: { accelerator: 'CommandOrControl+A', display: 'Ctrl+A' },
      },
    ],
  },
  {
    id: TITLEBAR_MENU_IDS.view,
    labelKey: 'menu.view',
    children: [
      {
        kind: 'action',
        command: command.resetZoom,
        target: 'main',
        labelKey: 'menu.resetZoom',
        role: 'resetZoom',
        shortcut: { accelerator: 'CommandOrControl+0', display: 'Ctrl+0' },
      },
      {
        kind: 'action',
        command: command.zoomIn,
        target: 'main',
        labelKey: 'menu.zoomIn',
        role: 'zoomIn',
        // "Plus" only fires with Shift on most layouts; "=" is the key users
        // actually press for zoom in. Shift+= and numpad + are handled by the
        // window navigation shortcuts.
        shortcut: { accelerator: 'CommandOrControl+=', display: 'Ctrl++' },
      },
      {
        kind: 'action',
        command: command.zoomOut,
        target: 'main',
        labelKey: 'menu.zoomOut',
        role: 'zoomOut',
        shortcut: { accelerator: 'CommandOrControl+-', display: 'Ctrl+-' },
      },
      { id: 'view-display-separator', kind: 'separator' },
      {
        kind: 'action',
        command: command.toggleFullScreen,
        target: 'main',
        labelKey: 'menu.toggleFullScreen',
        role: 'togglefullscreen',
        shortcut: { accelerator: 'F11', display: 'F11' },
      },
    ],
  },
  {
    id: TITLEBAR_MENU_IDS.help,
    labelKey: 'menu.help',
    children: [
      {
        kind: 'action',
        command: command.about,
        target: 'main',
        labelKey: 'menu.about',
        role: 'about',
      },
    ],
  },
] as const satisfies readonly ApplicationMenuDefinition[];
