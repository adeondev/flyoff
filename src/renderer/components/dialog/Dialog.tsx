import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { getTooltipTargetProps } from '../tooltip';
import { TwemojiText } from '../twemoji';
import { acquireModalRootLock, restoreModalFocus } from './modal-root-lock';

export interface DialogProps {
  title: string;
  closeLabel: string;
  children?: ReactNode;
  description?: string;
  busy?: boolean;
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  size?: 'compact' | 'standard' | 'wide';
  bodyPadding?: 'default' | 'none';
  onCancel: () => void;
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
  closeLabel,
  description,
  footerEnd,
  footerStart,
  onCancel,
  size = 'standard',
  title,
}: DialogProps) {
  const hasBody = children !== undefined && children !== null;
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialogElement = dialogRef.current;
    const releaseRootLock = acquireModalRootLock();
    if (dialogElement) {
      firstDialogFocusTarget(dialogElement)?.focus();
    }

    return () => {
      releaseRootLock();
      restoreModalFocus(previousFocus, dialogElement);
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        onCancel();
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

  return createPortal(
    <div className="flyoff-dialog__backdrop">
      <div
        aria-busy={busy}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`flyoff-dialog flyoff-dialog--${size}${
          hasBody ? '' : ' flyoff-dialog--bodyless'
        }`}
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
            onClick={onCancel}
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
