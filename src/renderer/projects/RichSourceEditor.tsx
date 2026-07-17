import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import type { SourceEditTransaction } from './markdown-history';
import {
  normalizeSourceText,
  sourceTextFromTransfer,
} from './source-clipboard';
import {
  readSelection,
  readSource,
  replaceRange,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import { reconcileSource } from './source-renderer';
import { resolveSourceInput } from './source-input';
import {
  expandDoubleClickSelection,
  expandTripleClickSelection,
} from './source-word-selection';

export interface RichSourceEditorProps {
  ariaLabel: string;
  autoFocus?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  nodeId: string;
  readOnly?: boolean;
  selection: SourceSelection;
  value: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRedo: () => void;
  onScroll?: (scrollTop: number) => void;
  onSelectionChange: (selection: SourceSelection) => void;
  onTransaction: (transaction: SourceEditTransaction) => void;
  onUndo: () => void;
}

interface PendingInput {
  before: SourceEditTransaction['before'];
  inputType: string;
  timestamp: number;
}

function collapsedSelection(offset: number): SourceSelection {
  return { start: offset, end: offset, direction: 'none' };
}

export function RichSourceEditor({
  ariaLabel,
  autoFocus = false,
  editorRef,
  nodeId,
  readOnly = false,
  onKeyDown,
  onRedo,
  onScroll,
  onSelectionChange,
  onTransaction,
  onUndo,
  selection,
  value,
}: RichSourceEditorProps) {
  const composingRef = useRef(false);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const suppressedInputRef = useRef<string | undefined>(undefined);
  const suppressedInputTimerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<PendingInput | undefined>(undefined);
  const stateRef = useRef({ content: value, selection });
  const readOnlyRef = useRef(readOnly);
  const callbacksRef = useRef({
    onRedo,
    onSelectionChange,
    onTransaction,
    onUndo,
  });

  useEffect(() => {
    readOnlyRef.current = readOnly;
    if (readOnly) {
      pendingRef.current = undefined;
      composingRef.current = false;
    }
  }, [readOnly]);

  useEffect(() => {
    callbacksRef.current = {
      onRedo,
      onSelectionChange,
      onTransaction,
      onUndo,
    };
  }, [onRedo, onSelectionChange, onTransaction, onUndo]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root || composingRef.current) {
      return;
    }

    if (readSource(root) !== value) {
      reconcileSource(root, value);
      writeSelection(root, selection);
      stateRef.current = { content: value, selection };
    }
  }, [editorRef, selection, value]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const editor = root;

    function commit(
      before: SourceEditTransaction['before'],
      content: string,
      nextSelection: SourceSelection,
      inputType: string,
      timestamp: number,
    ): void {
      reconcileSource(editor, content);
      writeSelection(editor, nextSelection);
      const after = { content, selection: nextSelection };
      stateRef.current = after;
      pendingRef.current = undefined;
      callbacksRef.current.onTransaction({
        after,
        before,
        inputType,
        timestamp,
      });
    }

    function commitReplacement(inputType: string, inserted: string): void {
      const before = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      const content = replaceRange(
        before.content,
        before.selection.start,
        before.selection.end,
        inserted,
      );
      const caret = before.selection.start + inserted.length;
      commit(
        before,
        content,
        collapsedSelection(caret),
        inputType,
        performance.now(),
      );
    }

    function suppressPairedInput(inputType: string): void {
      if (suppressedInputTimerRef.current !== undefined) {
        window.clearTimeout(suppressedInputTimerRef.current);
      }
      suppressedInputRef.current = inputType;
      suppressedInputTimerRef.current = window.setTimeout(() => {
        suppressedInputRef.current = undefined;
        suppressedInputTimerRef.current = undefined;
      }, 0);
    }

    function finishNativeInput(inputType?: string): void {
      if (composingRef.current) {
        return;
      }

      const before = pendingRef.current?.before ?? stateRef.current;
      const after = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      const resolvedInputType =
        inputType ?? pendingRef.current?.inputType ?? 'insertText';
      const timestamp = pendingRef.current?.timestamp ?? performance.now();

      if (after.content === before.content) {
        reconcileSource(editor, after.content);
        writeSelection(editor, after.selection);
        stateRef.current = after;
        pendingRef.current = undefined;
        callbacksRef.current.onSelectionChange(after.selection);
        return;
      }

      commit(
        before,
        after.content,
        after.selection,
        resolvedInputType,
        timestamp,
      );
    }

    function handleBeforeInput(event: InputEvent): void {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (event.inputType === 'historyUndo') {
        event.preventDefault();
        callbacksRef.current.onUndo();
        return;
      }
      if (event.inputType === 'historyRedo') {
        event.preventDefault();
        callbacksRef.current.onRedo();
        return;
      }
      if (composingRef.current) {
        return;
      }

      if (
        event.inputType === 'insertFromPaste' ||
        event.inputType === 'insertFromDrop'
      ) {
        event.preventDefault();
        if (suppressedInputRef.current === event.inputType) {
          return;
        }

        const inserted = event.dataTransfer
          ? sourceTextFromTransfer(event.dataTransfer, editor.ownerDocument)
          : normalizeSourceText(event.data ?? '');
        if (inserted) {
          commitReplacement(event.inputType, inserted);
          suppressPairedInput(event.inputType);
        }
        return;
      }

      const before = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      const data =
        event.data === null ? null : normalizeSourceText(event.data);
      const resolved = resolveSourceInput(before, event.inputType, data);
      if (resolved) {
        event.preventDefault();
        if (resolved.content === before.content) {
          reconcileSource(editor, resolved.content);
          writeSelection(editor, resolved.selection);
          stateRef.current = resolved;
          callbacksRef.current.onSelectionChange(resolved.selection);
          return;
        }
        commit(
          before,
          resolved.content,
          resolved.selection,
          event.inputType,
          performance.now(),
        );
        return;
      }

      pendingRef.current = {
        before,
        inputType: event.inputType,
        timestamp: performance.now(),
      };
    }

    function handleInput(event: InputEvent): void {
      if (readOnlyRef.current) {
        reconcileSource(editor, stateRef.current.content);
        writeSelection(editor, stateRef.current.selection);
        return;
      }
      if (suppressedInputRef.current === event.inputType) {
        reconcileSource(editor, stateRef.current.content);
        writeSelection(editor, stateRef.current.selection);
        suppressedInputRef.current = undefined;
        return;
      }
      finishNativeInput(event.inputType);
    }

    function handlePaste(event: ClipboardEvent): void {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (!event.clipboardData) {
        return;
      }
      event.preventDefault();
      if (suppressedInputRef.current === 'insertFromPaste') {
        return;
      }
      const inserted = sourceTextFromTransfer(
        event.clipboardData,
        editor.ownerDocument,
      );
      if (inserted) {
        commitReplacement('insertFromPaste', inserted);
      }
      suppressPairedInput('insertFromPaste');
    }

    function handleDrop(event: DragEvent): void {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      if (suppressedInputRef.current === 'insertFromDrop') {
        return;
      }
      const inserted = sourceTextFromTransfer(
        event.dataTransfer,
        editor.ownerDocument,
      );
      if (inserted) {
        commitReplacement('insertFromDrop', inserted);
      }
      suppressPairedInput('insertFromDrop');
    }

    function handleCut(event: ClipboardEvent): void {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      const before = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      if (before.selection.start === before.selection.end) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        before.content.slice(before.selection.start, before.selection.end),
      );
      const resolved = resolveSourceInput(before, 'deleteByCut');
      if (resolved) {
        commit(
          before,
          resolved.content,
          resolved.selection,
          'deleteByCut',
          performance.now(),
        );
      }
    }

    function handleCopy(event: ClipboardEvent): void {
      const source = readSource(editor);
      const selected = readSelection(editor);
      if (selected.start === selected.end) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        source.slice(selected.start, selected.end),
      );
    }

    function handleCompositionStart(event: CompositionEvent): void {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
      }
      if (suppressedInputTimerRef.current !== undefined) {
        window.clearTimeout(suppressedInputTimerRef.current);
      }
      composingRef.current = true;
      pendingRef.current = {
        before: {
          content: readSource(editor),
          selection: readSelection(editor),
        },
        inputType: 'insertCompositionText',
        timestamp: performance.now(),
      };
    }

    function handleCompositionEnd(): void {
      compositionTimerRef.current = window.setTimeout(() => {
        compositionTimerRef.current = undefined;
        composingRef.current = false;
        if (readOnlyRef.current) {
          pendingRef.current = undefined;
          reconcileSource(editor, stateRef.current.content);
          writeSelection(editor, stateRef.current.selection);
          return;
        }
        finishNativeInput('insertCompositionText');
      }, 0);
    }

    function handleSelectionChange(): void {
      const selectionInDocument = editor.ownerDocument.getSelection();
      if (
        composingRef.current ||
        !selectionInDocument?.anchorNode ||
        (!editor.contains(selectionInDocument.anchorNode) &&
          selectionInDocument.anchorNode !== editor)
      ) {
        return;
      }
      const nextSelection = readSelection(editor);
      stateRef.current = {
        content: stateRef.current.content,
        selection: nextSelection,
      };
      callbacksRef.current.onSelectionChange(nextSelection);
    }

    function handleDoubleClick(event: MouseEvent): void {
      if (composingRef.current) {
        return;
      }
      const content = readSource(editor);
      const current = readSelection(editor);
      const next = expandDoubleClickSelection(content, current);
      if (
        next.start === current.start &&
        next.end === current.end &&
        next.direction === current.direction
      ) {
        return;
      }
      event.preventDefault();
      writeSelection(editor, next);
      stateRef.current = { content, selection: next };
      callbacksRef.current.onSelectionChange(next);
    }

    function handleClick(event: MouseEvent): void {
      if (event.detail !== 3 || composingRef.current) {
        return;
      }
      const content = readSource(editor);
      const current = readSelection(editor);
      const next = expandTripleClickSelection(content, current);
      if (
        next.start === current.start &&
        next.end === current.end &&
        next.direction === current.direction
      ) {
        return;
      }
      event.preventDefault();
      writeSelection(editor, next);
      stateRef.current = { content, selection: next };
      callbacksRef.current.onSelectionChange(next);
    }

    editor.addEventListener('beforeinput', handleBeforeInput);
    editor.addEventListener('compositionstart', handleCompositionStart);
    editor.addEventListener('compositionend', handleCompositionEnd);
    editor.addEventListener('input', handleInput);
    editor.addEventListener('paste', handlePaste);
    editor.addEventListener('copy', handleCopy);
    editor.addEventListener('cut', handleCut);
    editor.addEventListener('drop', handleDrop);
    editor.addEventListener('click', handleClick);
    editor.addEventListener('dblclick', handleDoubleClick);
    editor.ownerDocument.addEventListener(
      'selectionchange',
      handleSelectionChange,
    );

    return () => {
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
      }
      editor.removeEventListener('beforeinput', handleBeforeInput);
      editor.removeEventListener('compositionstart', handleCompositionStart);
      editor.removeEventListener('compositionend', handleCompositionEnd);
      editor.removeEventListener('input', handleInput);
      editor.removeEventListener('paste', handlePaste);
      editor.removeEventListener('copy', handleCopy);
      editor.removeEventListener('cut', handleCut);
      editor.removeEventListener('drop', handleDrop);
      editor.removeEventListener('click', handleClick);
      editor.removeEventListener('dblclick', handleDoubleClick);
      editor.ownerDocument.removeEventListener(
        'selectionchange',
        handleSelectionChange,
      );
    };
  }, [editorRef]);

  useEffect(() => {
    if (autoFocus) {
      editorRef.current?.focus();
    }
  }, [autoFocus, editorRef]);

  return (
    <div className="markdown-source">
      <div
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-readonly={readOnly}
        className="markdown-source__editor"
        contentEditable={readOnly ? false : 'plaintext-only'}
        data-markdown-node-id={nodeId}
        onKeyDown={onKeyDown}
        onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
        ref={editorRef}
        role="textbox"
        spellCheck={false}
        suppressContentEditableWarning
        tabIndex={0}
      />
    </div>
  );
}
