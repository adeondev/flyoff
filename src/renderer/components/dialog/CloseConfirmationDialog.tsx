import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { CloseIntent } from '../../../shared/contracts';
import type { Translate } from '../../pages/page-types';
import { acquireModalRootLock, restoreModalFocus } from './modal-root-lock';

interface CloseConfirmationDialogProps {
  intent: CloseIntent;
  translate: Translate;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export function CloseConfirmationDialog({
  intent,
  translate,
  onCancel,
  onConfirm,
  pending,
}: CloseConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const title =
    intent === 'quit-application'
      ? translate('closeConfirmation.quitTitle')
      : translate('closeConfirmation.closeWindowTitle');
  const confirmLabel =
    intent === 'quit-application'
      ? translate('closeConfirmation.quit')
      : translate('closeConfirmation.closeWindow');

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialogElement = dialogRef.current;
    const releaseRootLock = acquireModalRootLock();

    cancelRef.current?.focus();

    return () => {
      releaseRootLock();
      restoreModalFocus(previousFocus, dialogElement);
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ) ?? [],
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const currentIndex = focusable.indexOf(
      document.activeElement as HTMLButtonElement,
    );
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
    <div className="close-dialog__backdrop">
      <div
        aria-describedby="close-dialog-description"
        aria-labelledby="close-dialog-title"
        aria-modal="true"
        aria-busy={pending}
        className="close-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h2 id="close-dialog-title">{title}</h2>
        <p id="close-dialog-description">
          {translate('closeConfirmation.description')}
        </p>
        <div className="close-dialog__actions">
          <button
            disabled={pending}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {translate('closeConfirmation.cancel')}
          </button>
          <button
            className="close-dialog__confirm"
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
