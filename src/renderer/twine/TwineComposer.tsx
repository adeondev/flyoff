import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import plusIcon from '../../../public/images/icons/actions/plus.svg';
import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import autoApproveIcon from '../../../public/images/icons/twine/auto-approve.svg';
import approvalIcon from '../../../public/images/icons/twine/approval.svg';
import attachmentIcon from '../../../public/images/icons/twine/attachment.svg';
import audioIcon from '../../../public/images/icons/twine/audio.svg';
import searchIcon from '../../../public/images/icons/twine/search.svg';
import sendIcon from '../../../public/images/icons/twine/send.svg';
import fullAccessIcon from '../../../public/images/icons/twine/thinking.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { DropdownMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { TwineAttachments } from './TwineAttachments';
import type { TwineApprovalMode, TwineThinkingLevel } from './twine-state';
import type { TwineAttachment } from './twine-types';

interface TwineComposerProps {
  active: boolean;
  attachments: readonly TwineAttachment[];
  approvalMode: TwineApprovalMode;
  draft: string;
  editMessageId?: string;
  editMode: boolean;
  isGenerating: boolean;
  notice?: string;
  onCancelEdit: () => void;
  onAddFiles: (files: FileList | readonly File[]) => void;
  onApprovalChange: (mode: TwineApprovalMode) => void;
  onDraftChange: (draft: string) => void;
  onRemoveAttachment: (id: string) => void;
  onResearchChange: (enabled: boolean) => void;
  onSend: () => void;
  onThinkingChange: (level: TwineThinkingLevel) => void;
  originalEditText?: string;
  researchEnabled: boolean;
  thinkingLevel: TwineThinkingLevel;
  translate: Translate;
}

