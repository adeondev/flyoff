import type {
  FlyoffApi,
  TwineConversationMutationRequest,
  TwineConversationQuery,
  TwineConversationQueryResult,
  TwineConversationSnapshot,
  TwineConversationStoreSnapshot,
  TwineGenerationErrorCode,
  TwineGenerationEvent,
} from '../../shared/contracts';
import {
  clearRememberedTwineConversationSnapshot,
  createTwineConversationSnapshot,
  createEmptyTwineConversationSnapshot,
  rememberedTwineConversationSnapshot,
  rememberTwineConversationSnapshot,
  restoreTwineConversationSnapshot,
} from './twine-conversation-persistence';
import {
  activeTwineBranch,
  createTwineConversationState,
  updateTwineBranchMessages,
  updateTwineMessageByRequest,
} from './twine-conversation-state';
import type {
  TwineAttachment,
  TwineConversationScrollState,
  TwineConversationState,
} from './twine-types';

export interface TwineEditSession {
  branchId: string;
  conversationId: string | null;
  messageId: string;
  originalText: string;
  text: string;
}

export interface TwineRuntimeSnapshot {
  apiKeyDialogDismissed: boolean;
  attachments: readonly TwineAttachment[];
  conversation: TwineConversationState;
  conversationActivityAt: number;
  conversationArchivedAt: number | null;
  conversationCreatedAt: number;
  conversationId: string | null;
  conversationPinnedAt: number | null;
  conversationSummaries: TwineConversationStoreSnapshot['conversations'];
  conversationTitle: string;
  conversationTitleMode: TwineConversationSnapshot['titleMode'];
  draft: string;
  editSession?: TwineEditSession;
  historyReady: boolean;
  isGenerating: boolean;
  revision: number;
}

type ConversationUpdater = (
  current: TwineConversationState,
) => TwineConversationState;
type GenerationErrorMessages = Record<TwineGenerationErrorCode, string>;

const SAVE_DELAY_MS = 250;
const DEFAULT_GENERATION_ERROR_MESSAGES: GenerationErrorMessages = {
  authentication: 'The Gemini API key could not be authenticated.',
  network: 'Could not connect to Gemini. Check your connection and try again.',
  overloaded: 'Gemini is temporarily overloaded. Try again in a moment.',
  'rate-limited': 'The Gemini usage limit was reached. Try again later.',
  'tool-requirements':
    'Twine could not complete the required tools. Try again.',
  unknown: 'Could not generate the Twine response.',
};

function initialSnapshot(): TwineRuntimeSnapshot {
  return {
    apiKeyDialogDismissed: false,
    attachments: [],
    conversation: createTwineConversationState(),
    conversationActivityAt: Date.now(),
    conversationArchivedAt: null,
    conversationCreatedAt: Date.now(),
    conversationId: null,
    conversationPinnedAt: null,
    conversationSummaries: [],
    conversationTitle: 'New conversation',
    conversationTitleMode: 'automatic',
    draft: '',
    historyReady: false,
    isGenerating: false,
    revision: 0,
  };
}

function snapshotHasUserMessage(
  snapshot: TwineConversationSnapshot,
): boolean {
  return Object.values(snapshot.state.branches).some((branch) =>
    branch.messages.some(
      (message) => message.kind === 'user' && message.text.trim().length > 0,
    ),
  );
}

function conversationSummary(
  snapshot: TwineConversationSnapshot,
): TwineConversationStoreSnapshot['conversations'][number] {
  return {
    activityAt: snapshot.activityAt,
    archivedAt: snapshot.archivedAt,
    createdAt: snapshot.createdAt,
    id: snapshot.id,
    pinnedAt: snapshot.pinnedAt,
    title: snapshot.title,
    titleMode: snapshot.titleMode,
  };
}

function sortedConversationSummaries(
  conversations: TwineConversationStoreSnapshot['conversations'],
): TwineConversationStoreSnapshot['conversations'] {
  return [...conversations].sort((first, second) => {
    if (first.pinnedAt !== null || second.pinnedAt !== null) {
      if (first.pinnedAt === null) return 1;
      if (second.pinnedAt === null) return -1;
      return second.pinnedAt - first.pinnedAt;
    }
    return second.activityAt - first.activityAt;
  });
}

function upsertConversationSummary(
  conversations: TwineConversationStoreSnapshot['conversations'],
  snapshot: TwineConversationSnapshot,
): TwineConversationStoreSnapshot['conversations'] {
  return sortedConversationSummaries([
    conversationSummary(snapshot),
    ...conversations.filter(({ id }) => id !== snapshot.id),
  ]);
}

