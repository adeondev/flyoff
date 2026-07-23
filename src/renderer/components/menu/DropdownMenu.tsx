import {
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { MenuTree } from './MenuTree';
import type { MenuPlacement } from './menu-position';
import type { MenuItem } from './menu-types';
import { dismissFlyoffTooltip, suppressFlyoffTooltip } from '../tooltip';

export interface DropdownMenuTriggerProps {
  'aria-controls': string;
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
  id: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  ref: (element: HTMLElement | null) => void;
}

export interface DropdownMenuProps {
  menuClassName?: string;
  items: readonly MenuItem[];
  onAction: (id: string) => void;
  placement?: MenuPlacement;
  trigger: (props: DropdownMenuTriggerProps) => ReactNode;
}

export function DropdownMenu({
  menuClassName,
  items,
  onAction,
  placement = 'bottom-start',
  trigger,
}: DropdownMenuProps) {
  const generatedId = useId();
  const menuId = `flyoff-dropdown-${generatedId}`;
  const triggerId = `${menuId}-trigger`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) {
        requestAnimationFrame(() => {
          if (anchor) {
            suppressFlyoffTooltip(anchor);
            anchor.focus();
          }
        });
      }
    },
    [anchor],
  );

  function openFromKeyboard(focus: 'first' | 'last'): void {
    if (anchor) {
      suppressFlyoffTooltip(anchor);
      setInitialFocus(focus);
      setOpen(true);
    }
  }

  return (
    <>
      {trigger({
        ref: setAnchor,
        id: triggerId,
        'aria-controls': menuId,
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: () => {
          dismissFlyoffTooltip();
          setInitialFocus('first');
          setOpen((current) => !current);
        },
        onKeyDown: (event) => {
          if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            openFromKeyboard(event.key === 'ArrowUp' ? 'last' : 'first');
          }
          if (event.key === 'Escape') {
            close(true);
          }
        },
      })}
      {open && anchor ? (
        <MenuTree
          anchor={anchor}
          ariaLabelledBy={triggerId}
          id={menuId}
          initialFocus={initialFocus}
          items={items}
          className={menuClassName}
          onAction={onAction}
          onClose={close}
          placement={placement}
        />
      ) : null}
    </>
  );
}
