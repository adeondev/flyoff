import type { SourceSelection } from './source-caret';
import {
  isSourceTextChangeApplicable,
  type SourceTextChange,
} from './source-change';

export interface SourceEditorState {
  content: string;
  selection: SourceSelection;
}

export interface SourceEditTransaction {
  after: SourceEditorState;
  before: SourceEditorState;
  change?: SourceTextChange;
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
  const change = transaction.change;
  if (change && isSourceTextChangeApplicable(before, after, change)) {
    const deleted = before.slice(change.from, change.to);
    if (deleted === change.insert) {
      return undefined;
    }
    return {
      afterSelection: transaction.after.selection,
      beforeSelection: transaction.before.selection,
      deleted,
      inputType: transaction.inputType,
      inserted: change.insert,
      start: change.from,
      timestamp: transaction.timestamp,
    };
  }
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
    next.deleted === ''
  ) {
    const relativeStart = next.start - previous.start;
    if (
      relativeStart < 0 ||
      relativeStart > previous.inserted.length
    ) {
      return undefined;
    }
    return {
      ...previous,
      afterSelection: next.afterSelection,
      inserted:
        previous.inserted.slice(0, relativeStart) +
        next.inserted +
        previous.inserted.slice(relativeStart),
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
  private readonly undoStack = new HistoryEntryStack();
  private readonly redoStack = new HistoryEntryStack();
  lastUsed = 0;
  private mergeBarrier = false;

  get bytes(): number {
    return this.undoStack.bytes + this.redoStack.bytes;
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

    const previous = this.undoStack.last;
    const merged = previous && !this.mergeBarrier
      ? mergeEntries(previous, entry)
      : undefined;
    if (merged) {
      this.undoStack.replaceLast(merged);
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > MAX_ENTRIES_PER_DOCUMENT) {
        this.undoStack.discardOldest();
      }
    }
    this.mergeBarrier = false;
    this.redoStack.clear();
  }

  breakCoalescing(): void {
    this.mergeBarrier = true;
  }

  undo(state: SourceEditorState): SourceEditorState | undefined {
    const entry = this.undoStack.last;
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
    const entry = this.redoStack.last;
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

  discardOldest(): number {
    const undo = this.undoStack.discardOldest();
    if (undo) {
      return entryBytes(undo);
    }
    const redo = this.redoStack.discardOldest();
    if (redo) {
      return entryBytes(redo);
    }
    return 0;
  }

  clear(): void {
    this.undoStack.clear();
    this.redoStack.clear();
    this.mergeBarrier = false;
  }
}

class HistoryEntryStack {
  private byteCount = 0;
  private count = 0;
  private entries: (HistoryEntry | undefined)[] = [];
  private start = 0;

  get bytes(): number {
    return this.byteCount;
  }

  get last(): HistoryEntry | undefined {
    return this.count === 0
      ? undefined
      : this.entries[
          (this.start + this.count - 1) % this.entries.length
        ];
  }

  get length(): number {
    return this.count;
  }

  push(entry: HistoryEntry): void {
    this.ensureCapacity();
    this.entries[
      (this.start + this.count) % this.entries.length
    ] = entry;
    this.count += 1;
    this.byteCount += entryBytes(entry);
  }

  pop(): HistoryEntry | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const index =
      (this.start + this.count - 1) % this.entries.length;
    const entry = this.entries[index];
    this.entries[index] = undefined;
    if (entry) {
      this.byteCount -= entryBytes(entry);
    }
    this.count -= 1;
    if (this.count === 0) {
      this.start = 0;
    }
    return entry;
  }

  replaceLast(entry: HistoryEntry): void {
    if (this.count > 0) {
      const index =
        (this.start + this.count - 1) % this.entries.length;
      this.byteCount +=
        entryBytes(entry) - entryBytes(this.entries[index]!);
      this.entries[index] = entry;
    }
  }

  discardOldest(): HistoryEntry | undefined {
    const entry = this.entries[this.start];
    if (this.count === 0 || !entry) {
      return undefined;
    }
    this.entries[this.start] = undefined;
    this.count -= 1;
    this.byteCount -= entryBytes(entry);
    if (this.count === 0) {
      this.start = 0;
    } else {
      this.start = (this.start + 1) % this.entries.length;
    }
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.count = 0;
    this.start = 0;
    this.byteCount = 0;
  }

  private ensureCapacity(): void {
    if (this.count < this.entries.length) {
      return;
    }
    const previous = this.entries;
    const next = new Array<HistoryEntry | undefined>(
      Math.max(16, previous.length * 2),
    );
    for (let index = 0; index < this.count; index += 1) {
      next[index] =
        previous[(this.start + index) % previous.length];
    }
    this.entries = next;
    this.start = 0;
  }
}

export class MarkdownHistoryStore {
  private readonly documents = new Map<string, DocumentHistory>();
  private clock = 0;
  private totalByteCount = 0;

  constructor(private readonly maxBytes = DEFAULT_HISTORY_BYTES) {}

  record(nodeId: string, transaction: SourceEditTransaction): void {
    const history = this.get(nodeId);
    const previousBytes = history.bytes;
    history.record(transaction);
    this.totalByteCount += history.bytes - previousBytes;
    this.touch(history);
    this.trim();
  }

  undo(nodeId: string, state: SourceEditorState): SourceEditorState | undefined {
    const history = this.documents.get(nodeId);
    if (!history) {
      return undefined;
    }
    this.touch(history);
    const previousBytes = history.bytes;
    const next = history.undo(state);
    this.totalByteCount += history.bytes - previousBytes;
    return next;
  }

  redo(nodeId: string, state: SourceEditorState): SourceEditorState | undefined {
    const history = this.documents.get(nodeId);
    if (!history) {
      return undefined;
    }
    this.touch(history);
    const previousBytes = history.bytes;
    const next = history.redo(state);
    this.totalByteCount += history.bytes - previousBytes;
    return next;
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
    const history = this.documents.get(nodeId);
    if (history) {
      this.totalByteCount -= history.bytes;
      history.clear();
    }
  }

  clear(): void {
    this.documents.clear();
    this.totalByteCount = 0;
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
    while (this.totalByteCount > this.maxBytes) {
      let oldest: DocumentHistory | undefined;
      for (const history of this.documents.values()) {
        if (
          history.bytes > 0 &&
          (!oldest || history.lastUsed < oldest.lastUsed)
        ) {
          oldest = history;
        }
      }
      const discardedBytes = oldest?.discardOldest() ?? 0;
      if (discardedBytes === 0) {
        return;
      }
      this.totalByteCount -= discardedBytes;
    }
  }
}
