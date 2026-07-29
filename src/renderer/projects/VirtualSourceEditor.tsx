import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type UIEvent,
} from "react";

import type { RichSourceEditorProps } from "./RichSourceEditor";
import type { FlyoffApi } from "../../shared/contracts";
import { useScrollPositionReporter } from "../hooks/use-scroll-position-reporter";
import { parseHexColor, rgbToHex } from "../components/color";
import {
  parseImageDirective,
  serializeImageDirective,
} from "../../shared/markdown";
import { ImageInteractionLayer } from "./ImageInteractionLayer";
import {
  registerSourceCaretAdapter,
  sourceCaretRectInLine,
  type SourceSelection,
} from "./source-caret";
import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  updateSourceDocumentModel,
  type SourceDocumentModel,
  type SourceTextChange,
} from "./source-document-model";
import {
  sourceLineClassName,
  type HighlightedSourceLine,
} from "./markdown-highlight";
import {
  applyMarkdownTypingComposition,
  applyMarkdownTypingReplacement,
  resolveMarkdownTypingInput,
} from "./source-typing-color";
import {
  normalizeSourceText,
  sourceTextFromTransfer,
} from "./source-clipboard";
import {
  sourceLineColumn,
  sourceOffsetInLine,
  sourceSelectionAnchor,
  sourceSelectionFocus,
  VIRTUAL_SOURCE_OVERSCAN_LINES,
  type SourceViewportRange,
} from "./source-viewport";
import { createSourceMenuRequest } from "./source-context-actions";
import {
  IMAGE_INSTANCE_TRANSFER,
  MEDIA_ASSET_TRANSFER,
} from "./media-transfer";
import {
  hasWorkspaceDrag,
  isWorkspaceDragActive,
} from "../components/tabs/workspace-drag";
import {
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from "./source-grapheme";
import {
  nextSourceWordEndBoundary,
  nextSourceWordStartBoundary,
  previousSourceWordNavigationBoundary,
} from "./source-input";
import {
  clearSourceSpellingErrorsOutsideRange,
  clearSourceSpellingErrors,
  collectSourceSpellcheckWordsFromLines,
  PERSONAL_DICTIONARY_CHANGED_EVENT,
  renderSourceSpellingErrors,
} from "./source-spellcheck";
import { SOURCE_SPELLCHECK_IDLE_MS } from "./editor-performance";
import {
  expandDoubleClickSelection,
  expandTripleClickSelection,
} from "./source-word-selection";
import {
  boundedVirtualSourceRange,
  clampVirtualSourceSelection,
  maximumVirtualSourceLineLength,
  measureVirtualSourceLineHeight,
  virtualSourceChange,
  virtualSourceOffsetFromPoint,
  virtualSourceSelectionDirection,
  VIRTUAL_SOURCE_DEFAULT_LINE_HEIGHT,
  VIRTUAL_SOURCE_INITIAL_RENDERED_LINES,
} from "./virtual-source-engine";
import {
  VirtualSourceLayout,
  type VirtualSourceFloatIntrusion,
  type VirtualSourceLayoutConfig,
} from "./virtual-source-layout";

import "./virtual-source-editor.css";

interface ProxySelectionSync {
  end: number;
  start: number;
  value: string;
}

function compositionReplacementText(before: string, after: string): string {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return after.slice(prefix, after.length - suffix);
}

function inlineColorHtml(
  html: string,
  label: string | undefined,
  readOnly: boolean,
): string {
  if (!html.includes("md-inline-color-trigger")) {
    return html;
  }
  const escapedLabel = label
    ?.replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const accessibility = escapedLabel
    ? ` aria-disabled="${String(readOnly)}" aria-label="${escapedLabel}" data-flyoff-tooltip="${escapedLabel}" data-flyoff-tooltip-placement="top"`
    : ` aria-disabled="${String(readOnly)}"`;
  return html.replaceAll(
    '<button class="md-inline-color-trigger"',
    `<button${accessibility} class="md-inline-color-trigger"`,
  );
}

function virtualSourceLineHtml(
  html: string,
  intrusions: readonly VirtualSourceFloatIntrusion[],
): string {
  const source = html || "<br data-md-placeholder>";
  if (intrusions.length === 0) {
    return source;
  }
  return (
    intrusions
      .map(
        (intrusion) =>
          `<span aria-hidden="true" class="virtual-source__float-intrusion" data-md-decoration data-virtual-float-align="${intrusion.align}" style="--virtual-float-height:${intrusion.height}px;--virtual-float-top:${intrusion.top}px;--virtual-float-width:${intrusion.width}px"></span>`,
      )
      .join("") + source
  );
}

interface VirtualSourceRowsProps {
  highlightedLine: number;
  layout: VirtualSourceLayout;
  layoutRevision: number;
  renderedLines: readonly {
    html: string;
    index: number;
    line: HighlightedSourceLine;
  }[];
  selectedEndLine: number;
  selectedStartLine: number;
  selectionVisible: boolean;
}

const VirtualSourceRows = memo(function VirtualSourceRows({
  highlightedLine,
  layout,
  renderedLines,
  selectedEndLine,
  selectedStartLine,
  selectionVisible,
}: VirtualSourceRowsProps) {
  return (
    <div aria-hidden="true" className="virtual-source__rows">
      {renderedLines.map(({ html, index, line }) => {
        const wrapPlacement = layout.wrapPlacementAt(index);
        return (
          <span
            className={[
              sourceLineClassName(line),
              index === highlightedLine ? "md-line--active" : "",
              selectionVisible &&
              index >= selectedStartLine &&
              index <= selectedEndLine
                ? "md-line--selected"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-line={index + 1}
            data-virtual-wrap-image={wrapPlacement?.align}
            key={`${index}:${line.key}`}
            style={
              {
                "--virtual-wrap-inset": `${wrapPlacement?.inset ?? 0}px`,
                "--virtual-wrap-top": `${wrapPlacement?.top ?? 0}px`,
                height: layout.visualHeightAt(index),
                transform: `translateY(${layout.lineTop(index)}px)`,
              } as React.CSSProperties
            }
          >
            <span
              aria-hidden="true"
              className="md-line__gutter"
              data-md-gutter=""
            >
              {index + 1}
            </span>
            <span
              className="md-line__content"
              dangerouslySetInnerHTML={{
                __html: virtualSourceLineHtml(
                  html,
                  wrapPlacement ? [] : layout.floatIntrusionsAt(index),
                ),
              }}
            />
          </span>
        );
      })}
    </div>
  );
});

export function VirtualSourceEditor({
  active: pageActive = true,
  activeOffset,
  ariaLabel,
  autoFocus = false,
  editorRef,
  nodeId,
  readOnly = false,
  spellCheck = false,
  checkCodeBlocks = false,
  inlineColorLabel,
  onContextMenuRequest,
  onColorRequest,
  onImportFiles,
  onInsertMediaAsset,
  onImageOperation,
  onKeyDown,
  onRedo,
  onRevealMediaAsset,
  onScroll,
  onSelectionChange,
  onTransaction,
  onUndo,
  projectId,
  selection: externalSelection,
  spellcheckScope = "",
  typingColor = null,
  translate,
  value,
  viewId,
}: RichSourceEditorProps) {
  const [model, setModel] = useState(() => createSourceDocumentModel(value));
  const [selection, setSelection] = useState(() =>
    clampVirtualSourceSelection(externalSelection, value.length),
  );
  const [lineHeight, setLineHeight] = useState(
    VIRTUAL_SOURCE_DEFAULT_LINE_HEIGHT,
  );
  const [layout] = useState(
    () =>
      new VirtualSourceLayout(model, {
        characterWidth: 8,
        contentWidth: 800,
        lineHeight: VIRTUAL_SOURCE_DEFAULT_LINE_HEIGHT,
        tabSize: 2,
        wrap: true,
      }),
  );
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [spellcheckRevision, setSpellcheckRevision] = useState(0);
  const [wrapLines, setWrapLines] = useState(true);
  const [viewport, setViewport] = useState<SourceViewportRange>({
    endLine: Math.min(
      VIRTUAL_SOURCE_INITIAL_RENDERED_LINES,
      model.lines.length,
    ),
    startLine: 0,
  });
  const [maximumColumns, setMaximumColumns] = useState(() =>
    maximumVirtualSourceLineLength(model),
  );
  const scrollReporter = useScrollPositionReporter(onScroll);
  const maximumColumnsRef = useRef(maximumColumns);
  const proxyRef = useRef<HTMLTextAreaElement>(null);
  const proxySelectionSyncRef = useRef<ProxySelectionSync | undefined>(
    undefined,
  );
  const beforeInputHandlerRef = useRef<(event: InputEvent) => void>(
    () => undefined,
  );
  const proxySyncGenerationRef = useRef(0);
  const synchronizingProxyRef = useRef(false);
  const modelRef = useRef(model);
  const selectionRef = useRef(selection);
  const readOnlyRef = useRef(readOnly);
  const verticalColumnRef = useRef<number | undefined>(undefined);
  const composingRef = useRef(false);
  const compositionRef = useRef<
    | {
        before: { content: string; selection: SourceSelection };
        lineIndex: number;
        lineSource: string;
        lineStart: number;
        proxyValue: string;
        spansLines: boolean;
      }
    | undefined
  >(undefined);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const measurementFrameRef = useRef<number | undefined>(undefined);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const pendingScrollTopRef = useRef<number | undefined>(undefined);
  const selectionDragCleanupRef = useRef<() => void>(() => undefined);
  const spellcheckCacheRef = useRef(new Map<string, boolean>());
  const spellcheckGenerationRef = useRef(0);
  const spellcheckScopeRef = useRef<string | undefined>(undefined);

  const focusPosition = sourceLineColumn(
    model,
    sourceSelectionFocus(selection),
  );
  const activeLine = focusPosition.lineIndex;
  const highlightedLine = sourceLineIndexAtOffset(
    model,
    activeOffset ?? sourceSelectionFocus(selection),
  );
  const activeLineStart = model.lineStarts[activeLine] ?? 0;
  const activeLineValue = model.lines[activeLine]?.source ?? "";

  const synchronizeProxyState = useCallback(
    (
      proxy: HTMLTextAreaElement,
      value: string,
      start: number,
      end: number,
      direction: SourceSelection["direction"],
    ): void => {
      const generation = proxySyncGenerationRef.current + 1;
      proxySyncGenerationRef.current = generation;
      proxySelectionSyncRef.current = { end, start, value };
      synchronizingProxyRef.current = true;
      if (proxy.value !== value) {
        proxy.value = value;
      }
      proxy.setSelectionRange(start, end, direction);
      queueMicrotask(() => {
        if (proxySyncGenerationRef.current !== generation) {
          return;
        }
        if (
          proxy.isConnected &&
          !composingRef.current &&
          proxy.value === value
        ) {
          proxy.setSelectionRange(start, end, direction);
        }
        synchronizingProxyRef.current = false;
      });
    },
    [],
  );

  const synchronizeProxyToModel = useCallback(
    (proxy: HTMLTextAreaElement): void => {
      const currentModel = modelRef.current;
      const currentSelection = selectionRef.current;
      const focus = sourceLineColumn(
        currentModel,
        sourceSelectionFocus(currentSelection),
      );
      const start = sourceLineColumn(currentModel, currentSelection.start);
      const end = sourceLineColumn(currentModel, currentSelection.end);
      const value = currentModel.lines[focus.lineIndex]?.source ?? "";
      const localStart =
        start.lineIndex === focus.lineIndex && end.lineIndex === focus.lineIndex
          ? start.column
          : focus.column;
      const localEnd =
        start.lineIndex === focus.lineIndex && end.lineIndex === focus.lineIndex
          ? end.column
          : focus.column;
      const direction =
        localStart === localEnd ? "none" : currentSelection.direction;
      synchronizeProxyState(proxy, value, localStart, localEnd, direction);
    },
    [synchronizeProxyState],
  );

  const updateViewport = useCallback(
    (root: HTMLDivElement): void => {
      const next = boundedVirtualSourceRange(
        layout.viewportRange(
          root.scrollTop,
          root.clientHeight,
          VIRTUAL_SOURCE_OVERSCAN_LINES,
        ),
      );
      setViewport((current) =>
        current.startLine === next.startLine && current.endLine === next.endLine
          ? current
          : next,
      );
    },
    [layout],
  );

  function layoutConfiguration(
    root: HTMLDivElement,
    measuredLineHeight: number,
  ): VirtualSourceLayoutConfig {
    const styles = getComputedStyle(root);
    const fontSize = Number.parseFloat(styles.fontSize) || 14;
    const content = root.querySelector<HTMLElement>(".md-line__content");
    const contentWidth =
      content?.getBoundingClientRect().width ||
      (root.clientWidth > 0
        ? Math.max(
            96,
            root.clientWidth -
              fontSize *
                (Number(
                  root.style.getPropertyValue("--md-line-number-digits"),
                ) +
                  4),
          )
        : 800);
    return {
      characterWidth: Math.max(1, fontSize * 0.58),
      contentWidth,
      lineHeight: measuredLineHeight,
      tabSize: Math.max(1, Number.parseInt(styles.tabSize, 10) || 2),
      wrap:
        root.closest<HTMLElement>(".markdown-editor")?.dataset.wrap !== "false",
    };
  }

  const preserveViewport = useCallback(
    (root: HTMLDivElement | null, update: () => void): void => {
      const anchor = root ? layout.lineAtOffset(root.scrollTop) : 0;
      const within = root ? root.scrollTop - layout.lineTop(anchor) : 0;
      update();
      if (root) {
        const nextScrollTop =
          layout.lineTop(Math.min(anchor, Math.max(0, layout.lineCount - 1))) +
          within;
        root.scrollTop = nextScrollTop;
        pendingScrollTopRef.current = nextScrollTop;
      }
    },
    [layout],
  );

  const updateLayoutModel = useCallback(
    (
      previousModel: SourceDocumentModel,
      nextModel: SourceDocumentModel,
      change: SourceTextChange | undefined,
    ): void => {
      const root = editorRef.current;
      const anchor = root ? layout.lineAtOffset(root.scrollTop) : 0;
      const within = root ? root.scrollTop - layout.lineTop(anchor) : 0;
      layout.updateModel(previousModel, nextModel, change);
      if (root) {
        let nextAnchor = anchor;
        if (!change && nextModel.lines.length !== previousModel.lines.length) {
          const delta = nextModel.lines.length - previousModel.lines.length;
          if (anchor >= nextModel.change.endLine - delta) {
            nextAnchor = anchor + delta;
          }
        } else if (change) {
          const anchorOffset = previousModel.lineStarts[anchor] ?? 0;
          const mappedOffset =
            anchorOffset <= change.from
              ? anchorOffset
              : anchorOffset >= change.to
                ? anchorOffset +
                  change.insert.length -
                  (change.to - change.from)
                : change.from + change.insert.length;
          nextAnchor = sourceLineIndexAtOffset(nextModel, mappedOffset);
        }
        const nextScrollTop =
          layout.lineTop(
            Math.min(Math.max(0, nextAnchor), layout.lineCount - 1),
          ) + within;
        root.scrollTop = nextScrollTop;
        pendingScrollTopRef.current = nextScrollTop;
      }
      setLayoutRevision((current) => current + 1);
    },
    [editorRef, layout],
  );

  function revealOffset(offset: number): void {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const line = sourceLineIndexAtOffset(modelRef.current, offset);
    const top = layout.lineTop(line);
    const height = layout.heightAt(line);
    if (top < root.scrollTop) {
      root.scrollTop = top;
    } else if (top + height > root.scrollTop + root.clientHeight) {
      root.scrollTop = top + height - root.clientHeight;
    }
    updateViewport(root);
  }

  function applySelection(
    next: SourceSelection,
    publish: boolean,
    reveal = true,
    preserveVerticalColumn = false,
  ): void {
    if (!preserveVerticalColumn) {
      verticalColumnRef.current = undefined;
    }
    const normalized = clampVirtualSourceSelection(
      next,
      modelRef.current.source.length,
    );
    const current = selectionRef.current;
    if (
      current.start === normalized.start &&
      current.end === normalized.end &&
      current.direction === normalized.direction
    ) {
      if (reveal) {
        revealOffset(sourceSelectionFocus(normalized));
      }
      return;
    }
    selectionRef.current = normalized;
    setSelection(normalized);
    if (reveal) {
      revealOffset(sourceSelectionFocus(normalized));
    }
    if (publish) {
      onSelectionChange(normalized);
    }
  }

  function updateMaximumColumns(
    previousModel: SourceDocumentModel,
    nextModel: SourceDocumentModel,
    change: SourceTextChange | undefined,
  ): void {
    const currentMaximum = maximumColumnsRef.current;
    let nextMaximum = currentMaximum;
    if (!change) {
      nextMaximum = maximumVirtualSourceLineLength(nextModel);
    } else {
      const changedMaximum = maximumVirtualSourceLineLength(
        nextModel,
        nextModel.change.startLine,
        nextModel.change.endLine,
      );
      if (changedMaximum >= currentMaximum) {
        nextMaximum = changedMaximum;
      } else {
        const oldStart = sourceLineIndexAtOffset(previousModel, change.from);
        const oldEnd = sourceLineIndexAtOffset(previousModel, change.to);
        let touchedMaximum = false;
        for (let index = oldStart; index <= oldEnd; index += 1) {
          if (
            (previousModel.lines[index]?.source.length ?? 0) >= currentMaximum
          ) {
            touchedMaximum = true;
            break;
          }
        }
        if (touchedMaximum) {
          nextMaximum = maximumVirtualSourceLineLength(nextModel);
        }
      }
    }
    maximumColumnsRef.current = nextMaximum;
    setMaximumColumns((current) =>
      current === nextMaximum ? current : nextMaximum,
    );
  }

  function commit(
    before: { content: string; selection: SourceSelection },
    after: { content: string; selection: SourceSelection },
    inputType: string,
    timestamp = performance.now(),
  ): void {
    const change = virtualSourceChange(
      before.content,
      after.content,
      before.selection,
      after.selection,
    );
    const previousModel = modelRef.current;
    const nextModel = updateSourceDocumentModel(
      previousModel,
      after.content,
      change,
    );
    modelRef.current = nextModel;
    applySelection(after.selection, false, false);
    updateMaximumColumns(previousModel, nextModel, change);
    updateLayoutModel(previousModel, nextModel, change);
    setModel(nextModel);
    revealOffset(sourceSelectionFocus(after.selection));
    const proxy = proxyRef.current;
    if (proxy && !composingRef.current) {
      synchronizeProxyToModel(proxy);
    }
    onTransaction({
      after,
      before,
      change,
      inputType,
      timestamp,
    });
  }

  function replaceSelection(
    inputType: string,
    inserted: string,
    applyTypingColor = true,
  ): void {
    const before = {
      content: modelRef.current.source,
      selection: selectionRef.current,
    };
    const after = applyMarkdownTypingReplacement(
      before,
      normalizeSourceText(inserted),
      applyTypingColor ? typingColor : null,
    );
    if (after.content !== before.content) {
      commit(before, after, inputType);
    }
  }

  useEffect(() => {
    const nextSelection = clampVirtualSourceSelection(
      externalSelection,
      value.length,
    );
    if (value !== modelRef.current.source) {
      verticalColumnRef.current = undefined;
      const previous = modelRef.current;
      const next = updateSourceDocumentModel(previous, value);
      updateLayoutModel(previous, next, undefined);
      modelRef.current = next;
      setModel(next);
      const nextMaximum = maximumVirtualSourceLineLength(next);
      maximumColumnsRef.current = nextMaximum;
      setMaximumColumns(nextMaximum);
    }
    if (!composingRef.current) {
      const current = selectionRef.current;
      if (
        current.start !== nextSelection.start ||
        current.end !== nextSelection.end ||
        current.direction !== nextSelection.direction
      ) {
        verticalColumnRef.current = undefined;
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
      }
    }
  }, [externalSelection, updateLayoutModel, value]);

  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
    if (!readOnly) {
      return;
    }
    composingRef.current = false;
    compositionRef.current = undefined;
    const proxy = proxyRef.current;
    if (proxy) {
      delete proxy.dataset.composing;
      synchronizeProxyToModel(proxy);
    }
  }, [readOnly, synchronizeProxyToModel]);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const synchronize = (): void => {
      const measured = measureVirtualSourceLineHeight(root);
      setLineHeight((current) => (current === measured ? current : measured));
      const config = layoutConfiguration(root, measured);
      let changed = false;
      preserveViewport(root, () => {
        changed = layout.reconfigure(modelRef.current, config);
      });
      if (changed) {
        setWrapLines(config.wrap);
        setLayoutRevision((current) => current + 1);
      }
      updateViewport(root);
    };
    synchronize();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const schedule = (): void => {
      if (resizeFrameRef.current !== undefined) {
        return;
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = undefined;
        synchronize();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== undefined) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = undefined;
      }
    };
  }, [editorRef, layout, preserveViewport, updateViewport]);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const measured = measureVirtualSourceLineHeight(root);
    const config = layoutConfiguration(root, measured);
    let changed = false;
    preserveViewport(root, () => {
      changed = layout.reconfigure(model, config);
    });
    if (changed) {
      setWrapLines(config.wrap);
      setLayoutRevision((current) => current + 1);
    }
    if (pendingScrollTopRef.current !== undefined) {
      root.scrollTop = pendingScrollTopRef.current;
      pendingScrollTopRef.current = undefined;
    }
    updateViewport(root);
  }, [editorRef, layout, model, preserveViewport, updateViewport]);

  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy || composingRef.current) {
      return;
    }
    const start = sourceLineColumn(model, selection.start);
    const end = sourceLineColumn(model, selection.end);
    const focus = sourceSelectionFocus(selection);
    const focusColumn = sourceLineColumn(model, focus).column;
    const localStart =
      start.lineIndex === activeLine && end.lineIndex === activeLine
        ? start.column
        : focusColumn;
    const localEnd =
      start.lineIndex === activeLine && end.lineIndex === activeLine
        ? end.column
        : focusColumn;
    const localDirection =
      localStart === localEnd ? "none" : selection.direction;
    const requiresValue = proxy.value !== activeLineValue;
    const requiresSelection =
      proxy.selectionStart !== localStart ||
      proxy.selectionEnd !== localEnd ||
      proxy.selectionDirection !== localDirection;
    if (requiresValue || requiresSelection) {
      synchronizeProxyState(
        proxy,
        activeLineValue,
        localStart,
        localEnd,
        localDirection,
      );
    }
  }, [
    activeLine,
    activeLineValue,
    model,
    selection,
    synchronizeProxyState,
  ]);

  useEffect(() => {
    const root = editorRef.current;
    const proxy = proxyRef.current;
    if (!root || !proxy) {
      return;
    }
    return registerSourceCaretAdapter(root, {
      focus: (options) => proxy.focus(options),
      readSelection: () => selectionRef.current,
      readSource: () => modelRef.current.source,
      sourceDocumentModel: () => modelRef.current,
      sourceCaretRect: (target) => {
        const position = sourceLineColumn(modelRef.current, target);
        const renderedLine = root.querySelector<HTMLElement>(
          `.virtual-source__rows > [data-line="${position.lineIndex + 1}"]`,
        );
        const renderedRect = renderedLine
          ? sourceCaretRectInLine(renderedLine, position.column)
          : undefined;
        if (renderedRect) {
          return renderedRect;
        }
        const bounds = root.getBoundingClientRect();
        const fontSize =
          Number.parseFloat(getComputedStyle(root).fontSize) || 14;
        return new DOMRect(
          bounds.left +
            fontSize * (position.column * 0.58 + 5) -
            root.scrollLeft,
          bounds.top + layout.lineTop(position.lineIndex) - root.scrollTop,
          1,
          lineHeight,
        );
      },
      sourceOffsetAtPoint: (x, y) =>
        virtualSourceOffsetFromPoint(
          root,
          modelRef.current,
          x,
          y,
          lineHeight,
          layout,
        ),
      writeSelection: (next) => applySelection(next, false),
    });
  });

  useEffect(() => {
    if (autoFocus) {
      proxyRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  useEffect(() => {
    const refresh = (): void => {
      spellcheckCacheRef.current.clear();
      setSpellcheckRevision((current) => current + 1);
    };
    window.addEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(PERSONAL_DICTIONARY_CHANGED_EVENT, refresh);
  }, []);

  useEffect(
    () => () => {
      selectionDragCleanupRef.current();
      if (compositionTimerRef.current !== undefined) {
        window.clearTimeout(compositionTimerRef.current);
      }
      if (scrollFrameRef.current !== undefined) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      if (measurementFrameRef.current !== undefined) {
        cancelAnimationFrame(measurementFrameRef.current);
      }
      if (resizeFrameRef.current !== undefined) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  const renderedLines = useMemo(
    () =>
      model.lines
        .slice(viewport.startLine, viewport.endLine)
        .map((line, offset) => ({
          html: inlineColorHtml(line.html, inlineColorLabel, readOnly),
          index: viewport.startLine + offset,
          line,
        })),
    [inlineColorLabel, model, readOnly, viewport],
  );

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
    if (spellcheckScopeRef.current !== scope) {
      spellcheckCacheRef.current.clear();
      spellcheckScopeRef.current = scope;
    }
    const range = {
      endLine: viewport.endLine,
      startLine: viewport.startLine,
    };
    const timeout = window.setTimeout(() => {
      const current = modelRef.current;
      if (current.source !== value) {
        return;
      }
      clearSourceSpellingErrorsOutsideRange(root, range);
      const words = collectSourceSpellcheckWordsFromLines(
        current.lines.slice(range.startLine, range.endLine),
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
          : Promise.all(batches.map((batch) => checkWords({ words: batch })));
      void requests
        .then((results) => {
          if (
            !active ||
            generation !== spellcheckGenerationRef.current ||
            editorRef.current !== root
          ) {
            return;
          }
          const misspelled = new Set(results.flat());
          for (const word of unknown) {
            spellcheckCacheRef.current.set(word, misspelled.has(word));
          }
          renderSourceSpellingErrors(
            root,
            words.filter(
              (word) => spellcheckCacheRef.current.get(word) === true,
            ),
            checkCodeBlocks,
            range,
          );
        })
        .catch(() => {
          if (active && editorRef.current === root) {
            clearSourceSpellingErrors(root, range);
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
    pageActive,
    renderedLines,
    spellCheck,
    spellcheckRevision,
    spellcheckScope,
    value,
    viewport.endLine,
    viewport.startLine,
  ]);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const contents = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".virtual-source__rows > .md-line > .md-line__content",
      ),
    );
    const measure = (): void => {
      measurementFrameRef.current = undefined;
      const anchor = layout.lineAtOffset(root.scrollTop);
      const within = root.scrollTop - layout.lineTop(anchor);
      const measurements: { height: number; index: number }[] = [];
      for (const content of contents) {
        if (!content.isConnected) {
          continue;
        }
        const line = content.parentElement;
        const lineIndex = Number(line?.dataset.line) - 1;
        if (
          !Number.isInteger(lineIndex) ||
          lineIndex < 0 ||
          !layout.canMeasureLine(lineIndex)
        ) {
          continue;
        }
        const measured = Math.max(
          content.scrollHeight,
          content.getBoundingClientRect().height,
        );
        if (measured > 0) {
          measurements.push({ height: measured, index: lineIndex });
        }
      }
      if (!layout.setMeasuredHeights(measurements)) {
        return;
      }
      root.scrollTop =
        layout.lineTop(anchor) +
        Math.min(within, Math.max(0, layout.heightAt(anchor) - 1));
      setLayoutRevision((current) => current + 1);
      updateViewport(root);
    };
    const schedule = (): void => {
      if (measurementFrameRef.current === undefined) {
        measurementFrameRef.current = requestAnimationFrame(measure);
      }
    };
    schedule();
    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (measurementFrameRef.current !== undefined) {
          cancelAnimationFrame(measurementFrameRef.current);
          measurementFrameRef.current = undefined;
        }
      };
    }
    const observer = new ResizeObserver(schedule);
    for (const content of contents) {
      observer.observe(content);
    }
    return () => {
      observer.disconnect();
      if (measurementFrameRef.current !== undefined) {
        cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = undefined;
      }
    };
  }, [editorRef, layout, renderedLines, updateViewport]);

  function handleBeforeInput(native: InputEvent): void {
    verticalColumnRef.current = undefined;
    proxySelectionSyncRef.current = undefined;
    if (readOnlyRef.current) {
      native.preventDefault();
      return;
    }
    if (!native.inputType) {
      return;
    }
    if (native.inputType === "historyUndo") {
      native.preventDefault();
      onUndo();
      return;
    }
    if (native.inputType === "historyRedo") {
      native.preventDefault();
      onRedo();
      return;
    }
    if (composingRef.current) {
      return;
    }
    if (
      native.inputType === "insertFromPaste" ||
      native.inputType === "insertFromDrop"
    ) {
      native.preventDefault();
      return;
    }
    const before = {
      content: modelRef.current.source,
      selection: selectionRef.current,
    };
    const after = resolveMarkdownTypingInput(
      before,
      native.inputType,
      native.data === null ? null : normalizeSourceText(native.data),
      typingColor,
    );
    native.preventDefault();
    if (!after) {
      return;
    }
    if (after.content === before.content) {
      applySelection(after.selection, true);
      return;
    }
    commit(before, after, native.inputType);
  }

  useLayoutEffect(() => {
    beforeInputHandlerRef.current = handleBeforeInput;
  });

  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy) {
      return;
    }
    const listener = (event: Event): void =>
      beforeInputHandlerRef.current(event as InputEvent);
    proxy.addEventListener("beforeinput", listener);
    return () => proxy.removeEventListener("beforeinput", listener);
  }, []);

  function handleInput(event: FormEvent<HTMLTextAreaElement>): void {
    if (composingRef.current) {
      return;
    }
    const proxy = event.currentTarget;
    if (readOnlyRef.current) {
      synchronizeProxyToModel(proxy);
      return;
    }
    const native = event.nativeEvent as InputEvent;
    const before = {
      content: modelRef.current.source,
      selection: selectionRef.current,
    };
    const after = resolveMarkdownTypingInput(
      before,
      native.inputType,
      native.data,
      typingColor,
    );
    if (!after || after.content === before.content) {
      synchronizeProxyToModel(proxy);
      return;
    }
    commit(before, after, native.inputType);
  }

  function handleProxySelect(event: UIEvent<HTMLTextAreaElement>): void {
    if (composingRef.current || synchronizingProxyRef.current) {
      return;
    }
    const proxy = event.currentTarget;
    const synchronized = proxySelectionSyncRef.current;
    if (
      synchronized &&
      synchronized.value === proxy.value &&
      synchronized.start === proxy.selectionStart &&
      synchronized.end === proxy.selectionEnd
    ) {
      return;
    }
    verticalColumnRef.current = undefined;
    proxySelectionSyncRef.current = undefined;
    const start = activeLineStart + proxy.selectionStart;
    const end = activeLineStart + proxy.selectionEnd;
    const direction = proxy.selectionDirection || "none";
    applySelection(
      {
        direction: start === end ? "none" : direction,
        end,
        start,
      },
      true,
      false,
    );
  }

  function handleCompositionStart(
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    if (compositionTimerRef.current !== undefined) {
      window.clearTimeout(compositionTimerRef.current);
      compositionTimerRef.current = undefined;
    }
    proxySelectionSyncRef.current = undefined;
    composingRef.current = true;
    event.currentTarget.dataset.composing = "";
    const before = {
      content: modelRef.current.source,
      selection: selectionRef.current,
    };
    const startLine = sourceLineIndexAtOffset(
      modelRef.current,
      before.selection.start,
    );
    const endLine = sourceLineIndexAtOffset(
      modelRef.current,
      before.selection.end,
    );
    compositionRef.current = {
      before,
      lineIndex: activeLine,
      lineSource: activeLineValue,
      lineStart: activeLineStart,
      proxyValue: event.currentTarget.value,
      spansLines: startLine !== endLine,
    };
  }

  function handleCompositionEnd(
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void {
    const pending = compositionRef.current;
    const proxy = event.currentTarget;
    compositionTimerRef.current = window.setTimeout(() => {
      compositionTimerRef.current = undefined;
      composingRef.current = false;
      compositionRef.current = undefined;
      delete proxy.dataset.composing;
      if (readOnlyRef.current) {
        synchronizeProxyToModel(proxy);
        return;
      }
      const currentLine = pending?.lineIndex ?? -1;
      if (
        !pending ||
        currentLine < 0 ||
        currentLine >= modelRef.current.lines.length
      ) {
        proxy.value = modelRef.current.lines[activeLine]?.source ?? "";
        return;
      }
      const nextLine = proxy.value.replace(/[\r\n]/gu, "");
      const rawAfter = pending.spansLines
        ? nextLine === pending.proxyValue
          ? pending.before
          : applyMarkdownTypingReplacement(
              pending.before,
              compositionReplacementText(pending.proxyValue, nextLine),
              typingColor,
            )
        : {
            content:
              pending.before.content.slice(0, pending.lineStart) +
              nextLine +
              pending.before.content.slice(
                pending.lineStart + pending.lineSource.length,
              ),
            selection: {
              direction: "none" as const,
              end: pending.lineStart + proxy.selectionEnd,
              start: pending.lineStart + proxy.selectionStart,
            },
          };
      const after = pending.spansLines
        ? rawAfter
        : applyMarkdownTypingComposition(pending.before, rawAfter, typingColor);
      if (after.content !== pending.before.content) {
        commit(pending.before, after, "insertCompositionText");
      } else {
        applySelection(after.selection, true);
      }
    }, 0);
  }

  function handleCopy(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const selected = selectionRef.current;
    if (selected.start === selected.end) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      modelRef.current.source.slice(selected.start, selected.end),
    );
  }

  function handleCut(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    handleCopy(event);
    const before = {
      content: modelRef.current.source,
      selection: selectionRef.current,
    };
    const after = resolveMarkdownTypingInput(
      before,
      "deleteByCut",
      null,
      typingColor,
    );
    if (after?.content !== before.content) {
      commit(before, after!, "deleteByCut");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const image = parseImageDirective(
      event.clipboardData.getData(IMAGE_INSTANCE_TRANSFER),
    );
    const inserted = image
      ? serializeImageDirective({
          ...image,
          instanceId: crypto.randomUUID(),
        })
      : sourceTextFromTransfer(
          event.clipboardData,
          event.currentTarget.ownerDocument,
        );
    if (inserted) {
      replaceSelection("insertFromPaste", inserted, !image);
    }
  }

  function moveVertically(
    event: KeyboardEvent<HTMLDivElement>,
    lines: number,
  ): boolean {
    const focus = sourceSelectionFocus(selectionRef.current);
    const current = sourceLineColumn(modelRef.current, focus);
    const desiredColumn = verticalColumnRef.current ?? current.column;
    verticalColumnRef.current = desiredColumn;
    const target = sourceOffsetInLine(
      modelRef.current,
      current.lineIndex + lines,
      desiredColumn,
    );
    const anchor = event.shiftKey
      ? sourceSelectionAnchor(selectionRef.current)
      : target;
    applySelection(
      {
        direction: virtualSourceSelectionDirection(anchor, target),
        end: Math.max(anchor, target),
        start: Math.min(anchor, target),
      },
      true,
      true,
      true,
    );
    return true;
  }

  function moveHorizontally(
    event: KeyboardEvent<HTMLDivElement>,
    direction: -1 | 1,
  ): boolean {
    const platform =
      editorRef.current?.ownerDocument.documentElement.dataset.platform;
    const wordNavigation =
      platform === "darwin"
        ? event.altKey && !event.ctrlKey && !event.metaKey
        : event.ctrlKey && !event.altKey && !event.metaKey;
    const lineNavigation =
      platform === "darwin" &&
      event.metaKey &&
      !event.altKey &&
      !event.ctrlKey;
    if (
      (event.altKey || event.ctrlKey || event.metaKey) &&
      !wordNavigation &&
      !lineNavigation
    ) {
      return false;
    }
    const currentSelection = selectionRef.current;
    const focus = sourceSelectionFocus(currentSelection);
    const position = sourceLineColumn(modelRef.current, focus);
    const lineLength =
      modelRef.current.lines[position.lineIndex]?.source.length ?? 0;
    const spansLines =
      sourceLineIndexAtOffset(modelRef.current, currentSelection.start) !==
      sourceLineIndexAtOffset(modelRef.current, currentSelection.end);
    const crossesLine =
      direction === -1 ? position.column === 0 : position.column === lineLength;
    if (!wordNavigation && !lineNavigation && !spansLines && !crossesLine) {
      return false;
    }
    const target =
      !event.shiftKey && currentSelection.start !== currentSelection.end
        ? direction === -1
          ? currentSelection.start
          : currentSelection.end
        : wordNavigation
          ? direction === -1
            ? previousSourceWordNavigationBoundary(
                modelRef.current.source,
                focus,
              )
            : platform === "darwin"
              ? nextSourceWordEndBoundary(modelRef.current.source, focus)
              : nextSourceWordStartBoundary(modelRef.current.source, focus)
          : lineNavigation
            ? sourceOffsetInLine(
                modelRef.current,
                position.lineIndex,
                direction === -1 ? 0 : lineLength,
              )
          : direction === -1
            ? previousGraphemeBoundary(modelRef.current.source, focus)
            : nextGraphemeBoundary(modelRef.current.source, focus);
    const anchor = event.shiftKey
      ? sourceSelectionAnchor(currentSelection)
      : target;
    applySelection(
      {
        direction: virtualSourceSelectionDirection(anchor, target),
        end: Math.max(anchor, target),
        start: Math.min(anchor, target),
      },
      true,
    );
    return true;
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    proxySelectionSyncRef.current = undefined;
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      composingRef.current ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    const platform =
      editorRef.current?.ownerDocument.documentElement.dataset.platform;
    const command = platform === "darwin" ? event.metaKey : event.ctrlKey;
    if (command && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault();
      applySelection(
        {
          direction: "forward",
          end: modelRef.current.source.length,
          start: 0,
        },
        true,
        false,
      );
      return;
    }
    if (command && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
      return;
    }
    if (
      platform !== "darwin" &&
      event.ctrlKey &&
      event.key.toLocaleLowerCase() === "y"
    ) {
      event.preventDefault();
      onRedo();
      return;
    }
    let handled = false;
    if (
      platform === "darwin" &&
      event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      const target =
        event.key === "ArrowUp" ? 0 : modelRef.current.source.length;
      const anchor = event.shiftKey
        ? sourceSelectionAnchor(selectionRef.current)
        : target;
      applySelection(
        {
          direction: virtualSourceSelectionDirection(anchor, target),
          end: Math.max(anchor, target),
          start: Math.min(anchor, target),
        },
        true,
      );
      handled = true;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      handled = moveHorizontally(event, event.key === "ArrowLeft" ? -1 : 1);
    } else if (
      event.key === "ArrowUp" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      handled = moveVertically(event, -1);
    } else if (
      event.key === "ArrowDown" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      handled = moveVertically(event, 1);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      const page = Math.max(
        1,
        Math.floor(
          (editorRef.current?.clientHeight ?? lineHeight) / lineHeight,
        ),
      );
      handled = moveVertically(event, event.key === "PageUp" ? -page : page);
    } else if (event.key === "Home" || event.key === "End") {
      const current = sourceLineColumn(
        modelRef.current,
        sourceSelectionFocus(selectionRef.current),
      );
      const target = command
        ? event.key === "Home"
          ? 0
          : modelRef.current.source.length
        : sourceOffsetInLine(
            modelRef.current,
            current.lineIndex,
            event.key === "Home"
              ? 0
              : modelRef.current.lines[current.lineIndex]!.source.length,
          );
      const anchor = event.shiftKey
        ? sourceSelectionAnchor(selectionRef.current)
        : target;
      applySelection(
        {
          direction: virtualSourceSelectionDirection(anchor, target),
          end: Math.max(anchor, target),
          start: Math.min(anchor, target),
        },
        true,
      );
      handled = true;
    }
    if (handled) {
      event.preventDefault();
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    verticalColumnRef.current = undefined;
    if ((event.target as Element).closest(".md-inline-color-trigger")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) {
      return;
    }
    selectionDragCleanupRef.current();
    proxySelectionSyncRef.current = undefined;
    if ((event.target as Element).closest(".virtual-source__proxy")) {
      return;
    }
    event.preventDefault();
    const root = event.currentTarget;
    const offset = virtualSourceOffsetFromPoint(
      root,
      modelRef.current,
      event.clientX,
      event.clientY,
      lineHeight,
      layout,
    );
    if (event.detail === 2 || event.detail === 3) {
      const pointed: SourceSelection = {
        direction: "none",
        end: offset,
        start: offset,
      };
      applySelection(
        event.detail === 2
          ? expandDoubleClickSelection(modelRef.current.source, pointed)
          : expandTripleClickSelection(modelRef.current.source, pointed),
        true,
      );
      proxyRef.current?.focus({ preventScroll: true });
      return;
    }
    const anchor = event.shiftKey
      ? sourceSelectionAnchor(selectionRef.current)
      : offset;
    applySelection(
      {
        direction: virtualSourceSelectionDirection(anchor, offset),
        end: Math.max(anchor, offset),
        start: Math.min(anchor, offset),
      },
      true,
    );
    proxyRef.current?.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    let autoScrollFrame: number | undefined;
    let pointerX = event.clientX;
    let pointerY = event.clientY;
    const selectAtPoint = (x: number, y: number): void => {
      const focus = virtualSourceOffsetFromPoint(
        root,
        modelRef.current,
        x,
        y,
        lineHeight,
        layout,
      );
      applySelection(
        {
          direction: virtualSourceSelectionDirection(anchor, focus),
          end: Math.max(anchor, focus),
          start: Math.min(anchor, focus),
        },
        true,
        false,
      );
    };
    const autoScroll = (): void => {
      autoScrollFrame = undefined;
      const bounds = root.getBoundingClientRect();
      const overflow =
        pointerY < bounds.top
          ? pointerY - bounds.top
          : pointerY > bounds.bottom
            ? pointerY - bounds.bottom
            : 0;
      if (overflow === 0) {
        return;
      }
      const maximum = Math.max(0, layout.totalHeight - root.clientHeight);
      const delta =
        Math.sign(overflow) *
        Math.min(lineHeight * 2, Math.max(2, Math.abs(overflow) * 0.3));
      const next = Math.min(maximum, Math.max(0, root.scrollTop + delta));
      if (next === root.scrollTop) {
        return;
      }
      root.scrollTop = next;
      scrollReporter.reportScroll(next);
      updateViewport(root);
      const edgeY =
        bounds.height > 2
          ? Math.min(bounds.bottom - 1, Math.max(bounds.top + 1, pointerY))
          : bounds.top;
      selectAtPoint(pointerX, edgeY);
      autoScrollFrame = requestAnimationFrame(autoScroll);
    };
    const scheduleAutoScroll = (): void => {
      const bounds = root.getBoundingClientRect();
      if (pointerY >= bounds.top && pointerY <= bounds.bottom) {
        if (autoScrollFrame !== undefined) {
          cancelAnimationFrame(autoScrollFrame);
          autoScrollFrame = undefined;
        }
        return;
      }
      if (autoScrollFrame === undefined) {
        autoScrollFrame = requestAnimationFrame(autoScroll);
      }
    };
    const move = (moveEvent: globalThis.PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      pointerX = moveEvent.clientX;
      pointerY = moveEvent.clientY;
      selectAtPoint(pointerX, pointerY);
      scheduleAutoScroll();
    };
    const release = (releaseEvent?: Event): void => {
      if (
        releaseEvent &&
        "pointerId" in releaseEvent &&
        releaseEvent.pointerId !== pointerId
      ) {
        return;
      }
      if (autoScrollFrame !== undefined) {
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = undefined;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      if (selectionDragCleanupRef.current === release) {
        selectionDragCleanupRef.current = () => undefined;
      }
    };
    selectionDragCleanupRef.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
    window.addEventListener("blur", release, { once: true });
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const root = event.currentTarget;
    scrollReporter.reportScroll(root.scrollTop);
    if (scrollFrameRef.current === undefined) {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = undefined;
        updateViewport(root);
      });
    }
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const root = event.currentTarget;
    const offset = virtualSourceOffsetFromPoint(
      root,
      modelRef.current,
      event.clientX,
      event.clientY,
      lineHeight,
      layout,
    );
    if (!(
      offset >= selectionRef.current.start && offset <= selectionRef.current.end
    )) {
      applySelection({ direction: "none", end: offset, start: offset }, true);
    }
    onContextMenuRequest?.(
      createSourceMenuRequest(root, event.target, {
        x: event.clientX,
        y: event.clientY,
      }),
    );
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    const trigger = (event.target as Element).closest<HTMLButtonElement>(
      ".md-inline-color-trigger",
    );
    if (!trigger) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || !onColorRequest) {
      return;
    }
    const line = trigger.closest<HTMLElement>(".md-line");
    const lineIndex = Number(line?.dataset.line) - 1;
    const localStart = Number(trigger.dataset.mdColorStart);
    const localEnd = Number(trigger.dataset.mdColorEnd);
    const kind = trigger.dataset.mdColorKind;
    if (
      !Number.isInteger(lineIndex) ||
      lineIndex < 0 ||
      !Number.isInteger(localStart) ||
      !Number.isInteger(localEnd) ||
      (kind !== "text" && kind !== "highlight")
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
      "--note-seed",
      "--preference-accent-color",
      "--color-accent",
    ]
      .map((property) => styles.getPropertyValue(property).trim())
      .find((candidate) => parseHexColor(candidate));
    const color =
      explicitColor ??
      inheritedColor ??
      (channels
        ? rgbToHex({
            blue: Number(channels[3]),
            green: Number(channels[2]),
            red: Number(channels[1]),
          })
        : null);
    const lineStart = modelRef.current.lineStarts[lineIndex];
    if (lineStart === undefined) {
      return;
    }
    onColorRequest({
      color,
      end: lineStart + localEnd,
      kind,
      position: { x: bounds.left, y: bounds.bottom + 5 },
      start: lineStart + localStart,
    });
  }

  const selectedStartLine = sourceLineIndexAtOffset(model, selection.start);
  const selectedEndLine = sourceLineIndexAtOffset(model, selection.end);
  const height =
    layoutRevision >= 0 ? Math.max(lineHeight, layout.totalHeight) : lineHeight;

  return (
    <div className="markdown-source">
      <div
        className="markdown-source__editor markdown-source__editor--virtual"
        data-markdown-node-id={nodeId}
        data-markdown-view-id={viewId}
        data-spellcheck-code-blocks={String(checkCodeBlocks)}
        data-spellcheck-enabled={String(spellCheck)}
        data-virtual-layout-revision={layoutRevision}
        data-virtual-wrap={String(wrapLines)}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragOver={(event) => {
          if (
            isWorkspaceDragActive() ||
            hasWorkspaceDrag(event.dataTransfer)
          ) {
            return;
          }
          if (
            !readOnly &&
            ((onImportFiles &&
              event.dataTransfer.types.includes("Files")) ||
              (onInsertMediaAsset &&
                event.dataTransfer.types.includes(MEDIA_ASSET_TRANSFER)) ||
              event.dataTransfer.types.includes("text/plain") ||
              event.dataTransfer.types.includes("text/html"))
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (readOnly) {
            event.preventDefault();
            return;
          }
          if (
            isWorkspaceDragActive() ||
            hasWorkspaceDrag(event.dataTransfer)
          ) {
            event.preventDefault();
            return;
          }
          const offset = virtualSourceOffsetFromPoint(
            event.currentTarget,
            modelRef.current,
            event.clientX,
            event.clientY,
            lineHeight,
            layout,
          );
          if (
            onInsertMediaAsset &&
            event.dataTransfer.types.includes(MEDIA_ASSET_TRANSFER)
          ) {
            event.preventDefault();
            try {
              const payload = JSON.parse(
                event.dataTransfer.getData(MEDIA_ASSET_TRANSFER),
              ) as {
                assetId?: string;
                instanceId?: string;
                projectId?: string;
              };
              if (
                payload.assetId &&
                payload.projectId &&
                payload.projectId === projectId
              ) {
                void onInsertMediaAsset(
                  payload.assetId,
                  payload.projectId,
                  offset,
                  payload.instanceId,
                );
              }
            } catch {
              return;
            }
            return;
          }
          if (
            onImportFiles &&
            event.dataTransfer.files.length > 0
          ) {
            event.preventDefault();
            onImportFiles(Array.from(event.dataTransfer.files), offset);
          } else {
            const inserted = sourceTextFromTransfer(
              event.dataTransfer,
              event.currentTarget.ownerDocument,
            );
            if (inserted) {
              event.preventDefault();
              applySelection(
                { direction: "none", end: offset, start: offset },
                false,
              );
              replaceSelection("insertFromDrop", inserted);
            }
          }
        }}
        onErrorCapture={(event) => {
          const image = event.target as Element;
          if (!image.classList.contains("twemoji__glyph")) {
            return;
          }
          image.closest(".twemoji")?.classList.add("twemoji--fallback");
          image.remove();
        }}
        onKeyDown={handleKey}
        onPointerDown={handlePointerDown}
        onScroll={handleScroll}
        onScrollEnd={(event) =>
          scrollReporter.reportScrollEnd(event.currentTarget.scrollTop)
        }
        ref={editorRef}
        style={
          {
            "--md-line-number-digits": Math.max(
              3,
              String(model.lines.length).length,
            ),
            "--virtual-source-line-height": `${lineHeight}px`,
          } as React.CSSProperties
        }
      >
        <div
          className="virtual-source__spacer"
          style={{
            height,
            minWidth: wrapLines
              ? "100%"
              : `calc(${maximumColumns + 8}ch + 2 * var(--md-content-padding-inline))`,
          }}
        >
          <VirtualSourceRows
            highlightedLine={highlightedLine}
            layout={layout}
            layoutRevision={layoutRevision}
            renderedLines={renderedLines}
            selectedEndLine={selectedEndLine}
            selectedStartLine={selectedStartLine}
            selectionVisible={selection.start !== selection.end}
          />
          <textarea
            aria-label={ariaLabel}
            aria-multiline="true"
            aria-readonly={readOnly}
            className="virtual-source__proxy"
            onCompositionEnd={handleCompositionEnd}
            onCompositionStart={handleCompositionStart}
            onCopy={handleCopy}
            onCut={handleCut}
            onInput={handleInput}
            onPaste={handlePaste}
            onSelect={handleProxySelect}
            readOnly={readOnly}
            ref={proxyRef}
            spellCheck={
              pageActive &&
              spellCheck &&
              (checkCodeBlocks || !model.lines[activeLine]?.code)
            }
            style={{
              height: layout.heightAt(activeLine),
              transform: `translateY(${layout.lineTop(activeLine)}px)`,
            }}
            defaultValue={activeLineValue}
            wrap={wrapLines ? "soft" : "off"}
          />
        </div>
      </div>
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
