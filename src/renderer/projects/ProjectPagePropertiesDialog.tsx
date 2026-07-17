import { useId, useState, type FormEvent } from 'react';

import {
  isNewProjectPassword,
  isProjectPassword,
  type MarkdownDocument,
  type ProjectPageNode,
  type ProjectPageProperties,
  type ProjectResult,
} from '../../shared/contracts';
import { Dialog } from '../components/dialog';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { PasswordField } from './PasswordField';
import { projectFailureMessage } from './project-result-message';

type ProtectionMode = 'protect' | 'change' | 'remove' | 'unlock';
const EMPTY_VALUE = '\u2014';

interface ReadOnlyEdit {
  nodeId: string;
  baseline: boolean;
  value: boolean;
}

export interface ProjectPagePropertiesDialogProps {
  node: ProjectPageNode & { pageType: 'markdown' };
  logicalPath: string;
  properties?: ProjectPageProperties;
  loading: boolean;
  loadError?: string;
  translate: Translate;
  onRetry: () => void;
  onClose: () => void;
  onPropertiesChange: (properties: ProjectPageProperties) => void;
  onSetReadOnly: (
    value: boolean,
    expectedRevision: string,
  ) => Promise<ProjectResult<ProjectPageProperties>>;
  onProtect: (
    password: string,
    expectedRevision: string,
  ) => Promise<ProjectResult<ProjectPageProperties>>;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
    expectedRevision: string,
  ) => Promise<ProjectResult<ProjectPageProperties>>;
  onRemovePassword: (
    currentPassword: string,
    expectedRevision: string,
  ) => Promise<ProjectResult<ProjectPageProperties>>;
  onUnlock: (password: string) => Promise<ProjectResult<MarkdownDocument>>;
  onLock: () => Promise<ProjectResult<null>>;
}

function formatBytes(value: number, locale: string | undefined): string {
  const exact = new Intl.NumberFormat(locale).format(value);
  if (value < 1_024) {
    return `${exact} bytes`;
  }

  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1_024)), 3);
  const units = ['bytes', 'KiB', 'MiB', 'GiB'];
  const compact = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value / 1_024 ** exponent);
  return `${compact} ${units[exponent]} (${exact} bytes)`;
}

