import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { getTooltipTargetProps } from '../tooltip';
import type { ToastDescriptor } from './toast-state';

const TOAST_EXIT_DURATION = 45;

export interface ToastHostProps {
  ariaLabel: string;
  closeLabel: string;
  toasts: readonly ToastDescriptor[];
  onDismiss: (id: string) => void;
}

function ToastItem({
  closeLabel,
  onDismiss,
  toast,
}: {
  closeLabel: string;
  onDismiss: () => void;
  toast: ToastDescriptor;
}) {
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(0);
  const exitingRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const timerRef = useRef<number | undefined>(undefined);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const beginExit = useCallback((): void => {
    if (exitingRef.current) {
      return;
    }
    exitingRef.current = true;
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    setExiting(true);
    exitTimerRef.current = window.setTimeout(
      () => onDismissRef.current(),
      TOAST_EXIT_DURATION,
    );
  }, []);

  const startTimer = useCallback((): void => {
    startedAtRef.current = performance.now();
    timerRef.current = window.setTimeout(beginExit, remainingRef.current);
  }, [beginExit]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
      if (exitTimerRef.current !== undefined) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, [startTimer]);

  const pause = (): void => {
    if (paused || exiting) {
      return;
    }
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (performance.now() - startedAtRef.current),
      );
    }
    setPaused(true);
  };

  const resume = (): void => {
    if (!paused || exiting) {
      return;
    }
    setPaused(false);
    startTimer();
  };

  const handleBlur = (event: FocusEvent<HTMLElement>): void => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
      resume();
    }
  };

  const handleMouseLeave = (event: MouseEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(document.activeElement)) {
      resume();
    }
  };

  return (
    <article
      className={`toast toast--${toast.tone}${exiting ? ' toast--exiting' : ''}`}
      onBlur={handleBlur}
      onFocus={pause}
      onMouseEnter={pause}
      onMouseLeave={handleMouseLeave}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      style={{
        '--toast-duration': `${toast.duration}ms`,
        '--toast-progress-state': paused ? 'paused' : 'running',
      } as React.CSSProperties}
      tabIndex={0}
    >
      <span aria-hidden="true" className="toast__marker" />
      <p>{toast.message}</p>
      <button
        aria-label={closeLabel}
        onClick={onDismiss}
        type="button"
        {...getTooltipTargetProps(closeLabel, 'left')}
      >
        <span aria-hidden="true">&times;</span>
      </button>
      <span aria-hidden="true" className="toast__progress" />
    </article>
  );
}

export function ToastHost({
  ariaLabel,
  closeLabel,
  onDismiss,
  toasts,
}: ToastHostProps) {
  if (toasts.length === 0) {
    return null;
  }

  return createPortal(
    <section aria-label={ariaLabel} className="toast-host">
      {toasts.map((toast) => (
        <ToastItem
          closeLabel={closeLabel}
          key={toast.id}
          onDismiss={() => onDismiss(toast.id)}
          toast={toast}
        />
      ))}
    </section>,
    document.body,
  );
}
