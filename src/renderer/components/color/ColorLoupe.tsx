import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { colorContrastInk } from './color-model';
import { findAuthoredColorAtPoint, resolveColorAtPoint } from './color-loupe';
import type { PixelSampler } from './pixel-sampler';

export interface ColorLoupeLabels {
  cancel: string;
  hint: string;
  locked: string;
  screen?: string;
}

interface ColorLoupeProps {
  labels: ColorLoupeLabels;
  onCancel: () => void;
  onPick: (color: string) => void;
  /** Re-takes the still after the page moves under the loupe. */
  onRefresh?: () => Promise<void>;
  /** Offered only where the platform can sample beyond the app window. */
  onScreenPick?: () => void;
  /** Absent when the capture bridge is unavailable; the DOM is read instead. */
  sampler?: PixelSampler | null;
}

interface LoupeState {
  authored: boolean;
  color: string;
  x: number;
  y: number;
}

/** Side of the magnified crop, in source pixels. Odd, so one pixel centres. */
const ZOOM_PIXELS = 13;
const ZOOM_CANVAS = 78;
/** Long enough to coalesce a scroll gesture, short enough to feel immediate. */
const REFRESH_DELAY = 90;

/**
 * Marks the whole app as picking: draws the crosshair, and tells popovers to
 * hold their outside-click close so the picker survives the confirming click.
 */
const PICKING_ATTRIBUTE = 'colorPicking';

export function isColorPicking(view: Window = window): boolean {
  return view.document.documentElement.dataset[PICKING_ATTRIBUTE] === 'true';
}

export function ColorLoupe({
  labels,
  onCancel,
  onPick,
  onRefresh,
  onScreenPick,
  sampler,
}: ColorLoupeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<LoupeState | null>(null);
  const [stale, setStale] = useState(false);

  // Read by listeners that are registered once, so they never go out of date.
  const latest = useRef({ onCancel, onPick, sampler });
  useEffect(() => {
    latest.current = { onCancel, onPick, sampler };
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset[PICKING_ATTRIBUTE] = 'true';

    const owned = (target: EventTarget | null): boolean =>
      target instanceof Node && Boolean(rootRef.current?.contains(target));

    /**
     * A colour written for this point wins outright, handed back exactly as
     * authored — anti-aliasing means the pixel there is only ever a blend of
     * it with the page. Everywhere else the pixel is the only thing that
     * knows the answer: images, emoji, gradients, the whole app.
     */
    const read = (x: number, y: number): LoupeState | null => {
      const declared = findAuthoredColorAtPoint(x, y);
      if (declared) {
        return { authored: true, color: declared, x, y };
      }

      const sampled = latest.current.sampler?.at(x, y);
      if (sampled) {
        return { authored: false, color: sampled, x, y };
      }

      const resolved = resolveColorAtPoint(x, y);
      return resolved ? { ...resolved, x, y } : null;
    };

    const pointerMove = (event: PointerEvent): void => {
      setState(read(event.clientX, event.clientY));
    };

    // Swallowed in the capture phase so the click never reaches the editor.
    const pointerDown = (event: PointerEvent): void => {
      if (owned(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const click = (event: MouseEvent): void => {
      if (owned(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Resolved fresh from the confirming click, never from stale hover state.
      const picked = read(event.clientX, event.clientY);
      if (picked) {
        latest.current.onPick(picked.color);
      } else {
        latest.current.onCancel();
      }
    };

    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onCancel();
      }
    };

    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', keyDown, true);

    return () => {
      delete root.dataset[PICKING_ATTRIBUTE];
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keyDown, true);
    };
  }, []);

  /**
   * The still goes out of date the moment the page moves under it, and a stale
   * still reports colours for content that has scrolled away. Re-take it, and
   * say so meanwhile rather than answering confidently from the old frame.
   */
  useEffect(() => {
    if (!onRefresh) {
      return;
    }
    let timer = 0;
    let active = true;

    const refresh = (): void => {
      setStale(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void onRefresh().finally(() => {
          if (active) {
            setStale(false);
          }
        });
      }, REFRESH_DELAY);
    };

    const options = { capture: true, passive: true } as const;
    window.addEventListener('scroll', refresh, options);
    window.addEventListener('wheel', refresh, options);
    window.addEventListener('resize', refresh);

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('scroll', refresh, options);
      window.removeEventListener('wheel', refresh, options);
      window.removeEventListener('resize', refresh);
    };
  }, [onRefresh]);

  useEffect(() => {
    const canvas = zoomRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !sampler || !state) {
      return;
    }
    const half = (ZOOM_PIXELS - 1) / 2;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      sampler.source,
      Math.round(state.x * sampler.scale) - half,
      Math.round(state.y * sampler.scale) - half,
      ZOOM_PIXELS,
      ZOOM_PIXELS,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [sampler, state]);

  return createPortal(
    <div className="color-loupe-layer" ref={rootRef}>
      {state ? (
        <span
          className="color-loupe"
          data-authored={state.authored || undefined}
          data-stale={(stale && !state.authored) || undefined}
          style={
            {
              '--loupe-cell': `${ZOOM_CANVAS / ZOOM_PIXELS}px`,
              '--loupe-color': state.color,
              '--loupe-ink': colorContrastInk(state.color),
              '--loupe-x': `${state.x}px`,
              '--loupe-y': `${state.y}px`,
            } as CSSProperties
          }
        >
          <span className="color-loupe__well">
            {sampler ? (
              <canvas
                className="color-loupe__zoom"
                height={ZOOM_CANVAS}
                ref={zoomRef}
                width={ZOOM_CANVAS}
              />
            ) : null}
            <span className="color-loupe__cell" />
          </span>
          <span className="color-loupe__value">{state.color}</span>
          {state.authored ? (
            <span className="color-loupe__badge">{labels.locked}</span>
          ) : null}
        </span>
      ) : null}
      <div className="color-loupe-bar">
        <span>{labels.hint}</span>
        {onScreenPick ? (
          <button onClick={onScreenPick} type="button">
            {labels.screen}
          </button>
        ) : null}
        <button onClick={onCancel} type="button">
          {labels.cancel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
