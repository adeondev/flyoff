import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';

import {
  emptyCollectionSelection,
  selectCollectionMarquee,
  type CollectionMarqueeMode,
  type CollectionSelection,
} from './collection-selection';

const MARQUEE_START_DISTANCE = 4;
const AUTO_SCROLL_EDGE = 36;
const AUTO_SCROLL_MAX_SPEED = 18;

interface Point {
  x: number;
  y: number;
}

interface MarqueeBox {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface MarqueeSession {
  active: boolean;
  baseSelection: CollectionSelection;
  currentClient: Point;
  frameId?: number;
  itemBounds: ReadonlyMap<
    string,
    { bottom: number; left: number; right: number; top: number }
  >;
  limitReported: boolean;
  mode: CollectionMarqueeMode;
  originClient: Point;
  originContent: Point;
  pointerId: number;
  scrollElement: HTMLElement;
  treeElement: HTMLDivElement;
  visibleNodeIds: readonly string[];
}

interface UseProjectTreeMarqueeOptions {
  disabled?: boolean;
  getItemBounds?: (
    visibleItemIds: readonly string[],
    scrollElement: HTMLElement,
  ) => ReadonlyMap<
    string,
    { bottom: number; left: number; right: number; top: number }
  >;
  itemRefs: React.RefObject<Map<string, HTMLElement>>;
  itemSelector?: string;
  onSelectionChange: (selection: CollectionSelection) => void;
  onSelectionLimitReached?: () => void;
  scrollContainerSelector?: string;
  selection: CollectionSelection;
  visibleNodeIds: readonly string[];
}

function sameSelection(
  first: CollectionSelection,
  second: CollectionSelection,
): boolean {
  if (
    first.anchorId !== second.anchorId ||
    first.selectedIds.size !== second.selectedIds.size
  ) {
    return false;
  }
  for (const nodeId of first.selectedIds) {
    if (!second.selectedIds.has(nodeId)) {
      return false;
    }
  }
  return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function autoScrollSpeed(clientY: number, bounds: DOMRect): number {
  if (clientY < bounds.top + AUTO_SCROLL_EDGE) {
    return (
      -AUTO_SCROLL_MAX_SPEED *
      (1 - clamp((clientY - bounds.top) / AUTO_SCROLL_EDGE, 0, 1))
    );
  }
  if (clientY > bounds.bottom - AUTO_SCROLL_EDGE) {
    return (
      AUTO_SCROLL_MAX_SPEED *
      (1 - clamp((bounds.bottom - clientY) / AUTO_SCROLL_EDGE, 0, 1))
    );
  }
  return 0;
}

export function useProjectTreeMarquee({
  disabled = false,
  getItemBounds,
  itemRefs,
  itemSelector = '.project-tree__item',
  onSelectionChange,
  onSelectionLimitReached,
  scrollContainerSelector = '.project-sidebar__tree-scroll',
  selection,
  visibleNodeIds,
}: UseProjectTreeMarqueeOptions) {
  const [box, setBox] = useState<MarqueeBox>();
  const [selecting, setSelecting] = useState(false);
  const sessionRef = useRef<MarqueeSession | undefined>(undefined);
  const selectionRef = useRef(selection);
  const visibleNodeIdsRef = useRef(visibleNodeIds);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionLimitReachedRef = useRef(onSelectionLimitReached);

  useEffect(() => {
    selectionRef.current = selection;
    visibleNodeIdsRef.current = visibleNodeIds;
    onSelectionChangeRef.current = onSelectionChange;
    onSelectionLimitReachedRef.current = onSelectionLimitReached;
  }, [
    onSelectionChange,
    onSelectionLimitReached,
    selection,
    visibleNodeIds,
  ]);

  const stopSession = useCallback(
    (restoreSelection = false): void => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      if (session.frameId !== undefined) {
        cancelAnimationFrame(session.frameId);
      }
      if (session.treeElement.hasPointerCapture(session.pointerId)) {
        session.treeElement.releasePointerCapture(session.pointerId);
      }
      sessionRef.current = undefined;
      setSelecting(false);
      setBox(undefined);
      if (
        restoreSelection &&
        !sameSelection(selectionRef.current, session.baseSelection)
      ) {
        onSelectionChangeRef.current(session.baseSelection);
      }
    },
    [],
  );

  function updateSession(): void {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    session.frameId = undefined;

    const movement = Math.hypot(
      session.currentClient.x - session.originClient.x,
      session.currentClient.y - session.originClient.y,
    );
    if (!session.active && movement < MARQUEE_START_DISTANCE) {
      return;
    }
    if (!session.active) {
      session.active = true;
      setSelecting(true);
    }

    const scroll = session.scrollElement;
    const scrollBounds = scroll.getBoundingClientRect();
    const speed = autoScrollSpeed(session.currentClient.y, scrollBounds);
    const previousScrollTop = scroll.scrollTop;
    if (speed !== 0) {
      scroll.scrollTop = clamp(
        scroll.scrollTop + speed,
        0,
        Math.max(0, scroll.scrollHeight - scroll.clientHeight),
      );
    }

    const currentContent = {
      x:
        clamp(
          session.currentClient.x,
          scrollBounds.left,
          scrollBounds.right,
        ) -
        scrollBounds.left +
        scroll.scrollLeft,
      y:
        clamp(
          session.currentClient.y,
          scrollBounds.top,
          scrollBounds.bottom,
        ) -
        scrollBounds.top +
        scroll.scrollTop,
    };
    const contentLeft = Math.min(session.originContent.x, currentContent.x);
    const contentRight = Math.max(session.originContent.x, currentContent.x);
    const contentTop = Math.min(session.originContent.y, currentContent.y);
    const contentBottom = Math.max(session.originContent.y, currentContent.y);
    const intersectedNodeIds = new Set<string>();

    for (const nodeId of session.visibleNodeIds) {
      const bounds = session.itemBounds.get(nodeId);
      if (!bounds) {
        continue;
      }
      if (
        bounds.right >= contentLeft &&
        bounds.left <= contentRight &&
        bounds.bottom >= contentTop &&
        bounds.top <= contentBottom
      ) {
        intersectedNodeIds.add(nodeId);
      }
    }

    const nextSelection = selectCollectionMarquee(
      session.baseSelection,
      session.visibleNodeIds,
      intersectedNodeIds,
      session.mode,
    );
    if (!sameSelection(selectionRef.current, nextSelection)) {
      selectionRef.current = nextSelection;
      onSelectionChangeRef.current(nextSelection);
    }
    if (nextSelection.truncated && !session.limitReported) {
      session.limitReported = true;
      onSelectionLimitReachedRef.current?.();
    }

    const originViewport = {
      x: clamp(
        scrollBounds.left +
          session.originContent.x -
          scroll.scrollLeft,
        scrollBounds.left,
        scrollBounds.right,
      ),
      y: clamp(
        scrollBounds.top +
          session.originContent.y -
          scroll.scrollTop,
        scrollBounds.top,
        scrollBounds.bottom,
      ),
    };
    const currentViewport = {
      x: clamp(
        session.currentClient.x,
        scrollBounds.left,
        scrollBounds.right,
      ),
      y: clamp(
        session.currentClient.y,
        scrollBounds.top,
        scrollBounds.bottom,
      ),
    };
    setBox({
      height: Math.abs(currentViewport.y - originViewport.y),
      left: Math.min(originViewport.x, currentViewport.x),
      top: Math.min(originViewport.y, currentViewport.y),
      width: Math.abs(currentViewport.x - originViewport.x),
    });

    if (scroll.scrollTop !== previousScrollTop) {
      session.frameId = requestAnimationFrame(updateSession);
    }
  }

  function scheduleUpdate(): void {
    const session = sessionRef.current;
    if (!session || session.frameId !== undefined) {
      return;
    }
    session.frameId = requestAnimationFrame(updateSession);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target;
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.pointerType === 'touch' ||
      !(target instanceof Element) ||
      !event.currentTarget.contains(target) ||
      target.closest(itemSelector)
    ) {
      return;
    }
    const scrollElement = event.currentTarget.closest<HTMLElement>(
      scrollContainerSelector,
    );
    if (!scrollElement) {
      return;
    }
    const bounds = scrollElement.getBoundingClientRect();
    const visibleIds = visibleNodeIdsRef.current;
    const itemBounds = new Map<
      string,
      { bottom: number; left: number; right: number; top: number }
    >(getItemBounds?.(visibleIds, scrollElement));
    if (itemBounds.size === 0) {
      for (const nodeId of visibleIds) {
        const item = itemRefs.current?.get(nodeId);
        if (!item) {
          continue;
        }
        const itemRect = item.getBoundingClientRect();
        const left =
          itemRect.left - bounds.left + scrollElement.scrollLeft;
        const top = itemRect.top - bounds.top + scrollElement.scrollTop;
        itemBounds.set(nodeId, {
          bottom: top + itemRect.height,
          left,
          right: left + itemRect.width,
          top,
        });
      }
    }
    const mode: CollectionMarqueeMode =
      event.ctrlKey || event.metaKey
        ? 'toggle'
        : event.shiftKey
          ? 'add'
          : 'replace';
    const baseSelection = selectionRef.current;
    sessionRef.current = {
      active: false,
      baseSelection,
      currentClient: { x: event.clientX, y: event.clientY },
      itemBounds,
      limitReported: false,
      mode,
      originClient: { x: event.clientX, y: event.clientY },
      originContent: {
        x: event.clientX - bounds.left + scrollElement.scrollLeft,
        y: event.clientY - bounds.top + scrollElement.scrollTop,
      },
      pointerId: event.pointerId,
      scrollElement,
      treeElement: event.currentTarget,
      visibleNodeIds: visibleIds,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (mode === 'replace' && baseSelection.selectedIds.size > 0) {
      const empty = emptyCollectionSelection();
      selectionRef.current = empty;
      onSelectionChangeRef.current(empty);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    session.currentClient = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    scheduleUpdate();
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    session.currentClient = { x: event.clientX, y: event.clientY };
    if (session.frameId !== undefined) {
      cancelAnimationFrame(session.frameId);
      session.frameId = undefined;
    }
    updateSession();
    stopSession();
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>): void {
    if (sessionRef.current?.pointerId === event.pointerId) {
      stopSession(true);
    }
  }

  function handleLostPointerCapture(
    event: PointerEvent<HTMLDivElement>,
  ): void {
    if (sessionRef.current?.pointerId === event.pointerId) {
      stopSession();
    }
  }

  useEffect(() => {
    if (!selecting) {
      return;
    }
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      stopSession();
      const empty = emptyCollectionSelection();
      selectionRef.current = empty;
      onSelectionChangeRef.current(empty);
    };
    const handleBlur = (): void => {
      stopSession();
      const empty = emptyCollectionSelection();
      selectionRef.current = empty;
      onSelectionChangeRef.current(empty);
    };
    window.addEventListener('keydown', handleEscape, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [selecting, stopSession]);

  useEffect(() => () => stopSession(), [stopSession]);

  return {
    boxStyle: box
      ? ({
          height: box.height,
          left: box.left,
          top: box.top,
          width: box.width,
        } satisfies CSSProperties)
      : undefined,
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    selecting,
  };
}
