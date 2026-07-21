import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react';

import type { EditorMode } from './editor-mode';

type ScrollDriver = 'reading' | 'source';

interface ScrollRanges {
  source: number;
  target: number;
}

interface UseSplitScrollSyncOptions {
  content: string;
  enabled?: boolean;
  mode: EditorMode;
  readingRef: RefObject<HTMLElement | null>;
  sourceRef: RefObject<HTMLElement | null>;
}

export function proportionalScrollTop(
  source: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>,
  target: Pick<HTMLElement, 'clientHeight' | 'scrollHeight'>,
): number {
  const sourceRange = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetRange = Math.max(0, target.scrollHeight - target.clientHeight);

  if (sourceRange === 0 || targetRange === 0) {
    return 0;
  }

  return Math.min(
    targetRange,
    Math.max(0, (source.scrollTop / sourceRange) * targetRange),
  );
}

export function useSplitScrollSync({
  content,
  enabled = true,
  mode,
  readingRef,
  sourceRef,
}: UseSplitScrollSyncOptions) {
  const driverRef = useRef<ScrollDriver>('source');
  const frameRef = useRef<number | undefined>(undefined);
  const measurePendingRef = useRef(true);
  const rangesRef = useRef<ScrollRanges | undefined>(undefined);

  const syncFromSource = useCallback((): void => {
    if (
      !enabled ||
      mode !== 'split' ||
      driverRef.current !== 'source'
    ) {
      return;
    }

    const source = sourceRef.current;
    const reading = readingRef.current;
    if (!source || !reading) {
      return;
    }

    if (measurePendingRef.current || !rangesRef.current) {
      rangesRef.current = {
        source: Math.max(0, source.scrollHeight - source.clientHeight),
        target: Math.max(0, reading.scrollHeight - reading.clientHeight),
      };
      measurePendingRef.current = false;
    }

    const ranges = rangesRef.current;
    const nextScrollTop =
      ranges.source === 0 || ranges.target === 0
        ? 0
        : Math.min(
            ranges.target,
            Math.max(0, (source.scrollTop / ranges.source) * ranges.target),
          );
    if (Math.abs(reading.scrollTop - nextScrollTop) >= 0.5) {
      reading.scrollTop = nextScrollTop;
    }
  }, [enabled, mode, readingRef, sourceRef]);

  const scheduleSync = useCallback((measure = false): void => {
    if (measure) {
      measurePendingRef.current = true;
    }
    if (frameRef.current !== undefined) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      syncFromSource();
    });
  }, [syncFromSource]);

  const handleSourceScroll = useCallback((): void => {
    if (!enabled) {
      return;
    }
    driverRef.current = 'source';
    scheduleSync();
  }, [enabled, scheduleSync]);

  const handleReadingIntent = useCallback((): void => {
    if (enabled && mode === 'split') {
      driverRef.current = 'reading';
    }
  }, [enabled, mode]);

  useEffect(() => {
    if (!enabled || mode !== 'split') {
      return;
    }

    driverRef.current = 'source';
    scheduleSync(true);
  }, [enabled, mode, scheduleSync]);

  useEffect(() => {
    if (
      enabled &&
      mode === 'split' &&
      driverRef.current === 'source'
    ) {
      scheduleSync(true);
    }
  }, [content, enabled, mode, scheduleSync]);

  useEffect(() => {
    if (
      !enabled ||
      mode !== 'split' ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (driverRef.current === 'source') {
        scheduleSync(true);
      }
    });
    const source = sourceRef.current;
    const reading = readingRef.current;
    if (source) {
      observer.observe(source);
    }
    if (reading) {
      observer.observe(reading);
    }

    return () => observer.disconnect();
  }, [enabled, mode, readingRef, scheduleSync, sourceRef]);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
      rangesRef.current = undefined;
    },
    [],
  );

  return { handleReadingIntent, handleSourceScroll };
}
