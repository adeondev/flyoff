// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createPixelSampler } from '../../src/renderer/components/color/pixel-sampler';

/**
 * jsdom draws nothing, so the canvas is stubbed with a solid readback. The
 * arithmetic under test is the CSS-to-device mapping, not the rasterizer.
 */
function stubCanvas(
  pixel: readonly number[],
  naturalWidth: number,
): { getImageData: ReturnType<typeof vi.fn> } {
  const getImageData = vi.fn(() => ({ data: Uint8ClampedArray.from(pixel) }));
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    // Only the canvas is faked; `new Image()` needs the real element.
    tag === 'canvas'
      ? ({
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn(), getImageData }),
        } as unknown as HTMLElement)
      : createElement(
          tag as string,
        )) as typeof document.createElement);
  Object.defineProperty(Image.prototype, 'decode', {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(Image.prototype, 'naturalWidth', {
    configurable: true,
    get: () => naturalWidth,
  });
  Object.defineProperty(Image.prototype, 'naturalHeight', {
    configurable: true,
    get: () => naturalWidth,
  });
  return { getImageData };
}

describe('createPixelSampler', () => {
  it('reads a pixel back as hexadecimal', async () => {
    stubCanvas([45, 232, 91, 255], 100);
    const sampler = await createPixelSampler('data:image/png;base64,x', 100);

    expect(sampler?.at(10, 10)).toBe('#2DE85B');
    expect(sampler?.scale).toBe(1);
  });

  it('maps CSS coordinates onto a high-density capture', async () => {
    const { getImageData } = stubCanvas([0, 0, 0, 255], 200);
    const sampler = await createPixelSampler('data:image/png;base64,x', 100);

    expect(sampler?.scale).toBe(2);
    sampler?.at(10, 20);
    // The capture is twice the CSS size, so the point doubles with it.
    expect(getImageData).toHaveBeenLastCalledWith(20, 40, 1, 1);
  });

  it('refuses points outside the capture', async () => {
    stubCanvas([0, 0, 0, 255], 100);
    const sampler = await createPixelSampler('data:image/png;base64,x', 100);

    expect(sampler?.at(-1, 10)).toBeNull();
    expect(sampler?.at(10, 999)).toBeNull();
  });

  it('gives up when the capture cannot be decoded', async () => {
    Object.defineProperty(Image.prototype, 'decode', {
      configurable: true,
      value: () => Promise.reject(new Error('corrupt')),
    });

    expect(await createPixelSampler('data:image/png;base64,x', 100)).toBeNull();
  });
});
