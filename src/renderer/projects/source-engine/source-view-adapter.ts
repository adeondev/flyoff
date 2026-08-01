import type {
  SourceChangeRange,
  SourceDocumentModel,
} from '../source-document-model';

export type SourceViewSelectionDirection = 'forward' | 'backward' | 'none';

export interface SourceViewSelection {
  start: number;
  end: number;
  direction: SourceViewSelectionDirection;
}

export interface SourceViewAdapter {
  getModel(): SourceDocumentModel;
  readSelection(): SourceViewSelection;
  writeSelection(selection: SourceViewSelection): void;
  focus(): void;
  sourceOffsetAtPoint(x: number, y: number): number | undefined;
  sourceCaretRect(offset: number): DOMRect | undefined;
  synchronizeLayout?(): void;
  getVisibleLineElements?(): readonly HTMLElement[];
  getChangeRange?(): SourceChangeRange | undefined;
}

const adapters = new WeakMap<HTMLElement, SourceViewAdapter>();

export function registerSourceViewAdapter(
  root: HTMLElement,
  adapter: SourceViewAdapter,
): () => void {
  adapters.set(root, adapter);
  return () => unregisterSourceViewAdapter(root, adapter);
}

export function unregisterSourceViewAdapter(
  root: HTMLElement,
  adapter?: SourceViewAdapter,
): void {
  if (adapter && adapters.get(root) !== adapter) {
    return;
  }
  adapters.delete(root);
}

export function getSourceViewAdapter(
  root: HTMLElement,
): SourceViewAdapter | undefined {
  return adapters.get(root);
}
