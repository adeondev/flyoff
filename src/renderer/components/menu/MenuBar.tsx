import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { TwemojiText } from '../twemoji';
import { MenuTree } from './MenuTree';
import type { MenuBarItem } from './menu-types';

type InitialFocus = 'first' | 'last' | 'none';

interface OpenMenu {
  id: string;
  initialFocus: InitialFocus;
}

export interface MenuBarProps {
  ariaLabel: string;
  className?: string;
  menus: readonly MenuBarItem[];
  onAction: (id: string) => void;
}

function nextIndex(
  length: number,
  index: number,
  direction: 'next' | 'previous',
): number {
  return (index + (direction === 'next' ? 1 : -1) + length) % length;
}

export function MenuBar({
  ariaLabel,
  className,
  menus,
  onAction,
}: MenuBarProps) {
  const menuBarId = useId();
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const [activeAnchor, setActiveAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const [activeTriggerId, setActiveTriggerId] = useState<string | undefined>(
    menus[0]?.id,
  );

  const close = useCallback(
    (restoreFocus: boolean) => {
      const activeMenu = openMenu;
      setOpenMenu(undefined);
      setActiveAnchor(null);
      if (restoreFocus && activeMenu) {
        requestAnimationFrame(() => triggerRefs.current.get(activeMenu.id)?.focus());
      }
    },
    [openMenu],
  );

  function focusTrigger(menuId: string): void {
    setActiveTriggerId(menuId);
    triggerRefs.current.get(menuId)?.focus();
  }

  function openMenuAt(
    menuId: string,
    initialFocus: InitialFocus,
    anchor?: HTMLButtonElement,
  ): void {
    const nextAnchor = anchor ?? triggerRefs.current.get(menuId);
    if (!nextAnchor) {
      return;
    }

    setActiveAnchor(nextAnchor);
    setOpenMenu({ id: menuId, initialFocus });
  }

  function moveTrigger(currentId: string, direction: 'next' | 'previous'): string | undefined {
    const index = menus.findIndex((menu) => menu.id === currentId);
    if (index < 0 || menus.length === 0) {
      return undefined;
    }

    const nextMenu = menus[nextIndex(menus.length, index, direction)];
    if (nextMenu) {
      focusTrigger(nextMenu.id);
      return nextMenu.id;
    }

    return undefined;
  }

  function switchOpenMenu(
    currentId: string,
    direction: 'next' | 'previous',
  ): void {
    const menuId = moveTrigger(currentId, direction);
    if (menuId) {
      openMenuAt(menuId, 'first');
    }
  }

  function handleTriggerKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    menuId: string,
  ): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        event.preventDefault();
        openMenuAt(menuId, 'first', event.currentTarget);
        return;
      case 'ArrowUp':
        event.preventDefault();
        openMenuAt(menuId, 'last', event.currentTarget);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (openMenu) {
          switchOpenMenu(menuId, 'next');
        } else {
          moveTrigger(menuId, 'next');
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (openMenu) {
          switchOpenMenu(menuId, 'previous');
        } else {
          moveTrigger(menuId, 'previous');
        }
        return;
      case 'Home':
        event.preventDefault();
        if (menus[0]) {
          focusTrigger(menus[0].id);
        }
        return;
      case 'End':
        event.preventDefault();
        if (menus.at(-1)) {
          focusTrigger(menus.at(-1)!.id);
        }
        return;
      case 'Escape':
        if (openMenu) {
          event.preventDefault();
          close(true);
        }
        return;
      default:
        return;
    }
  }

  const activeMenu = openMenu
    ? menus.find((menu) => menu.id === openMenu.id)
    : undefined;
  return (
    <nav
      aria-label={ariaLabel}
      className={`flyoff-menu-bar${className ? ` ${className}` : ''}`}
      role="menubar"
    >
      {menus.map((menu) => {
        const triggerId = `flyoff-menu-trigger-${menuBarId}-${menu.id}`;
        const menuPanelId = `flyoff-menu-panel-${menuBarId}-${menu.id}`;
        const isOpen = activeMenu?.id === menu.id;

        return (
          <button
            aria-controls={menuPanelId}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className="flyoff-menu-bar__trigger"
            id={triggerId}
            key={menu.id}
            onClick={(event) => {
              if (openMenu?.id === menu.id) {
                close(false);
                return;
              }

              openMenuAt(menu.id, 'first', event.currentTarget);
            }}
            onKeyDown={(event) => handleTriggerKeyDown(event, menu.id)}
            onMouseEnter={(event) => {
              if (openMenu && openMenu.id !== menu.id) {
                openMenuAt(menu.id, 'none', event.currentTarget);
              }
            }}
            onFocus={() => setActiveTriggerId(menu.id)}
            ref={(element) => {
              if (element) {
                triggerRefs.current.set(menu.id, element);
              } else {
                triggerRefs.current.delete(menu.id);
              }
            }}
            role="menuitem"
            tabIndex={activeTriggerId === menu.id ? 0 : -1}
            type="button"
          >
            <TwemojiText text={menu.label} />
          </button>
        );
      })}
      {activeMenu && activeAnchor ? (
        <MenuTree
          anchor={activeAnchor}
          ariaLabelledBy={`flyoff-menu-trigger-${menuBarId}-${activeMenu.id}`}
          id={`flyoff-menu-panel-${menuBarId}-${activeMenu.id}`}
          initialFocus={openMenu?.initialFocus ?? 'first'}
          items={activeMenu.items}
          key={activeMenu.id}
          onAction={onAction}
          onClose={close}
          onNavigateMenu={(direction) => switchOpenMenu(activeMenu.id, direction)}
        />
      ) : null}
    </nav>
  );
}
