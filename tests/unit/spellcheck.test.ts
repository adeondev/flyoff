import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BundledSpellcheckService,
  ElectronSpellcheckService,
  SpellcheckLanguageSelectionUnsupportedError,
  UnsupportedSpellcheckLanguagesError,
  getSpellcheckCapabilities,
  type ElectronSpellcheckSession,
} from '../../src/main/services/spellcheck';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

interface FakeSession {
  availableSpellCheckerLanguages: string[];
  getSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  setSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  addWordToSpellCheckerDictionary: ReturnType<typeof vi.fn>;
  events: EventEmitter;
}

function createSession(
  available = ['en-US', 'pt-BR'],
  active = ['pt-BR'],
): FakeSession & ElectronSpellcheckSession {
  const events = new EventEmitter();
  const session: FakeSession = {
    availableSpellCheckerLanguages: [...available],
    getSpellCheckerLanguages: vi.fn(() => [...active]),
    setSpellCheckerLanguages: vi.fn(),
    addWordToSpellCheckerDictionary: vi.fn(() => true),
    events,
  };

  return Object.assign(session, {
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  }) as FakeSession & ElectronSpellcheckSession;
}

describe('spellcheck capabilities', () => {
  it.each(['win32', 'linux'] as const)(
    'uses the bundled Hunspell engine on %s',
    (platform) => {
      expect(getSpellcheckCapabilities(platform)).toEqual({
        provider: 'bundled-hunspell',
        canSelectLanguages: true,
        downloadsDictionaries: false,
      });
    },
  );

  it('delegates spellchecking to macOS', () => {
    expect(getSpellcheckCapabilities('darwin')).toEqual({
      provider: 'macos-native',
      canSelectLanguages: false,
      downloadsDictionaries: false,
    });
  });
});

describe('BundledSpellcheckService', () => {
  it('checks Brazilian Portuguese and returns native Hunspell suggestions', async () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'flyoff-spellcheck-'),
    );
    temporaryDirectories.push(directory);
    const service = new BundledSpellcheckService(directory);
    service.setActiveLanguages(['pt-BR']);

    await expect(service.checkWords(['casa', 'caza'])).resolves.toEqual([
      'caza',
    ]);
    await expect(service.getSuggestions('caza')).resolves.toContain('casa');
  });

  it('persists personal words independently of preferences', async () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'flyoff-spellcheck-'),
    );
    temporaryDirectories.push(directory);
    const first = new BundledSpellcheckService(directory);
    first.setActiveLanguages(['pt-BR']);
    expect(await first.addWordToDictionary('Gabrielzito')).toBe(true);

    const restored = new BundledSpellcheckService(directory);
    restored.setActiveLanguages(['pt-BR']);
    await expect(
      restored.checkWords(['Gabrielzito']),
    ).resolves.toEqual([]);
  });
});

describe('ElectronSpellcheckService', () => {
  it('returns defensive copies of available and active languages', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'linux');

    const available = service.getAvailableLanguages() as string[];
    const active = service.getActiveLanguages() as string[];
    available.push('fr-FR');
    active.push('en-US');

    expect(session.availableSpellCheckerLanguages).toEqual(['en-US', 'pt-BR']);
    expect(service.getActiveLanguages()).toEqual(['pt-BR']);
  });

  it('normalizes and de-duplicates supported language selections', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'win32');

    service.setActiveLanguages([' pt-BR ', 'en-US', 'pt-BR']);

    expect(session.setSpellCheckerLanguages).toHaveBeenCalledOnce();
    expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith([
      'pt-BR',
      'en-US',
    ]);
  });

  it('adds a word through the active session dictionary', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'win32');

    expect(service.addWordToDictionary('Flyoff')).toBe(true);
    expect(
      session.addWordToSpellCheckerDictionary,
    ).toHaveBeenCalledWith('Flyoff');
  });

  it('rejects empty and unavailable language codes', () => {
    const service = new ElectronSpellcheckService(createSession(), 'linux');

    expect(() => service.setActiveLanguages([' '])).toThrow(TypeError);

    try {
      service.setActiveLanguages(['fr-FR', 'de-DE']);
      throw new Error('Expected unsupported languages to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSpellcheckLanguagesError);
      expect(
        (error as UnsupportedSpellcheckLanguagesError).languageCodes,
      ).toEqual(['fr-FR', 'de-DE']);
    }
  });

  it('does not allow explicit language selection on macOS', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'darwin');

    expect(() => service.setActiveLanguages(['pt-BR'])).toThrow(
      SpellcheckLanguageSelectionUnsupportedError,
    );
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled();
  });

  it('forwards Chromium dictionary events and removes all listeners', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'linux');
    const listener = vi.fn();
    const unsubscribe = service.onDictionaryDownload(listener);

    session.events.emit('spellcheck-dictionary-download-begin', {}, 'pt-BR');
    session.events.emit('spellcheck-dictionary-download-success', {}, 'pt-BR');
    session.events.emit('spellcheck-dictionary-download-failure', {}, 'en-US');
    session.events.emit('spellcheck-dictionary-initialized', {}, 'en-US');

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { type: 'download-started', languageCode: 'pt-BR' },
      { type: 'download-succeeded', languageCode: 'pt-BR' },
      { type: 'download-failed', languageCode: 'en-US' },
      { type: 'dictionary-initialized', languageCode: 'en-US' },
    ]);

    unsubscribe();
    unsubscribe();
    session.events.emit('spellcheck-dictionary-download-begin', {}, 'en-US');

    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('does not subscribe to download events on macOS', () => {
    const session = createSession();
    const service = new ElectronSpellcheckService(session, 'darwin');
    const listener = vi.fn();

    service.onDictionaryDownload(listener)();
    session.events.emit('spellcheck-dictionary-download-begin', {}, 'pt-BR');

    expect(listener).not.toHaveBeenCalled();
    expect(session.events.eventNames()).toEqual([]);
  });
});
