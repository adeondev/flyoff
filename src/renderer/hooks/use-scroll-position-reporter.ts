import { useCallback, useEffect, useRef } from 'react';

type ScrollPositionListener = (
  scrollTop: number,
  settled?: boolean,
) => void;

export function useScrollPositionReporter(
  onScroll?: ScrollPositionListener,
) {
  const frameRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(0);

  const cancelFrame = useCallback((): void => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
  }, []);

  const reportScroll = useCallback(
    (scrollTop: number): void => {
      pendingRef.current = scrollTop;
      if (frameRef.current !== undefined) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined;
        onScroll?.(pendingRef.current, false);
      });
    },
    [onScroll],
  );

  const reportScrollEnd = useCallback(
    (scrollTop: number): void => {
      pendingRef.current = scrollTop;
      cancelFrame();
      onScroll?.(scrollTop, true);
    },
    [cancelFrame, onScroll],
  );

  useEffect(() => cancelFrame, [cancelFrame]);

  return { reportScroll, reportScrollEnd };
}
