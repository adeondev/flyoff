// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findAuthoredColorAtPoint,
  resolveColorAtPoint,
} from '../../src/renderer/components/color';

type HitTestable = { elementFromPoint?: (x: number, y: number) => Element | null };

afterEach(() => {
  document.body.innerHTML = '';
  delete (document as HitTestable).elementFromPoint;
  vi.restoreAllMocks();
});

/** jsdom has no layout and so ships no hit testing; stub an explicit target. */
function pointAt(element: Element | null): void {
  (document as HitTestable).elementFromPoint = () => element;
}

describe('resolveColorAtPoint', () => {
  it('reads the exact colour an author wrote on the text', () => {
    document.body.innerHTML =
      '<span class="md-source-colored-text"><span style="color:#3B82F6" id="t">blue</span></span>';
    pointAt(document.getElementById('t'));

    expect(resolveColorAtPoint(10, 10)).toEqual({
      authored: true,
      color: '#3B82F6',
    });
  });

  it('prefers a highlight background over its contrast ink', () => {
    document.body.innerHTML =
      '<span id="h" style="background:#2DE85B;color:#000000">green</span>';
    pointAt(document.getElementById('h'));

    expect(resolveColorAtPoint(10, 10)).toEqual({
      authored: true,
      color: '#2DE85B',
    });
  });

  it('climbs out of a nested run to find the colour around it', () => {
    document.body.innerHTML =
      '<span style="background:#2DE85B"><strong><em id="deep">x</em></strong></span>';
    pointAt(document.getElementById('deep'));

    expect(resolveColorAtPoint(10, 10)?.color).toBe('#2DE85B');
  });

  it('reads the swatch a source trigger carries', () => {
    document.body.innerHTML =
      '<button id="b" data-md-color-value="#8F4FC4"></button>';
    pointAt(document.getElementById('b'));

    expect(resolveColorAtPoint(10, 10)).toEqual({
      authored: true,
      color: '#8F4FC4',
    });
  });

  it('falls back to the surface underneath, flagged as sampled', () => {
    document.body.innerHTML = '<div id="plain">no colour here</div>';
    const plain = document.getElementById('plain')!;
    pointAt(plain);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(17, 24, 39)',
    } as CSSStyleDeclaration);

    expect(resolveColorAtPoint(10, 10)).toEqual({
      authored: false,
      color: '#111827',
    });
  });

  it('ignores fully transparent declarations', () => {
    document.body.innerHTML =
      '<span id="ghost" style="background:rgba(0,0,0,0)">x</span>';
    pointAt(document.getElementById('ghost'));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgba(0, 0, 0, 0)',
    } as CSSStyleDeclaration);

    expect(resolveColorAtPoint(10, 10)).toBeNull();
  });

  it('reports no written colour for media inside a coloured run', () => {
    document.body.innerHTML =
      '<span style="color:#2DE85B"><img id="glyph" alt=""></span>';
    pointAt(document.getElementById('glyph'));

    // The run's colour does not describe the image; its pixels do.
    expect(findAuthoredColorAtPoint(10, 10)).toBeNull();
  });

  it('still reports the run colour for text beside that media', () => {
    document.body.innerHTML =
      '<span style="color:#2DE85B"><img alt=""><em id="word">hi</em></span>';
    pointAt(document.getElementById('word'));

    expect(findAuthoredColorAtPoint(10, 10)).toBe('#2DE85B');
  });

  it('returns nothing when the point hits no element', () => {
    pointAt(null);
    expect(resolveColorAtPoint(10, 10)).toBeNull();
  });
});
