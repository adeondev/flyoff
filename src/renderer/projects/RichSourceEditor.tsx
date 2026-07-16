import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import type { SourceEditTransaction } from './markdown-history';
import {
  readSelection,
  readSource,
  replaceRange,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import { reconcileSource } from './source-renderer';
import { resolveSourceInput } from './source-input';

export interface RichSourceEditorProps {
  ariaLabel: string;
  autoFocus?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  nodeId: string;
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

function normalizedText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function RichSourceEditor({
  ariaLabel,
  autoFocus = false,
  editorRef,
  nodeId,
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
  const pendingRef = useRef<PendingInput | undefined>(undefined);
  const stateRef = useRef({ content: value, selection });
  const callbacksRef = useRef({
    onRedo,
    onSelectionChange,
    onTransaction,
    onUndo,
  });

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

      const before = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      const resolved = resolveSourceInput(before, event.inputType, event.data);
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
      finishNativeInput(event.inputType);
    }

    function handlePaste(event: ClipboardEvent): void {
      const text = event.clipboardData?.getData('text/plain');
      if (text === undefined) {
        return;
      }
      event.preventDefault();
      commitReplacement('insertFromPaste', normalizedText(text));
    }

    function handleDrop(event: DragEvent): void {
      const text = event.dataTransfer?.getData('text/plain');
      if (text === undefined || text === '') {
        return;
      }
      event.preventDefault();
      commitReplacement('insertFromDrop', normalizedText(text));
    }

    function handleCut(event: ClipboardEvent): void {
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

    function handleCompositionStart(): void {
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
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
      composingRef.current = false;
      compositionTimerRef.current = window.setTimeout(() => {
        compositionTimerRef.current = undefined;
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

    editor.addEventListener('beforeinput', handleBeforeInput);
    editor.addEventListener('compositionstart', handleCompositionStart);
    editor.addEventListener('compositionend', handleCompositionEnd);
    editor.addEventListener('input', handleInput);
    editor.addEventListener('paste', handlePaste);
    editor.addEventListener('copy', handleCopy);
    editor.addEventListener('cut', handleCut);
    editor.addEventListener('drop', handleDrop);
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
        className="markdown-source__editor"
        contentEditable="plaintext-only"
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
