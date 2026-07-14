import { createInstance, type i18n } from 'i18next';

import {
  DEFAULT_UI_LOCALE,
  UI_LOCALES,
  type UiLocale,
} from '../contracts';
import { I18NEXT_RESOURCES } from './catalogs';

export async function createFlyoffI18n(locale: UiLocale): Promise<i18n> {
  const instance = createInstance();

  await instance.init({
    resources: I18NEXT_RESOURCES,
    lng: locale,
    fallbackLng: DEFAULT_UI_LOCALE,
    supportedLngs: [...UI_LOCALES],
    ns: ['translation'],
    defaultNS: 'translation',
    load: 'currentOnly',
    returnNull: false,
    interpolation: {
      escapeValue: false,
    },
  });

  return instance;
}
