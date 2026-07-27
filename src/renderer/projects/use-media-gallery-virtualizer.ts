import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';

import type {
  MediaGalleryDensity,
  MediaGalleryViewMode,
} from './media-gallery-model';
import {
  mediaGalleryVirtualItemBounds,
  mediaGalleryVirtualMetrics,
} from './media-gallery-virtualization';

interface UseMediaGalleryVirtualizerOptions {
  density: MediaGalleryDensity;
  itemIds: readonly string[];
  scrollRef: RefObject<HTMLDivElement | null>;
  viewMode: MediaGalleryViewMode;
}

interface Viewport {
  height: number;
  scrollTop: number;
  width: number;
}

export function useMediaGalleryVirtualizer({
  density,
  itemIds,
  scrollRef,
  viewMode,
}: UseMediaGalleryVirtualizerOptions) {
  const [viewport, setViewport] = useState<Viewport>({
    height: 640,
    scrollTop: 0,
    width: 320,
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    let frameId: number | undefined;
    const publish = (): void => {
      frameId = undefined;
      setViewport({
        height: scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        width: scroll.clientWidth,
      });
    };
    const schedule = (): void => {
      if (frameId === undefined) {
        frameId = requestAnimationFrame(publish);
      }
    };
    publish();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [scrollRef]);

  const enabled = itemIds.length > 120;
  const metrics = useMemo(
    () =>
      mediaGalleryVirtualMetrics(
        itemIds.length,
        viewport.width,
        viewport.height,
        viewport.scrollTop,
        viewMode,
        density,
      ),
    [density, itemIds.length, viewMode, viewport],
  );
  const itemBounds = useMemo(
    () => mediaGalleryVirtualItemBounds(itemIds, metrics, viewMode),
    [itemIds, metrics, viewMode],
  );
  const getItemBounds = useCallback(
    (
      _visibleItemIds: readonly string[],
      scrollElement: HTMLElement,
    ): ReadonlyMap<
      string,
      { bottom: number; left: number; right: number; top: number }
    > => {
      if (!enabled) {
        return new Map();
      }
      const width = Math.max(1, scrollElement.clientWidth - 16);
      return new Map(
        [...itemBounds].map(([itemId, bounds]) => [
          itemId,
          {
            ...bounds,
            left: 8 + bounds.left * width,
            right: 8 + bounds.right * width,
          },
        ]),
      );
    },
    [enabled, itemBounds],
  );
  const scrollToIndex = useCallback(
    (index: number): void => {
      const scroll = scrollRef.current;
      if (!scroll || index < 0) {
        return;
      }
      const row = Math.floor(index / metrics.columnCount);
      const top = 8 + row * metrics.rowHeight;
      const bottom = top + metrics.rowHeight;
      if (top < scroll.scrollTop) {
        scroll.scrollTop = top;
      } else if (bottom > scroll.scrollTop + scroll.clientHeight) {
        scroll.scrollTop = bottom - scroll.clientHeight;
      }
    },
    [metrics.columnCount, metrics.rowHeight, scrollRef],
  );

  return {
    enabled,
    endIndex: enabled ? metrics.endIndex : itemIds.length,
    getItemBounds,
    scrollToIndex,
    startIndex: enabled ? metrics.startIndex : 0,
    topSpacerHeight: enabled ? metrics.topSpacerHeight : 0,
    bottomSpacerHeight: enabled ? metrics.bottomSpacerHeight : 0,
  };
}
