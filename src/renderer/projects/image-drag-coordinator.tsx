import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export type ImageDragPhase =
  | 'idle'
  | 'dragging'
  | 'holding'
  | 'settling'
  | 'returning';

export interface ImageDragPoint {
  x: number;
  y: number;
}

export interface ImageDragRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface ImageDragPayload {
  assetId: string;
  ghostHeight: number;
  ghostWidth: number;
  instanceId: string;
  projectId: string;
  source: 'gallery' | 'note';
  sourceUrl: string;
  targetHeight: number;
  targetWidth: number;
}

export interface ImageDropPreview {
  rect: ImageDragRect;
}

export interface ImageDragSession {
  destination?: ImageDragRect;
  heldRect?: ImageDragRect;
  payload?: ImageDragPayload;
  phase: ImageDragPhase;
  pointer?: ImageDragPoint;
  preview?: ImageDropPreview;
  sourceRect?: ImageDragRect;
}

const LANDING_DURATION_MS = 120;
const RETURN_DURATION_MS = 100;
const listeners = new Set<() => void>();
let session: ImageDragSession = { phase: 'idle' };
let completionTimer: number | undefined;
let completion: (() => void) | undefined;
let landingFrame: number | undefined;
let pointerFrame: number | undefined;
let pendingPointer: ImageDragPoint | undefined;

function publish(next: ImageDragSession): void {
  session = next;
  for (const listener of listeners) {
    listener();
  }
}