function formatDate(
  value: string | null,
  locale: string | undefined,
  unavailable: string,
): string {
  if (!value) {
    return unavailable;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : unavailable;
}

function logicalParentPath(logicalPath: string): string {
  const separatorIndex = logicalPath.lastIndexOf('/');
  return separatorIndex <= 0 ? '/' : logicalPath.slice(0, separatorIndex);
}

export function ProjectPagePropertiesDialog({
  loadError,
  loading,
  logicalPath,
  node,
  onChangePassword,
  onClose,
  onLock,
  onPropertiesChange,
  onProtect,
  onRemovePassword,
  onRetry,
  onSetReadOnly,
  onUnlock,
  properties,
  translate,
}: ProjectPagePropertiesDialogProps) {
  const passwordFormTitleId = `${useId()}-password-title`;
  const [readOnlyEdit, setReadOnlyEdit] = useState<ReadOnlyEdit>();
  const [protectionMode, setProtectionMode] = useState<ProtectionMode>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState<string>();

  const displayedProperties =
    properties?.nodeId === node.nodeId ? properties : undefined;
  const unavailable = translate('projects.propertiesUnavailable');
  const locale = document.documentElement.lang || undefined;
  const location = logicalParentPath(logicalPath);
  const readOnly =
    displayedProperties &&
    readOnlyEdit?.nodeId === node.nodeId &&
    readOnlyEdit.baseline === displayedProperties.readOnly
      ? readOnlyEdit.value
      : displayedProperties?.readOnly ?? false;
  const changedReadOnly = Boolean(
    displayedProperties && readOnly !== displayedProperties.readOnly,
  );

  function acceptProperties(next: ProjectPageProperties): void {
    onPropertiesChange(next);
  }

  function resetProtectionForm(): void {
    setProtectionMode(undefined);
    setCurrentPassword('');
    setNewPassword('');
    setOperationError(undefined);
  }

  function beginProtectionAction(mode: ProtectionMode): void {
    setProtectionMode(mode);
    setCurrentPassword('');
    setNewPassword('');
    setOperationError(undefined);
  }

  async function runPropertiesOperation(
    operation: () => Promise<ProjectResult<ProjectPageProperties>>,
  ): Promise<ProjectPageProperties | undefined> {
    setPending(true);
    setOperationError(undefined);
    try {
      const result = await operation();
      if (!result.ok) {
        setOperationError(projectFailureMessage(result.error, translate));
        return undefined;
      }
      acceptProperties(result.value);
      return result.value;
    } catch (error) {
      setOperationError(String(error));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  async function applyReadOnly(closeAfter: boolean): Promise<void> {
    if (!displayedProperties) {
      return;
    }
    if (!changedReadOnly) {
      if (closeAfter) {
        onClose();
      }
      return;
    }

    const result = await runPropertiesOperation(() =>
      onSetReadOnly(readOnly, displayedProperties.revision),
    );
    if (result && closeAfter) {
      onClose();
    }
  }

  function validateProtectionForm(): boolean {
    if (
      (protectionMode === 'change' ||
        protectionMode === 'remove' ||
        protectionMode === 'unlock') &&
      !isProjectPassword(currentPassword)
    ) {
      setOperationError(translate('projects.propertiesCurrentPasswordRequired'));
      return false;
    }

    if (
      (protectionMode === 'protect' || protectionMode === 'change') &&
      !isNewProjectPassword(newPassword)
    ) {
      setOperationError(translate('projects.propertiesPasswordRequirements'));
      return false;
    }

    return true;
  }

  async function submitProtection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!displayedProperties || !protectionMode || !validateProtectionForm()) {
      return;
    }

    if (protectionMode === 'unlock') {
      setPending(true);
      setOperationError(undefined);
      try {
        const result = await onUnlock(currentPassword);
        if (!result.ok) {
          setOperationError(projectFailureMessage(result.error, translate));
          return;
        }
        acceptProperties({
          ...displayedProperties,
          locked: false,
          readOnly: result.value.readOnly,
          revision: result.value.revision,
        });
        resetProtectionForm();
      } catch (error) {
        setOperationError(String(error));
      } finally {
        setPending(false);
      }
      return;
    }

    const result = await runPropertiesOperation(() => {
      if (protectionMode === 'protect') {
        return onProtect(newPassword, displayedProperties.revision);
      }
      if (protectionMode === 'change') {
        return onChangePassword(
          currentPassword,
          newPassword,
          displayedProperties.revision,
        );
      }
      return onRemovePassword(currentPassword, displayedProperties.revision);
    });
    if (result) {
      resetProtectionForm();
    }
  }

  async function lock(): Promise<void> {
    if (!displayedProperties) {
      return;
    }
    setPending(true);
    setOperationError(undefined);
    try {
      const result = await onLock();
      if (!result.ok) {
        setOperationError(projectFailureMessage(result.error, translate));
        return;
      }
      acceptProperties({ ...displayedProperties, locked: true });
    } catch (error) {
      setOperationError(String(error));
    } finally {
      setPending(false);
    }
  }

  const protectionStatus = !displayedProperties
    ? EMPTY_VALUE
    : !displayedProperties.passwordProtected
      ? translate('projects.propertiesNotProtected')
      : displayedProperties.locked
        ? translate('projects.propertiesLocked')
        : translate('projects.propertiesUnlocked');

  return (
    <Dialog
      bodyPadding="none"
      busy={pending}
      closeLabel={translate('windowControls.close')}
      footerEnd={
        <>
          <button
            disabled={
              pending || loading || Boolean(protectionMode) || !changedReadOnly
            }
            onClick={() => void applyReadOnly(false)}
            type="button"
          >
            {translate('projects.propertiesApply')}
          </button>
          <button
            className="flyoff-dialog__button--primary"
            disabled={
              pending || loading || Boolean(protectionMode) || !displayedProperties
            }
            onClick={() => void applyReadOnly(true)}
            type="button"
          >
            {translate('projects.propertiesOk')}
          </button>
        </>
      }
      footerStart={
        <button disabled={pending} onClick={onClose} type="button">
          {translate('projects.cancel')}
        </button>
      }
      onCancel={onClose}
      size="wide"
      title={translate('projects.propertiesTitle')}
    >
      <div
        aria-busy={loading}
        className="project-page-properties"
        data-node-id={node.nodeId}
      >
        <section className="project-page-properties__general">
          <h3>{translate('projects.propertiesGeneral')}</h3>
          <dl className="project-page-properties__details">
            <div>
              <dt>{translate('projects.name')}</dt>
              <dd>{node.name}</dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesType')}</dt>
              <dd>{translate('projects.propertiesMarkdownNote')}</dd>
            </div>
            <div>
              <dt>{translate('projects.location')}</dt>
              <dd {...getTooltipTargetProps(location, 'bottom')}>{location}</dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesContentSize')}</dt>
              <dd>
                {displayedProperties
                  ? formatBytes(displayedProperties.contentSizeBytes, locale)
                  : EMPTY_VALUE}
              </dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesDiskSize')}</dt>
              <dd>
                {displayedProperties
                  ? formatBytes(displayedProperties.diskSizeBytes, locale)
                  : EMPTY_VALUE}
              </dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesCreated')}</dt>
              <dd>
                {displayedProperties
                  ? formatDate(displayedProperties.createdAt, locale, unavailable)
                  : EMPTY_VALUE}
              </dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesModified')}</dt>
              <dd>
                {displayedProperties
                  ? formatDate(displayedProperties.modifiedAt, locale, unavailable)
                  : EMPTY_VALUE}
              </dd>
            </div>
          </dl>
          <div className="project-page-properties__load-status">
            {loadError ? (
              <>
                <p className="flyoff-dialog__error" role="alert">
                  {loadError}
                </p>
                <button disabled={loading || pending} onClick={onRetry} type="button">
                  {translate('projects.propertiesRetry')}
                </button>
              </>
            ) : null}
          </div>
        </section>

        <section className="project-page-properties__attributes">
          <h3>{translate('projects.propertiesAttributes')}</h3>
          <label className="project-page-properties__checkbox">
            <input
              checked={readOnly}
              disabled={!displayedProperties || loading || pending}
              onChange={(event) => {
                if (displayedProperties) {
                  setReadOnlyEdit({
                    baseline: displayedProperties.readOnly,
                    nodeId: node.nodeId,
                    value: event.target.checked,
                  });
                }
              }}
              type="checkbox"
            />
            <span>
              <strong>{translate('projects.propertiesReadOnly')}</strong>
              <small>{translate('projects.propertiesReadOnlyHint')}</small>
            </span>
          </label>
        </section>

        <section className="project-page-properties__protection">
          <h3>{translate('projects.propertiesProtection')}</h3>
          <div className="project-page-properties__protection-status">
            <span>{translate('projects.propertiesProtectionStatus')}</span>
            <output>{protectionStatus}</output>
          </div>
          <p className="project-page-properties__warning">
            {translate('projects.propertiesProtectionWarning')}
          </p>
          {!protectionMode ? (
            <div className="project-page-properties__protection-actions">
              {displayedProperties && !displayedProperties.passwordProtected ? (
                <button
                  className="flyoff-dialog__button--primary"
                  disabled={loading || pending}
                  onClick={() => beginProtectionAction('protect')}
                  type="button"
                >
                  {translate('projects.propertiesDefinePassword')}
                </button>
              ) : null}
              {displayedProperties?.passwordProtected && displayedProperties.locked ? (
                <button
                  className="flyoff-dialog__button--primary"
                  disabled={loading || pending}
                  onClick={() => beginProtectionAction('unlock')}
                  type="button"
                >
                  {translate('projects.propertiesUnlock')}
                </button>
              ) : null}
              {displayedProperties?.passwordProtected && !displayedProperties.locked ? (
                <>
                  <button
                    className="flyoff-dialog__button--danger"
                    disabled={loading || pending}
                    onClick={() => beginProtectionAction('remove')}
                    type="button"
                  >
                    {translate('projects.propertiesRemovePassword')}
                  </button>
                  <button
                    disabled={loading || pending}
                    onClick={() => beginProtectionAction('change')}
                    type="button"
                  >
                    {translate('projects.propertiesChangePassword')}
                  </button>
                  <button
                    className="flyoff-dialog__button--primary"
                    disabled={loading || pending}
                    onClick={() => void lock()}
                    type="button"
                  >
                    {translate('projects.propertiesLockNow')}
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <form
              aria-labelledby={passwordFormTitleId}
              className="project-page-properties__password-form"
              onSubmit={(event) => void submitProtection(event)}
            >
              <h4 id={passwordFormTitleId}>
                {translate(
                  protectionMode === 'protect'
                    ? 'projects.propertiesDefinePassword'
                    : protectionMode === 'change'
                      ? 'projects.propertiesChangePassword'
                      : protectionMode === 'remove'
                        ? 'projects.propertiesRemovePassword'
                        : 'projects.propertiesUnlock',
                )}
              </h4>
              {protectionMode !== 'protect' ? (
                <PasswordField
                  autoComplete="current-password"
                  autoFocus
                  disabled={pending}
                  label={translate(
                    protectionMode === 'unlock'
                      ? 'projects.propertiesPassword'
                      : 'projects.propertiesCurrentPassword',
                  )}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  translate={translate}
                  value={currentPassword}
                />
              ) : null}
              {protectionMode === 'protect' || protectionMode === 'change' ? (
                <PasswordField
                  autoComplete="new-password"
                  autoFocus={protectionMode === 'protect'}
                  disabled={pending}
                  label={translate('projects.propertiesNewPassword')}
                  onChange={(event) => setNewPassword(event.target.value)}
                  translate={translate}
                  value={newPassword}
                />
              ) : null}
              {protectionMode === 'remove' ? (
                <p className="project-page-properties__warning">
                  {translate('projects.propertiesRemoveWarning')}
                </p>
              ) : null}
              <div className="project-page-properties__password-actions">
                <button disabled={pending} onClick={resetProtectionForm} type="button">
                  {translate('projects.propertiesBack')}
                </button>
                <button
                  className={
                    protectionMode === 'remove'
                      ? 'flyoff-dialog__button--danger'
                      : 'flyoff-dialog__button--primary'
                  }
                  disabled={pending}
                  type="submit"
                >
                  {translate(
                    protectionMode === 'protect'
                      ? 'projects.propertiesDefinePassword'
                      : protectionMode === 'change'
                        ? 'projects.propertiesChangePassword'
                        : protectionMode === 'remove'
                          ? 'projects.propertiesRemovePassword'
                          : 'projects.propertiesUnlock',
                  )}
                </button>
              </div>
            </form>
          )}
          <div className="project-page-properties__operation-status">
            {operationError ? (
              <p className="flyoff-dialog__error" role="alert">
                {operationError}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
