import {
  useState,
  type FormEvent,
} from 'react';

import { Dialog } from '../components/dialog';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';

const GEMINI_API_KEY_URL = 'https://aistudio.google.com/app/apikey';

interface TwineApiKeyDialogProps {
  closeLabel: string;
  encryptionAvailable: boolean;
  onCancel: () => void;
  onSave: (apiKey: string) => Promise<void>;
  translate: Translate;
}

export function TwineApiKeyDialog({
  closeLabel,
  encryptionAvailable,
  onCancel,
  onSave,
  translate,
}: TwineApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [visible, setVisible] = useState(false);
  const canSave = apiKey.trim().length > 0 && encryptionAvailable && !busy;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await onSave(apiKey);
    } catch {
      setError(translate('twine.apiKeySaveError'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      closeLabel={closeLabel}
      description={translate('twine.apiKeyDialogDescription')}
      footerEnd={
        <button
          className="flyoff-dialog__button--primary"
          disabled={!canSave}
          form="twine-api-key-form"
          type="submit"
        >
          {busy ? translate('twine.savingApiKey') : translate('twine.saveApiKey')}
        </button>
      }
      footerStart={
        <button data-dialog-initial-focus onClick={onCancel} type="button">
          {translate('twine.apiKeyLater')}
        </button>
      }
      onCancel={busy ? () => undefined : onCancel}
      size="standard"
      title={translate('twine.apiKeyDialogTitle')}
    >
      <form
        className="twine-api-key-dialog"
        id="twine-api-key-form"
        onSubmit={handleSubmit}
      >
        <label className="twine-api-key-dialog__field">
          <span>{translate('twine.apiKeyInput')}</span>
          <span className="twine-api-key-dialog__input-row">
            <input
              autoComplete="off"
              disabled={busy || !encryptionAvailable}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder={translate('twine.apiKeyInputPlaceholder')}
              type={visible ? 'text' : 'password'}
              value={apiKey}
            />
            <button
              aria-label={
                visible
                  ? translate('twine.hideApiKey')
                  : translate('twine.showApiKey')
              }
              disabled={busy}
              onClick={() => setVisible((current) => !current)}
              type="button"
              {...getTooltipTargetProps(
                visible
                  ? translate('twine.hideApiKey')
                  : translate('twine.showApiKey'),
                'top',
              )}
            >
              {visible ? translate('twine.hideApiKey') : translate('twine.showApiKey')}
            </button>
          </span>
        </label>
        {!encryptionAvailable ? (
          <p className="twine-api-key-dialog__error">
            {translate('twine.apiKeyEncryptionUnavailable')}
          </p>
        ) : null}
        {error ? (
          <p className="twine-api-key-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="twine-api-key-dialog__link"
          onClick={() => {
            void window.flyoff?.openExternalLink({ url: GEMINI_API_KEY_URL });
          }}
          type="button"
        >
          {translate('twine.createApiKey')}
        </button>
      </form>
    </Dialog>
  );
}
