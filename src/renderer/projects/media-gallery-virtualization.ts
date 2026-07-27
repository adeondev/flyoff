import type {
  MediaGalleryDensity,
  MediaGalleryViewMode,
} from './media-gallery-model';

export interface MediaGalleryVirtualMetrics {
  columnCount: number;
  contentHeight: number;
  endIndex: number;
  rowHeight: number;
  startIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

const GRID_MIN_WIDTH: Readonly<Record<MediaGalleryDensity, number>> = {
  compact: 72,
  normal: 88,
  large: 126,
};

const ROW_HEIGHT: Readonly<
  Record<MediaGalleryViewMode, Record<MediaGalleryDensity, number>>
> = {
  grid: { compact: 97, normal: 113, large: 147 },
  list: { compact: 49, normal: 49, large: 49 },
  details: { compact: 35, normal: 35, large: 35 },
};

export function mediaGalleryVirtualMetrics(
  itemCount: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollTop: number,
  viewMode: MediaGalleryViewMode,
  density: MediaGalleryDensity,
  overscanRows = 3,
): MediaGalleryVirtualMetrics {
  const gap = viewMode === 'grid' ? 7 : 1;
  const horizontalPadding = 16;
  const rowHeight = ROW_HEIGHT[viewMode][density];
  const columnCount =
    viewMode === 'grid'
      ? Math.max(
          1,
          Math.floor(
            (Math.max(0, viewportWidth - horizontalPadding) + gap) /
              (GRID_MIN_WIDTH[density] + gap),
          ),
        )
      : 1;
  const rowCount = Math.ceil(itemCount / columnCount);
  const firstVisibleRow = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - 8) / rowHeight),
  );
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startRow = Math.max(0, firstVisibleRow - overscanRows);
  const endRow = Math.min(
    rowCount,
    firstVisibleRow + visibleRows + overscanRows,
  );
  const startIndex = Math.min(itemCount, startRow * columnCount);
  const endIndex = Math.min(itemCount, endRow * columnCount);
  const topSpacerHeight = startRow * rowHeight;
  const bottomSpacerHeight = Math.max(0, (rowCount - endRow) * rowHeight);

  return {
    columnCount,
    contentHeight: rowCount * rowHeight + 16,
    endIndex,
    rowHeight,
    startIndex,
    topSpacerHeight,
    bottomSpacerHeight,
  };
}

export function mediaGalleryVirtualItemBounds(
  itemIds: readonly string[],
  metrics: MediaGalleryVirtualMetrics,
  viewMode: MediaGalleryViewMode,
): ReadonlyMap<
  string,
  { bottom: number; left: number; right: number; top: number }
> {
  const bounds = new Map<
    string,
    { bottom: number; left: number; right: number; top: number }
  >();
  const gap = viewMode === 'grid' ? 7 : 1;
  const cellWidth =
    viewMode === 'grid' ? 1 / metrics.columnCount : 1;
  const headerHeight = viewMode === 'details' ? 34 : 0;
  for (const [index, itemId] of itemIds.entries()) {
    const row = Math.floor(index / metrics.columnCount);
    const column = index % metrics.columnCount;
    const top = 8 + headerHeight + row * metrics.rowHeight;
    bounds.set(itemId, {
      bottom: top + metrics.rowHeight - gap,
      left: column * cellWidth,
      right: (column + 1) * cellWidth,
      top,
    });
  }
  return bounds;
}
