import { parseColor, rgbaToHex } from './color-model';

export interface ResolvedColor {
  /** True when the value was written in the note, not sampled from a surface. */
  authored: boolean;
  color: string;
}

/** Deep enough to leave any inline run, short enough to never walk the app. */
const MAX_DEPTH = 24;

function asElement(node: Element | null): HTMLElement | null {
  return node && 'style' in node && 'dataset' in node
    ? (node as HTMLElement)
    : null;
}

function normalize(value: string | undefined): string | null {
  const parsed = value ? parseColor(value) : null;
  return parsed && parsed.alpha > 0 ? rgbaToHex(parsed) : null;
}

/**
 * The colour a note author wrote here, if any. Highlights carry it as the
 * background and set the text to contrast ink, so background wins.
 */
function authoredColor(element: HTMLElement): string | null {
  return (
    normalize(element.dataset.mdColorValue) ??
    normalize(element.style.backgroundColor) ??
    normalize(element.style.color)
  );
}

/**
 * Reads the colour under a point straight from the DOM. Unlike sampling the
 * screen, an authored colour comes back exactly as written — anti-aliasing
 * never enters into it.
 */
/** Paints its own pixels, so no colour declared around it describes it. */
const SELF_PAINTING = new Set([
  'CANVAS',
  'IFRAME',
  'IMG',
  'PICTURE',
  'SVG',
  'VIDEO',
]);

/**
 * The colour written for this point, if any. A run reports its colour across
 * its whole box, gaps between glyphs included — hovering coloured words is a
 * clear request for that colour, not for the page showing through them. The
 * search stops at media, whose pixels belong to the image, not to its parent.
 */
export function findAuthoredColorAtPoint(
  x: number,
  y: number,
  view: Window = window,
): string | null {
  let node = asElement(view.document.elementFromPoint(x, y));

  for (let depth = 0; node && depth < MAX_DEPTH; depth += 1) {
    if (SELF_PAINTING.has(node.tagName.toUpperCase())) {
      return null;
    }
    const authored = authoredColor(node);
    if (authored) {
      return authored;
    }
    node = asElement(node.parentElement);
  }

  return null;
}

export function resolveColorAtPoint(
  x: number,
  y: number,
  view: Window = window,
): ResolvedColor | null {
  const origin = asElement(view.document.elementFromPoint(x, y));
  if (!origin) {
    return null;
  }

  const authored = findAuthoredColorAtPoint(x, y, view);
  if (authored) {
    return { authored: true, color: authored };
  }

  let node: HTMLElement | null = origin;
  for (let depth = 0; node && depth < MAX_DEPTH; depth += 1) {
    const surface = normalize(
      view.getComputedStyle(node).backgroundColor,
    );
    if (surface) {
      return { authored: false, color: surface };
    }
    node = asElement(node.parentElement);
  }

  return null;
}
