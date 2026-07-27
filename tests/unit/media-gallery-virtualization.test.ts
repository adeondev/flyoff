import { describe, expect, it } from 'vitest';

import {
  mediaGalleryVirtualItemBounds,
  mediaGalleryVirtualMetrics,
} from '../../src/renderer/projects/media-gallery-virtualization';

describe('media gallery virtualization', () => {
  it('windows a large grid on complete row boundaries', () => {
    const metrics = mediaGalleryVirtualMetrics(
      10_000,
      320,
      600,
      4_000,
      'grid',
      'normal',
    );

    expect(metrics.columnCount).toBeGreaterThan(1);
    expect(metrics.startIndex % metrics.columnCount).toBe(0);
    expect(metrics.endIndex).toBeLessThan(10_000);
    expect(metrics.topSpacerHeight).toBeGreaterThan(0);
    expect(metrics.contentHeight).toBeGreaterThan(4_000);
  });

  it('provides stable logical bounds for unmounted entries', () => {
    const ids = Array.from({ length: 500 }, (_, index) => String(index));
    const metrics = mediaGalleryVirtualMetrics(
      ids.length,
      300,
      400,
      0,
      'details',
      'normal',
    );
    const bounds = mediaGalleryVirtualItemBounds(ids, metrics, 'details');

    expect(bounds.size).toBe(ids.length);
    expect(bounds.get('400')!.top).toBeGreaterThan(
      bounds.get('100')!.bottom,
    );
  });
});
