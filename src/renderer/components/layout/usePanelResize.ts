import { useCallback, useEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';

const RESIZING_CLASS = 'flyoff-resizing';

export interface PanelResizeOptions {
  target: RefObject<HTMLElement | null>;
  cssVar: string;
  min: number;
  max: number;
  step?: number;
  direction?: 1 | -1;
  getSize: () => number;
  onCommit: (size: number) => void;
  onReset?: () => void;
}

export interface PanelResizeHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function usePanelResize({
  cssVar,
  direction = 1,
  getSize,
  max,
  min,
  onCommit,
  onReset,
  step = 24,
  target,
}: PanelResizeOptions): PanelResizeHandlers {
  const cleanupRef = useRef<() => void>(() => undefined);
  const write = useCallback(
    (size: number) => {
      target.current?.style.setProperty(cssVar, `${size}px`);
    },
    [cssVar, target],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      cleanupRef.current();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startSize = getSize();
      let latest = startSize;
      document.documentElement.classList.add(RESIZING_CLASS);
      handle.dataset.resizing = 'true';
      handle.setPointerCapture?.(pointerId);

      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        latest = clamp(
          startSize + (moveEvent.clientX - startX) * direction,
          min,
          max,
        );
        write(latest);
      };
      const cleanup = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', cancel);
        handle.removeEventListener('lostpointercapture', cancel);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
        document.documentElement.classList.remove(RESIZING_CLASS);
        delete handle.dataset.resizing;
        if (handle.hasPointerCapture?.(pointerId)) {
          handle.releasePointerCapture?.(pointerId);
        }
        cleanupRef.current = () => undefined;
      };
      const end = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        onCommit(latest);
      };
      const cancel = () => {
        cleanup();
        write(startSize);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', cancel);
      handle.addEventListener('lostpointercapture', cancel);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      cleanupRef.current = cancel;
    },
    [direction, getSize, max, min, onCommit, write],
  );

  useEffect(
    () => () => {
      cleanupRef.current();
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      let next: number;

      switch (event.key) {
        case 'ArrowLeft':
          next = clamp(getSize() - step * direction, min, max);
          break;
        case 'ArrowRight':
          next = clamp(getSize() + step * direction, min, max);
          break;
        case 'Home':
          next = min;
          break;
        case 'End':
          next = max;
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          onReset?.();
          return;
        default:
          return;
      }

      event.preventDefault();
      write(next);
      onCommit(next);
    },
    [direction, getSize, max, min, onCommit, onReset, step, write],
  );

  const onDoubleClick = useCallback(() => onReset?.(), [onReset]);

  return { onPointerDown, onKeyDown, onDoubleClick };
}
