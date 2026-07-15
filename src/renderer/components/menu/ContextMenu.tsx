import { useId, useState, type CSSProperties } from 'react';

import { MenuTree } from './MenuTree';
import type { MenuItem } from './menu-types';

export interface ContextMenuProps {
  ariaLabel: string;
  items: readonly MenuItem[];
  x: number;
  y: number;
  onAction: (id: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

const anchorStyle: CSSProperties = {
  position: 'fixed',
  width: 0,
  height: 0,
};

export function ContextMenu({
  ariaLabel,
  items,
  onAction,
  onClose,
  x,
  y,
}: ContextMenuProps) {
  const menuId = `flyoff-context-menu-${useId()}`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <span
        aria-hidden="true"
        ref={setAnchor}
        style={{ ...anchorStyle, left: `${x}px`, top: `${y}px` }}
      />
      {anchor ? (
        <MenuTree
          anchor={anchor}
          ariaLabel={ariaLabel}
          id={menuId}
          initialFocus="first"
          items={items}
          onAction={onAction}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
