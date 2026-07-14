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
