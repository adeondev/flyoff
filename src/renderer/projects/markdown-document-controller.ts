import type {
  MarkdownDocument,
  ProjectFailureDetails,
  ProjectResult,
  ReadMarkdownDocumentRequest,
  SaveMarkdownDocumentRequest,
} from '../../shared/contracts';

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
  dirty: boolean;
  status: MarkdownBufferStatus;
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
}

interface MarkdownBufferEntry {
  snapshot: MarkdownBufferSnapshot;
  savedContent: string;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  savePromise?: Promise<boolean>;
}

const DEFAULT_AUTOSAVE_DELAY = 500;

function rejectedOperation(message: string): ProjectFailureDetails {
  return { code: 'io-error', message };
}

export class MarkdownDocumentController {
  private readonly buffers = new Map<string, MarkdownBufferEntry>();
  private readonly debounceMs: number;
  private readonly saveDocument: MarkdownDocumentControllerOptions['save'];
  private readonly reloadDocument: MarkdownDocumentControllerOptions['reload'];
  private disposed = false;

  constructor({
    debounceMs = DEFAULT_AUTOSAVE_DELAY,
    reload,
    save,
  }: MarkdownDocumentControllerOptions) {
    this.debounceMs = Math.max(0, debounceMs);
    this.reloadDocument = reload;
    this.saveDocument = save;
  }

  open(document: MarkdownDocument): MarkdownBufferSnapshot {
    const existing = this.buffers.get(document.nodeId);

    if (existing) {
      if (
        !existing.snapshot.dirty &&
        (existing.snapshot.revision !== document.revision ||
          existing.snapshot.content !== document.content)
      ) {
        this.replaceFromDocument(existing, document);
      }

      return existing.snapshot;
    }

    const entry: MarkdownBufferEntry = {
      snapshot: {
        nodeId: document.nodeId,
        content: document.content,
        revision: document.revision,
        dirty: false,
        status: 'saved',
      },
      savedContent: document.content,
      listeners: new Set(),
    };
    this.buffers.set(document.nodeId, entry);
    return entry.snapshot;
  }

  getSnapshot(nodeId: string): MarkdownBufferSnapshot | undefined {
    return this.buffers.get(nodeId)?.snapshot;
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    const entry = this.getEntry(nodeId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  update(nodeId: string, content: string): void {
    const entry = this.getEntry(nodeId);
    const blockedByConflict = entry.snapshot.status === 'conflict';
    const saveInProgress = Boolean(entry.savePromise);
    const dirty = blockedByConflict || content !== entry.savedContent;

    this.setSnapshot(entry, {
      ...entry.snapshot,
      content,
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

    this.clearTimer(entry);
    if (dirty && !blockedByConflict && !saveInProgress) {
      this.scheduleSave(entry);
    }
  }

  async save(nodeId: string): Promise<boolean> {
    return this.performSave(this.getEntry(nodeId), false);
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

  isDirty(nodeId: string): boolean {
    return this.buffers.get(nodeId)?.snapshot.dirty ?? false;
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

  dispose(): void {
    this.disposed = true;
    for (const entry of this.buffers.values()) {
      this.clearTimer(entry);
      entry.listeners.clear();
    }
    this.buffers.clear();
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

    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.performSave(entry, false);
    }, this.debounceMs);
  }

  private async performSave(
    entry: MarkdownBufferEntry,
    force: boolean,
  ): Promise<boolean> {
    this.clearTimer(entry);

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
      this.setFailure(entry, rejectedOperation(String(error)));
      return false;
    }

    if (!result.ok) {
      this.setFailure(entry, result.error);
      return false;
    }

    entry.savedContent = request.content;
    const changedWhileSaving = entry.snapshot.content !== request.content;
    this.setSnapshot(entry, {
      nodeId: entry.snapshot.nodeId,
      content: entry.snapshot.content,
      revision: result.value.revision,
      dirty: changedWhileSaving,
      status: changedWhileSaving ? 'dirty' : 'saved',
    });

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
    entry.savedContent = document.content;
    this.setSnapshot(entry, {
      nodeId: document.nodeId,
      content: document.content,
      revision: document.revision,
      dirty: false,
      status: 'saved',
    });
  }

  private clearTimer(entry: MarkdownBufferEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
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