class TwineRuntime {
  private state = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly conversationCache = new Map<
    string,
    TwineConversationSnapshot
  >();
  private readonly scrollStates = new Map<
    string,
    TwineConversationScrollState
  >();
  private api: Partial<FlyoffApi> = {};
  private fallbackTitle = 'New conversation';
  private generationErrorMessages = DEFAULT_GENERATION_ERROR_MESSAGES;
  private nextIdValue = 1;
  private activeRequestId?: string;
  private historyLoad?: Promise<void>;
  private generationUnsubscribe?: () => void;
  private pendingDeltas = new Map<
    string,
    { text: string; thought: string }
  >();
  private streamFrame?: number;
  private saveTimer?: number;
  private saveTail: Promise<void> = Promise.resolve();

  readonly getSnapshot = (): TwineRuntimeSnapshot => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(api: Partial<FlyoffApi>): void {
    if (this.api === api) {
      return;
    }
    this.generationUnsubscribe?.();
    this.api = api;
    this.generationUnsubscribe = api.onTwineGenerationEvent?.((event) =>
      this.handleGenerationEvent(event),
    );
  }

  configure(
    fallbackTitle: string,
    generationErrorMessages?: GenerationErrorMessages,
  ): void {
    this.fallbackTitle = fallbackTitle;
    if (generationErrorMessages) {
      this.generationErrorMessages = generationErrorMessages;
    }
  }

  nextId(prefix: string): string {
    const id = `${prefix}-${this.nextIdValue}`;
    this.nextIdValue += 1;
    return id;
  }

  setAttachments(
    update:
      | readonly TwineAttachment[]
      | ((current: readonly TwineAttachment[]) => readonly TwineAttachment[]),
  ): void {
    const attachments =
      typeof update === 'function' ? update(this.state.attachments) : update;
    this.publish({ ...this.state, attachments: [...attachments] });
  }

  setApiKeyDialogDismissed(apiKeyDialogDismissed: boolean): void {
    if (apiKeyDialogDismissed !== this.state.apiKeyDialogDismissed) {
      this.publish({ ...this.state, apiKeyDialogDismissed });
    }
  }

  setConversation(update: ConversationUpdater): void {
    const conversation = update(this.state.conversation);
    if (conversation === this.state.conversation) {
      return;
    }
    this.publish({ ...this.state, conversation });
    this.scheduleSave();
  }

  markAnswerRevealed(messageId: string): void {
    const branch = activeTwineBranch(this.state.conversation);
    const message = branch.messages.find(({ id }) => id === messageId);
    if (message?.kind !== 'assistant' || message.answerRevealed) {
      return;
    }
    const conversation = updateTwineBranchMessages(
      this.state.conversation,
      branch.id,
      (messages) =>
        messages.map((entry) =>
          entry.id === messageId
            ? { ...entry, answerRevealed: true }
            : entry,
        ),
    );
    this.publish({ ...this.state, conversation });
  }

  setDraft(draft: string): void {
    if (draft === this.state.draft) {
      return;
    }
    this.publish({ ...this.state, draft });
    this.scheduleSave();
  }

  beginEdit(messageId: string, text: string): void {
    const conversationId = this.state.conversationId;
    const branch = activeTwineBranch(this.state.conversation);
    const message = branch.messages.find(({ id }) => id === messageId);
    if (message?.kind !== 'user') {
      return;
    }
    this.publish({
      ...this.state,
      editSession: {
        branchId: branch.id,
        conversationId,
        messageId,
        originalText: text,
        text,
      },
    });
  }

  setEditText(text: string): void {
    const editSession = this.state.editSession;
    if (!editSession || editSession.text === text) {
      return;
    }
    this.publish({
      ...this.state,
      editSession: { ...editSession, text },
    });
  }

  clearEditSession(): void {
    if (!this.state.editSession) {
      return;
    }
    this.publish({ ...this.state, editSession: undefined });
  }

  getScrollState(
    conversationId: string | null,
  ): TwineConversationScrollState | undefined {
    return conversationId
      ? this.scrollStates.get(conversationId)
      : undefined;
  }

  setScrollState(
    conversationId: string | null,
    state: TwineConversationScrollState,
  ): void {
    if (conversationId) {
      this.scrollStates.set(conversationId, state);
    }
  }

  async loadHistory(
    requestedConversationId: string | null,
    fallbackTitle: string,
  ): Promise<void> {
    this.configure(fallbackTitle);
    if (this.state.historyReady) {
      return;
    }
    if (this.historyLoad) {
      return this.historyLoad;
    }
    this.historyLoad = this.loadHistoryOnce(requestedConversationId)
      .catch(() => undefined)
      .finally(() => {
        this.publish({ ...this.state, historyReady: true });
        this.scheduleSave();
      });
    return this.historyLoad;
  }

