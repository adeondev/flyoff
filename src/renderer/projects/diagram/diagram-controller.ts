import type {
  DiagramDocumentEnvelope,
  ProjectFailureDetails,
  ProjectResult,
  ReadDiagramDocumentRequest,
  SaveDiagramDocumentRequest,
} from '../../../shared/contracts';
import {
  validateDiagramDocument,
  type DiagramDocument,
} from '../../../shared/diagram';
import { DiagramHistoryStore } from './diagram-history';

export type DiagramBufferStatus =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'loading'
  | 'conflict'
  | 'error';

export interface DiagramBufferSnapshot {
  nodeId: string;
  document: DiagramDocument;
  revision: string;
  dirty: boolean;
  status: DiagramBufferStatus;
  error?: ProjectFailureDetails;
}

export interface DiagramControllerOptions {
  save: (
    request: SaveDiagramDocumentRequest,
  ) => Promise<ProjectResult<DiagramDocumentEnvelope>>;
  reload: (
    request: ReadDiagramDocumentRequest,
  ) => Promise<ProjectResult<DiagramDocumentEnvelope>>;
  debounceMs?: number;
  onSaveError?: (error: ProjectFailureDetails, nodeId: string) => void;
}

interface DiagramBuffer {
  snapshot: DiagramBufferSnapshot;
  savedDocument: DiagramDocument;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  savePromise?: Promise<boolean>;
}

function operationError(message: string): ProjectFailureDetails {
  return { code: 'io-error', message };
}

export class DiagramController {
  private readonly buffers = new Map<string, DiagramBuffer>();
  private readonly history = new DiagramHistoryStore();
  private readonly saveDocument: DiagramControllerOptions['save'];
  private readonly reloadDocument: DiagramControllerOptions['reload'];
  private onSaveError?: DiagramControllerOptions['onSaveError'];
  private debounceMs: number;
  private disposed = false;

  constructor({
    save,
    reload,
    debounceMs = 500,
    onSaveError,
  }: DiagramControllerOptions) {
    this.saveDocument = save;
    this.reloadDocument = reload;
    this.debounceMs = Math.max(0, debounceMs);
    this.onSaveError = onSaveError;
  }

  open(envelope: DiagramDocumentEnvelope): DiagramBufferSnapshot {
    const existing = this.buffers.get(envelope.nodeId);
    if (existing) {
      if (!existing.snapshot.dirty && existing.snapshot.revision !== envelope.revision) {
        this.replace(existing, envelope);
      }
      return existing.snapshot;
    }
    const snapshot: DiagramBufferSnapshot = {
      nodeId: envelope.nodeId,
      document: envelope.document,
      revision: envelope.revision,
      dirty: false,
      status: 'saved',
    };
    this.buffers.set(envelope.nodeId, {
      snapshot,
      savedDocument: envelope.document,
      listeners: new Set(),
    });
    return snapshot;
  }

