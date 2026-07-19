import type { SourceSelection } from './source-caret';

export interface SourceEditorState {
  content: string;
  selection: SourceSelection;
}

export interface SourceEditTransaction {
  after: SourceEditorState;
  before: SourceEditorState;
  inputType: string;
  timestamp: number;
}

interface HistoryEntry {
  afterSelection: SourceSelection;
  beforeSelection: SourceSelection;
  deleted: string;
  inputType: string;
  inserted: string;
  start: number;
  timestamp: number;
}

const COALESCE_WINDOW_MS = 750;
const MAX_ENTRIES_PER_DOCUMENT = 1_000;
const DEFAULT_HISTORY_BYTES = 64 * 1024 * 1024;

function sameSelection(
  left: SourceSelection,
  right: SourceSelection,
): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.direction === right.direction
  );
}

function entryBytes(entry: HistoryEntry): number {
  return (entry.deleted.length + entry.inserted.length) * 2;
}

function deriveEntry(transaction: SourceEditTransaction): HistoryEntry | undefined {
  const before = transaction.before.content;
  const after = transaction.after.content;
  if (before === after) {
    return undefined;
  }

  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    afterSelection: transaction.after.selection,
    beforeSelection: transaction.before.selection,
    deleted: before.slice(start, before.length - suffix),
    inputType: transaction.inputType,
    inserted: after.slice(start, after.length - suffix),
    start,
    timestamp: transaction.timestamp,
  };
}

function mergeKind(inputType: string): 'insert' | 'backward' | 'forward' | undefined {
  if (inputType === 'insertText') {
    return 'insert';
  }
  if (inputType.startsWith('delete') && inputType.endsWith('Backward')) {
    return 'backward';
  }
  if (inputType.startsWith('delete') && inputType.endsWith('Forward')) {
    return 'forward';
  }
  return undefined;
}

function mergeEntries(
  previous: HistoryEntry,
  next: HistoryEntry,
): HistoryEntry | undefined {
  const kind = mergeKind(previous.inputType);
  if (
    !kind ||
    previous.inputType !== next.inputType ||
    next.timestamp - previous.timestamp > COALESCE_WINDOW_MS ||
    next.timestamp < previous.timestamp ||
    !sameSelection(previous.afterSelection, next.beforeSelection)
  ) {
    return undefined;
  }

  if (
    kind === 'insert' &&
    previous.deleted === '' &&
    next.deleted === '' &&
    next.start === previous.start + previous.inserted.length
  ) {
    return {
      ...previous,
      afterSelection: next.afterSelection,
      inserted: previous.inserted + next.inserted,
      timestamp: next.timestamp,
    };
  }

  if (
    kind === 'backward' &&
    previous.inserted === '' &&
    next.inserted === '' &&
    next.start + next.deleted.length === previous.start
  ) {
    return {
      ...previous,
      afterSelection: next.afterSelection,
      deleted: next.deleted + previous.deleted,
      start: next.start,
      timestamp: next.timestamp,
    };
  }

  if (
    kind === 'forward' &&
    previous.inserted === '' &&
    next.inserted === '' &&
    next.start === previous.start
  ) {
    return {
      ...previous,
      afterSelection: next.afterSelection,
      deleted: previous.deleted + next.deleted,
      timestamp: next.timestamp,
    };
  }

  return undefined;
}

function applyEntry(
  state: SourceEditorState,
  entry: HistoryEntry,
  direction: 'undo' | 'redo',
): SourceEditorState | undefined {
  const expected = direction === 'undo' ? entry.inserted : entry.deleted;
  const replacement = direction === 'undo' ? entry.deleted : entry.inserted;
  if (state.content.slice(entry.start, entry.start + expected.length) !== expected) {
    return undefined;
  }

  return {
    content:
      state.content.slice(0, entry.start) +
      replacement +
      state.content.slice(entry.start + expected.length),
    selection:
      direction === 'undo' ? entry.beforeSelection : entry.afterSelection,
  };
}

class DocumentHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  lastUsed = 0;
  private mergeBarrier = false;

  get bytes(): number {
    return [...this.undoStack, ...this.redoStack].reduce(
      (total, entry) => total + entryBytes(entry),
      0,
    );
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(transaction: SourceEditTransaction): void {
    const entry = deriveEntry(transaction);
    if (!entry) {
      return;
    }

    const previous = this.undoStack.at(-1);
    const merged = previous && !this.mergeBarrier
      ? mergeEntries(previous, entry)
      : undefined;
    if (merged) {
      this.undoStack[this.undoStack.length - 1] = merged;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > MAX_ENTRIES_PER_DOCUMENT) {
        this.undoStack.shift();
      }
    }
    this.mergeBarrier = false;
    this.redoStack.length = 0;
  }

  breakCoalescing(): void {
    this.mergeBarrier = true;
  }

  undo(state: SourceEditorState): SourceEditorState | undefined {
    const entry = this.undoStack.at(-1);
    if (!entry) {
      return undefined;
    }
    const next = applyEntry(state, entry, 'undo');
    if (!next) {
      this.clear();
      return undefined;
    }
    this.undoStack.pop();
    this.redoStack.push(entry);
    return next;
  }

  redo(state: SourceEditorState): SourceEditorState | undefined {
    const entry = this.redoStack.at(-1);
    if (!entry) {
      return undefined;
    }
    const next = applyEntry(state, entry, 'redo');
    if (!next) {
      this.clear();
      return undefined;
    }
    this.redoStack.pop();
    this.undoStack.push(entry);
    return next;
  }

  discardOldest(): boolean {
    if (this.undoStack.length > 0) {
      this.undoStack.shift();
      return true;
    }
    if (this.redoStack.length > 0) {
      this.redoStack.shift();
      return true;
    }
    return false;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.mergeBarrier = false;
  }
}

export class MarkdownHistoryStore {
  private readonly documents = new Map<string, DocumentHistory>();
  private clock = 0;

  constructor(private readonly maxBytes = DEFAULT_HISTORY_BYTES) {}

  record(nodeId: string, transaction: SourceEditTransaction): void {
    const history = this.get(nodeId);
    history.record(transaction);
    this.touch(history);
    this.trim();
  }

  undo(nodeId: string, state: SourceEditorState): SourceEditorState | undefined {
    const history = this.documents.get(nodeId);
    if (!history) {
      return undefined;
    }
    this.touch(history);
    return history.undo(state);
  }

  redo(nodeId: string, state: SourceEditorState): SourceEditorState | undefined {
    const history = this.documents.get(nodeId);
    if (!history) {
      return undefined;
    }
    this.touch(history);
    return history.redo(state);
  }

  canUndo(nodeId: string): boolean {
    return this.documents.get(nodeId)?.canUndo ?? false;
  }

  canRedo(nodeId: string): boolean {
    return this.documents.get(nodeId)?.canRedo ?? false;
  }

  breakCoalescing(nodeId: string): void {
    this.documents.get(nodeId)?.breakCoalescing();
  }

  reset(nodeId: string): void {
    this.documents.get(nodeId)?.clear();
  }

  clear(): void {
    this.documents.clear();
  }

  private get(nodeId: string): DocumentHistory {
    const existing = this.documents.get(nodeId);
    if (existing) {
      return existing;
    }
    const history = new DocumentHistory();
    this.documents.set(nodeId, history);
    return history;
  }

  private touch(history: DocumentHistory): void {
    this.clock += 1;
    history.lastUsed = this.clock;
  }

  private trim(): void {
    let bytes = this.totalBytes();
    while (bytes > this.maxBytes) {
      const oldest = [...this.documents.values()]
        .filter((history) => history.bytes > 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!oldest?.discardOldest()) {
        return;
      }
      bytes = this.totalBytes();
    }
  }

  private totalBytes(): number {
    return [...this.documents.values()].reduce(
      (total, history) => total + history.bytes,
      0,
    );
  }
}
