export type MenuItemTone = 'default' | 'danger' | 'warning';

export interface MenuActionItem {
  kind: 'action';
  id: string;
  label: string;
  shortcut?: string;
  keyShortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  icon?: string;
  imageIcon?: string;
  tone?: MenuItemTone;
}

export interface MenuSeparatorItem {
  kind: 'separator';
  id: string;
}

export interface MenuLabelItem {
  kind: 'label';
  id: string;
  label: string;
}

export interface MenuSubmenuItem {
  kind: 'submenu';
  id: string;
  label: string;
  children: readonly MenuItem[];
  disabled?: boolean;
  icon?: string;
  imageIcon?: string;
}

export type MenuItem =
  | MenuActionItem
  | MenuLabelItem
  | MenuSeparatorItem
  | MenuSubmenuItem;

export interface MenuBarItem {
  id: string;
  label: string;
  items: readonly MenuItem[];
}
