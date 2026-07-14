import type { i18n } from 'i18next';

import type { UiLocale } from '../shared/contracts';
import { createFlyoffI18n } from '../shared/i18n';

let initialization: Promise<i18n> | undefined;

export async function initializeRendererI18n(locale: UiLocale): Promise<i18n> {
  const instance = await (initialization ??= createFlyoffI18n(locale));

  if (instance.resolvedLanguage !== locale) {
    await instance.changeLanguage(locale);
  }

  return instance;
}
