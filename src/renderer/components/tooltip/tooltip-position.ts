export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipPosition {
  left: number;
  placement: TooltipPlacement;
  top: number;
}

interface ViewportSize {
  height: number;
  width: number;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_INSET = 8;

const OPPOSITE_PLACEMENT: Record<TooltipPlacement, TooltipPlacement> = {
  bottom: 'top',
  left: 'right',
  right: 'left',
  top: 'bottom',
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function fits(
  anchor: DOMRect,
  tooltip: DOMRect,
  viewport: ViewportSize,
  placement: TooltipPlacement,
): boolean {
  switch (placement) {
    case 'bottom':
      return anchor.bottom + TOOLTIP_GAP + tooltip.height <= viewport.height - VIEWPORT_INSET;
    case 'left':
      return anchor.left - TOOLTIP_GAP - tooltip.width >= VIEWPORT_INSET;
    case 'right':
      return anchor.right + TOOLTIP_GAP + tooltip.width <= viewport.width - VIEWPORT_INSET;
    case 'top':
      return anchor.top - TOOLTIP_GAP - tooltip.height >= VIEWPORT_INSET;
  }
}

export function calculateTooltipPosition(
  anchor: DOMRect,
  tooltip: DOMRect,
  viewport: ViewportSize,
  preferredPlacement: TooltipPlacement,
): TooltipPosition {
  const placement = fits(anchor, tooltip, viewport, preferredPlacement)
    ? preferredPlacement
    : fits(anchor, tooltip, viewport, OPPOSITE_PLACEMENT[preferredPlacement])
      ? OPPOSITE_PLACEMENT[preferredPlacement]
      : preferredPlacement;

  if (placement === 'top' || placement === 'bottom') {
    return {
      left: clamp(
        anchor.left + (anchor.width - tooltip.width) / 2,
        VIEWPORT_INSET,
        viewport.width - tooltip.width - VIEWPORT_INSET,
      ),
      placement,
      top:
        placement === 'top'
          ? Math.max(VIEWPORT_INSET, anchor.top - tooltip.height - TOOLTIP_GAP)
          : Math.min(
              anchor.bottom + TOOLTIP_GAP,
              viewport.height - tooltip.height - VIEWPORT_INSET,
            ),
    };
  }

  return {
    left:
      placement === 'left'
        ? Math.max(VIEWPORT_INSET, anchor.left - tooltip.width - TOOLTIP_GAP)
        : Math.min(
            anchor.right + TOOLTIP_GAP,
            viewport.width - tooltip.width - VIEWPORT_INSET,
          ),
    placement,
    top: clamp(
      anchor.top + (anchor.height - tooltip.height) / 2,
      VIEWPORT_INSET,
      viewport.height - tooltip.height - VIEWPORT_INSET,
    ),
  };
}