  async createConversation(): Promise<void> {
    this.cancelGeneration();
    await this.flushSave();
    this.applyConversationSnapshot(
      createEmptyTwineConversationSnapshot(this.fallbackTitle),
    );
  }

  async openConversation(id: string): Promise<void> {
    if (id === this.state.conversationId) {
      return;
    }
    this.cancelGeneration();
    await this.flushSave();
    const snapshot =
      this.conversationCache.get(id) ??
      rememberedTwineConversationSnapshot(id) ??
      (await this.api.loadTwineConversation?.(id));
    if (snapshot) {
      this.applyConversationSnapshot(snapshot);
    }
  }

  async deleteConversation(id: string): Promise<void> {
    const deletingActiveConversation = id === this.state.conversationId;
    if (deletingActiveConversation) {
      this.cancelGeneration();
    }
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const store = await this.api.deleteTwineConversation?.(id);
    this.conversationCache.delete(id);
    this.scrollStates.delete(id);
    if (!store) {
      return;
    }
    this.publish({
      ...this.state,
      conversationId:
        this.state.conversationId === id ? null : this.state.conversationId,
      conversationSummaries: store.conversations,
    });
    if (!deletingActiveConversation) {
      return;
    }
    if (store.activeConversationId) {
      await this.openConversation(store.activeConversationId);
    } else {
      await this.createConversation();
    }
  }

  async queryConversations(
    query: TwineConversationQuery,
  ): Promise<TwineConversationQueryResult> {
    await this.flushSave();
    const result = await this.api.queryTwineConversations?.(query);
    return result ?? {
      conversations: this.state.conversationSummaries,
      version: 2,
    };
  }

  async updateConversation(
    request: TwineConversationMutationRequest,
  ): Promise<void> {
    await this.flushSave();
    const updatingActiveConversation = request.id === this.state.conversationId;
    const store = await this.api.updateTwineConversation?.(request);
    if (!store) {
      return;
    }
    if (!updatingActiveConversation) {
      this.conversationCache.delete(request.id);
    }
    let nextState = {
      ...this.state,
      conversationSummaries: store.conversations,
    };
    if (updatingActiveConversation) {
      if (request.type === 'rename') {
        nextState = {
          ...nextState,
          conversationTitle: request.title.trim(),
          conversationTitleMode: 'custom',
        };
      } else if (request.type === 'pin') {
        nextState = {
          ...nextState,
          conversationPinnedAt: request.pinned ? Date.now() : null,
        };
      } else if (request.type === 'archive') {
        nextState = {
          ...nextState,
          conversationArchivedAt: request.archived ? Date.now() : null,
          conversationPinnedAt: request.archived
            ? null
            : nextState.conversationPinnedAt,
        };
      }
    }
    this.publish(nextState);
    if (
      updatingActiveConversation &&
      request.type === 'archive' &&
      request.archived
    ) {
      if (store.activeConversationId) {
        await this.openConversation(store.activeConversationId);
      } else {
        await this.createConversation();
      }
    }
  }

  markActivity(): void {
    this.publish({
      ...this.state,
      conversationActivityAt: Date.now(),
      conversationArchivedAt: null,
    });
    void this.flushSave();
  }

  beginGeneration(requestId: string): void {
    this.activeRequestId = requestId;
    this.publish({ ...this.state, isGenerating: true });
  }

  failGeneration(requestId: string, message: string): void {
    if (requestId !== this.activeRequestId) {
      return;
    }
    this.flushPendingDeltas();
    this.setConversation((current) =>
      updateTwineMessageByRequest(current, requestId, (entry) => ({
        ...entry,
        activity: undefined,
        kind: 'system',
        status: 'error',
        text: entry.text || message,
      })),
    );
    this.activeRequestId = undefined;
    this.publish({ ...this.state, isGenerating: false });
    void this.flushSave();
  }

