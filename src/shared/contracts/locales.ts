export const UI_LOCALES = ['pt-BR', 'en-US'] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE = 'pt-BR' satisfies UiLocale;

export function isUiLocale(value: unknown): value is UiLocale {
  return (
    typeof value === 'string' &&
    (UI_LOCALES as readonly string[]).includes(value)
  );
}
