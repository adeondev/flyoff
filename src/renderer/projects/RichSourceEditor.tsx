import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { useScrollPositionReporter } from '../hooks/use-scroll-position-reporter';
import { parseHexColor, rgbToHex } from '../components/color';
import type { FlyoffApi } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import {
  parseImageDirective,
  serializeImageDirective,
} from '../../shared/markdown';
import type { SourceEditTransaction } from './markdown-history';
import {
  isSourceTextChangeApplicable,
  type SourceTextChange,
} from './source-document-model';
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
  sourceOffsetAtPoint,
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
  clearSourceSpellingErrorsOutsideRange,
  clearSourceSpellingErrors,
  collectSourceSpellcheckWordsFromLines,
  PERSONAL_DICTIONARY_CHANGED_EVENT,
  renderSourceSpellingErrors,
  sourceSpellcheckViewportRange,
} from './source-spellcheck';
import {
  isLargeMarkdownDocument,
  SOURCE_SPELLCHECK_IDLE_MS,
  SOURCE_SPELLCHECK_SCROLL_IDLE_MS,
} from './editor-performance';
import {
  applyMarkdownTypingComposition,
  applyMarkdownTypingReplacement,
  resolveMarkdownTypingInput,
  type MarkdownTypingColor,
} from './source-typing-color';
import {
  createSourceMenuRequest,
  type SourceMenuRequest,
} from './source-context-actions';
import {
  ImageInteractionLayer,
  type ImageSourceOperation,
} from './ImageInteractionLayer';
import {
  IMAGE_INSTANCE_TRANSFER,
  MEDIA_ASSET_TRANSFER,
} from './media-transfer';
import type { ImageInsertionPlacement } from './image-interaction';
import { shouldVirtualizeSource } from './source-viewport';
import { VirtualSourceEditor } from './VirtualSourceEditor';

export interface RichSourceEditorProps {
  active?: boolean;
  activeOffset?: number;
  ariaLabel: string;
  autoFocus?: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  nodeId: string;
  projectId?: string;
  viewId?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  checkCodeBlocks?: boolean;
  inlineColorLabel?: string;
  spellcheckScope?: string;
  typingColor?: MarkdownTypingColor | null;
  selection: SourceSelection;
  value: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenuRequest?: (request: SourceMenuRequest) => void;
  onColorRequest?: (request: SourceInlineColorRequest) => void;
  onImportFiles?: (files: readonly File[], offset: number) => void;
  onInsertMediaAsset?: (
    assetId: string,
    projectId: string,
    offset: number,
    instanceId?: string,
    placement?: ImageInsertionPlacement,
  ) => boolean | Promise<boolean>;
  onRevealMediaAsset?: (assetId: string) => void;
  onImageOperation?: (operation: ImageSourceOperation) => void;
  onRedo: () => void;
  onScroll?: (scrollTop: number, settled?: boolean) => void;
  onSelectionChange: (selection: SourceSelection) => void;
  onTransaction: (transaction: SourceEditTransaction) => void;
  onUndo: () => void;
  translate: Translate;
}

export interface SourceInlineColorRequest {
  color: string | null;
  end: number;
  kind: 'highlight' | 'text';
  position: { x: number; y: number };
  start: number;
}

interface PendingInput {
  before: SourceEditTransaction['before'];
  data?: string | null;
  inputType: string;
  timestamp: number;
}