  getSnapshot(nodeId: string): DiagramBufferSnapshot | undefined {
    return this.buffers.get(nodeId)?.snapshot;
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    const entry = this.requireEntry(nodeId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  setDebounceMs(value: number): void {
    this.debounceMs = Math.max(0, value);
  }

  setOnSaveError(callback?: DiagramControllerOptions['onSaveError']): void {
    this.onSaveError = callback;
  }

  update(
    nodeId: string,
    update: (document: DiagramDocument) => DiagramDocument,
    coalesceKey?: string,
    continuousHistory = false,
  ): boolean {
    const entry = this.requireEntry(nodeId);
    const next = update(entry.snapshot.document);
    if (next === entry.snapshot.document) {
      return false;
    }
    if (!validateDiagramDocument(next).ok) {
      return false;
    }
    this.history.record(
      nodeId,
      entry.snapshot.document,
      next,
      coalesceKey,
      Date.now(),
      continuousHistory,
    );
    this.applyDocument(entry, next);
    return true;
  }

  undo(nodeId: string): boolean {
    const entry = this.requireEntry(nodeId);
    const document = this.history.undo(nodeId, entry.snapshot.document);
    if (!document) {
      return false;
    }
    this.applyDocument(entry, document);
    return true;
  }

  redo(nodeId: string): boolean {
    const entry = this.requireEntry(nodeId);
    const document = this.history.redo(nodeId, entry.snapshot.document);
    if (!document) {
      return false;
    }
    this.applyDocument(entry, document);
    return true;
  }

  canUndo(nodeId: string): boolean {
    return this.history.canUndo(nodeId);
  }

  canRedo(nodeId: string): boolean {
    return this.history.canRedo(nodeId);
  }

  async save(nodeId: string): Promise<boolean> {
    return this.performSave(this.requireEntry(nodeId), false);
  }

  async overwrite(nodeId: string): Promise<boolean> {
    return this.performSave(this.requireEntry(nodeId), true);
  }

  async reload(nodeId: string): Promise<boolean> {
    const entry = this.requireEntry(nodeId);
    this.clearTimer(entry);
    if (entry.savePromise) {
      await entry.savePromise;
    }
    this.setSnapshot(entry, { ...entry.snapshot, status: 'loading', error: undefined });
    try {
      const result = await this.reloadDocument({ nodeId });
      if (!result.ok) {
        this.fail(entry, result.error);
        return false;
      }
      this.replace(entry, result.value);
      return true;
    } catch (error) {
      this.fail(entry, operationError(String(error)));
      return false;
    }
  }

  async flush(nodeId: string): Promise<boolean> {
    const entry = this.requireEntry(nodeId);
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

  discardClean(nodeId: string): boolean {
    const entry = this.buffers.get(nodeId);
    if (!entry || entry.snapshot.dirty || entry.savePromise) {
      return false;
    }
    this.clearTimer(entry);
    entry.listeners.clear();
    this.history.reset(nodeId);
    return this.buffers.delete(nodeId);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.buffers.values()) {
      this.clearTimer(entry);
      entry.listeners.clear();
    }
    this.buffers.clear();
    this.history.clear();
  }

  private applyDocument(entry: DiagramBuffer, document: DiagramDocument): void {
    const conflict = entry.snapshot.status === 'conflict';
    this.setSnapshot(entry, {
      ...entry.snapshot,
      document,
      dirty: true,
      status: conflict ? 'conflict' : entry.savePromise ? 'saving' : 'dirty',
    });
    this.clearTimer(entry);
    if (!conflict && !entry.savePromise) {
      this.scheduleSave(entry);
    }
  }

  private scheduleSave(entry: DiagramBuffer): void {
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.performSave(entry, false);
    }, this.debounceMs);
  }

  private async performSave(entry: DiagramBuffer, force: boolean): Promise<boolean> {
    this.clearTimer(entry);
    if (entry.savePromise) {
      await entry.savePromise;
    }
    if (!entry.snapshot.dirty && !force) {
      return true;
    }
    if (entry.snapshot.status === 'conflict' && !force) {
      return false;
    }
    const savingDocument = entry.snapshot.document;
    this.setSnapshot(entry, { ...entry.snapshot, status: 'saving', error: undefined });
    const pending = (async () => {
      let result: ProjectResult<DiagramDocumentEnvelope>;
      try {
        result = await this.saveDocument({
          nodeId: entry.snapshot.nodeId,
          document: savingDocument,
          expectedRevision: entry.snapshot.revision,
          ...(force ? { force: true } : {}),
        });
      } catch (error) {
        this.fail(entry, operationError(String(error)));
        return false;
      }
      if (!result.ok) {
        this.fail(entry, result.error);
        return false;
      }
      entry.savedDocument = savingDocument;
      const dirty = entry.snapshot.document !== savingDocument;
      this.setSnapshot(entry, {
        ...entry.snapshot,
        revision: result.value.revision,
        dirty,
        status: dirty ? 'dirty' : 'saved',
        error: undefined,
      });
      return true;
    })();
    entry.savePromise = pending;
    const saved = await pending;
    entry.savePromise = undefined;
    if (saved && entry.snapshot.dirty && !this.disposed) {
      this.scheduleSave(entry);
    }
    return saved;
  }

  private replace(entry: DiagramBuffer, envelope: DiagramDocumentEnvelope): void {
    this.clearTimer(entry);
    entry.savedDocument = envelope.document;
    this.history.reset(envelope.nodeId);
    this.setSnapshot(entry, {
      nodeId: envelope.nodeId,
      document: envelope.document,
      revision: envelope.revision,
      dirty: false,
      status: 'saved',
    });
  }

  private fail(entry: DiagramBuffer, error: ProjectFailureDetails): void {
    this.setSnapshot(entry, {
      ...entry.snapshot,
      dirty: true,
      status: error.code === 'conflict' ? 'conflict' : 'error',
      error,
    });
    this.onSaveError?.(error, entry.snapshot.nodeId);
  }

  private setSnapshot(entry: DiagramBuffer, snapshot: DiagramBufferSnapshot): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) {
      listener();
    }
  }

  private clearTimer(entry: DiagramBuffer): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  private requireEntry(nodeId: string): DiagramBuffer {
    const entry = this.buffers.get(nodeId);
    if (!entry) {
      throw new Error(`Diagram document ${nodeId} is not open.`);
    }
    return entry;
  }
}
