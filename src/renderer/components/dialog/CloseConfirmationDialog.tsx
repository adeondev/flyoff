import type { CloseIntent } from '../../../shared/contracts';
import type { Translate } from '../../pages/page-types';
import { Dialog } from './Dialog';

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
  const title =
    intent === 'restart-application'
      ? translate('closeConfirmation.restartTitle')
      : intent === 'quit-application'
      ? translate('closeConfirmation.quitTitle')
      : translate('closeConfirmation.closeWindowTitle');
  const confirmLabel =
    intent === 'restart-application'
      ? translate('closeConfirmation.restart')
      : intent === 'quit-application'
      ? translate('closeConfirmation.quit')
      : translate('closeConfirmation.closeWindow');

  return (
    <Dialog
      busy={pending}
      closeLabel={translate('windowControls.close')}
      description={translate('closeConfirmation.description')}
      footerEnd={
        <button
          className="flyoff-dialog__button--primary"
          disabled={pending}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      }
      footerStart={
        <button
          data-dialog-initial-focus
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          {translate('closeConfirmation.cancel')}
        </button>
      }
      onCancel={onCancel}
      size="compact"
      title={title}
    />
  );
}
