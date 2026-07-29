import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import {
  mediaAssetUrl,
  normalizeImageDirective,
  parseImageDirective,
  parseMediaDirective,
  serializeImageDirective,
  type ImageDirective,
} from '../../shared/markdown';
import { ContextMenu, type MenuItem } from '../components/menu';
import { Dialog } from '../components/dialog';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import {
  IMAGE_INSTANCE_TRANSFER,
  MEDIA_ASSET_TRANSFER,
  MEDIA_LIBRARY_CHANGED_EVENT,
  removedMediaAssetIds,
} from './media-transfer';
import {
  beginImageDrag,
  finishImageDrag,
  holdImageDrag,
  imageDragSnapshot,
  moveImageDrag,
  rejectImageDrop,
  returnImageDrag,
  settleImageDrag,
  updateImageDropPreview,
  type ImageDragRect,
} from './image-drag-coordinator';
import {
  focusSource,
  readSelection,
  readSourceDocumentModel,
  sourceCaretRect,
  sourceOffsetAtPoint,
  writeSelection,
  type SourceSelection,
} from './source-caret';
import {
  fitImageDragGhost,
  imageBoundaryAtPoint,
  imagePlacementAtPoint,
  inlineImageDropOffset,
  initialImageInteractionState,
  reduceImageInteraction,
  resizeImageDirective,
  sameImageDropIntent,
  type ImageDropIntent,
  type ImageInsertionPlacement,
  type ImageResizeDirection,
  type ImageSourceRange,
} from './image-interaction';
import type { ImageSourceOperation } from './image-source-edit';
export type { ImageSourceOperation } from './image-source-edit';

interface ImageInteractionLayerProps {
  editorRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  readOnly: boolean;
  onOperation?: (operation: ImageSourceOperation) => void;
  onInsertMediaAsset?: (
    assetId: string,
    projectId: string,
    offset: number,
    instanceId?: string,
    placement?: ImageInsertionPlacement,
  ) => boolean | Promise<boolean>;
  onRevealAsset?: (assetId: string) => void;
  onSelectionChange: (selection: SourceSelection) => void;
  translate: Translate;
}

interface OverlayBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

const DIRECTIONS: readonly ImageResizeDirection[] = [
  'north-west',
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
];

function imageFromLine(source: string): ImageDirective | null {
  const current = parseImageDirective(source);
  if (current) {
    return current;
  }
  const legacy = parseMediaDirective(source);
  if (!legacy || !legacy.path.match(/\.(?:avif|gif|jpe?g|png|webp)$/i)) {
    return null;
  }
  const width = Math.max(96, Math.round((legacy.span / 12) * 720));
  return normalizeImageDirective({
    version: 2,
    instanceId: crypto.randomUUID(),
    assetId: legacy.id,
    path: legacy.path,
    alt: legacy.description,
    mode: legacy.placement.startsWith('wrap')
      ? 'wrap'
      : legacy.placement === 'inline'
        ? 'inline'
        : 'block',
    align:
      legacy.placement === 'wrap-right'
        ? 'right'
        : legacy.offset > 0
          ? 'center'
          : 'left',
    width,
    height: Math.max(24, Math.round(width / legacy.ratio)),
    minWidth: 96,
    maxWidth: 1200,
    margin: 12,
    ratioLock: legacy.lock,
    positionLock: false,
    caption: legacy.caption ? legacy.description : '',
  });
}

function imageSourceRange(
  wrapper: HTMLElement,
  lineStart: number,
  source: string,
): {
  directive: ImageDirective;
  range: ImageSourceRange;
} | null {
  const localStart = Number(wrapper.dataset.imageSourceStart ?? 0);
  const localEnd = Number(wrapper.dataset.imageSourceEnd ?? source.length);
  if (
    !Number.isInteger(localStart) ||
    !Number.isInteger(localEnd) ||
    localStart < 0 ||
    localEnd <= localStart ||
    localEnd > source.length
  ) {
    return null;
  }
  const selected = source.slice(localStart, localEnd);
  const directive =
    parseImageDirective(selected) ??
    (localStart === 0 && localEnd === source.length
      ? imageFromLine(source)
      : null);
  return directive
    ? {
        directive,
        range: {
          start: lineStart + localStart,
          end: lineStart + localEnd,
        },
      }
    : null;
}

function imageHostAtPoint(
  editor: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const hosts = Array.from(
    editor.querySelectorAll<HTMLElement>('.md-source-image__host'),
  );
  for (let index = hosts.length - 1; index >= 0; index -= 1) {
    const host = hosts[index]!;
    const bounds = host.getBoundingClientRect();
    if (
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom
    ) {
      return host;
    }
  }
  return null;
}

interface BlockDropPreview {
  afterLast: boolean;
  boundaryIndex: number;
  bounds: OverlayBounds;
  placement: ImageInsertionPlacement;
  sourceRect: ImageDragRect;
  target: number;
  targetLine?: HTMLElement;
}

interface BlockDropGeometry {
  contentBounds: readonly DOMRect[];
  editorBounds: DOMRect;
  layerBounds: DOMRect;
  lineBounds: readonly DOMRect[];
  lines: readonly HTMLElement[];
  scrollTop: number;
}

function captureBlockDropGeometry(
  editor: HTMLElement,
  layer: HTMLElement,
): BlockDropGeometry {
  const lines = Array.from(editor.querySelectorAll<HTMLElement>('.md-line'));
  return {
    contentBounds: lines.map(
      (line) =>
        line
          .querySelector<HTMLElement>('.md-line__content')
          ?.getBoundingClientRect() ?? line.getBoundingClientRect(),
    ),
    editorBounds: editor.getBoundingClientRect(),
    layerBounds: layer.getBoundingClientRect(),
    lineBounds: lines.map((line) => line.getBoundingClientRect()),
    lines,
    scrollTop: editor.scrollTop,
  };
}

