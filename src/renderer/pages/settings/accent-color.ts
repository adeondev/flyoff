import type { FlyoffTheme } from '../../../shared/contracts';

const THEME_ACCENTS: Record<FlyoffTheme, string> = {
  flyoff: '#8F4FC4',
  basalt: '#B04FD4',
};

export function themeAccentColor(theme: FlyoffTheme): string {
  return THEME_ACCENTS[theme];
}
