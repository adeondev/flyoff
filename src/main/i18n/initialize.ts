import { app } from 'electron';
import type { i18n } from 'i18next';
import type { UiLocale } from '../../shared/contracts';
import {
  createFlyoffI18n,
  type FlyoffTranslator,
} from '../../shared/i18n';
import { resolveUiLocale } from './locale';

export interface MainI18n {
  instance: i18n;
  locale: UiLocale;
  t: FlyoffTranslator;
}

export function createMainTranslator(instance: i18n): FlyoffTranslator {
  return (key) => instance.t(key);
}

export async function initializeMainI18n(
  preferredLocales: readonly string[] = app.getPreferredSystemLanguages(),
): Promise<MainI18n> {
  const locale = resolveUiLocale(preferredLocales);
  const instance = await createFlyoffI18n(locale);

  return {
    instance,
    locale,
    t: createMainTranslator(instance),
  };
}
