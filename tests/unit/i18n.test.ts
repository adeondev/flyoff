import { describe, expect, it } from 'vitest';

import { resolveUiLocale } from '../../src/main/i18n/locale';
import { initializeRendererI18n } from '../../src/renderer/i18n';
import { createFlyoffI18n } from '../../src/shared/i18n';

describe('resolveUiLocale', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['pt_PT', 'pt-BR'],
    ['PT-br', 'pt-BR'],
    ['en-US', 'en-US'],
    ['en_GB', 'en-US'],
    ['EN-us', 'en-US'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(resolveUiLocale(input)).toBe(expected);
  });

  it('uses the first supported locale in preference order', () => {
    expect(resolveUiLocale(['fr-FR', 'en-GB', 'pt-BR'])).toBe('en-US');
  });

  it.each([undefined, null, [], ['es-ES', 'de-DE'], '']) (
    'falls back to pt-BR for %j',
    (input) => {
      expect(resolveUiLocale(input)).toBe('pt-BR');
    },
  );
});

describe('shared i18next foundation', () => {
  it('uses the typed catalogs and pt-BR fallback', async () => {
    const instance = await createFlyoffI18n('pt-BR');

    expect(instance.t('menu.file')).toBe('Arquivo');
    expect(instance.t('menu.help', { lng: 'en-US' })).toBe('Help');
  });

  it('keeps one renderer instance while changing UI locale', async () => {
    const english = await initializeRendererI18n('en-US');
    const portuguese = await initializeRendererI18n('pt-BR');

    expect(portuguese).toBe(english);
    expect(portuguese.t('menu.edit')).toBe('Editar');
  });
});
