export type MenuItemTone = 'default' | 'danger';

export interface MenuActionItem {
  kind: 'action';
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  tone?: MenuItemTone;
}

export interface MenuSeparatorItem {
  kind: 'separator';
  id: string;
}

export interface MenuSubmenuItem {
  kind: 'submenu';
  id: string;
  label: string;
  children: readonly MenuItem[];
  disabled?: boolean;
}

export type MenuItem = MenuActionItem | MenuSeparatorItem | MenuSubmenuItem;

export interface MenuBarItem {
  id: string;
  label: string;
  items: readonly MenuItem[];
}
