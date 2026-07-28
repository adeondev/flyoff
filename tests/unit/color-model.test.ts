import { describe, expect, it } from 'vitest';

import {
  colorContrastInk,
  colorDistance,
  contrastRatio,
  formatColor,
  nearestColor,
  hslToRgb,
  hsvToRgb,
  parseColor,
  parseHexColor,
  parseHexRgba,
  rgbaToHex,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from '../../src/renderer/components/color';

describe('color model', () => {
  it('normalizes hexadecimal colors and rejects CSS expressions', () => {
    expect(rgbToHex(parseHexColor('#3b82f6')!)).toBe('#3B82F6');
    expect(parseHexColor('3B82F6')).toEqual({
      red: 59,
      green: 130,
      blue: 246,
    });
    expect(parseHexColor('var(--accent)')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
  });

  it('round-trips RGB through HSV without changing the selected color', () => {
    const source = { red: 59, green: 130, blue: 246 };
    expect(hsvToRgb(rgbToHsv(source))).toEqual(source);
  });

  it('selects readable ink for light and dark backgrounds', () => {
    expect(colorContrastInk('#F8FAFC')).toBe('#000000');
    expect(colorContrastInk('#111827')).toBe('#FFFFFF');
  });

  it('expands shorthand hexadecimal and reads the alpha pair', () => {
    expect(parseHexColor('#fff')).toEqual({
      red: 255,
      green: 255,
      blue: 255,
    });
    expect(parseHexRgba('#3B82F680')?.alpha).toBeCloseTo(128 / 255, 5);
    expect(parseHexRgba('#3B82F6')?.alpha).toBe(1);
    expect(parseHexColor('#12345')).toBeNull();
  });

  it('keeps opaque colours six digits and translucent ones eight', () => {
    const rgb = { red: 59, green: 130, blue: 246 };
    expect(rgbaToHex({ ...rgb, alpha: 1 })).toBe('#3B82F6');
    expect(rgbaToHex({ ...rgb, alpha: 0.5 })).toBe('#3B82F680');
  });

  it('round-trips RGB through HSL', () => {
    const source = { red: 59, green: 130, blue: 246 };
    expect(hslToRgb(rgbToHsl(source))).toEqual(source);
    expect(hslToRgb(rgbToHsl({ red: 0, green: 0, blue: 0 }))).toEqual({
      red: 0,
      green: 0,
      blue: 0,
    });
  });

  it('parses rgb() and hsl() notation but rejects CSS expressions', () => {
    expect(parseColor('rgb(59 130 246)')).toEqual({
      red: 59,
      green: 130,
      blue: 246,
      alpha: 1,
    });
    expect(parseColor('rgba(59, 130, 246, 0.5)')?.alpha).toBe(0.5);
    expect(parseColor('hsl(217 91% 60%)')?.red).toBeCloseTo(59, -1);
    expect(parseColor('var(--accent)')).toBeNull();
    expect(parseColor('url(evil)')).toBeNull();
  });

  it('measures WCAG contrast between the extremes', () => {
    const black = { red: 0, green: 0, blue: 0 };
    const white = { red: 255, green: 255, blue: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(contrastRatio(black, white)).toBe(contrastRatio(white, black));
  });

  it('snaps an anti-aliased sample back onto the colour it came from', () => {
    const authored = ['#2DE85B', '#3B82F6'];
    // A screen sample of coloured text blends toward the page background.
    const blended = { red: 66, green: 234, blue: 107 };

    expect(nearestColor(blended, authored)).toBe('#2DE85B');
    expect(nearestColor(parseColor('#2DE85B')!, authored)).toBe('#2DE85B');
  });

  it('leaves a sample alone when no authored colour is close', () => {
    expect(nearestColor(parseColor('#FF0000')!, ['#2DE85B'])).toBeNull();
    expect(nearestColor(parseColor('#2DE85B')!, [])).toBeNull();
    expect(nearestColor(parseColor('#2DE85B')!, ['nonsense'])).toBeNull();
  });

  it('prefers the closest authored colour when several are similar', () => {
    expect(
      nearestColor(parseColor('#2DE85B')!, ['#2FE85D', '#2DE85B']),
    ).toBe('#2DE85B');
    expect(colorDistance(parseColor('#000')!, parseColor('#FFF')!)).toBeCloseTo(
      765,
      0,
    );
    expect(colorDistance(parseColor('#2DE85B')!, parseColor('#2DE85B')!)).toBe(
      0,
    );
  });

  it('serializes each notation and only shows alpha when translucent', () => {
    const opaque = { red: 59, green: 130, blue: 246, alpha: 1 };
    expect(formatColor(opaque, 'hex')).toBe('#3B82F6');
    expect(formatColor(opaque, 'rgb')).toBe('rgb(59 130 246)');
    expect(formatColor(opaque, 'hsl')).toBe('hsl(217 91% 60%)');
    expect(formatColor({ ...opaque, alpha: 0.5 }, 'rgb')).toBe(
      'rgb(59 130 246 / 0.5)',
    );
  });
});