  cancelGeneration(): void {
    const requestId = this.activeRequestId;
    if (requestId) {
      void this.api.cancelTwineGeneration?.(requestId);
      this.flushPendingDeltas();
      this.setConversation((current) =>
        updateTwineMessageByRequest(current, requestId, (message) => ({
          ...message,
          activity: undefined,
          answerRevealed:
            message.answerRevealed || message.text.length === 0,
          status: 'complete',
          streamRequestId: undefined,
          thinkingDurationMs:
            message.thinkingDurationMs ??
            (message.thinkingStartedAt
              ? Date.now() - message.thinkingStartedAt
              : undefined),
        })),
      );
      this.activeRequestId = undefined;
    }
    if (this.state.isGenerating) {
      this.publish({ ...this.state, isGenerating: false });
    }
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const id = this.state.conversationId;
    if (!this.state.historyReady || !id || !this.api.saveTwineConversation) {
      await this.saveTail;
      return;
    }
    const snapshot = this.currentConversationSnapshot();
    if (!snapshotHasUserMessage(snapshot)) {
      this.conversationCache.set(snapshot.id, snapshot);
      rememberTwineConversationSnapshot(snapshot);
      await this.saveTail;
      return;
    }
    this.conversationCache.set(snapshot.id, snapshot);
    rememberTwineConversationSnapshot(snapshot);
    const operation = this.saveTail
      .catch(() => undefined)
      .then(async () => {
        const store = await this.api.saveTwineConversation?.(snapshot);
        if (store) {
          this.publish({
            ...this.state,
            conversationSummaries: store.conversations,
          });
        }
      });
    this.saveTail = operation.catch(() => undefined);
    await this.saveTail;
  }

