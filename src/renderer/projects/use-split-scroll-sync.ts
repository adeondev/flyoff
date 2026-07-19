import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react';

import type { EditorMode } from './editor-mode';

type ScrollDriver = 'reading' | 'source';

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

    reading.scrollTop = proportionalScrollTop(source, reading);
  }, [enabled, mode, readingRef, sourceRef]);

  const scheduleSync = useCallback((): void => {
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
    scheduleSync();
  }, [enabled, mode, scheduleSync]);

  useEffect(() => {
    if (
      enabled &&
      mode === 'split' &&
      driverRef.current === 'source'
    ) {
      scheduleSync();
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
        scheduleSync();
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
    },
    [],
  );

  return { handleReadingIntent, handleSourceScroll };
}
