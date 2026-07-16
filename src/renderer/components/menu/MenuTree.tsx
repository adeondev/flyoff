import {
  createPortal,
} from 'react-dom';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';

import chevronRightIcon from '../../../../public/images/icons/actions/chevron-right.svg';
import { MaskedIcon } from '../MaskedIcon';
import { calculateMenuPosition, type MenuPlacement } from './menu-position';
import type { MenuItem } from './menu-types';

type InitialFocus = 'first' | 'last' | 'none';
type Direction = 'next' | 'previous';

interface MenuTreeProps {
  anchor: HTMLElement;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id: string;
  initialFocus: InitialFocus;
  items: readonly MenuItem[];
  onAction: (id: string) => void;
  onClose: (restoreFocus: boolean) => void;
  onNavigateMenu?: (direction: Direction) => void;
}

interface MenuSurfaceProps extends MenuTreeProps {
  anchor: HTMLElement;
  onRootElement?: (element: HTMLDivElement | null) => void;
  onCloseSubmenu?: (restoreFocus: boolean) => void;
  placement: MenuPlacement;
}

interface OpenSubmenu {
  anchor: HTMLElement;
  id: string;
  initialFocus: InitialFocus;
  item: Extract<MenuItem, { kind: 'submenu' }>;
}

function isInteractive(
  item: MenuItem,
): item is Exclude<MenuItem, { kind: 'separator' }> {
  return item.kind !== 'separator';
}

function isDisabled(item: MenuItem): boolean {
  return item.kind !== 'separator' && Boolean(item.disabled);
}

function itemId(item: Exclude<MenuItem, { kind: 'separator' }>): string {
  return item.id;
}

function focusElement(element: HTMLElement | undefined): void {
  element?.focus();
}

function ChevronRight() {
  return <MaskedIcon icon={chevronRightIcon} />;
}

function useMenuPosition(
  anchor: HTMLElement,
  placement: MenuPlacement,
): {
  menuRef: MutableRefObject<HTMLDivElement | null>;
  positioned: boolean;
  style: CSSProperties;
} {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  }>();

  const updatePosition = useCallback(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const next = calculateMenuPosition(
      anchor.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );

    setPosition((current) =>
      current?.left === next.left && current.top === next.top
        ? current
        : { left: next.left, top: next.top },
    );
  }, [anchor, placement]);

  useLayoutEffect(() => {
    updatePosition();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updatePosition);
    resizeObserver?.observe(anchor);
    if (menuRef.current) {
      resizeObserver?.observe(menuRef.current);
    }

    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor, updatePosition]);

  return {
    menuRef,
    positioned: Boolean(position),
    style: position
      ? { left: `${position.left}px`, top: `${position.top}px` }
      : { left: '0', top: '0' },
  };
}

