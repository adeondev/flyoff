import {
  DEFAULT_UI_LOCALE,
  type UiLocale,
} from '../../shared/contracts';

function matchSupportedLocale(locale: string): UiLocale | undefined {
  const language = locale.trim().replaceAll('_', '-').split('-', 1)[0];

  if (language?.toLowerCase() === 'pt') {
    return 'pt-BR';
  }

  if (language?.toLowerCase() === 'en') {
    return 'en-US';
  }

  return undefined;
}

export function resolveUiLocale(
  preferredLocales?: string | readonly string[] | null,
): UiLocale {
  const locales =
    typeof preferredLocales === 'string'
      ? [preferredLocales]
      : (preferredLocales ?? []);

  for (const locale of locales) {
    const supportedLocale = matchSupportedLocale(locale);

    if (supportedLocale) {
      return supportedLocale;
    }
  }

  return DEFAULT_UI_LOCALE;
}
