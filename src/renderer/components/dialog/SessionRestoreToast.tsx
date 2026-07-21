import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { Translate } from '../../pages/page-types';

interface SessionRestoreToastProps {
  translate: Translate;
  onIgnore: () => void;
  onRestore: () => void;
}

export function SessionRestoreToast({
  translate,
  onIgnore,
  onRestore,
}: SessionRestoreToastProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector(
          '[role="dialog"][aria-modal="true"], .add-instance-popover[role="dialog"], .external-link-popover[role="dialog"], [role="menu"][data-positioned="true"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      onIgnore();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onIgnore]);

  return createPortal(
    <aside
      aria-live="polite"
      aria-label={translate('sessionRestore.message')}
      className="session-restore"
      role="status"
    >
      <p>{translate('sessionRestore.message')}</p>
      <div className="session-restore__actions">
        <button onClick={onIgnore} type="button">
          {translate('sessionRestore.ignore')}
        </button>
        <button
          className="session-restore__primary"
          onClick={onRestore}
          type="button"
        >
          {translate('sessionRestore.restore')}
        </button>
      </div>
    </aside>,
    document.body,
  );
}