function resolveBlockDropPreview(
  geometry: BlockDropGeometry,
  scrollTop: number,
  clientX: number,
  clientY: number,
  targetWidth: number,
  targetHeight: number,
  preferredMode: ImageInsertionPlacement['mode'],
): BlockDropPreview {
  const scrollOffset = geometry.scrollTop - scrollTop;
  const lines = geometry.lines;
  const lineBounds = geometry.lineBounds.map((bounds) => ({
    bottom: bounds.bottom + scrollOffset,
    top: bounds.top + scrollOffset,
  }));
  const editorBounds = geometry.editorBounds;
  const provisionalTarget = imageBoundaryAtPoint(clientY, 0, lineBounds);
  const provisionalContent =
    geometry.contentBounds[
      Math.min(provisionalTarget, geometry.contentBounds.length - 1)
    ] ?? editorBounds;
  const provisionalWidth = Math.min(
    targetWidth,
    Math.max(96, provisionalContent.width),
  );
  const provisionalHeight =
    provisionalWidth * (targetHeight / Math.max(1, targetWidth));
  const target = imageBoundaryAtPoint(clientY, provisionalHeight, lineBounds);
  const targetLine = lines[Math.min(target, lines.length - 1)];
  const boundaryLine = lines[Math.min(target, lines.length - 1)];
  const boundaryLineIndex = Number(boundaryLine?.dataset.line) - 1;
  const boundaryIndex = Number.isInteger(boundaryLineIndex)
    ? boundaryLineIndex + Number(target >= lines.length)
    : target;
  const contentBounds =
    geometry.contentBounds[
      Math.min(target, geometry.contentBounds.length - 1)
    ] ?? editorBounds;
  const width = Math.min(targetWidth, Math.max(96, contentBounds.width));
  const height = width * (targetHeight / Math.max(1, targetWidth));
  const placement = imagePlacementAtPoint(
    clientX,
    contentBounds,
    preferredMode,
  );
  const left =
    placement.align === 'right'
      ? contentBounds.right - width
      : placement.align === 'center'
        ? contentBounds.left + (contentBounds.width - width) / 2
        : contentBounds.left;
  const top =
    target >= lines.length
      ? (lineBounds.at(-1)?.bottom ?? contentBounds.bottom)
      : (lineBounds[target]?.top ?? contentBounds.top);
  const layerBounds = geometry.layerBounds;
  const bounds = {
    height,
    left: Math.max(0, left - layerBounds.left),
    top: Math.max(0, top - layerBounds.top),
    width,
  };
  return {
    afterLast: target >= lines.length,
    boundaryIndex,
    bounds,
    placement,
    sourceRect: {
      ...bounds,
      left: bounds.left + layerBounds.left,
      top: bounds.top + layerBounds.top,
    },
    target,
    targetLine,
  };
}