  resetForTests(): void {
    this.generationUnsubscribe?.();
    if (this.streamFrame !== undefined) {
      cancelAnimationFrame(this.streamFrame);
    }
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
    }
    this.state = initialSnapshot();
    this.api = {};
    this.fallbackTitle = 'New conversation';
    this.nextIdValue = 1;
    this.activeRequestId = undefined;
    this.historyLoad = undefined;
    this.generationUnsubscribe = undefined;
    this.pendingDeltas.clear();
    this.streamFrame = undefined;
    this.saveTimer = undefined;
    this.saveTail = Promise.resolve();
    this.conversationCache.clear();
    this.scrollStates.clear();
    clearRememberedTwineConversationSnapshot();
    this.emit();
  }

  private async loadHistoryOnce(
    requestedConversationId: string | null,
  ): Promise<void> {
    if (
      !this.api.listTwineConversations ||
      !this.api.loadTwineConversation
    ) {
      return;
    }
    const remembered = rememberedTwineConversationSnapshot(
      requestedConversationId,
    );
    if (remembered) {
      this.applyConversationSnapshot(remembered);
    }
    const store = await this.api.listTwineConversations();
    this.publish({
      ...this.state,
      conversationSummaries:
        remembered &&
        snapshotHasUserMessage(remembered) &&
        remembered.archivedAt === null
        ? upsertConversationSummary(store.conversations, remembered)
        : store.conversations,
    });
    if (remembered) {
      return;
    }
    const targetId =
      requestedConversationId &&
      store.conversations.some(({ id }) => id === requestedConversationId)
        ? requestedConversationId
        : store.activeConversationId;
    const snapshot = targetId
      ? await this.api.loadTwineConversation(targetId)
      : createEmptyTwineConversationSnapshot(this.fallbackTitle);
    if (snapshot) {
      this.applyConversationSnapshot(snapshot);
    }
  }

  private applyConversationSnapshot(
    snapshot: TwineConversationSnapshot,
  ): void {
    this.activeRequestId = undefined;
    this.pendingDeltas.clear();
    this.nextIdValue = snapshot.nextId;
    this.conversationCache.set(snapshot.id, snapshot);
    rememberTwineConversationSnapshot(snapshot);
    this.publish({
      ...this.state,
      attachments: [],
      conversation: restoreTwineConversationSnapshot(snapshot),
      conversationActivityAt: snapshot.activityAt,
      conversationArchivedAt: snapshot.archivedAt,
      conversationCreatedAt: snapshot.createdAt,
      conversationId: snapshot.id,
      conversationPinnedAt: snapshot.pinnedAt,
      conversationSummaries:
        snapshotHasUserMessage(snapshot) && snapshot.archivedAt === null
          ? upsertConversationSummary(
              this.state.conversationSummaries,
              snapshot,
            )
          : this.state.conversationSummaries.filter(
              ({ id }) => id !== snapshot.id,
            ),
      conversationTitle: snapshot.title,
      conversationTitleMode: snapshot.titleMode,
      draft: snapshot.draft ?? '',
      editSession: undefined,
      isGenerating: false,
    });
  }

  private handleGenerationEvent(event: TwineGenerationEvent): void {
    if (event.requestId !== this.activeRequestId) {
      return;
    }
    switch (event.type) {
      case 'started':
        this.setConversation((current) =>
          updateTwineMessageByRequest(current, event.requestId, (message) => ({
            ...message,
            activity: event.activity,
          })),
        );
        return;
      case 'thought-delta':
        this.queueDelta(event.requestId, 'thought', event.text);
        return;
      case 'text-delta':
        this.queueDelta(event.requestId, 'text', event.text);
        return;
      case 'tool':
        this.flushPendingDeltas();
        this.setConversation((current) =>
          updateTwineMessageByRequest(current, event.requestId, (message) => ({
            ...message,
            activity:
              event.tool === 'search' ? 'searching' : message.activity,
            tools: [
              ...(message.tools ?? []),
              {
                id: this.nextId('tool'),
                phase: event.phase,
                text: event.text,
                tool: event.tool,
              },
            ],
          })),
        );
        return;
      case 'sources':
        this.flushPendingDeltas();
        this.setConversation((current) =>
          updateTwineMessageByRequest(current, event.requestId, (message) => {
            const known = new Set(
              (message.sources ?? []).map(({ url }) => url),
            );
            return {
              ...message,
              sources: [
                ...(message.sources ?? []),
                ...event.sources.filter(({ url }) => !known.has(url)),
              ],
            };
          }),
        );
        return;
      case 'done':
        this.flushPendingDeltas();
        this.setConversation((current) =>
          updateTwineMessageByRequest(current, event.requestId, (message) => ({
            ...message,
            activity: undefined,
            answerRevealed:
              message.answerRevealed || message.text.length === 0,
            status: 'complete',
            thinkingDurationMs:
              message.thinkingDurationMs ??
              (message.thinkingStartedAt
                ? Date.now() - message.thinkingStartedAt
                : undefined),
            usage: event.usage,
          })),
        );
        this.activeRequestId = undefined;
        this.publish({ ...this.state, isGenerating: false });
        void this.flushSave();
        return;
      case 'error':
        this.failGeneration(
          event.requestId,
          this.generationErrorMessages[event.code],
        );
    }
  }

  private queueDelta(
    requestId: string,
    type: 'text' | 'thought',
    text: string,
  ): void {
    const current = this.pendingDeltas.get(requestId) ?? {
      text: '',
      thought: '',
    };
    current[type] += text;
    this.pendingDeltas.set(requestId, current);
    if (this.streamFrame === undefined) {
      this.streamFrame = requestAnimationFrame(() =>
        this.flushPendingDeltas(),
      );
    }
  }

  private flushPendingDeltas(): void {
    if (this.streamFrame !== undefined) {
      cancelAnimationFrame(this.streamFrame);
      this.streamFrame = undefined;
    }
    if (this.pendingDeltas.size === 0) {
      return;
    }
    const pending = this.pendingDeltas;
    this.pendingDeltas = new Map();
    this.setConversation((current) => {
      let next = current;
      for (const [requestId, delta] of pending) {
        next = updateTwineMessageByRequest(next, requestId, (message) => ({
          ...message,
          text: `${message.text}${delta.text}`,
          thought: `${message.thought ?? ''}${delta.thought}`,
          thinkingDurationMs:
            delta.text &&
            message.thinkingStartedAt &&
            !message.thinkingDurationMs
              ? Date.now() - message.thinkingStartedAt
              : message.thinkingDurationMs,
        }));
      }
      return next;
    });
  }

  private conversationWithPendingDeltas(): TwineConversationState {
    let next = this.state.conversation;
    for (const [requestId, delta] of this.pendingDeltas) {
      next = updateTwineMessageByRequest(next, requestId, (message) => ({
        ...message,
        text: `${message.text}${delta.text}`,
        thought: `${message.thought ?? ''}${delta.thought}`,
      }));
    }
    return next;
  }

  private currentConversationSnapshot(): TwineConversationSnapshot {
    return createTwineConversationSnapshot({
      activityAt: this.state.conversationActivityAt,
      archivedAt: this.state.conversationArchivedAt,
      createdAt: this.state.conversationCreatedAt,
      draft: this.state.draft,
      fallbackTitle: this.fallbackTitle,
      id: this.state.conversationId!,
      nextId: this.nextIdValue,
      pinnedAt: this.state.conversationPinnedAt,
      state: this.conversationWithPendingDeltas(),
      title: this.state.conversationTitle,
      titleMode: this.state.conversationTitleMode,
    });
  }

  private scheduleSave(): void {
    if (!this.state.historyReady || !this.state.conversationId) {
      return;
    }
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = undefined;
      void this.flushSave();
    }, SAVE_DELAY_MS);
  }

  private publish(next: TwineRuntimeSnapshot): void {
    this.state = { ...next, revision: this.state.revision + 1 };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const twineRuntime = new TwineRuntime();

export function getTwineRuntime(): TwineRuntime {
  return twineRuntime;
}

export function resetTwineRuntimeForTests(): void {
  twineRuntime.resetForTests();
}
