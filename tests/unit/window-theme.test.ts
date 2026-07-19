import { describe, expect, it, vi } from 'vitest';

import {
  applyWindowTheme,
  getWindowThemeColors,
} from '../../src/main/window';

describe('native window theme', () => {
  it('keeps native colors aligned with renderer theme tokens', () => {
    expect(getWindowThemeColors('flyoff')).toEqual({
      background: '#222226',
      symbol: '#f4eff7',
      titlebar: '#1b1b1e',
    });
    expect(getWindowThemeColors('basalt')).toEqual({
      background: '#131014',
      symbol: '#f4f0f6',
      titlebar: '#100f11',
    });
  });

  it('updates the window background and overlay together', () => {
    const window = {
      isDestroyed: () => false,
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };

    applyWindowTheme(window as never, 'flyoff');

    expect(window.setBackgroundColor).toHaveBeenCalledWith('#222226');
    if (process.platform !== 'darwin') {
      expect(window.setTitleBarOverlay).toHaveBeenCalledWith({
        color: '#00000000',
        height: 40,
        symbolColor: '#f4eff7',
      });
    }
  });
});
