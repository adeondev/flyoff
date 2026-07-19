import type { BrowserWindow } from 'electron';

import type { FlyoffTheme } from '../../shared/contracts';

interface WindowThemeColors {
  background: string;
  symbol: string;
  titlebar: string;
}

export const WINDOW_TITLE_BAR_OVERLAY = {
  color: '#00000000',
  height: 40,
} as const;

const WINDOW_THEME_COLORS: Record<FlyoffTheme, WindowThemeColors> = {
  flyoff: {
    background: '#222226',
    symbol: '#f4eff7',
    titlebar: '#1b1b1e',
  },
  basalt: {
    background: '#131014',
    symbol: '#f4f0f6',
    titlebar: '#100f11',
  },
};

export function getWindowThemeColors(theme: FlyoffTheme): WindowThemeColors {
  return WINDOW_THEME_COLORS[theme];
}

export function applyWindowTheme(
  window: BrowserWindow,
  theme: FlyoffTheme,
): void {
  if (window.isDestroyed()) {
    return;
  }

  const colors = getWindowThemeColors(theme);
  window.setBackgroundColor(colors.background);
  if (process.platform !== 'darwin') {
    window.setTitleBarOverlay({
      ...WINDOW_TITLE_BAR_OVERLAY,
      symbolColor: colors.symbol,
    });
  }
}