export function TwineComposer({
  active,
  attachments,
  approvalMode,
  draft,
  editMessageId,
  editMode,
  isGenerating,
  notice,
  onCancelEdit,
  onAddFiles,
  onApprovalChange,
  onDraftChange,
  onRemoveAttachment,
  onResearchChange,
  onSend,
  onThinkingChange,
  originalEditText,
  researchEnabled,
  thinkingLevel,
  translate,
}: TwineComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousActiveRef = useRef(active);
  const previousEditMessageIdRef = useRef<string | undefined>(undefined);
  const [dragActive, setDragActive] = useState(false);
  const trimmedDraft = draft.trim();
  const canSend = editMode
    ? trimmedDraft.length > 0 && trimmedDraft !== originalEditText?.trim()
    : !isGenerating && (trimmedDraft.length > 0 || attachments.length > 0);
  const approvalLabel =
    approvalMode === 'full'
      ? translate('twine.approvalFull')
      : approvalMode === 'automatic'
        ? translate('twine.approvalAutomatic')
        : translate('twine.approvalRequest');
  const selectedApprovalIcon =
    approvalMode === 'full'
      ? fullAccessIcon
      : approvalMode === 'automatic'
        ? autoApproveIcon
        : approvalIcon;
  const toolItems = useMemo<readonly MenuItem[]>(
    () => [
      {
        kind: 'action',
        id: 'attach',
        label: translate('twine.attachFile'),
        icon: attachmentIcon,
      },
      {
        kind: 'action',
        id: 'research',
        label: translate('twine.researchMode'),
        icon: searchIcon,
        checked: researchEnabled,
      },
    ],
    [researchEnabled, translate],
  );
  const approvalItems = useMemo<readonly MenuItem[]>(
    () => [
      {
        kind: 'action',
        id: 'approval-request',
        label: translate('twine.approvalRequest'),
        icon: approvalIcon,
        checked: approvalMode === 'request',
      },
      {
        kind: 'action',
        id: 'approval-automatic',
        label: translate('twine.approvalAutomatic'),
        icon: autoApproveIcon,
        checked: approvalMode === 'automatic',
      },
      {
        kind: 'action',
        id: 'approval-full',
        label: translate('twine.approvalFull'),
        icon: fullAccessIcon,
        checked: approvalMode === 'full',
        tone: 'warning',
      },
    ],
    [approvalMode, translate],
  );
  const thinkingItems = useMemo<readonly MenuItem[]>(
    () => [
      {
        kind: 'label',
        id: 'thinking-label',
        label: translate('twine.thinkingLevel'),
      },
      {
        kind: 'action',
        id: 'thinking-high',
        label: translate('twine.thinkingHigh'),
        checked: thinkingLevel === 'high',
      },
      {
        kind: 'action',
        id: 'thinking-low',
        label: translate('twine.thinkingLow'),
        checked: thinkingLevel === 'low',
      },
    ],
    [thinkingLevel, translate],
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const reactivated = active && !previousActiveRef.current;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 184)}px`;
    if (!draft || textarea.scrollHeight <= 184 || !active || reactivated) {
      textarea.scrollTop = 0;
    }
    previousActiveRef.current = active;
  }, [active, draft]);

  useLayoutEffect(() => {
    if (!editMode) {
      previousEditMessageIdRef.current = undefined;
      return;
    }
    if (
      !active ||
      !editMessageId ||
      previousEditMessageIdRef.current === editMessageId
    ) {
      return;
    }
    previousEditMessageIdRef.current = editMessageId;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(draft.length, draft.length);
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [active, draft.length, editMessageId, editMode]);

  function cancelEdit(): void {
    onCancelEdit();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleToolAction(id: string): void {
    switch (id) {
      case 'attach':
        fileInputRef.current?.click();
        return;
      case 'thinking-low':
        onThinkingChange('low');
        return;
      case 'thinking-high':
        onThinkingChange('high');
        return;
      case 'research':
        onResearchChange(!researchEnabled);
        return;
      case 'approval-request':
        onApprovalChange('request');
        return;
      case 'approval-automatic':
        onApprovalChange('automatic');
        return;
      case 'approval-full':
        onApprovalChange('full');
        return;
      default:
        return;
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (editMode && event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      if (!editMode) {
        onAddFiles(event.clipboardData.files);
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (!editMode && event.dataTransfer.files.length > 0) {
      onAddFiles(event.dataTransfer.files);
    }
  }

  return (
    <div className="twine-composer-area">
      <form
        className="twine-composer"
        data-drag-active={(!editMode && dragActive) || undefined}
        data-edit-mode={editMode || undefined}
        data-generating={isGenerating || undefined}
        data-thinking-level={thinkingLevel}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!editMode) {
            setDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onSubmit={handleSubmit}
      >
        {!editMode ? (
          <>
            <input
              className="twine-composer__file-input"
              multiple
              onChange={(event) => {
                if (event.currentTarget.files) {
                  onAddFiles(event.currentTarget.files);
                }
                event.currentTarget.value = '';
              }}
              ref={fileInputRef}
              type="file"
            />
            <TwineAttachments
              attachments={attachments}
              onRemove={onRemoveAttachment}
              translate={translate}
            />
          </>
        ) : null}
        <div className="twine-composer__input-shell">
          <textarea
            aria-label={translate(
              editMode ? 'twine.editMessage' : 'twine.messageInput',
            )}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={translate(
              editMode ? 'twine.editMessage' : 'twine.messagePlaceholder',
            )}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          {editMode ? (
            <div className="twine-composer__footer twine-composer__footer--editing">
              <span className="twine-composer__edit-label">
                {translate('twine.editMessage')}
              </span>
              <div className="twine-composer__edit-actions">
                <button
                  className="twine-composer__edit-cancel"
                  onClick={cancelEdit}
                  type="button"
                >
                  {translate('twine.cancel')}
                </button>
                <button
                  aria-label={translate('twine.saveEdit')}
                  className="twine-composer__send twine-composer__edit-save"
                  disabled={!canSend}
                  type="submit"
                  {...getTooltipTargetProps(translate('twine.saveEdit'), 'top')}
                >
                  <MaskedIcon icon={sendIcon} />
                </button>
              </div>
            </div>
          ) : (
            <div className="twine-composer__footer">
              <div className="twine-composer__leading-action">
                <DropdownMenu
                  items={toolItems}
                  onAction={handleToolAction}
                  placement="top-end"
                  trigger={(props) => (
                    <button
                      {...props}
                      aria-label={translate('twine.tools')}
                      className="twine-composer__icon-button"
                      type="button"
                      {...getTooltipTargetProps(translate('twine.tools'), 'top')}
                    >
                      <MaskedIcon icon={plusIcon} />
                    </button>
                  )}
                />
                <DropdownMenu
                  items={approvalItems}
                  onAction={handleToolAction}
                  placement="top-end"
                  trigger={(props) => (
                    <button
                      {...props}
                      aria-label={`${translate('twine.approvalMode')}: ${approvalLabel}`}
                      className="twine-approval-trigger"
                      data-approval-mode={approvalMode}
                      type="button"
                    >
                      <MaskedIcon icon={selectedApprovalIcon} />
                      <span>{approvalLabel}</span>
                    </button>
                  )}
                />
              </div>
              <div className="twine-composer__actions">
                <DropdownMenu
                  items={thinkingItems}
                  onAction={handleToolAction}
                  placement="top-end"
                  trigger={(props) => (
                    <button
                      {...props}
                      aria-label={`${translate('twine.thinkingLevel')}: ${translate(
                        thinkingLevel === 'high'
                          ? 'twine.thinkingHigh'
                          : 'twine.thinkingLow',
                      )}`}
                      className="twine-thinking-trigger"
                      type="button"
                    >
                      <span>
                        {translate(
                          thinkingLevel === 'high'
                            ? 'twine.thinkingHigh'
                            : 'twine.thinkingLow',
                        )}
                      </span>
                      <MaskedIcon icon={chevronIcon} />
                    </button>
                  )}
                />
                <button
                  aria-disabled="true"
                  aria-label={translate('twine.audioComingSoon')}
                  className="twine-composer__audio"
                  type="button"
                  {...getTooltipTargetProps(
                    translate('twine.audioComingSoon'),
                    'top',
                  )}
                >
                  <MaskedIcon icon={audioIcon} />
                </button>
                <button
                  aria-label={translate('twine.send')}
                  className="twine-composer__send"
                  disabled={!canSend}
                  type="submit"
                  {...getTooltipTargetProps(
                    isGenerating
                      ? translate('twine.generating')
                      : translate('twine.send'),
                    'top',
                  )}
                >
                  <MaskedIcon icon={sendIcon} />
                </button>
              </div>
            </div>
          )}
        </div>
        {!editMode && dragActive ? (
          <div className="twine-composer__drop-label">
            {translate('twine.dropFiles')}
          </div>
        ) : null}
      </form>
      <p aria-live="polite" className="twine-composer__notice" role="status">
        {notice ?? ''}
      </p>
    </div>
  );
}
