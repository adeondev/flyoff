import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_MENU_IDS,
  createApplicationMenuTemplate,
} from '../../src/main/menu';
import {
  enUS,
  ptBR,
  type FlyoffTranslator,
  type TranslationCatalog,
} from '../../src/shared/i18n';

function createTranslator(catalog: TranslationCatalog): FlyoffTranslator {
  return (key) => {
    const [section, entry] = key.split('.') as [
      keyof TranslationCatalog,
      string,
    ];
    const translations = catalog[section] as Record<string, string>;

    return translations[entry] ?? key;
  };
}

function submenuOf(
  item: MenuItemConstructorOptions,
): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) {
    throw new TypeError(`Menu ${item.id ?? item.label} has no template submenu.`);
  }

  return item.submenu;
}

function itemById(
  template: MenuItemConstructorOptions[],
  id: string,
): MenuItemConstructorOptions {
  const item = template.find((candidate) => candidate.id === id);

  if (!item) {
    throw new TypeError(`Menu ${id} was not found.`);
  }

  return item;
}

describe('application menu template', () => {
  it.each(['win32', 'linux'] as const)(
    'uses native roles and four menus on %s',
    (platform) => {
      const onRendererCommand = vi.fn();
      const template = createApplicationMenuTemplate({
        platform,
        t: createTranslator(ptBR),
        onRendererCommand,
      });

      expect(template.map(({ id }) => id)).toEqual([
        APPLICATION_MENU_IDS.file,
        APPLICATION_MENU_IDS.edit,
        APPLICATION_MENU_IDS.view,
        APPLICATION_MENU_IDS.help,
      ]);
      expect(template.map(({ label }) => label)).toEqual([
        'Arquivo',
        'Editar',
        'Exibir',
        'Ajuda',
      ]);
      expect(
        submenuOf(itemById(template, APPLICATION_MENU_IDS.file)).map(
          ({ id, role, type }) => role ?? type ?? id,
        ),
      ).toEqual(['file.closeTab', 'close', 'separator', 'quit']);
      const closeTab = itemById(
        submenuOf(itemById(template, APPLICATION_MENU_IDS.file)),
        'file.closeTab',
      );
      expect(closeTab).toMatchObject({
        accelerator: 'CommandOrControl+W',
        label: 'Fechar aba',
      });
      expect(closeTab.role).toBeUndefined();
      closeTab.click?.({} as never, undefined, {} as never);
      expect(onRendererCommand).toHaveBeenCalledWith(
        'file.closeTab',
        undefined,
      );
      expect(
        itemById(
          submenuOf(itemById(template, APPLICATION_MENU_IDS.file)),
          'file.closeWindow',
        ).accelerator,
      ).toBe('CommandOrControl+Shift+W');
      expect(
        submenuOf(itemById(template, APPLICATION_MENU_IDS.edit)).map(
          ({ role, type }) => role ?? type,
        ),
      ).toEqual([
        'undo',
        'redo',
        'separator',
        'cut',
        'copy',
        'paste',
        'separator',
        'selectAll',
      ]);
      expect(
        submenuOf(itemById(template, APPLICATION_MENU_IDS.view)).map(
          ({ role, type }) => role ?? type,
        ),
      ).toEqual([
        'resetZoom',
        'zoomIn',
        'zoomOut',
        'separator',
        'togglefullscreen',
      ]);
    },
  );

  it('adds the conventional Flyoff application menu on macOS', () => {
    const template = createApplicationMenuTemplate({
      platform: 'darwin',
      appName: 'Flyoff',
      t: createTranslator(enUS),
    });

    expect(template.map(({ id }) => id)).toEqual([
      APPLICATION_MENU_IDS.app,
      APPLICATION_MENU_IDS.file,
      APPLICATION_MENU_IDS.edit,
      APPLICATION_MENU_IDS.view,
      APPLICATION_MENU_IDS.help,
    ]);
    expect(template[0]?.label).toBe('Flyoff');
    expect(
      submenuOf(itemById(template, APPLICATION_MENU_IDS.app)).map(
        ({ role, type }) => role ?? type,
      ),
    ).toEqual([
      'about',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    expect(
      submenuOf(itemById(template, APPLICATION_MENU_IDS.file)).map(
        ({ id, role, type }) => role ?? type ?? id,
      ),
    ).toEqual(['file.closeTab', 'close']);
  });

  it('keeps About Flyoff in Help on every platform', () => {
    const template = createApplicationMenuTemplate({
      platform: 'linux',
      t: createTranslator(enUS),
    });
    const help = itemById(template, APPLICATION_MENU_IDS.help);

    expect(help.role).toBe('help');
    expect(submenuOf(help)).toEqual([
      expect.objectContaining({ label: 'About Flyoff', role: 'about' }),
    ]);
  });
});
