import type {
  BaseWindow,
  MenuItemConstructorOptions,
} from 'electron';
import {
  APPLICATION_MENU_COMMANDS,
  isRendererMenuCommand,
  type RendererMenuCommand,
  type FlyoffPlatform,
} from '../../shared/contracts';
import {
  APPLICATION_MENU_DEFINITIONS,
  type ApplicationMenuEntryDefinition,
} from '../../shared/application-menu';
import type { FlyoffTranslator } from '../../shared/i18n';

export const APPLICATION_MENU_IDS = {
  app: 'app-menu',
  file: 'file-menu',
  edit: 'edit-menu',
  view: 'view-menu',
  help: 'help-menu',
} as const;

export interface ApplicationMenuTemplateOptions {
  platform: FlyoffPlatform;
  t: FlyoffTranslator;
  appName?: string;
  onRendererCommand?: (
    command: RendererMenuCommand,
    window: BaseWindow | undefined,
  ) => void;
}

function createMacOSAppMenu(
  t: FlyoffTranslator,
  appName: string,
): MenuItemConstructorOptions {
  return {
    id: APPLICATION_MENU_IDS.app,
    label: appName,
    submenu: [
      { label: t('menu.about'), role: 'about' },
      { type: 'separator' },
      { label: t('menu.services'), role: 'services' },
      { type: 'separator' },
      { label: t('menu.hide'), role: 'hide' },
      { label: t('menu.hideOthers'), role: 'hideOthers' },
      { label: t('menu.showAll'), role: 'unhide' },
      { type: 'separator' },
      { label: t('menu.quit'), role: 'quit' },
    ],
  };
}

function createNativeEntries(
  entries: readonly ApplicationMenuEntryDefinition[],
  t: FlyoffTranslator,
  platform: FlyoffPlatform,
  onRendererCommand: ApplicationMenuTemplateOptions['onRendererCommand'],
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];

  for (const entry of entries) {
    if (
      platform === 'darwin' &&
      entry.kind === 'action' &&
      entry.command === APPLICATION_MENU_COMMANDS.quit
    ) {
      continue;
    }

    if (entry.kind === 'separator') {
      template.push({ id: entry.id, type: 'separator' });
      continue;
    }

    if (entry.kind === 'submenu') {
      template.push({
        id: entry.id,
        label: t(entry.labelKey),
        enabled: !entry.disabled,
        submenu: createNativeEntries(
          entry.children,
          t,
          platform,
          onRendererCommand,
        ),
      });
      continue;
    }

    const rendererCommand = isRendererMenuCommand(entry.command)
      ? entry.command
      : undefined;

    template.push({
      id: entry.command,
      label: t(entry.labelKey),
      role: entry.role,
      ...(entry.shortcut
        ? { accelerator: entry.shortcut.accelerator }
        : {}),
      ...(entry.target === 'renderer' && rendererCommand
        ? {
            click: (_item, window) =>
              onRendererCommand?.(rendererCommand, window),
          }
        : {}),
    });
  }

  return template.filter(
    (item, index, items) =>
      item.type !== 'separator' ||
      (index > 0 &&
        index < items.length - 1 &&
        items[index - 1]?.type !== 'separator' &&
        items[index + 1]?.type !== 'separator'),
  );
}

export function createApplicationMenuTemplate({
  platform,
  t,
  appName = 'Flyoff',
  onRendererCommand,
}: ApplicationMenuTemplateOptions): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = APPLICATION_MENU_DEFINITIONS.map((menu) => ({
    id: menu.id,
    label: t(menu.labelKey),
    ...(menu.id === APPLICATION_MENU_IDS.help ? { role: 'help' as const } : {}),
    submenu: createNativeEntries(
      menu.children,
      t,
      platform,
      onRendererCommand,
    ),
  }));

  if (platform === 'darwin') {
    template.unshift(createMacOSAppMenu(t, appName));
  }

  return template;
}