function reducedMotion(): boolean {
  const preference = document.documentElement.dataset.motion;
  if (preference === 'reduced') {
    return true;
  }
  if (preference === 'full') {
    return false;
  }
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clearCompletion(runCallback = false): void {
  if (landingFrame !== undefined) {
    window.cancelAnimationFrame(landingFrame);
    landingFrame = undefined;
  }
  if (completionTimer !== undefined) {
    window.clearTimeout(completionTimer);
    completionTimer = undefined;
  }
  const callback = completion;
  completion = undefined;
  if (runCallback) {
    callback?.();
  }
}

function clearPointerFrame(): void {
  pendingPointer = undefined;
  if (pointerFrame !== undefined) {
    window.cancelAnimationFrame(pointerFrame);
    pointerFrame = undefined;
  }
}

function finishAfterMotion(
  duration: number,
  onFinish?: () => void,
): void {
  completion = onFinish;
  if (reducedMotion()) {
    finishImageDrag();
    return;
  }
  completionTimer = window.setTimeout(finishImageDrag, duration);
}

export function imageDragSnapshot(): ImageDragSession {
  return session;
}

export function subscribeImageDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginImageDrag(
  payload: ImageDragPayload,
  pointer: ImageDragPoint,
  sourceRect: ImageDragRect,
): void {
  clearCompletion(true);
  clearPointerFrame();
  publish({
    payload,
    phase: 'dragging',
    pointer,
    sourceRect,
  });
}

export function moveImageDrag(pointer: ImageDragPoint): void {
  if (session.phase !== 'dragging') {
    return;
  }
  pendingPointer = pointer;
  if (
    typeof window.requestAnimationFrame !== 'function' ||
    typeof window.cancelAnimationFrame !== 'function'
  ) {
    pendingPointer = undefined;
    publish({ ...session, pointer });
    return;
  }
  if (pointerFrame !== undefined) {
    return;
  }
  pointerFrame = window.requestAnimationFrame(() => {
    pointerFrame = undefined;
    const nextPointer = pendingPointer;
    pendingPointer = undefined;
    if (nextPointer && session.phase === 'dragging') {
      publish({ ...session, pointer: nextPointer });
    }
  });
}

export function updateImageDropPreview(
  preview: ImageDropPreview | undefined,
): void {
  const current = session.preview?.rect;
  const next = preview?.rect;
  if (
    session.phase !== 'dragging' ||
    current === next ||
    Boolean(
      current &&
        next &&
        current.height === next.height &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width,
    ) ||
    (!current && !next)
  ) {
    return;
  }
  publish({ ...session, preview });
}

export function settleImageDrag(
  destination: ImageDragRect,
  onFinish?: () => void,
): void {
  if (session.phase === 'dragging') {
    holdImageDrag();
  }
  if (session.phase !== 'holding' || !session.payload) {
    onFinish?.();
    return;
  }
  clearCompletion();
  clearPointerFrame();
  completion = onFinish;
  if (reducedMotion()) {
    publish({ ...session, destination, phase: 'settling' });
    finishImageDrag();
    return;
  }
  landingFrame = window.requestAnimationFrame(() => {
    landingFrame = undefined;
    if (session.phase !== 'holding' || !session.payload) {
      const callback = completion;
      completion = undefined;
      callback?.();
      return;
    }
    publish({ ...session, destination, phase: 'settling' });
    finishAfterMotion(LANDING_DURATION_MS, completion);
  });
}

export function holdImageDrag(pointer?: ImageDragPoint): void {
  if (session.phase !== 'dragging' || !session.payload) {
    return;
  }
  const current = pointer ? { ...session, pointer } : session;
  const heldRect = imageDragGhostRect(current);
  clearCompletion();
  clearPointerFrame();
  if (!heldRect) {
    return;
  }
  publish({
    ...current,
    destination: undefined,
    heldRect,
    phase: 'holding',
    pointer: undefined,
  });
}

export function rejectImageDrop(onFinish?: () => void): void {
  returnImageDrag(onFinish);
}

export function returnImageDrag(onFinish?: () => void): void {
  if (session.phase === 'settling' || session.phase === 'returning') {
    return;
  }
  if (session.phase === 'idle') {
    onFinish?.();
    return;
  }
  if (
    !session.payload ||
    !session.sourceRect
  ) {
    finishImageDrag();
    onFinish?.();
    return;
  }
  clearPointerFrame();
  publish({ ...session, destination: session.sourceRect, phase: 'returning' });
  finishAfterMotion(RETURN_DURATION_MS, onFinish);
}

export function finishImageDrag(): void {
  clearPointerFrame();
  if (landingFrame !== undefined) {
    window.cancelAnimationFrame(landingFrame);
    landingFrame = undefined;
  }
  if (completionTimer !== undefined) {
    window.clearTimeout(completionTimer);
    completionTimer = undefined;
  }
  const callback = completion;
  completion = undefined;
  publish({ phase: 'idle' });
  callback?.();
}

export function transparentNativeDragImage(
  dataTransfer: DataTransfer,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  Object.assign(canvas.style, {
    left: '-10px',
    position: 'fixed',
    top: '-10px',
  });
  document.body.append(canvas);
  dataTransfer.setDragImage(canvas, 0, 0);
  queueMicrotask(() => canvas.remove());
}

export function imageDragGhostRect(
  value: ImageDragSession,
): ImageDragRect | undefined {
  const payload = value.payload;
  if (!payload) {
    return undefined;
  }
  if (
    (value.phase === 'settling' || value.phase === 'returning') &&
    value.destination
  ) {
    return value.destination;
  }
  if (value.phase === 'holding' && value.heldRect) {
    return value.heldRect;
  }
  if (!value.pointer) {
    return undefined;
  }
  return {
    height: payload.ghostHeight,
    left: value.pointer.x - payload.ghostWidth / 2,
    top: value.pointer.y - payload.ghostHeight / 2,
    width: payload.ghostWidth,
  };
}

export function ImageDragOverlay() {
  const value = useSyncExternalStore(
    subscribeImageDrag,
    imageDragSnapshot,
    imageDragSnapshot,
  );
  const bounds = imageDragGhostRect(value);
  if (!bounds || !value.payload || value.phase === 'idle') {
    return null;
  }
  return createPortal(
    <div
      aria-hidden="true"
      className="image-drag-ghost"
      data-phase={value.phase}
      style={{
        height: bounds.height,
        transform: `translate3d(${bounds.left}px, ${bounds.top}px, 0)`,
        width: bounds.width,
      }}
    >
      <img alt="" draggable={false} src={value.payload.sourceUrl} />
    </div>,
    document.body,
  );
}