function ImageInteractionLayerComponent({
  editorRef,
  onOperation,
  onInsertMediaAsset,
  onRevealAsset,
  onSelectionChange,
  projectId,
  readOnly,
  translate,
}: ImageInteractionLayerProps) {
  const [state, dispatch] = useReducer(
    reduceImageInteraction,
    initialImageInteractionState,
  );
  const [bounds, setBounds] = useState<OverlayBounds | null>(null);
  const [dropBounds, setDropBounds] = useState<OverlayBounds | null>(null);
  const [context, setContext] = useState<{
    x: number;
    y: number;
  }>();
  const [metadataEdit, setMetadataEdit] = useState<'alt' | 'caption'>();
  const [metadataValue, setMetadataValue] = useState('');
  const layerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const onOperationRef = useRef(onOperation);
  const onInsertMediaAssetRef = useRef(onInsertMediaAsset);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const resizeCleanupRef = useRef<() => void>(() => undefined);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onOperationRef.current = onOperation;
  }, [onOperation]);

  useEffect(() => {
    onInsertMediaAssetRef.current = onInsertMediaAsset;
  }, [onInsertMediaAsset]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const syncBounds = useCallback(() => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      const host = hostRef.current;
      const layer = layerRef.current;
      if (!host || !layer || !host.isConnected) {
        setBounds(null);
        return;
      }
      const hostBounds = host.getBoundingClientRect();
      const layerBounds = layer.getBoundingClientRect();
      setBounds({
        height: hostBounds.height,
        left: hostBounds.left - layerBounds.left,
        top: hostBounds.top - layerBounds.top,
        width: hostBounds.width,
      });
    });
  }, []);

  const selectHost = useCallback(
    (host: HTMLElement): void => {
      const editor = editorRef.current;
      const line = host.closest<HTMLElement>('.md-line');
      const model = editor ? readSourceDocumentModel(editor) : undefined;
      const lineIndex = Number(line?.dataset.line) - 1;
      const source =
        model && Number.isInteger(lineIndex) && lineIndex >= 0
          ? model.lines[lineIndex]?.source
          : undefined;
      const wrapper = host.closest<HTMLElement>('.md-source-image');
      const resolved =
        source === undefined || !wrapper || !model
          ? null
          : imageSourceRange(wrapper, model.lineStarts[lineIndex] ?? 0, source);
      if (!editor || !model || !resolved || lineIndex < 0) {
        return;
      }
      hostRef.current = host;
      dispatch({
        type: 'select',
        selection: {
          directive: resolved.directive,
          lineIndex,
          sourceRange: resolved.range,
        },
      });
      const offset = resolved.range.start;
      const selection = {
        start: offset,
        end: offset,
        direction: 'none',
      } as const;
      focusSource(editor, { preventScroll: true });
      writeSelection(editor, selection);
      onSelectionChangeRef.current(selection);
      syncBounds();
    },
    [editorRef, syncBounds],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const hydrateHost = (host: HTMLElement): void => {
      const assetId = host.parentElement?.dataset.imageAsset;
      const image = host.querySelector<HTMLImageElement>('img');
      if (assetId && image) {
        const source = mediaAssetUrl(assetId, projectId);
        if (image.src !== source) {
          image.src = source;
        }
        image.addEventListener(
          'error',
          () => host.parentElement?.classList.add('md-source-image--missing'),
          { once: true },
        );
      }
    };
    const hydrateTree = (root: ParentNode): void => {
      if (
        root instanceof HTMLElement &&
        root.matches('.md-source-image__host[data-md-decoration]')
      ) {
        hydrateHost(root);
      }
      for (const host of root.querySelectorAll<HTMLElement>(
        '.md-source-image__host[data-md-decoration]',
      )) {
        hydrateHost(host);
      }
    };
    const syncSelectedImage = (): void => {
      const selected = stateRef.current.selection;
      if (!selected || stateRef.current.phase === 'image-dragging') {
        return;
      }
      let host = hostRef.current;
      if (
        !host?.isConnected ||
        host.parentElement?.dataset.imageInstance !==
          selected.directive.instanceId
      ) {
        host = editor.querySelector<HTMLElement>(
          `.md-source-image[data-image-instance="${CSS.escape(selected.directive.instanceId)}"] > .md-source-image__host`,
        );
      }
      if (host) {
        hostRef.current = host;
        const current = host.parentElement;
        const line = host.closest<HTMLElement>('.md-line');
        const model = readSourceDocumentModel(editor);
        const lineIndex = Number(line?.dataset.line) - 1;
        const source =
          model && lineIndex >= 0 ? model.lines[lineIndex]?.source : undefined;
        const resolved =
          current && model && source !== undefined
            ? imageSourceRange(
                current,
                model.lineStarts[lineIndex] ?? 0,
                source,
              )
            : null;
        if (
          resolved &&
          (selected.sourceRange.start !== resolved.range.start ||
            selected.sourceRange.end !== resolved.range.end ||
            selected.lineIndex !== lineIndex)
        ) {
          dispatch({
            type: 'select',
            selection: {
              directive: resolved.directive,
              lineIndex,
              sourceRange: resolved.range,
            },
          });
        }
        syncBounds();
      } else {
        hostRef.current = null;
        setBounds(null);
      }
    };
    hydrateTree(editor);
    syncSelectedImage();
    const observer = new MutationObserver((records) => {
      let selectionMayHaveMoved = !hostRef.current?.isConnected;
      for (const record of records) {
        selectionMayHaveMoved ||= record.removedNodes.length > 0;
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            hydrateTree(node);
          }
        }
      }
      if (selectionMayHaveMoved) {
        syncSelectedImage();
      }
    });
    observer.observe(editor, {
      childList: true,
      subtree: true,
    });
    const mediaChanged = (event: Event): void => {
      const removed = removedMediaAssetIds(event);
      if (removed.size === 0) {
        return;
      }
      for (const image of editor.querySelectorAll<HTMLElement>(
        '.md-source-image',
      )) {
        if (!removed.has(image.dataset.imageAsset ?? '')) {
          continue;
        }
        image.classList.add('md-source-image--missing');
        image
          .querySelector<HTMLImageElement>('.md-source-image__content')
          ?.removeAttribute('src');
      }
    };
    window.addEventListener(MEDIA_LIBRARY_CHANGED_EVENT, mediaChanged);

    let drag:
      | {
          origin: HTMLElement;
          pointerId: number;
          started: boolean;
          startX: number;
          startY: number;
          intent: ImageDropIntent | null;
          previewRect?: ImageDragRect;
          preferredMode: ImageInsertionPlacement['mode'];
          sourceRect: ImageDragRect;
          sourceRange: ImageSourceRange;
          directive: ImageDirective;
        }
      | undefined;
    let activeDropLine: HTMLElement | undefined;
    let blockGeometry: BlockDropGeometry | undefined;
    let dropBoundsValue: OverlayBounds | null = null;
    let previewFrame: number | undefined;
    let pendingPreview:
      | { kind: 'internal'; x: number; y: number }
      | { kind: 'external'; x: number; y: number }
      | undefined;
    let lastPreview:
      | { kind: 'internal'; x: number; y: number }
      | { kind: 'external'; x: number; y: number }
      | undefined;
    let inlineMarker: HTMLElement | undefined;
    let externalDrop:
      | {
          intent: ImageDropIntent;
          instanceId: string;
          offset: number;
          placement: ImageInsertionPlacement;
          previewRect: ImageDragRect;
        }
      | undefined;

    const sameBounds = (
      left: OverlayBounds | null,
      right: OverlayBounds | null,
    ): boolean =>
      left === right ||
      Boolean(
        left &&
        right &&
        left.height === right.height &&
        left.left === right.left &&
        left.top === right.top &&
        left.width === right.width,
      );
    const publishDropBounds = (next: OverlayBounds | null): void => {
      if (sameBounds(dropBoundsValue, next)) {
        return;
      }
      dropBoundsValue = next;
      setDropBounds(next);
    };
    const cancelPreviewFrame = (): void => {
      pendingPreview = undefined;
      if (previewFrame !== undefined) {
        cancelAnimationFrame(previewFrame);
        previewFrame = undefined;
      }
    };
    const clearDropTarget = (): void => {
      inlineMarker?.remove();
      inlineMarker = undefined;
      if (activeDropLine) {
        activeDropLine.classList.remove('md-line--image-drop');
        delete activeDropLine.dataset.imageDropAfter;
        delete activeDropLine.dataset.imageDropAlign;
        activeDropLine.style.removeProperty('--image-drop-height');
        activeDropLine.style.removeProperty('--image-drop-margin');
        activeDropLine.style.removeProperty('--image-drop-width');
        activeDropLine = undefined;
      }
    };
    const blockDropGeometry = (): BlockDropGeometry | undefined => {
      const layer = layerRef.current;
      if (!layer) {
        return undefined;
      }
      blockGeometry ??= captureBlockDropGeometry(editor, layer);
      return blockGeometry;
    };
    const applyBlockDropTarget = (
      preview: BlockDropPreview,
      align: ImageDirective['align'],
      margin: number,
    ): void => {
      clearDropTarget();
      activeDropLine = preview.targetLine;
      if (!activeDropLine) {
        return;
      }
      activeDropLine.classList.add('md-line--image-drop');
      if (preview.afterLast) {
        activeDropLine.dataset.imageDropAfter = '';
      }
      activeDropLine.dataset.imageDropAlign = align;
      activeDropLine.style.setProperty(
        '--image-drop-width',
        `${preview.bounds.width}px`,
      );
      activeDropLine.style.setProperty(
        '--image-drop-height',
        `${preview.bounds.height}px`,
      );
      activeDropLine.style.setProperty('--image-drop-margin', `${margin}px`);
    };
    const settleAtInstance = (
      instanceId: string,
      fallback: ImageDragRect,
      onFinish: () => void,
      attempt = 0,
    ): void => {
      requestAnimationFrame(() => {
        const currentDrag = imageDragSnapshot();
        if (
          currentDrag.phase !== 'holding' ||
          currentDrag.payload?.instanceId !== instanceId
        ) {
          onFinish();
          return;
        }
        const finalWrapper = editor.querySelector<HTMLElement>(
          `.md-source-image[data-image-instance="${instanceId}"]`,
        );
        const finalBounds = finalWrapper?.getBoundingClientRect();
        if (
          (!finalBounds || finalBounds.width <= 0 || finalBounds.height <= 0) &&
          attempt < 3
        ) {
          settleAtInstance(instanceId, fallback, onFinish, attempt + 1);
          return;
        }
        finalWrapper?.classList.add('md-source-image--drag-settling');
        settleImageDrag(
          finalBounds && finalBounds.width > 0 && finalBounds.height > 0
            ? {
                height: finalBounds.height,
                left: finalBounds.left,
                top: finalBounds.top,
                width: finalBounds.width,
              }
            : fallback,
          () => {
            finalWrapper?.classList.remove('md-source-image--drag-settling');
            onFinish();
          },
        );
      });
    };
    const cancelDrag = (): void => {
      const cancelled = drag;
      if (!cancelled) {
        return;
      }
      cancelPreviewFrame();
      lastPreview = undefined;
      clearDropTarget();
      blockGeometry = undefined;
      drag = undefined;
      publishDropBounds(null);
      updateImageDropPreview(undefined);
      dispatch({ type: 'cancel' });
      if (cancelled?.started) {
        returnImageDrag(() => {
          cancelled.origin.classList.remove('md-source-image--drag-origin');
          syncBounds();
        });
      } else {
        cancelled?.origin.classList.remove('md-source-image--drag-origin');
        finishImageDrag();
        syncBounds();
      }
    };
    const pointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      const directTarget =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.md-source-image__host')
          : null;
      const target =
        directTarget && editor.contains(directTarget)
          ? directTarget
          : imageHostAtPoint(editor, event.clientX, event.clientY);
      if (!target || !editor.contains(target)) {
        hostRef.current = null;
        dispatch({ type: 'clear' });
        setBounds(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectHost(target);
      const line = target.closest<HTMLElement>('.md-line');
      const model = readSourceDocumentModel(editor);
      const lineIndex = Number(line?.dataset.line) - 1;
      const wrapper = target.closest<HTMLElement>('.md-source-image');
      const source =
        model && lineIndex >= 0 ? model.lines[lineIndex]?.source : undefined;
      const resolved =
        model && wrapper && source !== undefined
          ? imageSourceRange(wrapper, model.lineStarts[lineIndex] ?? 0, source)
          : null;
      if (
        readOnly ||
        !wrapper ||
        !resolved ||
        resolved.directive.positionLock
      ) {
        return;
      }
      editor.setPointerCapture(event.pointerId);
      const sourceBounds = target.getBoundingClientRect();
      cancelPreviewFrame();
      lastPreview = undefined;
      clearDropTarget();
      blockGeometry = undefined;
      drag = {
        origin: wrapper,
        pointerId: event.pointerId,
        started: false,
        startX: event.clientX,
        startY: event.clientY,
        intent: null,
        preferredMode: resolved.directive.mode === 'wrap' ? 'wrap' : 'block',
        sourceRect: {
          height: sourceBounds.height,
          left: sourceBounds.left,
          top: sourceBounds.top,
          width: sourceBounds.width,
        },
        sourceRange: resolved.range,
        directive: resolved.directive,
      };
    };
    const contextMenu = (event: MouseEvent): void => {
      const directTarget =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.md-source-image__host')
          : null;
      const target =
        directTarget && editor.contains(directTarget)
          ? directTarget
          : imageHostAtPoint(editor, event.clientX, event.clientY);
      if (!target || !editor.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectHost(target);
      dispatch({ type: 'open-menu' });
      setContext({ x: event.clientX, y: event.clientY });
    };
    const updateInternalPreview = (clientX: number, clientY: number): void => {
      if (!drag?.started) {
        return;
      }
      const model = readSourceDocumentModel(editor);
      if (drag.directive.mode === 'inline' && model) {
        const candidate = sourceOffsetAtPoint(editor, clientX, clientY);
        const offset =
          candidate === undefined
            ? null
            : inlineImageDropOffset(model.source, candidate, drag.sourceRange);
        const caret =
          offset === null ? undefined : sourceCaretRect(editor, offset);
        const layer = layerRef.current;
        if (offset !== null && caret && layer) {
          const layerBounds = layer.getBoundingClientRect();
          const nextIntent: ImageDropIntent = {
            kind: 'inline-offset',
            offset,
          };
          if (!sameImageDropIntent(drag.intent, nextIntent)) {
            clearDropTarget();
            inlineMarker = editor.ownerDocument.createElement('span');
            inlineMarker.className = 'md-inline-image-drop-marker';
            inlineMarker.style.left = `${caret.left - layerBounds.left}px`;
            inlineMarker.style.top = `${caret.top - layerBounds.top}px`;
            inlineMarker.style.height = `${Math.max(18, caret.height)}px`;
            layer.appendChild(inlineMarker);
            drag.intent = nextIntent;
          }
          const availableWidth = Math.max(96, layerBounds.right - caret.left);
          const previewWidth = Math.min(drag.directive.width, availableWidth);
          const previewHeight =
            previewWidth *
            (drag.directive.height / Math.max(1, drag.directive.width));
          const nextBounds = {
            height: previewHeight,
            left: Math.min(
              Math.max(0, caret.left - layerBounds.left),
              Math.max(0, layerBounds.width - previewWidth),
            ),
            top: Math.max(0, caret.top - layerBounds.top),
            width: previewWidth,
          };
          drag.previewRect = {
            ...nextBounds,
            left: nextBounds.left + layerBounds.left,
            top: nextBounds.top + layerBounds.top,
          };
          publishDropBounds(nextBounds);
          updateImageDropPreview({
            rect: drag.previewRect,
          });
        } else if (drag.intent !== null) {
          clearDropTarget();
          drag.intent = null;
          drag.previewRect = undefined;
          publishDropBounds(null);
          updateImageDropPreview(undefined);
        }
      } else {
        const geometry = blockDropGeometry();
        if (!geometry) {
          drag.intent = null;
          drag.previewRect = undefined;
          publishDropBounds(null);
          updateImageDropPreview(undefined);
          return;
        }
        const preview = resolveBlockDropPreview(
          geometry,
          editor.scrollTop,
          clientX,
          clientY,
          drag.directive.width,
          drag.directive.height,
          drag.preferredMode,
        );
        const nextDirective = normalizeImageDirective({
          ...drag.directive,
          ...preview.placement,
        });
        const nextIntent: ImageDropIntent = {
          kind: 'block-boundary',
          align: nextDirective.align,
          boundaryIndex: preview.boundaryIndex,
        };
        if (!sameImageDropIntent(drag.intent, nextIntent)) {
          applyBlockDropTarget(
            preview,
            nextDirective.align,
            nextDirective.margin,
          );
        }
        drag.directive = nextDirective;
        drag.intent = nextIntent;
        drag.previewRect = preview.sourceRect;
        publishDropBounds(preview.bounds);
        updateImageDropPreview({ rect: drag.previewRect });
      }
    };
    const flushPreview = (): void => {
      previewFrame = undefined;
      const pending = pendingPreview;
      pendingPreview = undefined;
      if (!pending) {
        return;
      }
      if (pending.kind === 'internal') {
        updateInternalPreview(pending.x, pending.y);
      } else {
        updateExternalPreview(pending.x, pending.y);
      }
    };
    const schedulePreview = (
      kind: 'internal' | 'external',
      x: number,
      y: number,
    ): void => {
      pendingPreview = { kind, x, y };
      lastPreview = pendingPreview;
      if (previewFrame === undefined) {
        previewFrame = requestAnimationFrame(flushPreview);
      }
    };
    const pointerMove = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (distance < 5 && !drag.started) {
        return;
      }
      if (!drag.started) {
        drag.started = true;
        drag.origin.classList.add('md-source-image--drag-origin');
        const ghost = fitImageDragGhost(
          drag.sourceRect.width,
          drag.sourceRect.height,
        );
        beginImageDrag(
          {
            assetId: drag.directive.assetId,
            ghostHeight: ghost.height,
            ghostWidth: ghost.width,
            instanceId: drag.directive.instanceId,
            projectId: projectId ?? '',
            source: 'note',
            sourceUrl: mediaAssetUrl(drag.directive.assetId, projectId),
            targetHeight: drag.directive.height,
            targetWidth: drag.directive.width,
          },
          { x: event.clientX, y: event.clientY },
          drag.sourceRect,
        );
        dispatch({ type: 'start-drag' });
      }
      event.preventDefault();
      moveImageDrag({ x: event.clientX, y: event.clientY });
      schedulePreview('internal', event.clientX, event.clientY);
    };
    const pointerEnd = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const completed = drag;
      const moved = completed.started;
      cancelPreviewFrame();
      lastPreview = undefined;
      clearDropTarget();
      blockGeometry = undefined;
      drag = undefined;
      updateImageDropPreview(undefined);
      if (moved && completed.intent && completed.previewRect) {
        holdImageDrag({
          x: event.clientX,
          y: event.clientY,
        });
        onOperationRef.current?.({
          type: 'move',
          sourceRange: completed.sourceRange,
          intent: completed.intent,
          directive: completed.directive,
        });
        settleAtInstance(
          completed.directive.instanceId,
          completed.previewRect,
          () => {
            completed.origin.classList.remove('md-source-image--drag-origin');
            publishDropBounds(null);
            syncBounds();
          },
        );
      } else if (moved) {
        returnImageDrag(() => {
          completed.origin.classList.remove('md-source-image--drag-origin');
          publishDropBounds(null);
          syncBounds();
        });
      } else {
        finishImageDrag();
        completed.origin.classList.remove('md-source-image--drag-origin');
        publishDropBounds(null);
      }
      dispatch({ type: 'finish' });
    };
    const clearExternalDrop = (): void => {
      cancelPreviewFrame();
      lastPreview = undefined;
      externalDrop = undefined;
      clearDropTarget();
      blockGeometry = undefined;
      publishDropBounds(null);
      updateImageDropPreview(undefined);
    };
    const updateExternalPreview = (clientX: number, clientY: number): void => {
      const payload = imageDragSnapshot().payload;
      const model = readSourceDocumentModel(editor);
      const geometry = blockDropGeometry();
      if (
        !payload ||
        payload.source !== 'gallery' ||
        payload.projectId !== projectId ||
        !model ||
        !geometry
      ) {
        clearExternalDrop();
        return;
      }
      const preview = resolveBlockDropPreview(
        geometry,
        editor.scrollTop,
        clientX,
        clientY,
        payload.targetWidth,
        payload.targetHeight,
        'wrap',
      );
      const nextIntent: ImageDropIntent = {
        align: preview.placement.align,
        boundaryIndex: preview.boundaryIndex,
        kind: 'block-boundary',
      };
      if (!sameImageDropIntent(externalDrop?.intent ?? null, nextIntent)) {
        applyBlockDropTarget(preview, preview.placement.align, 12);
      }
      externalDrop = {
        intent: nextIntent,
        instanceId: payload.instanceId,
        offset:
          model.lineStarts[preview.boundaryIndex] ?? model.source.length,
        placement: preview.placement,
        previewRect: preview.sourceRect,
      };
      publishDropBounds(preview.bounds);
      updateImageDropPreview({ rect: preview.sourceRect });
    };
    const nativeDragOver = (event: globalThis.DragEvent): void => {
      if (
        readOnly ||
        !onInsertMediaAssetRef.current ||
        !event.dataTransfer?.types.includes(MEDIA_ASSET_TRANSFER)
      ) {
        return;
      }
      const payload = imageDragSnapshot().payload;
      const model = readSourceDocumentModel(editor);
      if (
        !payload ||
        payload.source !== 'gallery' ||
        payload.projectId !== projectId ||
        !model
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      moveImageDrag({ x: event.clientX, y: event.clientY });
      schedulePreview('external', event.clientX, event.clientY);
    };
    const nativeDragLeave = (event: globalThis.DragEvent): void => {
      if (
        event.relatedTarget instanceof Node &&
        editor.contains(event.relatedTarget)
      ) {
        return;
      }
      clearExternalDrop();
    };
    const nativeDrop = (event: globalThis.DragEvent): void => {
      const completed = externalDrop;
      const payload = imageDragSnapshot().payload;
      if (
        !completed ||
        !payload ||
        payload.source !== 'gallery' ||
        payload.projectId !== projectId ||
        !onInsertMediaAssetRef.current
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cancelPreviewFrame();
      lastPreview = undefined;
      externalDrop = undefined;
      clearDropTarget();
      blockGeometry = undefined;
      updateImageDropPreview(undefined);
      holdImageDrag({ x: event.clientX, y: event.clientY });
      void Promise.resolve(
        onInsertMediaAssetRef.current(
          payload.assetId,
          payload.projectId,
          completed.offset,
          completed.instanceId,
          completed.placement,
        ),
      )
        .then((inserted) => {
          if (!inserted) {
            rejectImageDrop(() => publishDropBounds(null));
            return;
          }
          settleAtInstance(completed.instanceId, completed.previewRect, () =>
            publishDropBounds(null),
          );
        })
        .catch(() => rejectImageDrop(() => publishDropBounds(null)));
    };
    const keyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && stateRef.current.selection) {
        event.preventDefault();
        cancelDrag();
      }
    };
    const clipboard = (event: ClipboardEvent): void => {
      const selection = stateRef.current.selection;
      if (!selection || !event.clipboardData) {
        return;
      }
      const sourceSelection = readSelection(editor);
      if (
        sourceSelection.start !== sourceSelection.end ||
        sourceSelection.start !== selection.sourceRange.start
      ) {
        return;
      }
      event.preventDefault();
      const serialized = serializeImageDirective(selection.directive);
      event.clipboardData.setData('text/plain', serialized);
      event.clipboardData.setData(IMAGE_INSTANCE_TRANSFER, serialized);
      if (event.type === 'cut' && !readOnly) {
        onOperationRef.current?.({
          type: 'delete',
          sourceRange: selection.sourceRange,
        });
        hostRef.current = null;
        dispatch({ type: 'clear' });
        setBounds(null);
      }
    };
    const blur = (): void => cancelDrag();
    const scroll = (): void => {
      syncBounds();
      if (lastPreview) {
        blockGeometry = undefined;
        clearDropTarget();
        if (drag) {
          drag.intent = null;
        }
        externalDrop = undefined;
        schedulePreview(lastPreview.kind, lastPreview.x, lastPreview.y);
      }
    };
    const resize = (): void => {
      syncBounds();
      blockGeometry = undefined;
      clearDropTarget();
      if (drag) {
        drag.intent = null;
      }
      externalDrop = undefined;
      if (lastPreview) {
        schedulePreview(lastPreview.kind, lastPreview.x, lastPreview.y);
      }
    };

    editor.addEventListener('pointerdown', pointerDown, true);
    editor.addEventListener('dragover', nativeDragOver, true);
    editor.addEventListener('dragleave', nativeDragLeave, true);
    editor.addEventListener('drop', nativeDrop, true);
    editor.addEventListener('contextmenu', contextMenu, true);
    editor.addEventListener('pointermove', pointerMove, true);
    editor.addEventListener('pointerup', pointerEnd, true);
    editor.addEventListener('pointercancel', cancelDrag, true);
    editor.addEventListener('lostpointercapture', cancelDrag, true);
    editor.addEventListener('scroll', scroll, {
      passive: true,
    });
    editor.addEventListener('copy', clipboard, true);
    editor.addEventListener('cut', clipboard, true);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener(MEDIA_LIBRARY_CHANGED_EVENT, mediaChanged);
      editor.removeEventListener('pointerdown', pointerDown, true);
      editor.removeEventListener('dragover', nativeDragOver, true);
      editor.removeEventListener('dragleave', nativeDragLeave, true);
      editor.removeEventListener('drop', nativeDrop, true);
      editor.removeEventListener('contextmenu', contextMenu, true);
      editor.removeEventListener('pointermove', pointerMove, true);
      editor.removeEventListener('pointerup', pointerEnd, true);
      editor.removeEventListener('pointercancel', cancelDrag, true);
      editor.removeEventListener('lostpointercapture', cancelDrag, true);
      editor.removeEventListener('scroll', scroll);
      editor.removeEventListener('copy', clipboard, true);
      editor.removeEventListener('cut', clipboard, true);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', resize);
      cancelPreviewFrame();
      clearDropTarget();
      if (externalDrop) {
        rejectImageDrop();
      }
      if (drag) {
        drag.origin.classList.remove('md-source-image--drag-origin');
        finishImageDrag();
      }
      const activeDrag = imageDragSnapshot();
      if (
        activeDrag.payload?.source === 'note' &&
        activeDrag.payload.instanceId ===
          stateRef.current.selection?.directive.instanceId
      ) {
        finishImageDrag();
      }
    };
  }, [editorRef, projectId, readOnly, selectHost, syncBounds]);

  useEffect(
    () => () => {
      resizeCleanupRef.current();
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const beginResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: ImageResizeDirection,
  ): void => {
    const selection = state.selection;
    const host = hostRef.current;
    const editor = editorRef.current;
    if (readOnly || !selection || !host || !editor) {
      return;
    }
    resizeCleanupRef.current();
    event.preventDefault();
    event.stopPropagation();
    const owner = event.currentTarget;
    owner.setPointerCapture(event.pointerId);
    dispatch({ type: 'start-resize' });
    const initial = selection.directive;
    const startX = event.clientX;
    const startY = event.clientY;
    const contentBounds = host
      .closest<HTMLElement>('.md-line__content')
      ?.getBoundingClientRect();
    const horizontalMargin = initial.mode === 'block' ? 0 : initial.margin;
    const availableWidth = Math.max(
      48,
      (contentBounds?.width ?? editor.clientWidth) - horizontalMargin,
    );
    let current = initial;
    let animationFrame: number | undefined;

    const applyPreview = (): void => {
      host.parentElement?.style.setProperty(
        '--source-image-width',
        `${current.width}px`,
      );
      host.parentElement?.style.setProperty(
        '--source-image-height',
        `${current.height}px`,
      );
      host.parentElement?.style.setProperty(
        '--source-image-ratio',
        String(current.width / current.height),
      );
      syncBounds();
    };
    const render = (): void => {
      animationFrame = undefined;
      applyPreview();
    };
    const move = (pointer: PointerEvent): void => {
      current = resizeImageDirective(
        initial,
        direction,
        pointer.clientX - startX,
        pointer.clientY - startY,
        pointer.shiftKey,
        availableWidth,
      );
      if (animationFrame === undefined) {
        animationFrame = requestAnimationFrame(render);
      }
    };
    const cleanup = (): void => {
      owner.removeEventListener('pointermove', move);
      owner.removeEventListener('pointerup', commit);
      owner.removeEventListener('pointercancel', cancel);
      owner.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
      resizeCleanupRef.current = () => undefined;
    };
    const restore = (): void => {
      host.parentElement?.style.setProperty(
        '--source-image-width',
        `${initial.width}px`,
      );
      host.parentElement?.style.setProperty(
        '--source-image-height',
        `${initial.height}px`,
      );
      host.parentElement?.style.setProperty(
        '--source-image-ratio',
        String(initial.width / initial.height),
      );
      syncBounds();
    };
    const commit = (): void => {
      cleanup();
      applyPreview();
      onOperationRef.current?.({
        type: 'change',
        sourceRange: selection.sourceRange,
        directive: current,
      });
      dispatch({
        type: 'finish',
        selection: { ...selection, directive: current },
      });
    };
    const cancel = (): void => {
      cleanup();
      restore();
      dispatch({ type: 'cancel' });
    };
    const teardown = (): void => {
      cleanup();
      restore();
    };
    const key = (keyboard: globalThis.KeyboardEvent): void => {
      if (keyboard.key === 'Escape') {
        keyboard.preventDefault();
        cancel();
      }
    };
    owner.addEventListener('pointermove', move);
    owner.addEventListener('pointerup', commit, {
      once: true,
    });
    owner.addEventListener('pointercancel', cancel, {
      once: true,
    });
    owner.addEventListener('lostpointercapture', cancel, {
      once: true,
    });
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    resizeCleanupRef.current = teardown;
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const selection = state.selection;
    if (!selection) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hostRef.current = null;
      dispatch({ type: 'clear' });
      setBounds(null);
      return;
    }
    if (event.key === 'Delete' && !readOnly) {
      event.preventDefault();
      onOperationRef.current?.({
        type: 'delete',
        sourceRange: selection.sourceRange,
      });
      dispatch({ type: 'clear' });
      setBounds(null);
      return;
    }
    if (!event.key.startsWith('Arrow') || readOnly) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      const delta =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -16 : 16;
      const directive = resizeImageDirective(
        selection.directive,
        'east',
        delta,
        0,
        false,
        editorRef.current?.clientWidth ?? selection.directive.maxWidth,
      );
      onOperationRef.current?.({
        type: 'change',
        sourceRange: selection.sourceRange,
        directive,
      });
      dispatch({
        type: 'select',
        selection: { ...selection, directive },
      });
      return;
    }
    if (selection.directive.positionLock) {
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (selection.directive.mode === 'inline') {
        return;
      }
      const alignments =
        selection.directive.mode === 'wrap'
          ? (['left', 'right'] as const)
          : (['left', 'center', 'right'] as const);
      const current = alignments.findIndex(
        (alignment) => alignment === selection.directive.align,
      );
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const align =
        alignments[
          Math.max(0, Math.min(alignments.length - 1, current + direction))
        ]!;
      const directive = { ...selection.directive, align };
      onOperationRef.current?.({
        type: 'change',
        sourceRange: selection.sourceRange,
        directive,
      });
      dispatch({
        type: 'select',
        selection: { ...selection, directive },
      });
    } else {
      onOperationRef.current?.({
        type: 'move',
        sourceRange: selection.sourceRange,
        intent: {
          kind: 'block-boundary',
          align: selection.directive.align,
          boundaryIndex:
            selection.lineIndex + (event.key === 'ArrowUp' ? -1 : 2),
        },
        directive: selection.directive,
      });
    }
  };

  const replaceFromDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const selection = stateRef.current.selection;
    if (readOnly || !selection) {
      return;
    }
    const serialized = event.dataTransfer.getData(MEDIA_ASSET_TRANSFER);
    if (!serialized) {
      return;
    }
    event.preventDefault();
    try {
      const value = JSON.parse(serialized) as {
        assetId?: string;
        projectId?: string;
      };
      if (!value.assetId || !value.projectId || value.projectId !== projectId) {
        return;
      }
      void window.flyoff.getMediaGallery().then((result) => {
        const asset = result.ok
          ? result.value.assets.find(({ assetId }) => assetId === value.assetId)
          : undefined;
        if (!asset || asset.kind !== 'image') {
          return;
        }
        const directive = {
          ...selection.directive,
          assetId: asset.assetId,
          path: asset.relativePath,
        };
        onOperationRef.current?.({
          type: 'change',
          sourceRange: selection.sourceRange,
          directive,
        });
        dispatch({
          type: 'select',
          selection: { ...selection, directive },
        });
      });
    } catch {
      return;
    }
  };

  const selected = state.selection;
  const menuItems: readonly MenuItem[] = selected
    ? [
        {
          kind: 'action',
          id: 'open-gallery',
          label: translate('projects.imageOpenGallery'),
        },
        {
          kind: 'submenu',
          id: 'mode',
          label: translate('projects.imageMode'),
          children: [
            {
              kind: 'action',
              id: 'mode-inline',
              label: translate('projects.imageInline'),
              checked: selected.directive.mode === 'inline',
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'mode-block',
              label: translate('projects.imageBlock'),
              checked: selected.directive.mode === 'block',
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'mode-wrap',
              label: translate('projects.imageWrap'),
              checked: selected.directive.mode === 'wrap',
              disabled: readOnly,
            },
          ],
        },
        {
          kind: 'submenu',
          id: 'align',
          label: translate('projects.imageAlign'),
          children: [
            {
              kind: 'action',
              id: 'align-left',
              label: translate('projects.imageAlignLeft'),
              checked: selected.directive.align === 'left',
              disabled: readOnly || selected.directive.mode === 'inline',
            },
            {
              kind: 'action',
              id: 'align-center',
              label: translate('projects.imageAlignCenter'),
              checked: selected.directive.align === 'center',
              disabled: readOnly || selected.directive.mode !== 'block',
            },
            {
              kind: 'action',
              id: 'align-right',
              label: translate('projects.imageAlignRight'),
              checked: selected.directive.align === 'right',
              disabled: readOnly || selected.directive.mode === 'inline',
            },
          ],
        },
        {
          kind: 'submenu',
          id: 'size-limits',
          label: translate('projects.imageSizeLimits'),
          children: [
            {
              kind: 'action',
              id: 'restore-size',
              label: translate('projects.imageRestoreOriginal'),
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'ratio-lock',
              label: translate('projects.imageRatioLock'),
              checked: selected.directive.ratioLock,
              disabled: readOnly,
            },
            {
              kind: 'separator',
              id: 'size-limits-separator',
            },
            {
              kind: 'action',
              id: 'minimum-current',
              label: translate('projects.imageSetMinimum'),
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'maximum-current',
              label: translate('projects.imageSetMaximum'),
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'limits-reset',
              label: translate('projects.imageResetLimits'),
              disabled: readOnly,
            },
          ],
        },
        {
          kind: 'submenu',
          id: 'image-details',
          label: translate('projects.properties'),
          children: [
            {
              kind: 'action',
              id: 'alt-text',
              label: translate('projects.imageAltText'),
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'caption',
              label: translate('projects.imageCaption'),
              disabled: readOnly,
            },
            {
              kind: 'action',
              id: 'replace',
              label: translate('projects.imageReplace'),
              disabled: readOnly,
            },
          ],
        },
        {
          kind: 'action',
          id: 'position-lock',
          label: translate('projects.imagePositionLock'),
          checked: selected.directive.positionLock,
          disabled: readOnly,
        },
        { kind: 'separator', id: 'image-edit-separator' },
        {
          kind: 'action',
          id: 'copy',
          label: translate('menu.copy'),
        },
        {
          kind: 'action',
          id: 'cut',
          label: translate('menu.cut'),
          disabled: readOnly,
        },
        {
          kind: 'action',
          id: 'duplicate',
          label: translate('projects.imageDuplicate'),
          disabled: readOnly,
        },
        {
          kind: 'action',
          id: 'delete',
          label: translate('projects.mediaDelete'),
          disabled: readOnly,
          tone: 'danger',
        },
      ]
    : [];

  const applyContextAction = (action: string): void => {
    const selection = stateRef.current.selection;
    setContext(undefined);
    if (!selection) {
      return;
    }
    if (action === 'open-gallery') {
      onRevealAsset?.(selection.directive.assetId);
      return;
    }
    if (action === 'copy' || action === 'cut') {
      void navigator.clipboard
        .writeText(serializeImageDirective(selection.directive))
        .then(() => {
          if (action === 'cut' && !readOnly) {
            onOperationRef.current?.({
              type: 'delete',
              sourceRange: selection.sourceRange,
            });
          }
        });
      return;
    }
    if (action === 'duplicate') {
      onOperationRef.current?.({
        type: 'duplicate',
        sourceRange: selection.sourceRange,
        directive: selection.directive,
      });
      return;
    }
    if (action === 'alt-text' || action === 'caption') {
      const kind = action === 'alt-text' ? 'alt' : 'caption';
      setMetadataEdit(kind);
      setMetadataValue(
        kind === 'alt' ? selection.directive.alt : selection.directive.caption,
      );
      return;
    }
    if (action === 'replace') {
      void window.flyoff
        .selectProjectMedia({ parentId: null })
        .then((result) => {
          const asset = result.ok
            ? result.value.assets.find(({ kind }) => kind === 'image')
            : undefined;
          if (!asset) {
            return;
          }
          window.dispatchEvent(new Event(MEDIA_LIBRARY_CHANGED_EVENT));
          const directive = {
            ...selection.directive,
            assetId: asset.nodeId,
            path: asset.relativePath,
          };
          onOperationRef.current?.({
            type: 'change',
            sourceRange: selection.sourceRange,
            directive,
          });
          dispatch({
            type: 'select',
            selection: { ...selection, directive },
          });
        });
      return;
    }
    if (
      action === 'minimum-current' ||
      action === 'maximum-current' ||
      action === 'limits-reset'
    ) {
      const directive = normalizeImageDirective({
        ...selection.directive,
        minWidth:
          action === 'minimum-current'
            ? selection.directive.width
            : action === 'limits-reset'
              ? 96
              : selection.directive.minWidth,
        maxWidth:
          action === 'maximum-current'
            ? selection.directive.width
            : action === 'limits-reset'
              ? 1200
              : selection.directive.maxWidth,
      });
      onOperationRef.current?.({
        type: 'change',
        sourceRange: selection.sourceRange,
        directive,
      });
      dispatch({
        type: 'select',
        selection: { ...selection, directive },
      });
      return;
    }
    if (action === 'delete') {
      onOperationRef.current?.({
        type: 'delete',
        sourceRange: selection.sourceRange,
      });
      dispatch({ type: 'clear' });
      setBounds(null);
      return;
    }
    if (action === 'restore-size') {
      void window.flyoff.getMediaGallery().then((result) => {
        if (!result.ok) {
          return;
        }
        const asset = result.value.assets.find(
          ({ assetId }) => assetId === selection.directive.assetId,
        );
        if (!asset?.pixelWidth || !asset.pixelHeight) {
          return;
        }
        const width = Math.min(selection.directive.maxWidth, asset.pixelWidth);
        const directive = normalizeImageDirective({
          ...selection.directive,
          width,
          height: Math.round((width * asset.pixelHeight) / asset.pixelWidth),
        });
        onOperationRef.current?.({
          type: 'change',
          sourceRange: selection.sourceRange,
          directive,
        });
        dispatch({
          type: 'select',
          selection: { ...selection, directive },
        });
      });
      return;
    }
    const [group, value] = action.split('-');
    let directive = selection.directive;
    if (
      group === 'mode' &&
      (value === 'inline' || value === 'block' || value === 'wrap')
    ) {
      directive = normalizeImageDirective({
        ...directive,
        mode: value,
        align:
          value === 'inline'
            ? 'left'
            : value === 'wrap' && directive.align === 'center'
              ? 'left'
              : directive.align,
      });
    } else if (
      group === 'align' &&
      (value === 'left' || value === 'center' || value === 'right')
    ) {
      directive = normalizeImageDirective({
        ...directive,
        align: value,
      });
    } else if (action === 'ratio-lock') {
      directive = {
        ...directive,
        ratioLock: !directive.ratioLock,
      };
    } else if (action === 'position-lock') {
      directive = {
        ...directive,
        positionLock: !directive.positionLock,
      };
    } else {
      return;
    }
    onOperationRef.current?.({
      type: 'change',
      sourceRange: selection.sourceRange,
      directive,
    });
    dispatch({
      type: 'select',
      selection: { ...selection, directive },
    });
  };

  return (
    <>
      <div
        aria-hidden={!selected}
        className="markdown-image-layer"
        ref={layerRef}
      >
        {dropBounds ? (
          <div
            aria-hidden="true"
            className="markdown-image-drop-target"
            style={{
              height: dropBounds.height,
              left: dropBounds.left,
              top: dropBounds.top,
              width: dropBounds.width,
            }}
          />
        ) : null}
        {selected && bounds && !dropBounds ? (
          <div
            aria-label={`Imagem: ${selected.directive.alt || 'sem texto alternativo'}`}
            className="markdown-image-overlay"
            data-phase={state.phase}
            onDragOver={(event) => {
              if (
                !readOnly &&
                event.dataTransfer.types.includes(MEDIA_ASSET_TRANSFER)
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={replaceFromDrop}
            onKeyDown={handleKeyboard}
            role="group"
            style={{
              height: bounds.height,
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
            }}
            tabIndex={0}
            {...getTooltipTargetProps('Imagem selecionada', 'top')}
          >
            {readOnly
              ? null
              : DIRECTIONS.map((direction) => (
                  <button
                    aria-label={`Redimensionar ${direction}`}
                    className={`markdown-image-overlay__handle markdown-image-overlay__handle--${direction}`}
                    data-direction={direction}
                    key={direction}
                    onPointerDown={(event) => beginResize(event, direction)}
                    tabIndex={-1}
                    type="button"
                  />
                ))}
          </div>
        ) : null}
      </div>
      {context && selected ? (
        <ContextMenu
          ariaLabel={translate('projects.imageMenu')}
          items={menuItems}
          onAction={applyContextAction}
          onClose={() => {
            setContext(undefined);
            dispatch({ type: 'finish' });
          }}
          x={context.x}
          y={context.y}
        />
      ) : null}
      {metadataEdit && selected ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          footerEnd={
            <>
              <button onClick={() => setMetadataEdit(undefined)} type="button">
                {translate('projects.cancel')}
              </button>
              <button
                onClick={() => {
                  const directive = {
                    ...selected.directive,
                    ...(metadataEdit === 'alt'
                      ? { alt: metadataValue }
                      : { caption: metadataValue }),
                  };
                  onOperationRef.current?.({
                    type: 'change',
                    sourceRange: selected.sourceRange,
                    directive,
                  });
                  dispatch({
                    type: 'select',
                    selection: { ...selected, directive },
                  });
                  setMetadataEdit(undefined);
                }}
                type="button"
              >
                {translate('projects.save')}
              </button>
            </>
          }
          onCancel={() => setMetadataEdit(undefined)}
          title={translate(
            metadataEdit === 'alt'
              ? 'projects.imageAltText'
              : 'projects.imageCaption',
          )}
        >
          <input
            aria-label={translate(
              metadataEdit === 'alt'
                ? 'projects.imageAltText'
                : 'projects.imageCaption',
            )}
            autoFocus
            className="markdown-image-metadata-input"
            onChange={(event) => setMetadataValue(event.currentTarget.value)}
            value={metadataValue}
          />
        </Dialog>
      ) : null}
    </>
  );
}

export const ImageInteractionLayer = memo(ImageInteractionLayerComponent);
