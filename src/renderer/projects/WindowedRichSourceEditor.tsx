import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { FlyoffApi } from '../../shared/contracts';
import {
  parseImageDirective,
  serializeImageDirective,
} from '../../shared/markdown';
import { parseHexColor, rgbToHex } from '../components/color';
import {
  hasWorkspaceDrag,
  isWorkspaceDragActive,
} from '../components/tabs/workspace-drag';
import { useScrollPositionReporter } from '../hooks/use-scroll-position-reporter';
import {
  ImageInteractionLayer,
  type ImageSourceOperation,
} from './ImageInteractionLayer';
import {
  IMAGE_INSTANCE_TRANSFER,
  MEDIA_ASSET_TRANSFER,
} from './media-transfer';
import {
  normalizeSourceText,
  sourceTextFromTransfer,
} from './source-clipboard';
import {
  sourceOffsetAtPoint,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import { createSourceMenuRequest } from './source-context-actions';
import {
  installSourceMouseSelection,
  revealSourceSelectionAfterNavigation,
} from './source-interaction';
import {
  clearSourceSpellingErrors,
  clearSourceSpellingErrorsOutsideRange,
  collectSourceSpellcheckWordsFromLines,
  PERSONAL_DICTIONARY_CHANGED_EVENT,
  renderSourceSpellingErrors,
} from './source-spellcheck';
import {
  applyMarkdownTypingComposition,
  applyMarkdownTypingReplacement,
  resolveMarkdownTypingInput,
  type MarkdownTypingColor,
} from './source-typing-color';
import { WindowedSourceView } from './source-engine/windowed-source-view';
import { resolveSourceKeyboardNavigation } from './source-engine/source-keyboard-navigation';
import type { SourceInputMirror } from './source-engine/source-input-mirror';
import type {
  RichSourceEditorProps,
  SourceInlineColorRequest,
} from './RichSourceEditor';

interface WindowedCallbacks {
  onRedo: RichSourceEditorProps['onRedo'];
  onSelectionChange: RichSourceEditorProps['onSelectionChange'];
  onTransaction: RichSourceEditorProps['onTransaction'];
  onUndo: RichSourceEditorProps['onUndo'];
}

interface PendingInput {
  before: {
    content: string;
    selection: SourceSelection;
  };
  inputType: string;
  mirror: SourceInputMirror;
  timestamp: number;
}

interface ControlledSourceState {
  ariaLabel: string;
  nodeId: string;
  projectId?: string;
  readOnly: boolean;
  selection: SourceSelection;
  value: string;
  viewId?: string;
}

interface ControlledSourceIdentity {
  nodeId: string;
  projectId?: string;
  viewId?: string;
}

const SPELLCHECK_CACHE_MAX_ENTRIES = 16_384;

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

export function WindowedRichSourceEditor({
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
  const viewRef = useRef<WindowedSourceView | null>(null);
  const initialRef = useRef({ ariaLabel, readOnly, selection, value });
  const stateRef = useRef({ content: value, selection });
  const controlledRef = useRef<ControlledSourceState>({
    ariaLabel,
    nodeId,
    projectId,
    readOnly,
    selection,
    value,
    viewId,
  });
  const synchronizedIdentityRef = useRef<ControlledSourceIdentity>({
    nodeId,
    projectId,
    viewId,
  });
  const compositionControlledRef = useRef<
    ControlledSourceState | undefined
  >(undefined);
  const composingRef = useRef(false);
  const pendingRef = useRef<PendingInput | undefined>(undefined);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const suppressedInputRef = useRef<string | undefined>(undefined);
  const suppressedInputTimerRef = useRef<number | undefined>(undefined);
  const spellcheckTimerRef = useRef<number | undefined>(undefined);
  const spellcheckGenerationRef = useRef(0);
  const spellcheckCacheRef = useRef(new Map<string, boolean>());
  const callbacksRef = useRef<WindowedCallbacks>({
    onRedo,
    onSelectionChange,
    onTransaction,
    onUndo,
  });
  const readOnlyRef = useRef(readOnly);
  const typingColorRef = useRef<MarkdownTypingColor | null>(typingColor);
  const [spellcheckRevision, setSpellcheckRevision] = useState(0);
  const [viewportRevision, setViewportRevision] = useState(0);
  const scrollReporter = useScrollPositionReporter(onScroll);

  useEffect(() => {
    callbacksRef.current = {
      onRedo,
      onSelectionChange,
      onTransaction,
      onUndo,
    };
  }, [onRedo, onSelectionChange, onTransaction, onUndo]);

  useLayoutEffect(() => {
    const controlled = {
      ariaLabel,
      nodeId,
      projectId,
      readOnly,
      selection,
      value,
      viewId,
    };
    const compositionControlled = compositionControlledRef.current;
    controlledRef.current = controlled;
    readOnlyRef.current = readOnly;
    typingColorRef.current = typingColor;
    if (
      composingRef.current &&
      compositionControlled &&
      (value !== compositionControlled.value ||
        nodeId !== compositionControlled.nodeId ||
        projectId !== compositionControlled.projectId ||
        viewId !== compositionControlled.viewId)
    ) {
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
        compositionTimerRef.current = undefined;
      }
      composingRef.current = false;
      pendingRef.current = undefined;
      compositionControlledRef.current = undefined;
      viewRef.current?.cancelComposition();
    }
  }, [
    ariaLabel,
    nodeId,
    projectId,
    readOnly,
    selection,
    typingColor,
    value,
    viewId,
  ]);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const initial = initialRef.current;
    const view = new WindowedSourceView(root, {
      ariaLabel: initial.ariaLabel,
      readOnly: initial.readOnly,
      selection: initial.selection,
      source: initial.value,
    });
    viewRef.current = view;
    stateRef.current = {
      content: initial.value,
      selection: initial.selection,
    };

    const publishSelection = (nextSelection: SourceSelection): void => {
      if (sameSelection(stateRef.current.selection, nextSelection)) {
        return;
      }
      stateRef.current = {
        content: stateRef.current.content,
        selection: nextSelection,
      };
      callbacksRef.current.onSelectionChange(nextSelection);
    };

    const commit = (
      before: PendingInput['before'],
      content: string,
      nextSelection: SourceSelection,
      inputType: string,
      timestamp: number,
    ): void => {
      view.setSource(content, nextSelection, {
        nextSelection,
        previousSelection: before.selection,
      });
      view.revealOffset(
        nextSelection.direction === 'backward'
          ? nextSelection.start
          : nextSelection.end,
      );
      const after = { content, selection: nextSelection };
      stateRef.current = after;
      pendingRef.current = undefined;
      callbacksRef.current.onTransaction({
        after,
        before,
        inputType,
        timestamp,
      });
    };

    const commitReplacement = (
      inputType: string,
      inserted: string,
      applyTypingColor = true,
    ): void => {
      const before = {
        content: stateRef.current.content,
        selection: view.syncSelectionFromInput(),
      };
      const after = applyMarkdownTypingReplacement(
        before,
        inserted,
        applyTypingColor ? typingColorRef.current : null,
      );
      commit(
        before,
        after.content,
        after.selection,
        inputType,
        performance.now(),
      );
    };

    const suppressPairedInput = (inputType: string): void => {
      if (suppressedInputTimerRef.current !== undefined) {
        window.clearTimeout(suppressedInputTimerRef.current);
      }
      suppressedInputRef.current = inputType;
      suppressedInputTimerRef.current = window.setTimeout(() => {
        suppressedInputRef.current = undefined;
        suppressedInputTimerRef.current = undefined;
      }, 0);
    };

    const inputSelection = (): SourceSelection =>
      view.syncSelectionFromInput();

    const finishNativeInput = (inputType?: string): void => {
      if (composingRef.current) {
        return;
      }
      const before = pendingRef.current?.before ?? stateRef.current;
      const inputEdit = view.readInputEdit(
        before.content,
        pendingRef.current?.mirror ?? view.captureInputMirror(),
      );
      let after = {
        content: inputEdit.content,
        selection: inputEdit.selection,
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
        view.setSource(after.content, after.selection);
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
    };

    const handleBeforeInput = (event: InputEvent): void => {
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
            (event.dataTransfer && hasWorkspaceDrag(event.dataTransfer)))
        ) {
          return;
        }
        if (suppressedInputRef.current === event.inputType) {
          return;
        }
        const inserted = event.dataTransfer
          ? sourceTextFromTransfer(event.dataTransfer, root.ownerDocument)
          : normalizeSourceText(event.data ?? '');
        if (inserted) {
          commitReplacement(event.inputType, inserted);
          suppressPairedInput(event.inputType);
        }
        return;
      }

      const before = {
        content: stateRef.current.content,
        selection: view.syncSelectionFromInput(),
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
          view.writeSelection(resolved.selection);
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
        mirror: view.captureInputMirror(),
        timestamp: performance.now(),
      };
    };

    const handleInput = (event: InputEvent): void => {
      if (readOnlyRef.current) {
        view.setSource(
          stateRef.current.content,
          stateRef.current.selection,
        );
        return;
      }
      if (suppressedInputRef.current === event.inputType) {
        view.setSource(
          stateRef.current.content,
          stateRef.current.selection,
        );
        suppressedInputRef.current = undefined;
        return;
      }
      if (composingRef.current) {
        return;
      }
      finishNativeInput(event.inputType);
    };

    const handlePaste = (event: ClipboardEvent): void => {
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
        event.clipboardData.getData(IMAGE_INSTANCE_TRANSFER) ?? '',
      );
      const inserted = image
        ? serializeImageDirective({
            ...image,
            instanceId: crypto.randomUUID(),
          })
        : sourceTextFromTransfer(
            event.clipboardData,
            root.ownerDocument,
          );
      if (inserted) {
        commitReplacement('insertFromPaste', inserted, !image);
      }
      suppressPairedInput('insertFromPaste');
    };

    const handleCopy = (event: ClipboardEvent): void => {
      const selected = view.syncSelectionFromInput();
      if (selected.start === selected.end) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        stateRef.current.content.slice(selected.start, selected.end),
      );
    };

    const handleCut = (event: ClipboardEvent): void => {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      const before = {
        content: stateRef.current.content,
        selection: view.syncSelectionFromInput(),
      };
      if (before.selection.start === before.selection.end) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        before.content.slice(before.selection.start, before.selection.end),
      );
      const after = resolveMarkdownTypingInput(
        before,
        'deleteByCut',
        null,
        typingColorRef.current,
      );
      if (after) {
        commit(
          before,
          after.content,
          after.selection,
          'deleteByCut',
          performance.now(),
        );
      }
    };

    const handleDrop = (event: DragEvent): void => {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (!event.dataTransfer) {
        return;
      }
      if (
        isWorkspaceDragActive() ||
        hasWorkspaceDrag(event.dataTransfer)
      ) {
        event.preventDefault();
        return;
      }
      if (
        event.dataTransfer.types.includes(MEDIA_ASSET_TRANSFER) ||
        event.dataTransfer.types.includes('Files')
      ) {
        suppressPairedInput('insertFromDrop');
        return;
      }
      event.preventDefault();
      if (suppressedInputRef.current === 'insertFromDrop') {
        return;
      }
      const inserted = sourceTextFromTransfer(
        event.dataTransfer,
        root.ownerDocument,
      );
      if (inserted) {
        commitReplacement('insertFromDrop', inserted);
      }
      suppressPairedInput('insertFromDrop');
    };

    const handleCompositionStart = (event: CompositionEvent): void => {
      if (readOnlyRef.current) {
        event.preventDefault();
        return;
      }
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
      }
      composingRef.current = true;
      compositionControlledRef.current = {
        ...controlledRef.current,
        selection: { ...controlledRef.current.selection },
      };
      pendingRef.current = {
        before: {
          content: stateRef.current.content,
          selection: view.syncSelectionFromInput(),
        },
        inputType: 'insertCompositionText',
        mirror: view.captureInputMirror(),
        timestamp: performance.now(),
      };
    };

    const handleCompositionEnd = (): void => {
      if (
        !composingRef.current ||
        !compositionControlledRef.current
      ) {
        pendingRef.current = undefined;
        view.cancelComposition();
        return;
      }
      compositionTimerRef.current = window.setTimeout(() => {
        compositionTimerRef.current = undefined;
        const compositionControlled = compositionControlledRef.current;
        const controlled = controlledRef.current;
        compositionControlledRef.current = undefined;
        composingRef.current = false;
        view.setAriaLabel(controlled.ariaLabel);
        view.setReadOnly(controlled.readOnly);
        if (
          readOnlyRef.current ||
          !compositionControlled ||
          controlled.value !== compositionControlled.value ||
          controlled.nodeId !== compositionControlled.nodeId ||
          controlled.projectId !== compositionControlled.projectId ||
          controlled.viewId !== compositionControlled.viewId
        ) {
          pendingRef.current = undefined;
          view.setSource(controlled.value, controlled.selection);
          stateRef.current = {
            content: controlled.value,
            selection: controlled.selection,
          };
          return;
        }
        finishNativeInput('insertCompositionText');
        if (
          !sameSelection(
            controlled.selection,
            compositionControlled.selection,
          )
        ) {
          view.setSource(
            stateRef.current.content,
            controlled.selection,
          );
          stateRef.current = {
            content: stateRef.current.content,
            selection: controlled.selection,
          };
        }
      }, 0);
    };

    const handleSelectionChange = (): void => {
      if (
        composingRef.current ||
        root.ownerDocument.activeElement !== view.input
      ) {
        return;
      }
      publishSelection(inputSelection());
    };

    const removeMouseSelection = installSourceMouseSelection(root, {
      getContent: () => stateRef.current.content,
      getSelection: () => view.readSelection(),
      isComposing: () => composingRef.current,
      onSelectionChange: (content, nextSelection) => {
        if (
          stateRef.current.content === content &&
          sameSelection(stateRef.current.selection, nextSelection)
        ) {
          return;
        }
        stateRef.current = { content, selection: nextSelection };
        callbacksRef.current.onSelectionChange(nextSelection);
      },
    });

    view.input.addEventListener('beforeinput', handleBeforeInput);
    view.input.addEventListener('input', handleInput);
    view.input.addEventListener('paste', handlePaste);
    view.input.addEventListener('copy', handleCopy);
    view.input.addEventListener('cut', handleCut);
    view.input.addEventListener('select', handleSelectionChange);
    view.input.addEventListener('compositionstart', handleCompositionStart);
    view.input.addEventListener('compositionend', handleCompositionEnd);
    root.addEventListener('drop', handleDrop);
    root.ownerDocument.addEventListener(
      'selectionchange',
      handleSelectionChange,
    );

    return () => {
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
      }
      if (suppressedInputTimerRef.current !== undefined) {
        window.clearTimeout(suppressedInputTimerRef.current);
      }
      view.input.removeEventListener('beforeinput', handleBeforeInput);
      view.input.removeEventListener('input', handleInput);
      view.input.removeEventListener('paste', handlePaste);
      view.input.removeEventListener('copy', handleCopy);
      view.input.removeEventListener('cut', handleCut);
      view.input.removeEventListener('select', handleSelectionChange);
      view.input.removeEventListener(
        'compositionstart',
        handleCompositionStart,
      );
      view.input.removeEventListener(
        'compositionend',
        handleCompositionEnd,
      );
      root.removeEventListener('drop', handleDrop);
      root.ownerDocument.removeEventListener(
        'selectionchange',
        handleSelectionChange,
      );
      removeMouseSelection();
      clearSourceSpellingErrors(root);
      view.dispose();
      viewRef.current = null;
    };
  }, [editorRef]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.setAriaLabel(ariaLabel);
    view.setReadOnly(readOnly);
    if (composingRef.current) {
      return;
    }
    const focused =
      view.input.ownerDocument.activeElement === view.input;
    const synchronizedIdentity = synchronizedIdentityRef.current;
    const sameIdentity =
      synchronizedIdentity.nodeId === nodeId &&
      synchronizedIdentity.projectId === projectId &&
      synchronizedIdentity.viewId === viewId;
    const nextSelection =
      focused && sameIdentity && stateRef.current.content === value
        ? stateRef.current.selection
        : selection;
    if (
      view.getModel().source !== value ||
      ((!focused || !sameIdentity) &&
        !sameSelection(view.readSelection(), nextSelection))
    ) {
      view.setSource(value, nextSelection);
    }
    stateRef.current = { content: value, selection: nextSelection };
    synchronizedIdentityRef.current = { nodeId, projectId, viewId };
  }, [
    ariaLabel,
    nodeId,
    projectId,
    readOnly,
    selection,
    value,
    viewId,
  ]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    for (const trigger of root.querySelectorAll<HTMLButtonElement>(
      '.md-inline-color-trigger',
    )) {
      if (inlineColorLabel) {
        trigger.setAttribute('aria-label', inlineColorLabel);
        trigger.dataset.flyoffTooltip = inlineColorLabel;
        trigger.dataset.flyoffTooltipPlacement = 'top';
      } else {
        trigger.removeAttribute('aria-label');
        delete trigger.dataset.flyoffTooltip;
      }
      trigger.ariaDisabled = String(readOnly);
    }
  }, [editorRef, inlineColorLabel, readOnly, value, viewportRevision]);

  useEffect(() => {
    const refresh = () => {
      spellcheckGenerationRef.current += 1;
      spellcheckCacheRef.current.clear();
      setSpellcheckRevision((current) => current + 1);
    };
    window.addEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    spellcheckGenerationRef.current += 1;
    spellcheckCacheRef.current.clear();
    const root = editorRef.current;
    if (root) {
      clearSourceSpellingErrors(root);
    }
  }, [editorRef, nodeId, projectId, spellcheckScope]);

  useEffect(() => {
    const view = viewRef.current;
    const root = editorRef.current;
    const checkWords = (window.flyoff as Partial<FlyoffApi> | undefined)
      ?.checkSpellcheckWords;
    const generation = ++spellcheckGenerationRef.current;
    if (!view || !root || !spellCheck || !checkWords) {
      if (root) {
        clearSourceSpellingErrors(root);
      }
      return;
    }
    const timeout = window.setTimeout(() => {
      const model = view.getModel();
      if (model.source !== value) {
        return;
      }
      const visible = view.getVisibleLineElements();
      if (visible.length === 0) {
        return;
      }
      const indexes = visible
        .map((line) => Number(line.dataset.line) - 1)
        .filter((index) => Number.isInteger(index) && index >= 0);
      const startLine = Math.max(0, Math.min(...indexes));
      const endLine = Math.min(
        model.lines.length,
        Math.max(...indexes) + 1,
      );
      const range = { endLine, startLine };
      const words = collectSourceSpellcheckWordsFromLines(
        model.lines.slice(startLine, endLine),
        checkCodeBlocks,
      );
      const unknown = words.filter(
        (word) => !spellcheckCacheRef.current.has(word),
      );
      const batches: string[][] = [];
      for (let index = 0; index < unknown.length; index += 1_024) {
        batches.push(unknown.slice(index, index + 1_024));
      }
      void Promise.all(
        batches.map((batch) => checkWords({ words: batch })),
      )
        .then((results) => {
          if (
            generation !== spellcheckGenerationRef.current ||
            viewRef.current !== view
          ) {
            return;
          }
          const misspelled = new Set(results.flat());
          const resolved = new Map<string, boolean>();
          for (const word of unknown) {
            const isMisspelled = misspelled.has(word);
            resolved.set(word, isMisspelled);
            spellcheckCacheRef.current.set(word, isMisspelled);
          }
          while (
            spellcheckCacheRef.current.size >
            SPELLCHECK_CACHE_MAX_ENTRIES
          ) {
            const oldest = spellcheckCacheRef.current.keys().next().value;
            if (oldest === undefined) {
              break;
            }
            spellcheckCacheRef.current.delete(oldest);
          }
          clearSourceSpellingErrorsOutsideRange(root, range);
          renderSourceSpellingErrors(
            root,
            words.filter(
              (word) =>
                resolved.get(word) ??
                spellcheckCacheRef.current.get(word) === true,
            ),
            checkCodeBlocks,
            range,
          );
        })
        .catch(() => {
          if (
            generation === spellcheckGenerationRef.current &&
            viewRef.current === view
          ) {
            clearSourceSpellingErrors(root, range);
          }
        });
    }, viewportRevision > 0 ? 40 : 160);
    return () => window.clearTimeout(timeout);
  }, [
    checkCodeBlocks,
    editorRef,
    nodeId,
    projectId,
    spellCheck,
    spellcheckRevision,
    spellcheckScope,
    value,
    viewportRevision,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (autoFocus && view) {
      view.focus();
      view.writeSelection(stateRef.current.selection, { reveal: false });
    }
  }, [autoFocus]);

  useEffect(
    () => () => {
      if (spellcheckTimerRef.current !== undefined) {
        window.clearTimeout(spellcheckTimerRef.current);
      }
    },
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }
    const lineHeight =
      Number.parseFloat(getComputedStyle(event.currentTarget).lineHeight) ||
      24;
    const nextSelection = resolveSourceKeyboardNavigation(
      stateRef.current.content,
      viewRef.current?.readSelection() ?? stateRef.current.selection,
      {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        pageLineCount: Math.max(
          1,
          Math.floor(event.currentTarget.clientHeight / lineHeight),
        ),
        platform:
          event.currentTarget.ownerDocument.documentElement.dataset.platform,
        shiftKey: event.shiftKey,
      },
    );
    if (nextSelection) {
      event.preventDefault();
      writeSelection(event.currentTarget, nextSelection);
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
    const model = viewRef.current?.getModel();
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
    const channels = styles.backgroundColor.match(
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
    } satisfies SourceInlineColorRequest);
  }

  function refreshSpellcheckViewport(): void {
    if (!spellCheck) {
      return;
    }
    if (spellcheckTimerRef.current !== undefined) {
      window.clearTimeout(spellcheckTimerRef.current);
    }
    spellcheckTimerRef.current = window.setTimeout(() => {
      spellcheckTimerRef.current = undefined;
      setViewportRevision((current) => current + 1);
    }, 100);
  }

  return (
    <div className="markdown-source">
      <div
        aria-label={ariaLabel}
        className="markdown-source__editor"
        data-inline-color-label={inlineColorLabel}
        data-markdown-node-id={nodeId}
        data-markdown-view-id={viewId}
        data-read-only={String(readOnly)}
        data-spellcheck-code-blocks={String(checkCodeBlocks)}
        data-spellcheck-enabled="false"
        data-windowed="true"
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
          refreshSpellcheckViewport();
        }}
        onScrollEnd={(event) => {
          scrollReporter.reportScrollEnd(event.currentTarget.scrollTop);
          refreshSpellcheckViewport();
        }}
        ref={editorRef}
        tabIndex={0}
      />
      <ImageInteractionLayer
        editorRef={editorRef}
        onInsertMediaAsset={onInsertMediaAsset}
        onOperation={onImageOperation as
          | ((operation: ImageSourceOperation) => void)
          | undefined}
        onRevealAsset={onRevealMediaAsset}
        onSelectionChange={onSelectionChange}
        projectId={projectId}
        readOnly={readOnly}
        translate={translate}
      />
    </div>
  );
}
