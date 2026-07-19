export type WorkspaceSplitDropEdge = 'left' | 'right' | 'top' | 'bottom';

export interface WorkspaceTabFlightGeometry {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

interface RectLike {
  height: number;
  left: number;
  top: number;
  width: number;
}

const SPLIT_GAP = 5;
const TAB_INSET = 8;
const TAB_MOTION_DURATION_MS = 120;

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function workspaceTabFlightGeometry(
  source: RectLike,
  pane: RectLike,
  edge: WorkspaceSplitDropEdge,
): WorkspaceTabFlightGeometry {
  const horizontal = edge === 'left' || edge === 'right';
  const targetWidth = horizontal
    ? (pane.width - SPLIT_GAP) / 2
    : pane.width;
  const targetHeight = horizontal
    ? pane.height
    : (pane.height - SPLIT_GAP) / 2;
  const targetLeft =
    edge === 'right'
      ? pane.left + (pane.width + SPLIT_GAP) / 2
      : pane.left;
  const targetTop =
    edge === 'bottom'
      ? pane.top + (pane.height + SPLIT_GAP) / 2
      : pane.top;
  const width = Math.max(
    72,
    Math.min(source.width, targetWidth - TAB_INSET * 2),
  );
  const height = Math.min(source.height, Math.max(28, targetHeight - 8));
  return {
    scaleX: width / Math.max(1, source.width),
    scaleY: height / Math.max(1, source.height),
    x: targetLeft + TAB_INSET - source.left,
    y: targetTop + 4 - source.top,
  };
}

export function animateWorkspaceTabToSplit(
  source: HTMLElement | null,
  pane: HTMLElement,
  edge: WorkspaceSplitDropEdge,
): void {
  if (!source || reducedMotion()) {
    return;
  }
  const sourceBounds = source.getBoundingClientRect();
  const paneBounds = pane.getBoundingClientRect();
  if (
    sourceBounds.width <= 0 ||
    sourceBounds.height <= 0 ||
    paneBounds.width <= 0 ||
    paneBounds.height <= 0
  ) {
    return;
  }
  const geometry = workspaceTabFlightGeometry(
    sourceBounds,
    paneBounds,
    edge,
  );
  const flight = source.cloneNode(true) as HTMLElement;
  flight.className = 'workspace-tab-flight';
  flight.setAttribute('aria-hidden', 'true');
  flight.removeAttribute('draggable');
  flight.querySelectorAll<HTMLElement>('[id], button').forEach((element) => {
    element.removeAttribute('id');
    element.setAttribute('tabindex', '-1');
  });
  Object.assign(flight.style, {
    height: `${sourceBounds.height}px`,
    left: `${sourceBounds.left}px`,
    top: `${sourceBounds.top}px`,
    width: `${sourceBounds.width}px`,
  });
  document.body.append(flight);
  const animation = flight.animate(
    [
      { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
      {
        transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0) scale(${geometry.scaleX}, ${geometry.scaleY})`,
      },
    ],
    {
      duration: TAB_MOTION_DURATION_MS,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    },
  );
  const remove = () => flight.remove();
  animation.addEventListener('finish', remove, { once: true });
  animation.addEventListener('cancel', remove, { once: true });
  window.setTimeout(remove, TAB_MOTION_DURATION_MS + 80);
}
