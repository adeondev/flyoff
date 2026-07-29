import type { DiagramDocument } from '../../../shared/diagram';

interface DiagramHistoryEntry {
  before: DiagramDocument;
  after: DiagramDocument;
  coalesceKey?: string;
  timestamp: number;
}

interface DiagramHistoryState {
  undo: DiagramHistoryEntry[];
  redo: DiagramHistoryEntry[];
}

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 500;

export class DiagramHistoryStore {
  private readonly states = new Map<string, DiagramHistoryState>();

  record(
    nodeId: string,
    before: DiagramDocument,
    after: DiagramDocument,
    coalesceKey?: string,
    timestamp = Date.now(),
    continuous = false,
  ): void {
    if (before === after) {
      return;
    }
    const state = this.state(nodeId);
    const previous = state.undo.at(-1);
    if (
      coalesceKey &&
      previous?.coalesceKey === coalesceKey &&
      (continuous || timestamp - previous.timestamp <= COALESCE_WINDOW_MS)
    ) {
      previous.after = after;
      previous.timestamp = timestamp;
    } else {
      state.undo.push({ before, after, coalesceKey, timestamp });
      if (state.undo.length > HISTORY_LIMIT) {
        state.undo.shift();
      }
    }
    state.redo = [];
  }

  undo(nodeId: string, current: DiagramDocument): DiagramDocument | undefined {
    const state = this.state(nodeId);
    const entry = state.undo.pop();
    if (!entry) {
      return undefined;
    }
    state.redo.push({ ...entry, after: current });
    return entry.before;
  }

  redo(nodeId: string, current: DiagramDocument): DiagramDocument | undefined {
    const state = this.state(nodeId);
    const entry = state.redo.pop();
    if (!entry) {
      return undefined;
    }
    state.undo.push({ ...entry, before: current });
    return entry.after;
  }

  canUndo(nodeId: string): boolean {
    return (this.states.get(nodeId)?.undo.length ?? 0) > 0;
  }

  canRedo(nodeId: string): boolean {
    return (this.states.get(nodeId)?.redo.length ?? 0) > 0;
  }

  reset(nodeId: string): void {
    this.states.delete(nodeId);
  }

  clear(): void {
    this.states.clear();
  }

  private state(nodeId: string): DiagramHistoryState {
    let state = this.states.get(nodeId);
    if (!state) {
      state = { undo: [], redo: [] };
      this.states.set(nodeId, state);
    }
    return state;
  }
}
