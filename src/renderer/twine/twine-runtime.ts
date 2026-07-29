import type {
  FlyoffApi,
  TwineConversationSnapshot,
  TwineConversationStoreSnapshot,
  TwineDocumentToolCall,
  TwineDocumentToolResult,
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
  createTwineConversationState,
  updateTwineMessageByRequest,
} from './twine-conversation-state';
import type {
  TwineAttachment,
  TwineConversationScrollState,
  TwineConversationState,
} from './twine-types';

export interface TwineRuntimeSnapshot {
  apiKeyDialogDismissed: boolean;
  attachments: readonly TwineAttachment[];
  conversation: TwineConversationState;
  conversationCreatedAt: number;
  conversationId: string | null;
  conversationSummaries: TwineConversationStoreSnapshot['conversations'];
  draft: string;
  historyReady: boolean;
  isGenerating: boolean;
  revision: number;
}

type ConversationUpdater = (
  current: TwineConversationState,
) => TwineConversationState;
type DocumentToolHandler = (
  call: TwineDocumentToolCall,
  requestId: string,
  isActive: () => boolean,
) => Promise<TwineDocumentToolResult>;

const SAVE_DELAY_MS = 250;

function noteTool(name: TwineDocumentToolCall['name']): boolean {
  return (
    name === 'list_project_notes' ||
    name === 'read_note' ||
    name === 'propose_note_changes'
  );
}

function initialSnapshot(): TwineRuntimeSnapshot {
  return {
    apiKeyDialogDismissed: false,
    attachments: [],
    conversation: createTwineConversationState(),
    conversationCreatedAt: Date.now(),
    conversationId: null,
    conversationSummaries: [],
    draft: '',
    historyReady: false,
    isGenerating: false,
    revision: 0,
  };
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
  private documentToolHandler?: DocumentToolHandler;

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

  setDocumentToolHandler(handler?: DocumentToolHandler): void {
    this.documentToolHandler = handler;
  }

  configure(fallbackTitle: string): void {
    this.fallbackTitle = fallbackTitle;
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

  setDraft(draft: string): void {
    if (draft === this.state.draft) {
      return;
    }
    this.publish({ ...this.state, draft });
    this.scheduleSave();
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
      });
    return this.historyLoad;
  }

  async createConversation(): Promise<void> {
    await this.flushSave();
    this.cancelGeneration();
    const snapshot =
      (await this.api.createTwineConversation?.()) ??
      createEmptyTwineConversationSnapshot(this.fallbackTitle);
    this.applyConversationSnapshot(snapshot);
    this.publish({
      ...this.state,
      conversationSummaries: [
        {
          createdAt: snapshot.createdAt,
          id: snapshot.id,
          title: snapshot.title,
          updatedAt: snapshot.updatedAt,
        },
        ...this.state.conversationSummaries.filter(
          ({ id }) => id !== snapshot.id,
        ),
      ],
    });
  }

  async openConversation(id: string): Promise<void> {
    if (id === this.state.conversationId) {
      return;
    }
    await this.flushSave();
    this.cancelGeneration();
    const snapshot =
      this.conversationCache.get(id) ??
      rememberedTwineConversationSnapshot(id) ??
      (await this.api.loadTwineConversation?.(id));
    if (snapshot) {
      this.applyConversationSnapshot(snapshot);
    }
  }

  async deleteConversation(id: string): Promise<void> {
    this.cancelGeneration();
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
    if (store.activeConversationId) {
      await this.openConversation(store.activeConversationId);
    } else {
      await this.createConversation();
    }
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
      this.pendingDeltas.delete(requestId);
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
    this.documentToolHandler = undefined;
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
      !this.api.loadTwineConversation ||
      !this.api.createTwineConversation
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
      conversationSummaries: remembered
        ? [
            {
              createdAt: remembered.createdAt,
              id: remembered.id,
              title: remembered.title,
              updatedAt: remembered.updatedAt,
            },
            ...store.conversations.filter(({ id }) => id !== remembered.id),
          ]
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
      : await this.api.createTwineConversation();
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
      conversationCreatedAt: snapshot.createdAt,
      conversationId: snapshot.id,
      draft: snapshot.draft ?? '',
      isGenerating: false,
    });
  }

  private handleGenerationEvent(event: TwineGenerationEvent): void {
    if (event.requestId !== this.activeRequestId) {
      return;
    }
    switch (event.type) {
      case 'started':
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
      case 'document-tool-call':
        this.flushPendingDeltas();
        this.setConversation((current) =>
          updateTwineMessageByRequest(
            current,
            event.requestId,
            (message) => ({
              ...message,
              tools: [
                ...(message.tools ?? []),
                {
                  id: `document-call:${event.call.id}`,
                  phase: 'start',
                  text: event.call.name,
                  tool: noteTool(event.call.name) ? 'note' : 'diagram',
                },
              ],
            }),
          ),
        );
        void this.executeDocumentTool(event.requestId, event.call);
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
        this.failGeneration(event.requestId, event.message);
    }
  }

  private async executeDocumentTool(
    requestId: string,
    call: TwineDocumentToolCall,
  ): Promise<void> {
    let result: TwineDocumentToolResult;
    try {
      result = this.documentToolHandler
        ? await this.documentToolHandler(
            call,
            requestId,
            () => requestId === this.activeRequestId,
          )
        : {
            ok: false,
            text:
              'As ferramentas de documento não estão disponíveis nesta página.',
          };
    } catch (error) {
      result = {
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'Não foi possível executar a ferramenta de documento.',
      };
    }
    if (requestId !== this.activeRequestId) {
      return;
    }
    this.setConversation((current) =>
      updateTwineMessageByRequest(current, requestId, (message) => ({
        ...message,
        tools: [
          ...(message.tools ?? []),
          {
            id: `document-result:${call.id}`,
            phase: 'result',
            text: result.ok ? call.name : result.text,
            tool: noteTool(call.name) ? 'note' : 'diagram',
          },
        ],
      })),
    );
    try {
      await this.api.submitTwineDocumentToolResult?.({
        requestId,
        callId: call.id,
        result,
      });
    } catch (error) {
      this.failGeneration(
        requestId,
        error instanceof Error
          ? error.message
          : 'Não foi possível devolver o resultado da ferramenta ao Twine.',
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
      createdAt: this.state.conversationCreatedAt,
      draft: this.state.draft,
      fallbackTitle: this.fallbackTitle,
      id: this.state.conversationId!,
      nextId: this.nextIdValue,
      state: this.conversationWithPendingDeltas(),
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
