import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';

import { useScrollPositionReporter } from '../hooks/use-scroll-position-reporter';
import type { FlyoffApi } from '../../shared/contracts';
import type { SourceEditTransaction } from './markdown-history';
import {
  hasWorkspaceDrag,
  isWorkspaceDragActive,
} from '../components/tabs/workspace-drag';
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
import {
  handleSourceHorizontalNavigation,
  installSourceMouseSelection,
  revealSourceSelectionAfterNavigation,
} from './source-interaction';
import {
  reconcileSource,
  getSourceChangeRange,
  getSourceDocumentModel,
  updateActiveSourceLine,
} from './source-renderer';
import {
  clearSourceSpellingErrors,
  collectSourceSpellcheckWordsFromLines,
  PERSONAL_DICTIONARY_CHANGED_EVENT,
  renderSourceSpellingErrors,
} from './source-spellcheck';
import { SOURCE_SPELLCHECK_IDLE_MS } from './editor-performance';
import { resolveSourceInput } from './source-input';
import {
  createSourceMenuRequest,
  type SourceMenuRequest,
} from './source-context-actions';

export interface RichSourceEditorProps {
  ariaLabel: string;
  autoFocus?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  nodeId: string;
  viewId?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  checkCodeBlocks?: boolean;
  spellcheckScope?: string;
  selection: SourceSelection;
  value: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenuRequest?: (request: SourceMenuRequest) => void;
  onRedo: () => void;
  onScroll?: (scrollTop: number, settled?: boolean) => void;
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
  viewId,
  readOnly = false,
  spellCheck = false,
  checkCodeBlocks = false,
  onKeyDown,
  onContextMenuRequest,
  onRedo,
  onScroll,
  onSelectionChange,
  onTransaction,
  onUndo,
  selection,
  spellcheckScope = '',
  value,
}: RichSourceEditorProps) {
  const scrollReporter = useScrollPositionReporter(onScroll);
  const composingRef = useRef(false);
  const [spellcheckRevision, setSpellcheckRevision] = useState(0);
  const spellcheckCacheRef = useRef(new Map<string, boolean>());
  const spellcheckGenerationRef = useRef(0);
  const spellcheckScopeRef = useRef<string | undefined>(undefined);
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
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    for (const line of editor.querySelectorAll<HTMLElement>(
      '.md-line > .md-line__content',
    )) {
      line.spellcheck =
        spellCheck &&
        (checkCodeBlocks ||
          !line.parentElement?.classList.contains('md-line--code'));
    }
  }, [checkCodeBlocks, editorRef, spellCheck]);

  useEffect(() => {
    const refresh = () => {
      spellcheckCacheRef.current.clear();
      setSpellcheckRevision((current) => current + 1);
    };
    window.addEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const root = editorRef.current;
    if (!root || composingRef.current) {
      return;
    }

    const focused = root.ownerDocument.activeElement === root;
    const nextSelection =
      focused && stateRef.current.content === value
        ? stateRef.current.selection
        : selection;
    reconcileSource(root, value);
    if (focused) {
      writeSelection(root, nextSelection);
    }
    stateRef.current = { content: value, selection: nextSelection };
  }, [editorRef, selection, value]);

  useEffect(() => {
    const root = editorRef.current;
    const checkWords = (window.flyoff as Partial<FlyoffApi> | undefined)
      ?.checkSpellcheckWords;
    if (!root || !spellCheck || !checkWords) {
      if (root) {
        clearSourceSpellingErrors(root);
      }
      spellcheckScopeRef.current = undefined;
      return;
    }

    let active = true;
    const generation = ++spellcheckGenerationRef.current;
    const scope = `${spellcheckRevision}:${String(checkCodeBlocks)}:${spellcheckScope}`;
    const fullRefresh = spellcheckScopeRef.current !== scope;
    if (fullRefresh) {
      spellcheckCacheRef.current.clear();
    }
    spellcheckScopeRef.current = scope;
    const timeout = window.setTimeout(() => {
      const model = getSourceDocumentModel(root);
      if (!model || model.source !== value) {
        return;
      }
      const changed = getSourceChangeRange(root);
      const range =
        fullRefresh || changed?.full
          ? { startLine: 0, endLine: model.lines.length }
          : {
              startLine: changed?.startLine ?? 0,
              endLine: changed?.endLine ?? model.lines.length,
            };
      const words = collectSourceSpellcheckWordsFromLines(
        model.lines.slice(range.startLine, range.endLine),
        checkCodeBlocks,
      );
      const unknown = words.filter(
        (word) => !spellcheckCacheRef.current.has(word),
      );
      const batches: string[][] = [];
      for (let index = 0; index < unknown.length; index += 1_024) {
        batches.push(unknown.slice(index, index + 1_024));
      }
      const requests =
        batches.length === 0
          ? Promise.resolve<readonly (readonly string[])[]>([])
          : Promise.all(
              batches.map((batch) => checkWords({ words: batch })),
            );
      void requests
        .then((results) => {
          if (
            !active ||
            generation !== spellcheckGenerationRef.current ||
            !editorRef.current
          ) {
            return;
          }
          const editor = editorRef.current;
          const misspelled = new Set(results.flat());
          for (const word of unknown) {
            spellcheckCacheRef.current.set(word, misspelled.has(word));
          }
          const focused = editor.ownerDocument.activeElement === editor;
          const currentSelection = focused ? readSelection(editor) : undefined;
          renderSourceSpellingErrors(
            editor,
            words.filter(
              (word) => spellcheckCacheRef.current.get(word) === true,
            ),
            checkCodeBlocks,
            range,
          );
          if (currentSelection) {
            writeSelection(editor, currentSelection);
          }
        })
        .catch(() => {
          if (active && editorRef.current) {
            clearSourceSpellingErrors(editorRef.current);
          }
        });
    }, SOURCE_SPELLCHECK_IDLE_MS);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    checkCodeBlocks,
    editorRef,
    spellCheck,
    spellcheckScope,
    spellcheckRevision,
    value,
  ]);

  useEffect(() => {
    const root = editorRef.current;
    if (root) {
      updateActiveSourceLine(root, value, selection.end);
    }
  }, [editorRef, selection.end, value]);

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
        content: stateRef.current.content,
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
        if (
          event.inputType === 'insertFromDrop' &&
          (isWorkspaceDragActive() ||
            (event.dataTransfer &&
              hasWorkspaceDrag(event.dataTransfer)))
        ) {
          return;
        }
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
        content: stateRef.current.content,
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
      if (
        isWorkspaceDragActive() ||
        hasWorkspaceDrag(event.dataTransfer)
      ) {
        return;
      }
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
        content: stateRef.current.content,
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
      const source = stateRef.current.content;
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
          content: stateRef.current.content,
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

    const removeMouseSelection = installSourceMouseSelection(editor, {
      getContent: () => stateRef.current.content,
      isComposing: () => composingRef.current,
      onSelectionChange: (content, nextSelection) => {
        stateRef.current = { content, selection: nextSelection };
        callbacksRef.current.onSelectionChange(nextSelection);
      },
    });

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
      removeMouseSelection();
      editor.ownerDocument.removeEventListener(
        'selectionchange',
        handleSelectionChange,
      );
    };
  }, [editorRef]);

  useEffect(() => {
    const editor = editorRef.current;
    if (autoFocus && editor) {
      editor.focus({ preventScroll: true });
      writeSelection(editor, stateRef.current.selection);
    }
  }, [autoFocus, editorRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event);
    const nextSelection = handleSourceHorizontalNavigation(
      event.currentTarget,
      event.nativeEvent,
      stateRef.current.content,
    );
    if (nextSelection) {
      stateRef.current = {
        content: stateRef.current.content,
        selection: nextSelection,
      };
      callbacksRef.current.onSelectionChange(nextSelection);
    }
    revealSourceSelectionAfterNavigation(event.currentTarget, event);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onContextMenuRequest?.(
      createSourceMenuRequest(event.currentTarget, event.target, {
        x: event.clientX || bounds.left + 24,
        y: event.clientY || bounds.top + 24,
      }),
    );
  }

  return (
    <div className="markdown-source">
      <div
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-readonly={readOnly}
        className="markdown-source__editor"
        contentEditable={readOnly ? false : 'plaintext-only'}
        data-markdown-node-id={nodeId}
        data-markdown-view-id={viewId}
        data-spellcheck-code-blocks={String(checkCodeBlocks)}
        data-spellcheck-enabled={String(spellCheck)}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onScroll={(event) =>
          scrollReporter.reportScroll(event.currentTarget.scrollTop)
        }
        onScrollEnd={(event) =>
          scrollReporter.reportScrollEnd(event.currentTarget.scrollTop)
        }
        ref={editorRef}
        role="textbox"
        spellCheck={spellCheck}
        suppressContentEditableWarning
        tabIndex={0}
      />
    </div>
  );
}
