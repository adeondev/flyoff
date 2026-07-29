import type {
  MarkdownDocument,
  ProjectFailureDetails,
  ProjectResult,
  ReadMarkdownDocumentRequest,
  SaveMarkdownDocumentRequest,
} from '../../shared/contracts';
import {
  MarkdownHistoryStore,
  type SourceEditorState,
  type SourceEditTransaction,
} from './markdown-history';
import type { SourceSelection } from './source-caret';

export type MarkdownBufferStatus =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'loading'
  | 'conflict'
  | 'error';

export interface MarkdownBufferSnapshot {
  nodeId: string;
  content: string;
  revision: string;
  readOnly: boolean;
  dirty: boolean;
  status: MarkdownBufferStatus;
  selection: SourceSelection;
  error?: ProjectFailureDetails;
}

export interface MarkdownDocumentControllerOptions {
  save: (
    request: SaveMarkdownDocumentRequest,
  ) => Promise<ProjectResult<MarkdownDocument>>;
  reload: (
    request: ReadMarkdownDocumentRequest,
  ) => Promise<ProjectResult<MarkdownDocument>>;
  debounceMs?: number;
  onSaveError?: (error: ProjectFailureDetails, nodeId: string) => void;
  onSaveSuccess?: (document: MarkdownDocument) => void;
}

interface MarkdownBufferEntry {
  snapshot: MarkdownBufferSnapshot;
  savedContent: string;
  listeners: Set<() => void>;
  saveDueAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  savePromise?: Promise<boolean>;
}

const DEFAULT_AUTOSAVE_DELAY = 500;

function emptySelection(): SourceSelection {
  return { start: 0, end: 0, direction: 'none' };
}

function clampSelection(
  selection: SourceSelection,
  contentLength: number,
): SourceSelection {
  const start = Math.min(Math.max(0, selection.start), contentLength);
  const end = Math.min(Math.max(start, selection.end), contentLength);
  return {
    start,
    end,
    direction: start === end ? 'none' : selection.direction,
  };
}

function rejectedOperation(message: string): ProjectFailureDetails {
  return { code: 'io-error', message };
}

export class MarkdownDocumentController {
  private readonly buffers = new Map<string, MarkdownBufferEntry>();
  private readonly editorStates = new Map<string, SourceEditorState>();
  private readonly viewSelections = new Map<string, SourceSelection>();
  private readonly history = new MarkdownHistoryStore();
  private readonly mutationLocks = new Set<string>();
  private debounceMs: number;
  private readonly saveDocument: MarkdownDocumentControllerOptions['save'];
  private readonly reloadDocument: MarkdownDocumentControllerOptions['reload'];
  private onSaveError?: MarkdownDocumentControllerOptions['onSaveError'];
  private onSaveSuccess?: MarkdownDocumentControllerOptions['onSaveSuccess'];
  private disposed = false;

  constructor({
    debounceMs = DEFAULT_AUTOSAVE_DELAY,
    onSaveError,
    onSaveSuccess,
    reload,
    save,
  }: MarkdownDocumentControllerOptions) {
    this.debounceMs = Math.max(0, debounceMs);
    this.reloadDocument = reload;
    this.saveDocument = save;
    this.onSaveError = onSaveError;
    this.onSaveSuccess = onSaveSuccess;
  }

  open(
    document: MarkdownDocument,
    viewId = document.nodeId,
  ): MarkdownBufferSnapshot {
    const existing = this.buffers.get(document.nodeId);

    if (existing) {
      if (
        !existing.snapshot.dirty &&
        (existing.snapshot.revision !== document.revision ||
          existing.snapshot.content !== document.content ||
          existing.snapshot.readOnly !== document.readOnly)
      ) {
        this.replaceFromDocument(existing, document);
      }

      this.ensureViewSelection(document.nodeId, viewId, existing.snapshot);
      return this.snapshotForView(existing.snapshot, viewId);
    }

    const entry: MarkdownBufferEntry = {
      snapshot: {
        nodeId: document.nodeId,
        content: document.content,
        revision: document.revision,
        readOnly: document.readOnly,
        dirty: false,
        status: 'saved',
        selection: emptySelection(),
      },
      savedContent: document.content,
      listeners: new Set(),
    };
    const previousState = this.editorStates.get(document.nodeId);
    if (previousState?.content === document.content) {
      entry.snapshot.selection = clampSelection(
        previousState.selection,
        document.content.length,
      );
    } else {
      this.history.reset(document.nodeId);
    }
    this.editorStates.set(document.nodeId, {
      content: document.content,
      selection: entry.snapshot.selection,
    });
    this.buffers.set(document.nodeId, entry);
    this.ensureViewSelection(document.nodeId, viewId, entry.snapshot);
    return this.snapshotForView(entry.snapshot, viewId);
  }