function sourceTextChangeForStates(
  before: SourceEditTransaction['before'],
  after: SourceEditTransaction['after'],
): SourceTextChange | undefined {
  const directFrom = Math.min(
    before.selection.start,
    before.content.length,
  );
  const directTo = Math.min(
    Math.max(directFrom, before.selection.end),
    before.content.length,
  );
  const directInsertLength =
    after.content.length -
    (before.content.length - (directTo - directFrom));
  if (directInsertLength >= 0) {
    const direct = {
      from: directFrom,
      insert: after.content.slice(
        directFrom,
        directFrom + directInsertLength,
      ),
      to: directTo,
    };
    if (
      isSourceTextChangeApplicable(
        before.content,
        after.content,
        direct,
      )
    ) {
      return direct;
    }
  }

  const focus = Math.min(
    before.selection.start,
    after.selection.start,
  );
  const beforeStart =
    before.content.lastIndexOf('\n', Math.max(0, focus - 1)) + 1;
  const afterStart =
    after.content.lastIndexOf('\n', Math.max(0, focus - 1)) + 1;
  if (beforeStart !== afterStart) {
    return undefined;
  }
  const beforeBreak = before.content.indexOf(
    '\n',
    Math.max(before.selection.end, focus),
  );
  const afterBreak = after.content.indexOf(
    '\n',
    Math.max(after.selection.end, focus),
  );
  const beforeEnd =
    beforeBreak === -1 ? before.content.length : beforeBreak;
  const afterEnd =
    afterBreak === -1 ? after.content.length : afterBreak;
  let prefix = 0;
  while (
    beforeStart + prefix < beforeEnd &&
    afterStart + prefix < afterEnd &&
    before.content[beforeStart + prefix] ===
      after.content[afterStart + prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeEnd - beforeStart - prefix &&
    suffix < afterEnd - afterStart - prefix &&
    before.content[beforeEnd - suffix - 1] ===
      after.content[afterEnd - suffix - 1]
  ) {
    suffix += 1;
  }
  const localized = {
    from: beforeStart + prefix,
    insert: after.content.slice(
      afterStart + prefix,
      afterEnd - suffix,
    ),
    to: beforeEnd - suffix,
  };
  return isSourceTextChangeApplicable(
    before.content,
    after.content,
    localized,
  )
    ? localized
    : undefined;
}

function supportsVirtualSource(value: string): boolean {
  return shouldVirtualizeSource(value);
}

export function RichSourceEditor(
  props: RichSourceEditorProps,
) {
  const virtual = useMemo(
    () => supportsVirtualSource(props.value),
    [props.value],
  );
  const currentEditor = props.editorRef.current;
  const activeElement = currentEditor?.ownerDocument.activeElement;
  const restoreFocus = Boolean(
    currentEditor &&
      activeElement &&
      (activeElement === currentEditor ||
        currentEditor.contains(activeElement)),
  );
  const editorProps =
    restoreFocus && !props.autoFocus
      ? { ...props, autoFocus: true }
      : props;
  return virtual ? (
    <VirtualSourceEditor {...editorProps} />
  ) : (
    <ClassicSourceEditor {...editorProps} />
  );
}

function ClassicSourceEditor({
  active: pageActive = true,
  activeOffset,
  ariaLabel,
  autoFocus = false,
  editorRef,
  nodeId,
  projectId,
  viewId,
  readOnly = false,
  spellCheck = false,
  checkCodeBlocks = false,
  inlineColorLabel,
  onKeyDown,
  onColorRequest,
  onImportFiles,
  onInsertMediaAsset,
  onRevealMediaAsset,
  onImageOperation,
  onContextMenuRequest,
  onRedo,
  onScroll,
  onSelectionChange,
  onTransaction,
  onUndo,
  selection,
  spellcheckScope = '',
  translate,
  typingColor = null,
  value,
}: RichSourceEditorProps) {
  const activeSourceOffset = activeOffset ?? selection.end;
  const largeSourceDocument = isLargeMarkdownDocument(value);
  const scrollReporter = useScrollPositionReporter(onScroll);
  const composingRef = useRef(false);
  const [spellcheckRevision, setSpellcheckRevision] = useState(0);
  const [spellcheckViewportRevision, setSpellcheckViewportRevision] =
    useState(0);
  const spellcheckCacheRef = useRef(new Map<string, boolean>());
  const spellcheckGenerationRef = useRef(0);
  const spellcheckScopeRef = useRef<string | undefined>(undefined);
  const spellcheckScrollTimerRef = useRef<number | undefined>(undefined);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const suppressedInputRef = useRef<string | undefined>(undefined);
  const suppressedInputTimerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<PendingInput | undefined>(undefined);
  const decorationRef = useRef<{
    inlineColorLabel?: string;
    readOnly: boolean;
    value?: string;
  }>({ readOnly });
  const stateRef = useRef({ content: value, selection });
  const readOnlyRef = useRef(readOnly);
  const typingColorRef = useRef(typingColor);
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
    typingColorRef.current = typingColor;
  }, [typingColor]);

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
    const decoration = decorationRef.current;
    const metadataChanged =
      decoration.inlineColorLabel !== inlineColorLabel ||
      decoration.readOnly !== readOnly;
    if (decoration.value !== value || metadataChanged) {
      const change = metadataChanged
        ? undefined
        : getSourceChangeRange(root);
      const start = change?.startLine ?? 0;
      const end = Math.min(
        root.children.length,
        change?.endLine ?? root.children.length,
      );
      for (let index = start; index < end; index += 1) {
        const line = root.children[index];
        for (const trigger of line?.querySelectorAll<HTMLButtonElement>(
          '.md-inline-color-trigger',
        ) ?? []) {
          if (inlineColorLabel) {
            trigger.setAttribute('aria-label', inlineColorLabel);
            trigger.dataset.flyoffTooltip = inlineColorLabel;
            trigger.dataset.flyoffTooltipPlacement = 'top';
          } else {
            trigger.removeAttribute('aria-label');
            delete trigger.dataset.flyoffTooltip;
            delete trigger.dataset.flyoffTooltipPlacement;
          }
          trigger.ariaDisabled = String(readOnly);
        }
      }
      decorationRef.current = { inlineColorLabel, readOnly, value };
    }
    if (focused) {
      writeSelection(root, nextSelection);
    }
    stateRef.current = { content: value, selection: nextSelection };
    updateActiveSourceLine(root, value, nextSelection.end);
  }, [editorRef, inlineColorLabel, readOnly, selection, value]);

  useEffect(() => {
    const root = editorRef.current;
    const checkWords = (window.flyoff as Partial<FlyoffApi> | undefined)
      ?.checkSpellcheckWords;
    if (!root || !pageActive || !spellCheck || !checkWords) {
      if (root && !spellCheck) {
        clearSourceSpellingErrors(root);
      }
      if (!spellCheck) {
        spellcheckScopeRef.current = undefined;
      }
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
      const range = largeSourceDocument
        ? sourceSpellcheckViewportRange(root, model.lines.length)
        : fullRefresh || changed?.full
          ? { startLine: 0, endLine: model.lines.length }
          : {
              startLine: changed?.startLine ?? 0,
              endLine: changed?.endLine ?? model.lines.length,
            };
      if (largeSourceDocument) {
        clearSourceSpellingErrorsOutsideRange(root, range);
      }
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
    pageActive,
    checkCodeBlocks,
    editorRef,
    largeSourceDocument,
    spellCheck,
    spellcheckScope,
    spellcheckRevision,
    spellcheckViewportRevision,
    value,
  ]);

  useEffect(
    () => () => {
      if (spellcheckScrollTimerRef.current !== undefined) {
        window.clearTimeout(spellcheckScrollTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const root = editorRef.current;
    if (root) {
      const localSelection =
        root.ownerDocument.activeElement === root &&
        stateRef.current.content === value
          ? stateRef.current.selection
          : undefined;
      updateActiveSourceLine(
        root,
        value,
        localSelection?.end ?? activeSourceOffset,
      );
    }
  }, [activeSourceOffset, editorRef, value]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const editor = root;

    function reconcileSelection(
      content: string,
      nextSelection: SourceSelection,
      verifyStructure = false,
      change?: SourceTextChange,
    ): void {
      reconcileSource(editor, content, verifyStructure, change);
      writeSelection(editor, nextSelection);
      updateActiveSourceLine(editor, content, nextSelection.end);
    }

    function commit(
      before: SourceEditTransaction['before'],
      content: string,
      nextSelection: SourceSelection,
      inputType: string,
      timestamp: number,
      change?: SourceTextChange,
    ): void {
      const after = { content, selection: nextSelection };
      const exactChange =
        change ?? sourceTextChangeForStates(before, after);
      reconcileSelection(
        content,
        nextSelection,
        false,
        exactChange,
      );
      stateRef.current = after;
      pendingRef.current = undefined;
      callbacksRef.current.onTransaction({
        after,
        before,
        change: exactChange,
        inputType,
        timestamp,
      });
    }

    function commitReplacement(
      inputType: string,
      inserted: string,
      applyTypingColor = true,
    ): void {
      const before = {
        content: stateRef.current.content,
        selection: readSelection(editor),
      };
      const after = applyMarkdownTypingReplacement(
        before,
        inserted,
        applyTypingColor ? typingColorRef.current : null,
      );
      const normalized = normalizeSourceText(inserted);
      const directChange = {
        from: before.selection.start,
        insert: normalized,
        to: before.selection.end,
      };
      commit(
        before,
        after.content,
        after.selection,
        inputType,
        performance.now(),
        isSourceTextChangeApplicable(
          before.content,
          after.content,
          directChange,
        )
          ? directChange
          : undefined,
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
      let after = {
        content: readSource(editor),
        selection: readSelection(editor),
      };
      const resolvedInputType =
        inputType ?? pendingRef.current?.inputType ?? 'insertText';
      const timestamp = pendingRef.current?.timestamp ?? performance.now();
      if (resolvedInputType === 'insertCompositionText') {
        after = applyMarkdownTypingComposition(
          before,
          after,
          typingColorRef.current,
        );
      }

      if (after.content === before.content) {
        reconcileSelection(after.content, after.selection, true);
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
      const resolved = resolveMarkdownTypingInput(
        before,
        event.inputType,
        data,
        typingColorRef.current,
      );
      if (resolved) {
        event.preventDefault();
        if (resolved.content === before.content) {
          reconcileSelection(resolved.content, resolved.selection);
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
        data,
        inputType: event.inputType,
        timestamp: performance.now(),
      };
    }

    function handleInput(event: InputEvent): void {
      if (readOnlyRef.current) {
        reconcileSelection(
          stateRef.current.content,
          stateRef.current.selection,
          true,
        );
        return;
      }
      if (suppressedInputRef.current === event.inputType) {
        reconcileSelection(
          stateRef.current.content,
          stateRef.current.selection,
          true,
        );
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
      const image = parseImageDirective(
        event.clipboardData?.getData(IMAGE_INSTANCE_TRANSFER) ?? '',
      );
      const inserted = image
        ? serializeImageDirective({
            ...image,
            instanceId: crypto.randomUUID(),
          })
        : sourceTextFromTransfer(
            event.clipboardData,
            editor.ownerDocument,
          );
      if (inserted) {
        commitReplacement('insertFromPaste', inserted, !image);
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
      if (
        event.dataTransfer.types.includes(MEDIA_ASSET_TRANSFER) ||
        event.dataTransfer.types.includes('Files')
      ) {
        suppressPairedInput('insertFromDrop');
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
      const resolved = resolveMarkdownTypingInput(
        before,
        'deleteByCut',
        null,
        typingColorRef.current,
      );
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
          reconcileSelection(
            stateRef.current.content,
            stateRef.current.selection,
            true,
          );
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
      updateActiveSourceLine(
        editor,
        stateRef.current.content,
        nextSelection.end,
      );
      callbacksRef.current.onSelectionChange(nextSelection);
    }

    const removeMouseSelection = installSourceMouseSelection(editor, {
      getContent: () => stateRef.current.content,
      isComposing: () => composingRef.current,
      onSelectionChange: (content, nextSelection) => {
        stateRef.current = { content, selection: nextSelection };
        updateActiveSourceLine(editor, content, nextSelection.end);
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

  function handleColorPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if ((event.target as Element).closest('.md-inline-color-trigger')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const trigger = (event.target as Element).closest<HTMLButtonElement>(
      '.md-inline-color-trigger',
    );
    if (!trigger) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || !onColorRequest) {
      return;
    }
    const line = trigger.closest<HTMLElement>('.md-line');
    const model = getSourceDocumentModel(event.currentTarget);
    const lineIndex = Number(line?.dataset.line) - 1;
    const localStart = Number(trigger.dataset.mdColorStart);
    const localEnd = Number(trigger.dataset.mdColorEnd);
    const kind = trigger.dataset.mdColorKind;
    if (
      !model ||
      !Number.isInteger(lineIndex) ||
      lineIndex < 0 ||
      !Number.isInteger(localStart) ||
      !Number.isInteger(localEnd) ||
      (kind !== 'text' && kind !== 'highlight')
    ) {
      return;
    }
    const bounds = trigger.getBoundingClientRect();
    const explicitColor = trigger.dataset.mdColorValue || null;
    const styles = getComputedStyle(trigger);
    const computed = styles.backgroundColor;
    const channels = computed.match(
      /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/,
    );
    const inheritedColor = [
      '--note-seed',
      '--preference-accent-color',
      '--color-accent',
    ]
      .map((property) => styles.getPropertyValue(property).trim())
      .find((candidate) => parseHexColor(candidate));
    const color =
      explicitColor ??
      inheritedColor ??
      (channels
        ? rgbToHex({
            red: Number(channels[1]),
            green: Number(channels[2]),
            blue: Number(channels[3]),
          })
        : null);
    const lineStart = model.lineStarts[lineIndex]!;
    onColorRequest({
      color,
      end: lineStart + localEnd,
      kind,
      position: { x: bounds.left, y: bounds.bottom + 5 },
      start: lineStart + localStart,
    });
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
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragOver={(event) => {
          if (
            !readOnly &&
            onImportFiles &&
            event.dataTransfer.types.includes('Files')
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          if (
            event.dataTransfer.types?.includes(MEDIA_ASSET_TRANSFER)
          ) {
            return;
          }
          const offset =
            sourceOffsetAtPoint(
              event.currentTarget,
              event.clientX,
              event.clientY,
            ) ?? stateRef.current.selection.end;
          if (
            !readOnly &&
            onImportFiles &&
            event.dataTransfer.files.length > 0
          ) {
            event.preventDefault();
            onImportFiles(Array.from(event.dataTransfer.files), offset);
          }
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handleColorPointerDown}
        onScroll={(event) => {
          scrollReporter.reportScroll(event.currentTarget.scrollTop);
          if (
            spellCheck &&
            largeSourceDocument
          ) {
            if (spellcheckScrollTimerRef.current !== undefined) {
              window.clearTimeout(spellcheckScrollTimerRef.current);
            }
            spellcheckScrollTimerRef.current = window.setTimeout(() => {
              spellcheckScrollTimerRef.current = undefined;
              setSpellcheckViewportRevision((current) => current + 1);
            }, SOURCE_SPELLCHECK_SCROLL_IDLE_MS);
          }
        }}
        onScrollEnd={(event) => {
          scrollReporter.reportScrollEnd(event.currentTarget.scrollTop);
          if (spellcheckScrollTimerRef.current !== undefined) {
            window.clearTimeout(spellcheckScrollTimerRef.current);
            spellcheckScrollTimerRef.current = undefined;
            setSpellcheckViewportRevision((current) => current + 1);
          }
        }}
        ref={editorRef}
        role="textbox"
        spellCheck={spellCheck}
        suppressContentEditableWarning
        tabIndex={0}
      />
      <ImageInteractionLayer
        editorRef={editorRef}
        onInsertMediaAsset={onInsertMediaAsset}
        onOperation={onImageOperation}
        onRevealAsset={onRevealMediaAsset}
        onSelectionChange={onSelectionChange}
        projectId={projectId}
        readOnly={readOnly}
        translate={translate}
      />
    </div>
  );
}
