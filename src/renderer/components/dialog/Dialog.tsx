import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { dismissFlyoffTooltip, getTooltipTargetProps } from '../tooltip';
import { TwemojiText } from '../twemoji';
import { acquireModalRootLock, restoreModalFocus } from './modal-root-lock';

export type DialogDismissReason = 'backdrop' | 'close-button' | 'escape';

export interface DialogProps {
  title: string;
  closeLabel: string;
  className?: string;
  children?: ReactNode;
  description?: string;
  busy?: boolean;
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  size?: 'compact' | 'standard' | 'wide';
  bodyPadding?: 'default' | 'none';
  closeOnBackdrop?: boolean;
  restoreFocus?: boolean;
  onCancel: (reason: DialogDismissReason) => void;
}

function firstDialogFocusTarget(dialog: HTMLElement): HTMLElement | null {
  return (
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
    dialog.querySelector<HTMLElement>(
      '.flyoff-dialog__body input:not([disabled]), .flyoff-dialog__body textarea:not([disabled]), .flyoff-dialog__body button:not([disabled]), .flyoff-dialog__footer button:not([disabled])',
    ) ??
    dialog.querySelector<HTMLElement>('.flyoff-dialog__close')
  );
}

export function Dialog({
  bodyPadding = 'default',
  busy = false,
  children,
  className,
  closeLabel,
  closeOnBackdrop = false,
  description,
  footerEnd,
  footerStart,
  onCancel,
  restoreFocus = true,
  size = 'standard',
  title,
}: DialogProps) {
  const hasBody = children !== undefined && children !== null;
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dismissFlyoffTooltip();
    const previousFocus = document.activeElement;
    const dialogElement = dialogRef.current;
    const releaseRootLock = acquireModalRootLock();
    if (dialogElement) {
      firstDialogFocusTarget(dialogElement)?.focus();
    }

    return () => {
      releaseRootLock();
      if (restoreFocus) {
        restoreModalFocus(previousFocus, dialogElement);
      }
    };
  }, [restoreFocus]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (
        event.target instanceof Element &&
        event.target.closest('.flyoff-menu')
      ) {
        return;
      }
      event.preventDefault();
      if (!busy) {
        onCancel('escape');
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : currentIndex === focusable.length - 1
        ? 0
        : currentIndex + 1;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }

  function handleBackdropPointerDown(
    event: PointerEvent<HTMLDivElement>,
  ): void {
    if (
      closeOnBackdrop &&
      !busy &&
      event.target === event.currentTarget
    ) {
      onCancel('backdrop');
    }
  }

  return createPortal(
    <div
      className="flyoff-dialog__backdrop"
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        aria-busy={busy}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`flyoff-dialog flyoff-dialog--${size}${
          hasBody ? '' : ' flyoff-dialog--bodyless'
        }${className ? ` ${className}` : ''}`}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header className="flyoff-dialog__header">
          <div className="flyoff-dialog__heading">
            <h2 id={titleId}>
              <TwemojiText text={title} />
            </h2>
            {description ? (
              <p id={descriptionId}>
                <TwemojiText text={description} />
              </p>
            ) : null}
          </div>
          <button
            aria-label={closeLabel}
            className="flyoff-dialog__close"
            disabled={busy}
            onClick={() => onCancel('close-button')}
            type="button"
            {...getTooltipTargetProps(closeLabel, 'bottom')}
          >
            <span aria-hidden="true">&#215;</span>
          </button>
        </header>
        {hasBody ? (
          <div
            className={`flyoff-dialog__body${
              bodyPadding === 'none' ? ' flyoff-dialog__body--flush' : ''
            }`}
          >
            {children}
          </div>
        ) : null}
        {footerStart || footerEnd ? (
          <footer className="flyoff-dialog__footer">
            <div className="flyoff-dialog__footer-start">{footerStart}</div>
            <div className="flyoff-dialog__footer-end">{footerEnd}</div>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
