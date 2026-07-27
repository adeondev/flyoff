import { describe, expect, it } from 'vitest';

import {
  colorContrastInk,
  hsvToRgb,
  parseHexColor,
  rgbToHex,
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
});
