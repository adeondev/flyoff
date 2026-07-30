import { useCallback, useEffect, useRef } from 'react';

type ScrollPositionListener = (
  scrollTop: number,
  settled?: boolean,
) => void;

const SCROLL_SETTLE_DELAY_MS = 80;

export function useScrollPositionReporter(
  onScroll?: ScrollPositionListener,
) {
  const lastReportedRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(0);
  const settleTimerRef = useRef<number | undefined>(undefined);

  const cancelSettle = useCallback((): void => {
    if (settleTimerRef.current !== undefined) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
    }
  }, []);

  const reportScroll = useCallback(
    (scrollTop: number): void => {
      pendingRef.current = scrollTop;
      cancelSettle();
      lastReportedRef.current = scrollTop;
      onScroll?.(scrollTop, false);
    },
    [cancelSettle, onScroll],
  );

  const reportScrollEnd = useCallback(
    (scrollTop: number): void => {
      pendingRef.current = scrollTop;
      cancelSettle();
      if (lastReportedRef.current !== scrollTop) {
        lastReportedRef.current = scrollTop;
        onScroll?.(scrollTop, false);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = undefined;
        onScroll?.(pendingRef.current, true);
      }, SCROLL_SETTLE_DELAY_MS);
    },
    [cancelSettle, onScroll],
  );

  useEffect(
    () => () => {
      cancelSettle();
    },
    [cancelSettle],
  );

  return { reportScroll, reportScrollEnd };
}
