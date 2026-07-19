export type MenuPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'side-start'
  | 'top-end';

export interface MenuPosition {
  left: number;
  top: number;
  placement: MenuPlacement;
}

export interface MenuViewport {
  width: number;
  height: number;
}

const VIEWPORT_GAP = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateMenuPosition(
  anchor: DOMRect,
  menu: Pick<DOMRect, 'width' | 'height'>,
  viewport: MenuViewport,
  placement: MenuPlacement,
): MenuPosition {
  const maxLeft = viewport.width - menu.width - VIEWPORT_GAP;
  const maxTop = viewport.height - menu.height - VIEWPORT_GAP;

  if (placement === 'side-start') {
    const preferredRight = anchor.right;
    const preferredLeft = anchor.left - menu.width;
    const left =
      preferredRight + menu.width <= viewport.width - VIEWPORT_GAP ||
      preferredLeft < VIEWPORT_GAP
        ? preferredRight
        : preferredLeft;

    return {
      left: clamp(left, VIEWPORT_GAP, maxLeft),
      top: clamp(anchor.top, VIEWPORT_GAP, maxTop),
      placement,
    };
  }

  const opensBelow =
    placement === 'bottom-start' || placement === 'bottom-end';
  const preferredTop = opensBelow ? anchor.bottom : anchor.top - menu.height;
  const flippedTop = opensBelow ? anchor.top - menu.height : anchor.bottom;
  const canUsePreferred =
    preferredTop >= VIEWPORT_GAP &&
    preferredTop + menu.height <= viewport.height - VIEWPORT_GAP;

  return {
    left: clamp(
      placement === 'bottom-end' || placement === 'top-end'
        ? anchor.right - menu.width
        : anchor.left,
      VIEWPORT_GAP,
      maxLeft,
    ),
    top: clamp(canUsePreferred ? preferredTop : flippedTop, VIEWPORT_GAP, maxTop),
    placement,
  };
}
