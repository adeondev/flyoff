import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type {
  FlyoffApi,
  TwineCredentialStatus,
  TwineGenerateMessage,
} from '../../shared/contracts';
import chevronIcon from '../../../public/images/icons/actions/chevron-right.svg';
import conversationIcon from '../../../public/images/icons/twine/conversation.svg';
import fullAccessIcon from '../../../public/images/icons/twine/thinking.svg';
import historyIcon from '../../../public/images/icons/twine/history.svg';
import geminiLogo from '../../../public/images/twine/gemini-logo.png';
import { Dialog } from '../components/dialog';
import { MaskedIcon } from '../components/MaskedIcon';
import { DropdownMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { InternalPageProps } from '../pages/page-types';
import { TwineApiKeyDialog } from './TwineApiKeyDialog';
import { TwineComposer } from './TwineComposer';
import { TwineConversation } from './TwineConversation';
import { TwineHistoryDialog } from './TwineHistoryDialog';
import {
  activeTwineBranch,
  forkTwineConversation,
  selectTwineVariant,
  truncateActiveTwineConversation,
  twineConversationVariants,
  updateTwineBranchMessages,
} from './twine-conversation-state';
import {
  getTwineModel,
  isTwineModelId,
  TWINE_MODELS,
  type TwineModelId,
} from './twine-models';
import {
  migrateTwinePageState,
  type TwineApprovalMode,
  type TwinePageState,
  type TwineThinkingLevel,
} from './twine-state';
import type {
  TwineAttachment,
  TwineConversationScrollState,
  TwineMessage,
  TwineMessageAttachment,
} from './twine-types';
import { getTwineRuntime } from './twine-runtime';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 100 * 1_024 * 1_024;
const MAX_PREVIEW_BYTES = 10 * 1_024 * 1_024;

function getFlyoffApi(): Partial<FlyoffApi> {
  return (window.flyoff ?? {}) as Partial<FlyoffApi>;
}

function attachmentKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function generationMessages(
  messages: readonly TwineMessage[],
): readonly TwineGenerateMessage[] {
  return messages.flatMap<TwineGenerateMessage>((message) =>
    (message.kind === 'assistant' || message.kind === 'user') &&
    message.text.trim().length > 0
      ? [{ role: message.kind, text: message.text }]
      : [],
  );
}

export function TwineChat({
  active,
  descriptor,
  onStateChange,
  translate,
}: InternalPageProps) {
  const initialPageState = useMemo(
    () => migrateTwinePageState(descriptor.pageState),
    [descriptor.pageState],
  );
  const [pageState, setPageState] = useState<TwinePageState>(initialPageState);
  const runtime = getTwineRuntime();
  const runtimeState = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const {
    apiKeyDialogDismissed,
    attachments,
    conversation,
    conversationId,
    conversationSummaries,
    conversationTitle,
    draft,
    editSession,
    isGenerating,
  } = runtimeState;
  const [credentialStatus, setCredentialStatus] =
    useState<TwineCredentialStatus>();
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [confirmNewConversation, setConfirmNewConversation] = useState(false);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [deleteMessageId, setDeleteMessageId] = useState<string>();
  const [deleteConversationId, setDeleteConversationId] = useState<string>();
  const [showHistory, setShowHistory] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const selectedModel = getTwineModel(pageState.data.modelId);
  const messages = activeTwineBranch(conversation).messages;
  const variants = twineConversationVariants(conversation);
  const activeVariantIndex = variants.findIndex(
    ({ id }) => id === conversation.activeBranchId,
  );
  const variantAnchor = variants.find(({ forkMessageId }) => forkMessageId)
    ?.forkMessageId;
  const initialConversationScrollState = useMemo(
    () => runtime.getScrollState(conversationId),
    [conversationId, runtime],
  );

  const modelItems = useMemo<readonly MenuItem[]>(
    () => [
      { kind: 'label', id: 'twine-models-label', label: translate('twine.models') },
      ...TWINE_MODELS.map(({ id, label }, index) => ({
        kind: 'action' as const,
        id,
        imageIcon: geminiLogo,
        label,
        checked: pageState.data.modelId === id,
        shortcut: index === 0 ? translate('twine.defaultModel') : undefined,
      })),
    ],
    [pageState.data.modelId, translate],
  );
  const nextId = useCallback((prefix: string): string => {
    return runtime.nextId(prefix);
  }, [runtime]);

  const handleScrollStateChange = useCallback(
    (state: TwineConversationScrollState): void => {
      runtime.setScrollState(conversationId, state);
    },
    [conversationId, runtime],
  );

  const updatePageState = useCallback((
    update: (current: TwinePageState) => TwinePageState,
  ): void => {
    setPageState((current) => {
      const next = update(current);
      onStateChange(next);
      return next;
    });
  }, [onStateChange]);

  async function saveApiKey(apiKey: string): Promise<void> {
    const status = await getFlyoffApi().saveTwineApiKey?.(apiKey);
    if (!status) {
      throw new Error('Twine credentials bridge is unavailable.');
    }
    if (!status.hasApiKey) {
      throw new Error('The Gemini API key could not be persisted.');
    }
    setCredentialStatus(status);
    runtime.setApiKeyDialogDismissed(false);
    setShowApiKeyDialog(false);
  }

  async function confirmDeleteConversation(): Promise<void> {
    const id = deleteConversationId;
    setDeleteConversationId(undefined);
    if (!id) {
      return;
    }
    if (id === conversationId) {
      runtime.clearEditSession();
    }
    await runtime.deleteConversation(id);
  }

  useEffect(() => {
    const api = getFlyoffApi();
    runtime.connect(api);
    runtime.configure(translate('twine.untitledConversation'), {
      authentication: translate('twine.generationErrorAuthentication'),
      network: translate('twine.generationErrorNetwork'),
      overloaded: translate('twine.generationErrorOverloaded'),
      'rate-limited': translate('twine.generationErrorRateLimited'),
      'tool-requirements': translate('twine.generationErrorTools'),
      unknown: translate('twine.generationFailed'),
    });
    void runtime.loadHistory(
      initialPageState.data.activeConversationId,
      translate('twine.untitledConversation'),
    );
  }, [initialPageState.data.activeConversationId, runtime, translate]);

  useEffect(() => {
    if (conversationId === pageState.data.activeConversationId) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        updatePageState((current) => ({
          ...current,
          data: { ...current.data, activeConversationId: conversationId },
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, pageState.data.activeConversationId, updatePageState]);

  useEffect(() => {
    const api = getFlyoffApi();
    if (!api.getTwineCredentialStatus) {
      return;
    }
    let cancelled = false;
    void api.getTwineCredentialStatus().then((status) => {
      if (!cancelled) {
        setCredentialStatus(status);
        if (!status.hasApiKey && !apiKeyDialogDismissed) {
          setShowApiKeyDialog(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiKeyDialogDismissed]);

  function setModel(modelId: TwineModelId): void {
    updatePageState((current) => ({
      ...current,
      data: { ...current.data, modelId },
    }));
  }

  function setThinkingLevel(thinkingLevel: TwineThinkingLevel): void {
    updatePageState((current) => ({
      ...current,
      data: { ...current.data, thinkingLevel },
    }));
  }

  function setApprovalMode(approvalMode: TwineApprovalMode): void {
    updatePageState((current) => ({
      ...current,
      data: { ...current.data, approvalMode },
    }));
  }

  function setResearchEnabled(researchEnabled: boolean): void {
    updatePageState((current) => ({
      ...current,
      data: { ...current.data, researchEnabled },
    }));
  }

  function requestApprovalMode(approvalMode: TwineApprovalMode): void {
    if (approvalMode === 'full' && pageState.data.approvalMode !== 'full') {
      setConfirmFullAccess(true);
      return;
    }
    setApprovalMode(approvalMode);
  }

  function loadPreview(file: File, id: string): void {
    if (
      !file.type.startsWith('image/') ||
      file.size > MAX_PREVIEW_BYTES ||
      typeof FileReader !== 'function'
    ) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        return;
      }
      const previewUrl = reader.result;
      runtime.setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id ? { ...attachment, previewUrl } : attachment,
        ),
      );
      runtime.setConversation((current) => ({
        ...current,
        branches: Object.fromEntries(
          Object.entries(current.branches).map(([branchId, branch]) => [
            branchId,
            {
              ...branch,
              messages: branch.messages.map((message) => ({
                ...message,
                attachments: message.attachments.map((attachment) =>
                  attachment.id === id ? { ...attachment, previewUrl } : attachment,
                ),
              })),
            },
          ]),
        ),
      }));
    });
    reader.readAsDataURL(file);
  }

  function addFiles(files: FileList | readonly File[]): void {
    const candidates = Array.from(files);
    const existingKeys = new Set(attachments.map(({ file }) => attachmentKey(file)));
    const added: TwineAttachment[] = [];
    let nextNotice: string | undefined;
    for (const file of candidates) {
      if (attachments.length + added.length >= MAX_ATTACHMENTS) {
        nextNotice = translate('twine.attachmentLimit');
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        nextNotice = translate('twine.attachmentTooLarge');
        continue;
      }
      const key = attachmentKey(file);
      if (existingKeys.has(key)) {
        nextNotice = translate('twine.attachmentDuplicate');
        continue;
      }
      existingKeys.add(key);
      const id = nextId('attachment');
      added.push({ file, id });
      loadPreview(file, id);
    }
    if (added.length > 0) {
      runtime.setAttachments((current) => [...current, ...added]);
    }
    setNotice(nextNotice);
  }

  function removeAttachment(id: string): void {
    runtime.setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
    setNotice(undefined);
  }

  function cancelGeneration(): void {
    runtime.cancelGeneration();
  }

  async function startGeneration(
    requestId: string,
    requestMessages: readonly TwineGenerateMessage[],
  ): Promise<void> {
    runtime.beginGeneration(requestId);
    try {
      await getFlyoffApi().startTwineGeneration?.({
        approvalMode: pageState.data.approvalMode,
        messages: requestMessages,
        modelId: pageState.data.modelId,
        requestId,
        researchEnabled: pageState.data.researchEnabled,
        thinkingLevel: pageState.data.thinkingLevel,
      });
    } catch (error) {
      const missingApiKey = String(error).toLowerCase().includes('api key');
      runtime.failGeneration(
        requestId,
        missingApiKey
          ? translate('twine.apiKeyMissing')
          : translate('twine.generationFailed'),
      );
      if (missingApiKey) {
        setShowApiKeyDialog(true);
      }
    }
  }

  function createAssistantMessage(id: string, requestId: string): TwineMessage {
    return {
      activity: 'thinking',
      answerRevealed: false,
      attachments: [],
      id,
      kind: 'assistant',
      status: 'streaming',
      streamRequestId: requestId,
      text: '',
      thinkingStartedAt: Date.now(),
      thought: '',
      tools: [],
    };
  }

  function sendMessage(): void {
    if (editSession) {
      void submitEditedMessage();
    } else {
      void submitMessage();
    }
  }

  async function submitMessage(): Promise<void> {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || isGenerating) {
      return;
    }
    const branch = activeTwineBranch(conversation);
    const messageAttachments: TwineMessageAttachment[] = attachments.map(
      ({ file, id, previewUrl }) => ({
        id,
        name: file.name,
        previewUrl,
        size: file.size,
      }),
    );
    if (!getFlyoffApi().startTwineGeneration) {
      runtime.setConversation((current) =>
        updateTwineBranchMessages(current, current.activeBranchId, (currentMessages) => [
          ...currentMessages,
          {
            attachments: messageAttachments,
            id: nextId('message'),
            kind: 'user',
            status: 'complete',
            text,
          },
          {
            attachments: [],
            id: nextId('message'),
            kind: 'system',
            status: 'error',
            text: translate('twine.modelUnavailable'),
          },
        ]),
      );
      runtime.markActivity();
      runtime.setAttachments([]);
      runtime.setDraft('');
      setNotice(undefined);
      return;
    }
    if (!credentialStatus?.hasApiKey) {
      setShowApiKeyDialog(true);
      setNotice(translate('twine.apiKeyMissing'));
      return;
    }
    if (!text && attachments.length > 0) {
      setNotice(translate('twine.attachmentsNotSent'));
      return;
    }

    const requestId = nextId('twine-request');
    const userMessage: TwineMessage = {
      attachments: messageAttachments,
      id: nextId('message'),
      kind: 'user',
      status: 'complete',
      text,
    };
    const assistantMessage = createAssistantMessage(nextId('message'), requestId);
    const nextMessages = [...branch.messages, userMessage, assistantMessage];
    runtime.setConversation((current) =>
      updateTwineBranchMessages(current, branch.id, () => nextMessages),
    );
    runtime.markActivity();
    runtime.setAttachments([]);
    runtime.setDraft('');
    setNotice(
      messageAttachments.length > 0
        ? translate('twine.attachmentsNotSent')
        : undefined,
    );
    await startGeneration(requestId, generationMessages(nextMessages));
  }

  function beginEditingMessage(messageId: string): void {
    const message = activeTwineBranch(conversation).messages.find(
      ({ id }) => id === messageId,
    );
    if (message?.kind === 'user') {
      cancelGeneration();
      runtime.beginEdit(messageId, message.text);
    }
  }

  async function submitEditedMessage(): Promise<void> {
    if (!editSession) {
      return;
    }
    const text = editSession.text.trim();
    const branch = activeTwineBranch(conversation);
    const index = branch.messages.findIndex(
      ({ id }) => id === editSession.messageId,
    );
    if (
      !text ||
      text === editSession.originalText.trim() ||
      conversationId !== editSession.conversationId ||
      branch.id !== editSession.branchId ||
      index < 0 ||
      branch.messages[index]?.kind !== 'user'
    ) {
      runtime.clearEditSession();
      return;
    }
    cancelGeneration();
    const requestId = nextId('twine-request');
    const userMessage = { ...branch.messages[index]!, text };
    const assistantMessage = createAssistantMessage(nextId('message'), requestId);
    const nextMessages = [
      ...branch.messages.slice(0, index),
      userMessage,
      assistantMessage,
    ];
    const branchId = nextId('branch');
    runtime.setConversation((current) =>
      forkTwineConversation(current, {
        branchId,
        forkMessageId: editSession.messageId,
        messages: nextMessages,
      }),
    );
    runtime.markActivity();
    runtime.clearEditSession();
    setNotice(undefined);
    await startGeneration(requestId, generationMessages(nextMessages));
  }

  function regenerateMessage(messageId: string): void {
    runtime.clearEditSession();
    cancelGeneration();
    const branch = activeTwineBranch(conversation);
    const index = branch.messages.findIndex(({ id }) => id === messageId);
    if (index < 0 || branch.messages[index]?.kind !== 'assistant') {
      return;
    }
    const requestId = nextId('twine-request');
    const assistantMessage = createAssistantMessage(messageId, requestId);
    const nextMessages = [...branch.messages.slice(0, index), assistantMessage];
    const branchId = nextId('branch');
    runtime.setConversation((current) =>
      forkTwineConversation(current, {
        branchId,
        forkMessageId: messageId,
        messages: nextMessages,
      }),
    );
    void startGeneration(requestId, generationMessages(nextMessages));
  }

  function rewindToMessage(messageId: string): void {
    runtime.clearEditSession();
    cancelGeneration();
    runtime.setConversation((current) =>
      truncateActiveTwineConversation(current, messageId, true),
    );
  }

  function deleteMessage(): void {
    const messageId = deleteMessageId;
    setDeleteMessageId(undefined);
    if (!messageId) {
      return;
    }
    runtime.clearEditSession();
    cancelGeneration();
    const branch = activeTwineBranch(conversation);
    const index = branch.messages.findIndex(({ id }) => id === messageId);
    if (index < 0) {
      return;
    }
    runtime.setConversation((current) =>
      truncateActiveTwineConversation(current, messageId, false),
    );
  }

  async function resetConversation(): Promise<void> {
    cancelGeneration();
    runtime.clearEditSession();
    runtime.setAttachments([]);
    runtime.setDraft('');
    setNotice(undefined);
    setConfirmNewConversation(false);
    await runtime.createConversation();
  }

  function requestNewConversation(): void {
    if (messages.length > 0 || attachments.length > 0 || draft.trim()) {
      setConfirmNewConversation(true);
    } else {
      void resetConversation();
    }
  }

  function dismissHistory(): void {
    setShowHistory(false);
    requestAnimationFrame(() => {
      pageRef.current
        ?.querySelector<HTMLTextAreaElement>('.twine-composer textarea')
        ?.focus({ preventScroll: true });
    });
  }

  return (
    <main
      className="twine-page"
      aria-label={translate('twine.conversation')}
      ref={pageRef}
    >
      <section className="twine-page__workspace">
        <header className="twine-page__toolbar">
          <div className="twine-page__toolbar-leading">
            <button
              aria-label={translate('twine.history')}
              className="twine-history-trigger"
              onClick={() => setShowHistory(true)}
              type="button"
              {...getTooltipTargetProps(translate('twine.history'), 'bottom')}
            >
              <MaskedIcon icon={historyIcon} />
            </button>
            <DropdownMenu
              items={modelItems}
              onAction={(id) => {
                if (isTwineModelId(id)) {
                  setModel(id);
                }
              }}
              trigger={(props) => (
                <button
                  {...props}
                  aria-label={`${translate('twine.selectModel')}: ${selectedModel.label}`}
                  className="twine-model-selector"
                  type="button"
                >
                  <img aria-hidden="true" src={geminiLogo} alt="" />
                  <span>{selectedModel.label}</span>
                  <MaskedIcon
                    className="twine-model-selector__chevron"
                    icon={chevronIcon}
                  />
                </button>
              )}
            />
          </div>
          <button
            aria-label={translate('twine.newConversation')}
            className="twine-new-conversation"
            onClick={requestNewConversation}
            type="button"
            {...getTooltipTargetProps(
              translate('twine.newConversation'),
              'bottom',
            )}
          >
            <MaskedIcon icon={conversationIcon} />
          </button>
        </header>
        <div
          className={`twine-page__body${
            messages.length === 0 ? ' twine-page__body--empty' : ''
          }`}
        >
          <TwineConversation
            active={active}
            conversationId={conversationId}
            conversationTitle={conversationTitle}
            initialScrollState={initialConversationScrollState}
            key={conversationId ?? 'twine-session'}
            messages={messages}
            onDelete={setDeleteMessageId}
            onEditRequest={beginEditingMessage}
            onRegenerate={regenerateMessage}
            onRevealComplete={(messageId) =>
              runtime.markAnswerRevealed(messageId)
            }
            onRewind={rewindToMessage}
            onScrollStateChange={handleScrollStateChange}
            onVariantChange={(offset) => {
              runtime.clearEditSession();
              cancelGeneration();
              runtime.setConversation((current) =>
                selectTwineVariant(current, offset),
              );
            }}
            translate={translate}
            variant={
              variants.length > 1 && activeVariantIndex >= 0
                ? {
                    anchorMessageId: variantAnchor,
                    index: activeVariantIndex,
                    total: variants.length,
                  }
                : undefined
            }
          />
          <TwineComposer
            active={active}
            attachments={attachments}
            approvalMode={pageState.data.approvalMode}
            draft={editSession?.text ?? draft}
            editMessageId={editSession?.messageId}
            editMode={Boolean(editSession)}
            isGenerating={isGenerating}
            notice={notice}
            onAddFiles={addFiles}
            onApprovalChange={requestApprovalMode}
            onCancelEdit={() => runtime.clearEditSession()}
            onDraftChange={(value) => {
              if (editSession) {
                runtime.setEditText(value);
              } else {
                runtime.setDraft(value);
              }
            }}
            onRemoveAttachment={removeAttachment}
            onResearchChange={setResearchEnabled}
            onSend={sendMessage}
            onThinkingChange={setThinkingLevel}
            originalEditText={editSession?.originalText}
            researchEnabled={pageState.data.researchEnabled}
            thinkingLevel={pageState.data.thinkingLevel}
            translate={translate}
          />
        </div>
      </section>
      {showHistory ? (
        <TwineHistoryDialog
          activeConversationId={conversationId}
          initialConversations={conversationSummaries}
          onCancel={dismissHistory}
          onCreate={() => {
            setShowHistory(false);
            requestNewConversation();
          }}
          onDelete={setDeleteConversationId}
          onOpen={(id) => {
            runtime.clearEditSession();
            setNotice(undefined);
            setShowHistory(false);
            void runtime.openConversation(id);
          }}
          onQuery={(query) => runtime.queryConversations(query)}
          onUpdate={(request) => runtime.updateConversation(request)}
          translate={translate}
        />
      ) : null}
      {showApiKeyDialog && credentialStatus ? (
        <TwineApiKeyDialog
          closeLabel={translate('windowControls.close')}
          encryptionAvailable={credentialStatus.encryptionAvailable}
          onCancel={() => {
            runtime.setApiKeyDialogDismissed(true);
            setShowApiKeyDialog(false);
          }}
          onSave={saveApiKey}
          translate={translate}
        />
      ) : null}
      {confirmNewConversation ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          description={translate('twine.newConversationDescription')}
          footerEnd={
            <button
              className="flyoff-dialog__button--primary"
              onClick={() => void resetConversation()}
              type="button"
            >
              {translate('twine.startNewConversation')}
            </button>
          }
          footerStart={
            <button
              data-dialog-initial-focus
              onClick={() => setConfirmNewConversation(false)}
              type="button"
            >
              {translate('twine.cancel')}
            </button>
          }
          onCancel={() => setConfirmNewConversation(false)}
          size="compact"
          title={translate('twine.newConversationTitle')}
        />
      ) : null}
      {confirmFullAccess ? (
        <Dialog
          className="twine-full-access-dialog"
          closeLabel={translate('windowControls.close')}
          closeOnBackdrop
          footerEnd={
            <button
              className="twine-full-access-dialog__confirm"
              onClick={() => {
                setApprovalMode('full');
                setConfirmFullAccess(false);
              }}
              type="button"
            >
              {translate('twine.approvalFullConfirm')}
            </button>
          }
          footerStart={
            <button
              data-dialog-initial-focus
              onClick={() => setConfirmFullAccess(false)}
              type="button"
            >
              {translate('twine.cancel')}
            </button>
          }
          onCancel={() => setConfirmFullAccess(false)}
          size="compact"
          title={translate('twine.approvalFullTitle')}
        >
          <div className="twine-full-access-dialog__content">
            <MaskedIcon
              className="twine-full-access-dialog__icon"
              icon={fullAccessIcon}
            />
            <div>
              <p>{translate('twine.approvalFullDescription')}</p>
              <p className="twine-full-access-dialog__warning">
                {translate('twine.approvalFullWarning')}
              </p>
            </div>
          </div>
        </Dialog>
      ) : null}
      {deleteMessageId ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          description={translate('twine.deleteMessageDescription')}
          footerEnd={
            <button
              className="flyoff-dialog__button--danger"
              onClick={deleteMessage}
              type="button"
            >
              {translate('twine.deleteMessage')}
            </button>
          }
          footerStart={
            <button
              data-dialog-initial-focus
              onClick={() => setDeleteMessageId(undefined)}
              type="button"
            >
              {translate('twine.cancel')}
            </button>
          }
          onCancel={() => setDeleteMessageId(undefined)}
          size="compact"
          title={translate('twine.deleteMessageTitle')}
        />
      ) : null}
      {deleteConversationId ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          description={translate('twine.deleteConversationDescription')}
          footerEnd={
            <button
              className="flyoff-dialog__button--danger"
              onClick={() => void confirmDeleteConversation()}
              type="button"
            >
              {translate('twine.deleteConversation')}
            </button>
          }
          footerStart={
            <button
              data-dialog-initial-focus
              onClick={() => setDeleteConversationId(undefined)}
              type="button"
            >
              {translate('twine.cancel')}
            </button>
          }
          onCancel={() => setDeleteConversationId(undefined)}
          size="compact"
          title={translate('twine.deleteConversationTitle')}
        />
      ) : null}
    </main>
  );
}
