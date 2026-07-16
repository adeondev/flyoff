import { describe, expect, it } from 'vitest';

import {
  isBootstrapState,
  isApplicationMenuCommand,
  isNativeCoreMessage,
  isOpenExternalLinkRequest,
  isOpenExternalLinkResult,
  isSpellcheckCapabilities,
  isUiLocale,
  isWindowControlAction,
  isWindowState,
  type BootstrapState,
} from '../../src/shared/contracts';
import {
  I18NEXT_RESOURCES,
  TRANSLATION_CATALOGS,
  enUS,
  ptBR,
} from '../../src/shared/i18n';

function leafPaths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return typeof child === 'object' && child !== null
      ? leafPaths(child as object, path)
      : [path];
  });
}

const validBootstrapState: BootstrapState = {
  platform: 'linux',
  uiLocale: 'pt-BR',
  nativeCore: {
    coreVersion: '0.1.0',
    protocolVersion: 1,
  },
  spellcheck: {
    provider: 'chromium-hunspell',
    canSelectLanguages: true,
    downloadsDictionaries: true,
  },
};

describe('translation catalogs', () => {
  it('keeps both locales structurally identical and non-empty', () => {
    expect(leafPaths(enUS).sort()).toEqual(leafPaths(ptBR).sort());

    for (const catalog of Object.values(TRANSLATION_CATALOGS)) {
      for (const value of Object.values(catalog).flatMap(Object.values)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('provides the required initial menu labels', () => {
    expect(ptBR.menu).toMatchObject({
      file: 'Arquivo',
      edit: 'Editar',
      view: 'Exibir',
      help: 'Ajuda',
    });
    expect(enUS.menu).toMatchObject({
      file: 'File',
      edit: 'Edit',
      view: 'View',
      help: 'Help',
    });
  });

  it('provides localized custom window control labels', () => {
    expect(ptBR.windowControls).toEqual({
      minimize: 'Minimizar',
      maximize: 'Maximizar',
      restore: 'Restaurar',
      close: 'Fechar',
    });
    expect(enUS.windowControls).toEqual({
      minimize: 'Minimize',
      maximize: 'Maximize',
      restore: 'Restore',
      close: 'Close',
    });
  });

  it('exposes catalogs in the i18next resource shape', () => {
    expect(I18NEXT_RESOURCES['pt-BR'].translation).toBe(ptBR);
    expect(I18NEXT_RESOURCES['en-US'].translation).toBe(enUS);
  });
});

describe('shared contract guards', () => {
  it('accepts a complete bootstrap state', () => {
    expect(isBootstrapState(validBootstrapState)).toBe(true);
  });

  it.each([
    { ...validBootstrapState, platform: 'freebsd' },
    { ...validBootstrapState, uiLocale: 'es-ES' },
    {
      ...validBootstrapState,
      nativeCore: { coreVersion: '', protocolVersion: 1 },
    },
    {
      ...validBootstrapState,
      spellcheck: {
        provider: 'unknown',
        canSelectLanguages: true,
        downloadsDictionaries: true,
      },
    },
    null,
  ])('rejects invalid bootstrap payloads', (payload) => {
    expect(isBootstrapState(payload)).toBe(false);
  });

  it('keeps UI locales and spellcheck providers independently validated', () => {
    expect(isUiLocale('pt-BR')).toBe(true);
    expect(isUiLocale('pt-PT')).toBe(false);
    expect(
      isSpellcheckCapabilities({
        provider: 'macos-native',
        canSelectLanguages: false,
        downloadsDictionaries: false,
      }),
    ).toBe(true);
  });

  it('accepts only known menu command identifiers', () => {
    expect(isApplicationMenuCommand('file.closeWindow')).toBe(true);
    expect(isApplicationMenuCommand('edit.copy')).toBe(true);
    expect(isApplicationMenuCommand('developer.execute')).toBe(false);
    expect(isApplicationMenuCommand({ command: 'edit.copy' })).toBe(false);
  });

  it('accepts only known window actions and valid window state', () => {
    expect(isWindowControlAction('minimize')).toBe(true);
    expect(isWindowControlAction('toggle-maximize')).toBe(true);
    expect(isWindowControlAction('close')).toBe(true);
    expect(isWindowControlAction('move')).toBe(false);
    expect(isWindowState({ maximized: true })).toBe(true);
    expect(isWindowState({ maximized: 'yes' })).toBe(false);
  });

  it('bounds external link requests and results', () => {
    expect(isOpenExternalLinkRequest({ url: 'https://example.com' })).toBe(true);
    expect(isOpenExternalLinkRequest({ url: '' })).toBe(false);
    expect(isOpenExternalLinkRequest({ url: 'x'.repeat(4_097) })).toBe(false);
    expect(isOpenExternalLinkRequest({ url: 4 })).toBe(false);
    expect(isOpenExternalLinkResult({ ok: true })).toBe(true);
    expect(
      isOpenExternalLinkResult({ ok: false, error: 'unsupported-scheme' }),
    ).toBe(true);
    expect(isOpenExternalLinkResult({ ok: false, error: 'unknown' })).toBe(false);
  });

  it('validates native-core ready and error messages', () => {
    expect(
      isNativeCoreMessage({
        type: 'native-core:ready',
        payload: { coreVersion: '0.1.0', protocolVersion: 1 },
      }),
    ).toBe(true);
    expect(
      isNativeCoreMessage({
        type: 'native-core:error',
        payload: { code: 'LOAD_FAILED', message: 'Could not load addon.' },
      }),
    ).toBe(true);
    expect(
      isNativeCoreMessage({
        type: 'native-core:error',
        payload: { code: 'NOT_ALLOWED', message: 'Invalid code.' },
      }),
    ).toBe(false);
    expect(isNativeCoreMessage({ type: 'native-core:ready', payload: {} })).toBe(
      false,
    );
  });
});
