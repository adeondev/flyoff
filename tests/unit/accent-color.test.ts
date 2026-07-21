import { describe, expect, it } from 'vitest';

import { ACCENT_COLOR_PRESETS } from '../../src/shared/contracts';
import { themeAccentColor } from '../../src/renderer/pages/settings/accent-color';

describe('accent color presets', () => {
  it('keeps the original accent for each theme', () => {
    expect(themeAccentColor('flyoff')).toBe('#8F4FC4');
    expect(themeAccentColor('basalt')).toBe('#B04FD4');
  });

  it('offers sixteen unique colors with safe white text contrast', () => {
    const luminance = (color: string) => {
      const channels = [1, 3, 5].map((offset) => {
        const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * channels[0]! +
        0.7152 * channels[1]! +
        0.0722 * channels[2]!
      );
    };

    expect(ACCENT_COLOR_PRESETS).toHaveLength(16);
    expect(new Set(ACCENT_COLOR_PRESETS)).toHaveLength(16);
    for (const color of ACCENT_COLOR_PRESETS) {
      expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