function MenuSurface({
  anchor,
  ariaLabel,
  ariaLabelledBy,
  id,
  initialFocus,
  items,
  onAction,
  onClose,
  onCloseSubmenu,
  onNavigateMenu,
  onRootElement,
  placement,
}: MenuSurfaceProps) {
  const interactiveItems = useMemo(
    () => items.filter(isInteractive),
    [items],
  );
  const [activeId, setActiveId] = useState<string | undefined>(
    interactiveItems[0] ? itemId(interactiveItems[0]) : undefined,
  );
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>();
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const typeahead = useRef({ query: '', timeout: 0 as ReturnType<typeof setTimeout> | 0 });
  const { menuRef, positioned, style } = useMenuPosition(anchor, placement);

  const focusItem = useCallback(
    (idToFocus: string | undefined) => {
      if (!idToFocus) {
        return;
      }

      setActiveId(idToFocus);
      requestAnimationFrame(() => focusElement(itemRefs.current.get(idToFocus)));
    },
    [],
  );

  useLayoutEffect(() => {
    const target =
      initialFocus === 'last'
        ? interactiveItems.at(-1)
        : initialFocus === 'first'
          ? interactiveItems[0]
          : undefined;

    if (target) {
      const targetId = itemId(target);
      const frame = requestAnimationFrame(() => {
        setActiveId(targetId);
        focusElement(itemRefs.current.get(targetId));
      });

      return () => cancelAnimationFrame(frame);
    }
  }, [initialFocus, interactiveItems]);

  useEffect(
    () => () => {
      if (typeahead.current.timeout) {
        clearTimeout(typeahead.current.timeout);
      }
    },
    [],
  );

  function closeCurrentSubmenu(restoreFocus: boolean): void {
    const parent = openSubmenu?.anchor;
    setOpenSubmenu(undefined);
    if (restoreFocus) {
      requestAnimationFrame(() => focusElement(parent));
    }
  }

  function openChild(
    item: Extract<MenuItem, { kind: 'submenu' }>,
    element: HTMLButtonElement,
    childInitialFocus: InitialFocus,
  ): void {
    if (item.disabled) {
      return;
    }

    setActiveId(item.id);
    setOpenSubmenu({
      anchor: element,
      id: item.id,
      initialFocus: childInitialFocus,
      item,
    });
  }

  function moveFocus(offset: number): void {
    if (interactiveItems.length === 0) {
      return;
    }

    const index = interactiveItems.findIndex((item) => itemId(item) === activeId);
    const nextIndex =
      index < 0
        ? 0
        : (index + offset + interactiveItems.length) % interactiveItems.length;
    const next = interactiveItems[nextIndex];
    if (next) {
      setOpenSubmenu(undefined);
      focusItem(itemId(next));
    }
  }

  function handleTypeahead(event: KeyboardEvent<HTMLButtonElement>): boolean {
    if (
      event.key.length !== 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return false;
    }

    const query = `${typeahead.current.query}${event.key}`.toLocaleLowerCase();
    const startIndex = interactiveItems.findIndex(
      (item) => itemId(item) === activeId,
    );
    const candidates = [
      ...interactiveItems.slice(startIndex + 1),
      ...interactiveItems.slice(0, startIndex + 1),
    ];
    const match = candidates.find((item) =>
      item.label.toLocaleLowerCase().startsWith(query),
    );

    if (!match) {
      return false;
    }

    event.preventDefault();
    typeahead.current.query = query;
    if (typeahead.current.timeout) {
      clearTimeout(typeahead.current.timeout);
    }
    typeahead.current.timeout = setTimeout(() => {
      typeahead.current.query = '';
      typeahead.current.timeout = 0;
    }, 700);
    setOpenSubmenu(undefined);
    focusItem(itemId(match));
    return true;
  }

  function activateItem(
    item: Exclude<MenuItem, { kind: 'separator' }>,
    element: HTMLButtonElement,
  ): void {
    if (isDisabled(item)) {
      return;
    }

    if (item.kind === 'submenu') {
      openChild(item, element, 'first');
      return;
    }

    onClose(true);
    onAction(item.id);
  }

  function handleItemKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    item: Exclude<MenuItem, { kind: 'separator' }>,
  ): void {
    if (handleTypeahead(event)) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        return;
      case 'Home':
        event.preventDefault();
        focusItem(interactiveItems[0] ? itemId(interactiveItems[0]) : undefined);
        return;
      case 'End':
        event.preventDefault();
        focusItem(
          interactiveItems.at(-1)
            ? itemId(interactiveItems.at(-1)!)
            : undefined,
        );
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (item.kind === 'submenu') {
          openChild(item, event.currentTarget, 'first');
        } else {
          onNavigateMenu?.('next');
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (onCloseSubmenu) {
          onCloseSubmenu(true);
        } else {
          onNavigateMenu?.('previous');
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateItem(item, event.currentTarget);
        return;
      case 'Escape':
        event.preventDefault();
        if (onCloseSubmenu) {
          onCloseSubmenu(true);
        } else {
          onClose(true);
        }
        return;
      case 'Tab':
        window.setTimeout(() => onClose(false), 0);
        return;
      default:
        return;
    }
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="flyoff-menu"
      data-positioned={positioned}
      id={id}
      ref={(element) => {
        menuRef.current = element;
        onRootElement?.(element);
      }}
      role="menu"
      style={style}
    >
      {items.map((item) => {
        if (item.kind === 'separator') {
          return (
            <div
              className="flyoff-menu__separator"
              key={item.id}
              role="separator"
            />
          );
        }

        const disabled = isDisabled(item);
        const hasSubmenu = item.kind === 'submenu';
        const isSubmenuOpen = openSubmenu?.id === item.id;

        return (
          <button
            aria-disabled={disabled || undefined}
            aria-controls={hasSubmenu ? `${id}-${item.id}` : undefined}
            aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
            aria-haspopup={hasSubmenu ? 'menu' : undefined}
            className={`flyoff-menu__item${
              item.kind === 'action' && item.tone === 'danger'
                ? ' flyoff-menu__item--danger'
                : ''
            }${disabled ? ' flyoff-menu__item--disabled' : ''}`}
            id={`${id}-item-${item.id}`}
            key={item.id}
            onClick={(event) => activateItem(item, event.currentTarget)}
            onKeyDown={(event) => handleItemKeyDown(event, item)}
            onMouseEnter={(event) => {
              setActiveId(item.id);
              if (item.kind === 'submenu') {
                openChild(item, event.currentTarget, 'none');
              } else {
                setOpenSubmenu(undefined);
              }
            }}
            ref={(element) => {
              if (element) {
                itemRefs.current.set(item.id, element);
              } else {
                itemRefs.current.delete(item.id);
              }
            }}
            role="menuitem"
            tabIndex={activeId === item.id ? 0 : -1}
            type="button"
          >
            <span className="flyoff-menu__item-label">{item.label}</span>
            {item.kind === 'action' && item.shortcut ? (
              <span className="flyoff-menu__shortcut">{item.shortcut}</span>
            ) : null}
            {hasSubmenu ? (
              <span className="flyoff-menu__submenu-indicator">
                <ChevronRight />
              </span>
            ) : null}
          </button>
        );
      })}
      {openSubmenu ? (
        <MenuSurface
          anchor={openSubmenu.anchor}
          ariaLabelledBy={`${id}-item-${openSubmenu.id}`}
          id={`${id}-${openSubmenu.id}`}
          initialFocus={openSubmenu.initialFocus}
          items={openSubmenu.item.children}
          onAction={onAction}
          onClose={onClose}
          onCloseSubmenu={closeCurrentSubmenu}
          onNavigateMenu={onNavigateMenu}
          placement="side-start"
        />
      ) : null}
    </div>
  );
}

export function MenuTree({
  anchor,
  ariaLabel,
  ariaLabelledBy,
  id,
  initialFocus,
  items,
  onAction,
  onClose,
  onNavigateMenu,
}: MenuTreeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const closeForExternalInteraction = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || anchor.contains(target))
      ) {
        return;
      }

      onClose(false);
    };
    const closeForWindowBlur = () => onClose(false);

    document.addEventListener('pointerdown', closeForExternalInteraction, true);
    window.addEventListener('blur', closeForWindowBlur);

    return () => {
      document.removeEventListener(
        'pointerdown',
        closeForExternalInteraction,
        true,
      );
      window.removeEventListener('blur', closeForWindowBlur);
    };
  }, [anchor, onClose]);

  return createPortal(
    <MenuSurface
      anchor={anchor}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      id={id}
      initialFocus={initialFocus}
      items={items}
      onAction={onAction}
      onClose={onClose}
      onNavigateMenu={onNavigateMenu}
      onRootElement={(element) => {
        rootRef.current = element;
      }}
      placement="bottom-start"
    />,
    document.body,
  );
}