  getSnapshot(
    nodeId: string,
    viewId = nodeId,
  ): MarkdownBufferSnapshot | undefined {
    const snapshot = this.buffers.get(nodeId)?.snapshot;
    return snapshot ? this.snapshotForView(snapshot, viewId) : undefined;
  }

  setOnSaveError(
    onSaveError?: MarkdownDocumentControllerOptions['onSaveError'],
  ): void {
    this.onSaveError = onSaveError;
  }

  setOnSaveSuccess(
    onSaveSuccess?: MarkdownDocumentControllerOptions['onSaveSuccess'],
  ): void {
    this.onSaveSuccess = onSaveSuccess;
  }

  setDebounceMs(debounceMs: number): void {
    const nextDelay = Math.max(0, debounceMs);
    if (nextDelay === this.debounceMs) {
      return;
    }
    this.debounceMs = nextDelay;
    for (const entry of this.buffers.values()) {
      if (entry.timer === undefined) {
        continue;
      }
      this.clearTimer(entry);
      if (
        entry.snapshot.dirty &&
        entry.snapshot.status !== 'conflict' &&
        !entry.snapshot.readOnly &&
        !entry.savePromise
      ) {
        this.scheduleSave(entry);
      }
    }
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    const entry = this.getEntry(nodeId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  update(nodeId: string, content: string): void {
    const entry = this.getEntry(nodeId);
    if (entry.snapshot.readOnly || this.mutationLocks.has(nodeId)) {
      return;
    }
    this.history.reset(nodeId);
    this.updateContent(
      entry,
      content,
      clampSelection(entry.snapshot.selection, content.length),
    );
  }

  commitEditorTransaction(
    nodeId: string,
    transaction: SourceEditTransaction,
    viewId = nodeId,
  ): void {
    const entry = this.getEntry(nodeId);
    if (entry.snapshot.readOnly || this.mutationLocks.has(nodeId)) {
      return;
    }
    const after: SourceEditorState = {
      content: transaction.after.content,
      selection: clampSelection(
        transaction.after.selection,
        transaction.after.content.length,
      ),
    };

    if (transaction.before.content === entry.snapshot.content) {
      this.history.record(nodeId, {
        ...transaction,
        before: {
          content: transaction.before.content,
          selection: clampSelection(
            transaction.before.selection,
            transaction.before.content.length,
          ),
        },
        after,
      });
    } else {
      this.history.reset(nodeId);
    }

    this.updateContent(entry, after.content, after.selection, viewId);
  }

  setEditorSelection(
    nodeId: string,
    selection: SourceSelection,
    viewId = nodeId,
  ): void {
    const entry = this.buffers.get(nodeId);
    if (!entry) {
      return;
    }
    const next = clampSelection(selection, entry.snapshot.content.length);
    const key = this.viewSelectionKey(nodeId, viewId);
    const previous = this.viewSelections.get(key) ?? entry.snapshot.selection;
    if (
      previous.start === next.start &&
      previous.end === next.end &&
      previous.direction === next.direction
    ) {
      return;
    }
    this.history.breakCoalescing(nodeId);
    this.viewSelections.set(key, next);
    if (viewId === nodeId) {
      entry.snapshot = { ...entry.snapshot, selection: next };
      this.editorStates.set(nodeId, {
        content: entry.snapshot.content,
        selection: next,
      });
    }
  }

  undo(nodeId: string, viewId = nodeId): SourceEditorState | undefined {
    if (
      this.getEntry(nodeId).snapshot.readOnly ||
      this.mutationLocks.has(nodeId)
    ) {
      return undefined;
    }
    return this.applyHistory(nodeId, 'undo', viewId);
  }

  redo(nodeId: string, viewId = nodeId): SourceEditorState | undefined {
    if (
      this.getEntry(nodeId).snapshot.readOnly ||
      this.mutationLocks.has(nodeId)
    ) {
      return undefined;
    }
    return this.applyHistory(nodeId, 'redo', viewId);
  }

  canUndo(nodeId: string): boolean {
    return (
      !this.getEntry(nodeId).snapshot.readOnly &&
      !this.mutationLocks.has(nodeId) &&
      this.history.canUndo(nodeId)
    );
  }

  canRedo(nodeId: string): boolean {
    return (
      !this.getEntry(nodeId).snapshot.readOnly &&
      !this.mutationLocks.has(nodeId) &&
      this.history.canRedo(nodeId)
    );
  }

  private updateContent(
    entry: MarkdownBufferEntry,
    content: string,
    selection: SourceSelection,
    viewId = entry.snapshot.nodeId,
  ): void {
    if (
      entry.snapshot.readOnly ||
      this.mutationLocks.has(entry.snapshot.nodeId)
    ) {
      return;
    }
    const blockedByConflict = entry.snapshot.status === 'conflict';
    const saveInProgress = Boolean(entry.savePromise);
    const dirty = blockedByConflict || content !== entry.savedContent;
    const nodeId = entry.snapshot.nodeId;

    this.editorStates.set(nodeId, { content, selection });
    this.viewSelections.set(
      this.viewSelectionKey(nodeId, viewId),
      selection,
    );
    this.setSnapshot(entry, {
      ...entry.snapshot,
      content,
      selection,
      dirty,
      status: dirty
        ? blockedByConflict
          ? 'conflict'
          : saveInProgress
            ? 'saving'
            : 'dirty'
        : 'saved',
      ...(blockedByConflict && entry.snapshot.error
        ? { error: entry.snapshot.error }
        : {}),
    });

    if (dirty && !blockedByConflict && !saveInProgress) {
      this.scheduleSave(entry);
    } else {
      this.clearTimer(entry);
    }
  }

  async save(nodeId: string): Promise<boolean> {
    return this.performSave(this.getEntry(nodeId), false);
  }

  adoptProperties(
    nodeId: string,
    properties: Pick<MarkdownDocument, 'readOnly' | 'revision'>,
  ): boolean {
    const entry = this.buffers.get(nodeId);
    if (!entry || entry.snapshot.dirty || entry.savePromise) {
      return false;
    }
    this.clearTimer(entry);
    if (properties.readOnly) {
      this.history.reset(nodeId);
    }
    this.setSnapshot(entry, {
      ...entry.snapshot,
      readOnly: properties.readOnly,
      revision: properties.revision,
      status: 'saved',
      error: undefined,
    });
    return true;
  }

  applyReadOnlyPolicy(nodeId: string, readOnly: boolean): boolean {
    const entry = this.buffers.get(nodeId);
    if (!entry || entry.snapshot.readOnly === readOnly) {
      return Boolean(entry);
    }
    this.clearTimer(entry);
    if (readOnly) {
      this.history.reset(nodeId);
    }
    this.setSnapshot(entry, {
      ...entry.snapshot,
      readOnly,
    });
    if (!readOnly && entry.snapshot.dirty && !entry.savePromise) {
      this.scheduleSave(entry);
    }
    return true;
  }

  async overwrite(nodeId: string): Promise<boolean> {
    return this.performSave(this.getEntry(nodeId), true);
  }

  async reload(nodeId: string): Promise<boolean> {
    const entry = this.getEntry(nodeId);
    const resolvingConflict = entry.snapshot.status === 'conflict';
    this.clearTimer(entry);

    if (entry.savePromise) {
      await entry.savePromise;
    }

    this.setSnapshot(entry, {
      ...entry.snapshot,
      status: 'loading',
      error: undefined,
    });

    let result: ProjectResult<MarkdownDocument>;
    try {
      result = await this.reloadDocument({ nodeId });
    } catch (error) {
      this.setFailure(entry, rejectedOperation(String(error)));
      return false;
    }

    if (!result.ok) {
      this.setFailure(
        entry,
        resolvingConflict
          ? { ...result.error, code: 'conflict' }
          : result.error,
      );
      return false;
    }

    this.replaceFromDocument(entry, result.value);
    return true;
  }

  async flush(nodeId: string): Promise<boolean> {
    const entry = this.getEntry(nodeId);
    this.clearTimer(entry);

    if (entry.savePromise) {
      await entry.savePromise;
    }

    if (!entry.snapshot.dirty) {
      return true;
    }

    if (entry.snapshot.status === 'conflict') {
      return false;
    }

    return this.performSave(entry, false);
  }

  async flushAll(): Promise<boolean> {
    const results = await Promise.all(
      [...this.buffers.keys()].map((nodeId) => this.flush(nodeId)),
    );
    return results.every(Boolean);
  }

  async flushForTreeMutation(): Promise<boolean> {
    const results = await Promise.all(
      [...this.buffers.entries()].map(([nodeId, entry]) =>
        entry.snapshot.readOnly && entry.snapshot.dirty
          ? Promise.resolve(true)
          : this.flush(nodeId),
      ),
    );
    return results.every(Boolean);
  }

  isDirty(nodeId: string): boolean {
    return this.buffers.get(nodeId)?.snapshot.dirty ?? false;
  }

  isMutationLocked(nodeId: string): boolean {
    return this.mutationLocks.has(nodeId);
  }

  setMutationLocked(nodeId: string, locked: boolean): boolean {
    const entry = this.buffers.get(nodeId);
    if (!entry) {
      return false;
    }
    const changed = locked
      ? !this.mutationLocks.has(nodeId)
      : this.mutationLocks.has(nodeId);
    if (!changed) {
      return true;
    }
    if (locked) {
      this.mutationLocks.add(nodeId);
    } else {
      this.mutationLocks.delete(nodeId);
    }
    this.setSnapshot(entry, { ...entry.snapshot });
    return true;
  }

  discardClean(nodeId: string): boolean {
    const entry = this.buffers.get(nodeId);

    if (!entry || entry.snapshot.dirty || entry.savePromise) {
      return false;
    }

    this.clearTimer(entry);
    this.buffers.delete(nodeId);
    return true;
  }

  discardSensitive(nodeId: string): boolean {
    const entry = this.buffers.get(nodeId);
    if (entry) {
      this.clearTimer(entry);
      entry.listeners.clear();
      this.buffers.delete(nodeId);
    }
    const editorStateRemoved = this.editorStates.delete(nodeId);
    for (const key of this.viewSelections.keys()) {
      if (key.startsWith(`${nodeId}\u0000`)) {
        this.viewSelections.delete(key);
      }
    }
    this.history.reset(nodeId);
    const mutationLockRemoved = this.mutationLocks.delete(nodeId);
    return Boolean(entry) || editorStateRemoved || mutationLockRemoved;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.buffers.values()) {
      this.clearTimer(entry);
      entry.listeners.clear();
    }
    this.buffers.clear();
    this.editorStates.clear();
    this.viewSelections.clear();
    this.history.clear();
    this.mutationLocks.clear();
  }

  private getEntry(nodeId: string): MarkdownBufferEntry {
    const entry = this.buffers.get(nodeId);
    if (!entry) {
      throw new Error(`Markdown document ${nodeId} is not open.`);
    }
    return entry;
  }

  private scheduleSave(entry: MarkdownBufferEntry): void {
    if (this.disposed) {
      return;
    }

    entry.saveDueAt = Date.now() + this.debounceMs;
    if (entry.timer !== undefined) {
      return;
    }
    this.armSaveTimer(entry);
  }

  private armSaveTimer(entry: MarkdownBufferEntry): void {
    const delay = Math.max(
      0,
      (entry.saveDueAt ?? Date.now()) - Date.now(),
    );
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (
        entry.saveDueAt !== undefined &&
        entry.saveDueAt > Date.now()
      ) {
        this.armSaveTimer(entry);
        return;
      }
      entry.saveDueAt = undefined;
      void this.performSave(entry, false);
    }, delay);
  }

  private async performSave(
    entry: MarkdownBufferEntry,
    force: boolean,
  ): Promise<boolean> {
    this.clearTimer(entry);

    if (entry.snapshot.readOnly) {
      return !entry.snapshot.dirty;
    }

    if (entry.savePromise) {
      await entry.savePromise;
      if (!entry.snapshot.dirty) {
        return true;
      }
    }

    const content = entry.snapshot.content;
    const expectedRevision = entry.snapshot.revision;
    const operation = this.runSave(entry, {
      nodeId: entry.snapshot.nodeId,
      content,
      expectedRevision,
      ...(force ? { force: true } : {}),
    });
    entry.savePromise = operation;

    try {
      return await operation;
    } finally {
      if (entry.savePromise === operation) {
        entry.savePromise = undefined;
      }
    }
  }

  private async runSave(
    entry: MarkdownBufferEntry,
    request: SaveMarkdownDocumentRequest,
  ): Promise<boolean> {
    this.setSnapshot(entry, {
      ...entry.snapshot,
      status: 'saving',
      error: undefined,
    });

    let result: ProjectResult<MarkdownDocument>;
    try {
      result = await this.saveDocument(request);
    } catch (error) {
      const failure = rejectedOperation(String(error));
      this.setFailure(entry, failure);
      this.onSaveError?.(failure, entry.snapshot.nodeId);
      return false;
    }

    if (!result.ok) {
      this.setFailure(entry, result.error);
      this.onSaveError?.(result.error, entry.snapshot.nodeId);
      return false;
    }

    entry.savedContent = request.content;
    const changedWhileSaving = entry.snapshot.content !== request.content;
    this.setSnapshot(entry, {
      nodeId: entry.snapshot.nodeId,
      content: entry.snapshot.content,
      revision: result.value.revision,
      readOnly: result.value.readOnly,
      dirty: changedWhileSaving,
      status: changedWhileSaving ? 'dirty' : 'saved',
      selection: entry.snapshot.selection,
    });
    this.onSaveSuccess?.(result.value);

    if (changedWhileSaving) {
      this.scheduleSave(entry);
    }
    return !changedWhileSaving;
  }

  private setFailure(
    entry: MarkdownBufferEntry,
    error: ProjectFailureDetails,
  ): void {
    this.setSnapshot(entry, {
      ...entry.snapshot,
      readOnly: error.code === 'read-only' || entry.snapshot.readOnly,
      dirty: true,
      status: error.code === 'conflict' ? 'conflict' : 'error',
      error,
    });
  }

  private replaceFromDocument(
    entry: MarkdownBufferEntry,
    document: MarkdownDocument,
  ): void {
    this.clearTimer(entry);
    this.history.reset(document.nodeId);
    entry.savedContent = document.content;
    const selection = clampSelection(
      entry.snapshot.selection,
      document.content.length,
    );
    for (const [key, viewSelection] of this.viewSelections) {
      if (key.startsWith(`${document.nodeId}\u0000`)) {
        this.viewSelections.set(
          key,
          clampSelection(viewSelection, document.content.length),
        );
      }
    }
    this.setSnapshot(entry, {
      nodeId: document.nodeId,
      content: document.content,
      revision: document.revision,
      readOnly: document.readOnly,
      dirty: false,
      status: 'saved',
      selection,
    });
    this.editorStates.set(document.nodeId, {
      content: document.content,
      selection,
    });
  }

  private applyHistory(
    nodeId: string,
    direction: 'undo' | 'redo',
    viewId: string,
  ): SourceEditorState | undefined {
    const entry = this.getEntry(nodeId);
    const current: SourceEditorState = {
      content: entry.snapshot.content,
      selection:
        this.viewSelections.get(this.viewSelectionKey(nodeId, viewId)) ??
        entry.snapshot.selection,
    };
    const next = this.history[direction](nodeId, current);
    if (!next) {
      return undefined;
    }
    this.updateContent(entry, next.content, next.selection, viewId);
    return next;
  }

  private viewSelectionKey(nodeId: string, viewId: string): string {
    return `${nodeId}\u0000${viewId}`;
  }

  private ensureViewSelection(
    nodeId: string,
    viewId: string,
    snapshot: MarkdownBufferSnapshot,
  ): void {
    const key = this.viewSelectionKey(nodeId, viewId);
    if (!this.viewSelections.has(key)) {
      this.viewSelections.set(key, snapshot.selection);
    }
  }

  private snapshotForView(
    snapshot: MarkdownBufferSnapshot,
    viewId: string,
  ): MarkdownBufferSnapshot {
    const selection =
      this.viewSelections.get(
        this.viewSelectionKey(snapshot.nodeId, viewId),
      ) ?? snapshot.selection;
    return selection === snapshot.selection
      ? snapshot
      : { ...snapshot, selection };
  }

  private clearTimer(entry: MarkdownBufferEntry): void {
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    entry.saveDueAt = undefined;
  }

  private setSnapshot(
    entry: MarkdownBufferEntry,
    snapshot: MarkdownBufferSnapshot,
  ): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) {
      listener();
    }
  }
}
